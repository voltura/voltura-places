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
const errorSchema = z.object({ error: z.string().optional() });
const mutationResultSchema = z.object({
  accountId: z.string(),
  record: recordSchema.optional(),
  error: z.string().optional(),
});
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type Account = { id: string; methods: { provider: string; label: string }[] };
export type AccountState = {
  enabled: boolean;
  providers: { google?: boolean; email?: boolean; chatgpt?: boolean };
  account: Account | null;
};
export async function api<T>(
  path: string,
  body?: unknown,
  account?: string,
  method?: string,
): Promise<T> {
  const response = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: {
      "X-Places-Photos": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(account ? workspaceHeaders(account) : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      errorSchema.safeParse(data).data?.error ?? "serviceUnavailable",
    );
  return data as T;
}
export const fetchSnapshot = async (account: string, isCurrent = () => true) => {
  const records = [];
  const ids = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 200; page++) {
    if (!isCurrent()) throw new Error("accountChanged");
    const result = snapshotSchema.parse(
      await api(
        `/api/v1/sync${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        account,
      ),
    );
    if (!isCurrent()) throw new Error("accountChanged");
    if (result.accountId !== account) throw new Error("accountChanged");
    for (const record of result.records) {
      if (ids.has(record.id) || (cursor && record.id <= cursor)) throw new Error("invalidResponse");
      ids.add(record.id);
    }
    records.push(...result.records);
    if (!result.nextCursor) return { version: 1 as const, accountId: account, records };
    if (result.nextCursor <= cursor) throw new Error("invalidResponse");
    cursor = result.nextCursor;
  }
  throw new Error("libraryLimit");
};
const running = new Set<string>();
const requestedAgain = new Set<string>();
export async function synchronize(
  account: string,
  onStatus: (s: string) => void,
  isCurrent: () => boolean = () => true,
) {
  if (running.has(account)) {
    requestedAgain.add(account);
    return;
  }
  running.add(account);
  const run = async () => {
    try {
      if (!isCurrent()) return;
      if (!(await readWorkspace(account)).reconciled) return;
      if (!isCurrent()) return;
      if (!navigator.onLine) {
        onStatus("offline");
        return;
      }
      onStatus("syncing");
      // Persist exact request bodies before network access. A lost response retries the same ID/body.
      for (let i = 0; i < 5200; i++) {
        if (!isCurrent()) return;
        const flight = await prepareMutation(account, isCurrent);
        if (!flight) break;
        if (
          !flight.mutation.deleted &&
          flight.mutation.entity.kind === "place" &&
          flight.mutation.entity.value.photoId
        )
          await uploadPhoto(account, flight.mutation.entity.value.photoId, isCurrent);
        if (!isCurrent()) return;
        const response = await fetch("/api/v1/sync", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            "Content-Type": "application/json",
            ...workspaceHeaders(account),
            "X-Places-Photos": "1",
          },
          body: JSON.stringify(flight.mutation),
        });
        const data = mutationResultSchema.parse(await response.json());
        if (!isCurrent()) return;
        if (data.accountId !== account) throw new Error("accountChanged");
        if (response.status === 413 && data.error === "libraryLimit") {
          await deferCapacityFlight(account, flight.mutation.mutationId, isCurrent);
          const next = await readWorkspace(account);
          if (next.flight) throw new Error("libraryLimit");
          continue;
        }
        if (!response.ok && response.status !== 409)
          throw new Error(data.error ?? "serviceUnavailable");
        const remote = recordSchema.parse(data.record);
        if (remote.id !== flight.mutation.entity.id || remote.kind !== flight.mutation.entity.kind)
          throw new Error("invalidResponse");
        await acknowledge(
          account,
          flight.mutation.mutationId,
          remote,
          response.status === 409,
          isCurrent,
        );
      }
      if (!isCurrent()) return;
      const snapshot = await fetchSnapshot(account, isCurrent);
      if (!isCurrent()) return;
      if (snapshot.accountId !== account) throw new Error("accountChanged");
      await mergeSnapshot(account, snapshot.records, isCurrent);
      const w = await readWorkspace(account);
      const photoIds = new Set(
        w.records
          .flatMap((r) => [r, ...(r.conflict ? [r.conflict] : [])])
          .flatMap((r) =>
            r.kind === "place" && !r.deleted && r.value.photoId ? [r.value.photoId] : [],
          ),
      );
      for (const id of photoIds) {
        if (!isCurrent()) return;
        await loadPhoto(account, id, isCurrent);
      }
      if (!isCurrent()) return;
      onStatus(
        w.records.some((r) => r.conflict)
          ? "actionRequired"
          : w.records.some((r) => r.dirty)
            ? "pending"
            : "synced",
      );
    } catch {
      if (isCurrent()) onStatus(navigator.onLine ? "actionRequired" : "offline");
    }
  };
  let entered = false;
  try {
    if (typeof navigator.locks?.request === "function")
      await navigator.locks.request(`places-sync:${account}`, () => {
        entered = true;
        return run();
      });
    else {
      entered = true;
      await run();
    }
  } catch {
    // The durable flight and server receipts also protect browsers that deny
    // Web Locks. Never start another run after its callback already entered.
    if (!entered) await run();
    else if (isCurrent()) onStatus(navigator.onLine ? "actionRequired" : "offline");
  } finally {
    running.delete(account);
  }
  if (requestedAgain.delete(account) && isCurrent())
    await synchronize(account, onStatus, isCurrent);
}
