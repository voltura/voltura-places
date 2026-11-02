export type SyncStatus =
  | "localOnly"
  | "pending"
  | "syncing"
  | "offline"
  | "savedPending"
  | "retryRefresh"
  | "retryUpload"
  | "syncPhotoUnavailable"
  | "syncConflict"
  | "actionRequired"
  | "synced"
  | "reconcilePending";
import { api, ApiError } from "./http";
import { sameValue } from "./library-records";
import { syncLimits } from "../../shared/limits";
import { workspaceHeaders } from "../../shared/families";
import { recordSchema, snapshotSchema } from "../../shared/model";
import {
  deferCapacityFlight,
  acknowledge,
  mergeSnapshot,
  prepareMutation,
  readWorkspace,
} from "./library";
import { z } from "zod";
import { uploadPhoto, loadPhoto } from "./photos";
import { workspacePhotoIds } from "./photo-store";

const mutationResultSchema = z.object({
  accountId: z.string(),
  record: recordSchema.optional(),
  error: z.string().optional(),
});

export const fetchSnapshot = async (account: string, isCurrent = () => true) => {
  const records = [];
  const ids = new Set<string>();
  let cursor = "";
  for (let page = 0; page < Math.ceil(syncLimits.snapshotRecords / syncLimits.pageSize); page++) {
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    const result = snapshotSchema.parse(
      await api(
        `/api/v1/sync${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        account,
      ),
    );
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    if (result.accountId !== account) {
      throw new Error("accountChanged");
    }
    for (const record of result.records) {
      if (ids.has(record.id) || (cursor && record.id <= cursor)) {
        throw new Error("invalidResponse");
      }
      ids.add(record.id);
    }
    records.push(...result.records);
    if (result.nextCursor == null) {
      return { version: 1 as const, accountId: account, records };
    }
    if (
      !result.records.length ||
      result.nextCursor !== result.records.at(-1)!.id ||
      result.records.some((record) => record.id > result.nextCursor!)
    ) {
      throw new Error("invalidResponse");
    }
    cursor = result.nextCursor;
  }
  throw new Error("libraryLimit");
};

export function temporarySyncFailure(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && ["TimeoutError", "NetworkError"].includes(error.name)) ||
    (error instanceof ApiError && (error.status >= 500 || [408, 429].includes(error.status)))
  );
}

const running = new Map<string, Promise<void>>();
const requestedAgain = new Map<
  string,
  {
    onStatus: (status: SyncStatus) => void;
    isCurrent: () => boolean;
  }[]
>();

export async function synchronizeAndWait(
  account: string,
  onStatus: (status: SyncStatus) => void,
  isCurrent = () => true,
) {
  let previous;
  while ((previous = running.get(account))) {
    await previous;
    if (!isCurrent()) {
      return;
    }
  }
  await synchronize(account, onStatus, isCurrent);
}

export async function synchronize(
  account: string,
  onStatus: (s: SyncStatus) => void,
  isCurrent: () => boolean = () => true,
) {
  if (!isCurrent()) {
    return;
  }
  const previous = running.get(account);
  if (previous) {
    const queued = (requestedAgain.get(account) ?? []).filter((request) => request.isCurrent());
    if (!queued.some((request) => request.isCurrent === isCurrent)) {
      queued.push({ onStatus, isCurrent });
    }
    requestedAgain.set(account, queued);

    return;
  }
  let complete!: () => void;
  const completion = new Promise<void>((resolve) => {
    complete = resolve;
  });
  running.set(account, completion);

  const run = async () => {
    try {
      if (!isCurrent()) {
        return;
      }
      if (!(await readWorkspace(account)).reconciled) {
        return;
      }
      if (!isCurrent()) {
        return;
      }
      if (!navigator.onLine) {
        onStatus("offline");

        return;
      }
      onStatus("syncing");
      // Persist exact request bodies before network access. A lost response retries the same ID/body.
      let repairedPhotoFlight: string | undefined;
      let retrySnapshotLimit = true;
      for (let i = 0; i < syncLimits.mutationBatch; i++) {
        if (!isCurrent()) {
          return;
        }
        const flight = await prepareMutation(account, isCurrent, retrySnapshotLimit);
        if (!flight) {
          break;
        }
        if (
          !flight.mutation.deleted &&
          flight.mutation.entity.kind === "place" &&
          flight.mutation.entity.value.photoId
        ) {
          await uploadPhoto(account, flight.mutation.entity.value.photoId, isCurrent);
        }
        if (!isCurrent()) {
          return;
        }
        const response = await fetch("/api/v1/sync", {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          mode: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            "Content-Type": "application/json",
            ...workspaceHeaders(account),
            "X-Places-Photos": "1",
          },
          body: JSON.stringify(flight.mutation),
        });
        if (!response.ok && ![409, 413, 422].includes(response.status)) {
          throw new ApiError(response.status, "mutationFailed");
        }
        const data = mutationResultSchema.parse(await response.json());
        if (!isCurrent()) {
          return;
        }
        if (data.accountId !== account) {
          throw new Error("accountChanged");
        }
        if (
          response.status === 422 &&
          data.error === "photoUnavailable" &&
          !flight.mutation.deleted &&
          flight.mutation.entity.kind === "place" &&
          flight.mutation.entity.value.photoId &&
          repairedPhotoFlight !== flight.mutation.mutationId
        ) {
          repairedPhotoFlight = flight.mutation.mutationId;
          await uploadPhoto(account, flight.mutation.entity.value.photoId, isCurrent, true);
          continue;
        }
        if (
          response.status === 413 &&
          data.error === "snapshotLimit" &&
          flight.mutation.baseRevision === 0
        ) {
          await deferCapacityFlight(account, flight.mutation.mutationId, isCurrent, true);
          retrySnapshotLimit = false;
          continue;
        }
        if (response.status === 413 && data.error === "libraryLimit") {
          const next = await deferCapacityFlight(account, flight.mutation.mutationId, isCurrent);
          if (next.flight) {
            throw new Error("libraryLimit");
          }
          continue;
        }
        if (!response.ok && response.status !== 409) {
          throw new Error(data.error ?? "serviceUnavailable");
        }
        const remote = recordSchema.parse(data.record);
        if (
          remote.id !== flight.mutation.entity.id ||
          remote.kind !== flight.mutation.entity.kind ||
          (response.ok &&
            (remote.revision !== flight.mutation.baseRevision + 1 ||
              remote.deleted !== flight.mutation.deleted))
        ) {
          throw new Error("invalidResponse");
        }
        if (response.ok) {
          const submitted = flight.mutation.entity;
          // Compatibility writes without a photo field preserve the existing
          // cloud attachment on an update; every other value must match.
          const expected =
            submitted.kind === "place" &&
            remote.kind === "place" &&
            flight.mutation.baseRevision > 0 &&
            submitted.value.photoId === undefined
              ? { ...submitted.value, photoId: remote.value.photoId }
              : submitted.value;
          if (!sameValue(expected, remote.value)) {
            throw new Error("invalidResponse");
          }
        }
        await acknowledge(
          account,
          flight.mutation.mutationId,
          remote,
          response.status === 409,
          isCurrent,
        );
      }
      if (!isCurrent()) {
        return;
      }
      const snapshot = await fetchSnapshot(account, isCurrent);
      if (!isCurrent()) {
        return;
      }
      if (snapshot.accountId !== account) {
        throw new Error("accountChanged");
      }
      const w = await mergeSnapshot(account, snapshot.records, isCurrent);
      const photoIds = new Set<string>();
      for (const r of w.records) {
        if (r.kind === "place" && !r.deleted && r.value.photoId) {
          photoIds.add(r.value.photoId);
        }
        const conflict = r.conflict;
        if (conflict?.kind === "place" && !conflict.deleted && conflict.value.photoId) {
          photoIds.add(conflict.value.photoId);
        }
      }
      const cachedPhotos = photoIds.size ? await workspacePhotoIds(account) : new Set<string>();
      let missingPhoto = false;
      let lastPhotoHadServerError = false;
      for (const id of photoIds) {
        if (!isCurrent()) {
          return;
        }
        if (cachedPhotos.has(id)) {
          continue;
        }
        try {
          await loadPhoto(account, id, isCurrent);
          lastPhotoHadServerError = false;
        } catch (error) {
          if (!isCurrent()) {
            return;
          }
          // A single unavailable attachment must not block healthy photos.
          // Consecutive server errors indicate an outage; throttling stops immediately.
          const serverError = error instanceof ApiError && error.status >= 500;
          if (
            !navigator.onLine ||
            (temporarySyncFailure(error) && (!serverError || lastPhotoHadServerError)) ||
            (error instanceof ApiError && [401, 403, 409].includes(error.status))
          ) {
            throw error;
          }
          lastPhotoHadServerError = serverError;
          missingPhoto = true;
        }
      }
      if (!isCurrent()) {
        return;
      }
      const latest = await readWorkspace(account);
      if (!isCurrent()) {
        return;
      }
      onStatus(
        latest.records.some((r) => r.conflict)
          ? "syncConflict"
          : latest.deferredFlights?.some((flight) => flight.snapshotBlocked)
            ? "actionRequired"
            : missingPhoto
              ? "syncPhotoUnavailable"
              : latest.records.some((r) => r.dirty)
                ? "savedPending"
                : "synced",
      );
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      let status: SyncStatus = "actionRequired";
      if (!navigator.onLine) {
        status = "offline";
      } else if (temporarySyncFailure(error)) {
        const local = await readWorkspace(account);
        status = local.records.some((r) => r.conflict)
          ? "syncConflict"
          : local.flight || local.records.some((r) => r.dirty)
            ? "retryUpload"
            : "retryRefresh";
      } else if (error instanceof Error && error.message === "syncBusy") {
        status = "pending";
      } else if (error instanceof Error && error.message === "photoUnavailable") {
        status = "syncPhotoUnavailable";
      }
      if (isCurrent()) {
        onStatus(status);
      }
    }
  };

  let entered = false;
  try {
    if (typeof navigator.locks?.request === "function") {
      await navigator.locks.request(`places-sync:${account}`, () => {
        entered = true;

        return run();
      });
    } else {
      entered = true;
      await run();
    }
  } catch {
    // The durable flight and server receipts also protect browsers that deny
    // Web Locks. Never start another run after its callback already entered.
    if (!entered) {
      await run();
    } else if (isCurrent()) {
      onStatus(navigator.onLine ? "actionRequired" : "offline");
    }
  } finally {
    running.delete(account);
    complete();
  }
  const next = requestedAgain.get(account)?.find((request) => request.isCurrent());
  requestedAgain.delete(account);
  if (next?.isCurrent()) {
    // Retain an active caller's status subscription; use the queued caller only
    // when the previous view has gone away.
    const continuing = isCurrent();
    await synchronize(
      account,
      continuing ? onStatus : next.onStatus,
      continuing ? isCurrent : next.isCurrent,
    );
  }
}
