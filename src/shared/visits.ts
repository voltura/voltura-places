import { workspaceIdentity } from "./families";
import type { Entity, LocalRecord, VisitStatus } from "./model";

export const visitOwner = (workspace: string) => workspaceIdentity(workspace).account;
export async function visitEntity(
  workspace: string,
  placeId: string,
  status: VisitStatus,
): Promise<Extract<Entity, { kind: "visit" }>> {
  const libraryId = workspaceIdentity(workspace).family;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([libraryId, placeId])),
  );
  const id =
    "visit-" + [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
  return {
    id,
    kind: "visit",
    value: { placeId, libraryId, status, updatedAt: new Date().toISOString() },
  };
}
export function visitStatuses(records: LocalRecord[], workspace: string) {
  const libraryId = workspaceIdentity(workspace).family;
  return new Map(
    records.flatMap((r) =>
      r.kind === "visit" && !r.deleted && r.value.libraryId === libraryId
        ? [[r.value.placeId, r.value.status] as const]
        : [],
    ),
  );
}
