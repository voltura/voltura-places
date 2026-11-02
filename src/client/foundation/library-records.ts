import { entitySchema, type Entity, type LocalRecord, type RecordState } from "../../shared/model";
import { entityLimits } from "../../shared/limits";
import { workspaceIdentity } from "../../shared/families";
import type { Workspace } from "./library-types";

// In-memory record transitions. Callers own the transaction and cancellation boundary.
export function enforceCapacity(w: Workspace) {
  const family = workspaceIdentity(w.key).family;
  const counts = { place: 0, category: 0, visit: 0 };
  for (const record of w.records) {
    if (family && record.kind === "visit") {
      throw new Error("invalidImport");
    }
    if (!record.deleted && ++counts[record.kind] > entityLimits[record.kind]) {
      throw new Error("libraryLimit");
    }
  }
}

function editedRecord(
  w: Workspace,
  previous: LocalRecord | undefined,
  e: Entity,
  deleted = false,
): LocalRecord {
  if (e.kind !== "visit" && e.id.startsWith("visit-")) {
    throw new Error("invalidImport");
  }
  if (previous && previous.kind !== e.kind) {
    throw new Error("invalidImport");
  }

  // A guest record can be removed after transfer and later restored from a backup.
  // Never reuse a generation already acknowledged or skipped for this source ID.
  const receipt =
    !previous && w.key === "guest" && e.kind === "place" ? w.deviceTransfers?.[e.id] : undefined;
  const generation =
    previous?.generation ?? Math.max(receipt?.generation ?? 0, receipt?.skippedGeneration ?? 0);

  return {
    ...entitySchema.parse(e),
    revision: previous?.revision ?? 0,
    generation: generation + 1,
    dirty: true,
    deleted,
    ...(previous?.conflict ? { conflict: previous.conflict } : {}),
  };
}

export function write(w: Workspace, e: Entity, deleted = false) {
  const index = w.records.findIndex((record) => record.id === e.id);
  const next = editedRecord(w, index < 0 ? undefined : w.records[index], e, deleted);
  if (index >= 0) {
    w.records.splice(index, 1);
  }
  w.records.push(next);

  return next;
}

// Bulk operations preserve the same replacement order, revisions, generations
// and conflict metadata as individual writes without rebuilding an array per edit.
export function recordBatch(w: Workspace) {
  const records = new Map(w.records.map((record) => [record.id, record]));

  return {
    get: (id: string) => records.get(id),
    write(e: Entity, deleted = false) {
      const next = editedRecord(w, records.get(e.id), e, deleted);
      records.delete(e.id);
      records.set(e.id, next);

      return next;
    },
    commit() {
      w.records = [...records.values()];
    },
  };
}

// Compare JSON values independently of member order, including localized names.
// Undefined optional fields retain their normal JSON omission semantics.
export const valueKey = (value: unknown) =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry,
  );

// Record values are JSON objects with optional fields. Compare their common
// path directly instead of serializing and sorting two objects for each row
// on every unchanged snapshot; absent and undefined members remain equal.
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return valueKey(a) === valueKey(b);
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of Object.keys(left)) {
    if (
      left[key] !== undefined &&
      (!Object.hasOwn(right, key) || !sameValue(left[key], right[key]))
    ) {
      return false;
    }
  }
  for (const key of Object.keys(right)) {
    if (right[key] !== undefined && (!Object.hasOwn(left, key) || left[key] === undefined)) {
      return false;
    }
  }

  return true;
}

export function mergeRecords(w: Workspace, remote: RecordState[]) {
  if (!remote.length) {
    return false;
  }
  const byId = new Map(w.records.map((record) => [record.id, record]));
  let modified = false;
  for (const r of remote) {
    const local = byId.get(r.id);
    if (!local) {
      const added = { ...r, generation: 0, dirty: false };
      w.records.push(added);
      byId.set(r.id, added);
      modified = true;
      continue;
    }
    if (local.kind !== r.kind) {
      throw new Error("invalidResponse");
    }
    if (r.revision < Math.max(local.revision, local.conflict?.revision ?? 0)) {
      continue;
    }
    if (!local.dirty) {
      if (
        !local.conflict &&
        local.revision === r.revision &&
        local.deleted === r.deleted &&
        sameValue(local.value, r.value)
      ) {
        continue;
      }
      Object.assign(local, r);
      delete local.conflict;
      modified = true;
    } else if (r.deleted === local.deleted && sameValue(r.value, local.value)) {
      Object.assign(local, r, { dirty: false });
      delete local.conflict;
      modified = true;
    } else if (
      w.flight?.mutation.entity.id === r.id &&
      local.generation !== w.flight.generation &&
      r.revision === w.flight.mutation.baseRevision + 1 &&
      r.deleted === w.flight.mutation.deleted &&
      sameValue(r.value, w.flight.mutation.entity.value)
    ) {
      if (local.revision === r.revision && !local.conflict) {
        continue;
      }
      local.revision = r.revision;
      delete local.conflict;
      modified = true;
    } else if (r.revision !== local.revision) {
      if (
        local.conflict?.revision === r.revision &&
        local.conflict.deleted === r.deleted &&
        sameValue(local.conflict.value, r.value)
      ) {
        continue;
      }
      local.conflict = r;
      modified = true;
    }
  }
  if (!modified) {
    return false;
  }
}

export function acknowledgeRecord(
  w: Workspace,
  mutationId: string,
  remote: RecordState,
  conflict: boolean,
) {
  const flight = w.flight;
  if (!flight || flight.mutation.mutationId !== mutationId) {
    return false;
  }
  if (remote.id !== flight.mutation.entity.id || remote.kind !== flight.mutation.entity.kind) {
    throw new Error("invalidResponse");
  }
  const r = w.records.find((r) => r.id === remote.id);
  if (r) {
    if (
      r.revision > remote.revision ||
      (!r.dirty &&
        r.revision === remote.revision &&
        r.deleted === remote.deleted &&
        sameValue(r.value, remote.value))
    ) {
      delete w.flight;

      return;
    }
    const newerConflict =
      r.conflict && r.conflict.revision > remote.revision ? r.conflict : undefined;
    const identical =
      remote.kind === flight.mutation.entity.kind &&
      remote.deleted === flight.mutation.deleted &&
      sameValue(remote.value, flight.mutation.entity.value);
    // Two devices may add the same new preset before either sees the other's write.
    if (
      conflict &&
      !newerConflict &&
      r.deleted === remote.deleted &&
      sameValue(r.value, remote.value)
    ) {
      Object.assign(r, remote, { dirty: false });
      delete r.conflict;
    } else if (conflict && !identical) {
      r.conflict = newerConflict ?? remote;
    } else if (r.generation === flight.generation) {
      Object.assign(r, remote, { dirty: false });
      delete r.conflict;
    } else {
      r.revision = remote.revision;
      delete r.conflict;
    }
    if (newerConflict) {
      r.conflict = newerConflict;
      r.dirty = true;
    }
  }
  delete w.flight;
}
