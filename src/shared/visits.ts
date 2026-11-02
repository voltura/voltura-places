import { digest } from "./digest";
import { workspaceIdentity } from "./families";
import type { Entity, LocalRecord, VisitStatus } from "./model";

export const visitOwner = (workspace: string) => workspaceIdentity(workspace).account;

export async function visitEntity(
  workspace: string,
  placeId: string,
  status: VisitStatus,
): Promise<Extract<Entity, { kind: "visit" }>> {
  const libraryId = workspaceIdentity(workspace).family;
  const id = "visit-" + (await digest(JSON.stringify([libraryId, placeId])));

  return {
    id,
    kind: "visit",
    value: { placeId, libraryId, status, updatedAt: new Date().toISOString() },
  };
}

export function visitStatuses(records: LocalRecord[], workspace: string) {
  const libraryId = workspaceIdentity(workspace).family;

  const statuses = new Map<string, VisitStatus>();
  for (const record of records) {
    if (record.kind === "visit" && !record.deleted && record.value.libraryId === libraryId) {
      statuses.set(record.value.placeId, record.value.status);
    }
  }

  return statuses;
}
