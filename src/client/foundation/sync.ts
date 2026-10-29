import { recordSchema, snapshotSchema } from "../../shared/model";
import { acknowledge, mergeSnapshot, prepareMutation, readWorkspace } from "./library";
import { z } from "zod";
import { uploadPhoto, loadPhoto } from "./photos";
const errorSchema = z.object({ error: z.string().optional() });
const mutationResultSchema = z.object({
  accountId: z.string(),
  record: recordSchema.optional(),
  error: z.string().optional(),
});

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
      ...(account ? { "X-Places-Account": account } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(errorSchema.safeParse(data).data?.error ?? "serviceUnavailable");
  return data as T;
}
export const fetchSnapshot = async (account: string) => {
  const records = [];
  let cursor = "";
  for (let page = 0; page < 200; page++) {
    const result = snapshotSchema.parse(
      await api(
        `/api/v1/sync${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
        undefined,
        account,
      ),
    );
    if (result.accountId !== account) throw new Error("accountChanged");
    records.push(...result.records);
    if (!result.nextCursor) return { version: 1 as const, accountId: account, records };
    if (result.nextCursor <= cursor) throw new Error("invalidResponse");
    cursor = result.nextCursor;
  }
  throw new Error("libraryLimit");
};
let running = false;
export async function synchronize(
  account: string,
  onStatus: (s: string) => void,
  isCurrent: () => boolean = () => true,
) {
  if (running) return;
  const run = async () => {
    running = true;
    try {
      if (!(await readWorkspace(account)).reconciled) return;
      if (!navigator.onLine) {
        onStatus("offline");
        return;
      }
      onStatus("syncing");
      // Persist exact request bodies before network access. A lost response retries the same ID/body.
      for (let i = 0; i < 5200; i++) {
        if (!isCurrent()) return;
        const flight = await prepareMutation(account);
        if (!flight) break;
        if (
          !flight.mutation.deleted &&
          flight.mutation.entity.kind === "place" &&
          flight.mutation.entity.value.photoId
        )
          await uploadPhoto(account, flight.mutation.entity.value.photoId);
        if (!isCurrent()) return;
        const response = await fetch("/api/v1/sync", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            "Content-Type": "application/json",
            "X-Places-Account": account,
            "X-Places-Photos": "1",
          },
          body: JSON.stringify(flight.mutation),
        });
        const data = mutationResultSchema.parse(await response.json());
        if (data.accountId !== account) throw new Error("accountChanged");
        if (!response.ok && response.status !== 409)
          throw new Error(data.error ?? "serviceUnavailable");
        const remote = recordSchema.parse(data.record);
        if (remote.id !== flight.mutation.entity.id) throw new Error("invalidResponse");
        await acknowledge(account, flight.mutation.mutationId, remote, response.status === 409);
      }
      if (!isCurrent()) return;
      const snapshot = await fetchSnapshot(account);
      if (snapshot.accountId !== account) throw new Error("accountChanged");
      await mergeSnapshot(account, snapshot.records);
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
        await loadPhoto(account, id);
      }
      onStatus(
        w.records.some((r) => r.conflict)
          ? "actionRequired"
          : w.records.some((r) => r.dirty)
            ? "pending"
            : "synced",
      );
    } catch {
      onStatus(navigator.onLine ? "actionRequired" : "offline");
    } finally {
      running = false;
    }
  };
  if (navigator.locks)
    await navigator.locks.request("places-sync", { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
  else await run();
}
