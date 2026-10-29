import { openDB, type DBSchema } from "idb";
import {
  starters,
  validateBackup,
  type Backup,
  type Entity,
  type LocalRecord,
  type Mutation,
  type RecordState,
} from "../../shared/model";

export type Workspace = {
  key: string;
  records: LocalRecord[];
  flight?: { mutation: Mutation; generation: number };
  reconciled: boolean;
};
interface PlacesDB extends DBSchema {
  workspaces: { key: string; value: Workspace };
  drafts: { key: string; value: unknown };
}
const database = () =>
  openDB<PlacesDB>("voltura-places", 1, {
    upgrade(db) {
      db.createObjectStore("workspaces", { keyPath: "key" });
      db.createObjectStore("drafts");
    },
  });
const seed = (key: string): Workspace => ({
  key,
  reconciled: key === "guest",
  records: starters.map((e) => ({
    ...structuredClone(e),
    revision: 0,
    deleted: false,
    generation: 0,
    dirty: false,
  })),
});
export const channel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("places-library") : null;
const changed = () => {
  window.dispatchEvent(new Event("places-library"));
  channel?.postMessage("changed");
};
export async function readWorkspace(key: string) {
  const db = await database();
  return (await db.get("workspaces", key)) ?? seed(key);
}
export async function changeWorkspace(key: string, update: (w: Workspace) => void) {
  const db = await database(),
    tx = db.transaction("workspaces", "readwrite");
  const w = (await tx.store.get(key)) ?? seed(key);
  try {
    update(w);
    enforceCapacity(w);
    await tx.store.put(w);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
  changed();
  return w;
}
function enforceCapacity(w: Workspace) {
  if (
    w.records.filter((r) => r.kind === "place" && !r.deleted).length > 5000 ||
    w.records.filter((r) => r.kind === "category" && !r.deleted).length > 200
  )
    throw new Error("libraryLimit");
}
function write(w: Workspace, e: Entity, deleted = false) {
  const previous = w.records.find((r) => r.id === e.id);
  if (previous && previous.kind !== e.kind) throw new Error("invalidImport");
  const next: LocalRecord = {
    ...e,
    revision: previous?.revision ?? 0,
    generation: (previous?.generation ?? 0) + 1,
    dirty: true,
    deleted,
  };
  w.records = w.records.filter((r) => r.id !== e.id).concat(next);
}
export const saveEntity = (key: string, e: Entity) => changeWorkspace(key, (w) => write(w, e));
export const deleteEntity = (key: string, id: string) =>
  changeWorkspace(key, (w) => {
    const r = w.records.find((r) => r.id === id);
    if (!r || id === "other") return;
    if (r.kind === "category")
      for (const place of w.records.filter((p) => p.kind === "place" && !p.deleted)) {
        if (place.kind === "place" && place.value.categoryId === id)
          write(w, {
            ...place,
            value: { ...place.value, categoryId: "other", updatedAt: new Date().toISOString() },
          });
      }
    write(w, r, true);
  });
export function exportBackup(w: Workspace): Backup {
  const categories = w.records
    .filter((r) => r.kind === "category" && !r.deleted)
    .map((r) => ({ id: r.id, value: r.value }));
  const ids = new Set(categories.map((c) => c.id));
  return validateBackup({
    format: "voltura-places",
    version: 1,
    exportedAt: new Date().toISOString(),
    categories,
    places: w.records
      .filter((r) => r.kind === "place" && !r.deleted)
      .map((r) =>
        r.kind === "place"
          ? {
              id: r.id,
              value: {
                ...r.value,
                categoryId: ids.has(r.value.categoryId) ? r.value.categoryId : "other",
              },
            }
          : null,
      ),
  });
}
export async function importBackup(key: string, input: unknown, replace = false) {
  const b = validateBackup(input);
  return changeWorkspace(key, (w) => {
    if (w.flight) throw new Error("syncBusy");
    const incoming = new Set([...b.places, ...b.categories].map((e) => e.id));
    if (replace)
      for (const r of [...w.records]) if (!r.deleted && !incoming.has(r.id)) write(w, r, true);
    // Merge retains a conflicting local value under its own identity.
    const categoryMap = new Map<string, string>();
    for (const e of b.categories) {
      const old = w.records.find((r) => r.id === e.id && !r.deleted);
      const different = old && JSON.stringify(old.value) !== JSON.stringify(e.value);
      if (!replace && different && e.id === "other") {
        categoryMap.set(e.id, "other");
        continue;
      }
      const id = !replace && different ? crypto.randomUUID() : e.id;
      categoryMap.set(e.id, id);
      write(w, { id, kind: "category", value: e.value });
    }
    for (const e of b.places) {
      const value = { ...e.value, categoryId: categoryMap.get(e.value.categoryId) ?? "other" };
      const old = w.records.find((r) => r.id === e.id && !r.deleted);
      if (!replace && old && JSON.stringify(old.value) === JSON.stringify(value)) continue;
      write(w, { id: !replace && old ? crypto.randomUUID() : e.id, kind: "place", value });
    }
  });
}
export async function reconcileAccount(key: string, cloud: RecordState[], merge: boolean) {
  const guest = await readWorkspace("guest");
  return changeWorkspace(key, (w) => {
    if (w.reconciled) return;
    w.records = cloud.map((r) => ({ ...r, generation: 0, dirty: false }));
    for (const e of starters)
      if (!w.records.some((r) => r.id === e.id))
        w.records.push({
          ...structuredClone(e),
          revision: 0,
          deleted: false,
          generation: 0,
          dirty: false,
        });
    if (merge) {
      const map = new Map<string, string>();
      for (const r of guest.records.filter((r) => r.kind === "category" && !r.deleted)) {
        const old = w.records.find((c) => c.id === r.id);
        const id =
          old && JSON.stringify(old.value) !== JSON.stringify(r.value) ? crypto.randomUUID() : r.id;
        map.set(r.id, id);
        if (!old || id !== r.id) write(w, { ...r, id });
      }
      for (const r of guest.records.filter((r) => r.kind === "place" && !r.deleted))
        if (r.kind === "place") {
          const id = w.records.some((c) => c.id === r.id) ? crypto.randomUUID() : r.id;
          write(w, {
            id,
            kind: "place",
            value: { ...r.value, categoryId: map.get(r.value.categoryId) ?? "other" },
          });
        }
    }
    w.reconciled = true;
  });
}
export const mergeSnapshot = (key: string, remote: RecordState[]) =>
  changeWorkspace(key, (w) => {
    for (const r of remote) {
      const local = w.records.find((l) => l.id === r.id);
      if (!local) {
        w.records.push({ ...r, generation: 0, dirty: false });
        continue;
      }
      if (!local.dirty) {
        Object.assign(local, r);
        delete local.conflict;
      } else if (r.revision !== local.revision) local.conflict = r;
    }
  });
export async function prepareMutation(key: string) {
  let flight: Workspace["flight"];
  await changeWorkspace(key, (w) => {
    if (!w.reconciled) return;
    if (!w.flight) {
      const r = w.records.find((r) => r.dirty && !r.conflict);
      if (!r) return;
      w.flight = {
        generation: r.generation,
        mutation: {
          version: 1,
          mutationId: crypto.randomUUID(),
          baseRevision: r.revision,
          deleted: r.deleted,
          entity: { id: r.id, kind: r.kind, value: r.value } as Entity,
        },
      };
    }
    flight = structuredClone(w.flight);
  });
  return flight;
}
export const acknowledge = (
  key: string,
  mutationId: string,
  remote: RecordState,
  conflict = false,
) =>
  changeWorkspace(key, (w) => {
    const flight = w.flight;
    if (!flight || flight.mutation.mutationId !== mutationId) return;
    const r = w.records.find((r) => r.id === remote.id);
    if (r) {
      if (conflict) r.conflict = remote;
      else if (r.generation === flight.generation) {
        Object.assign(r, remote, { dirty: false });
        delete r.conflict;
      } else r.revision = remote.revision;
    }
    delete w.flight;
  });
export const resolveConflict = (key: string, id: string, choice: "device" | "cloud" | "both") =>
  changeWorkspace(key, (w) => {
    const r = w.records.find((r) => r.id === id);
    if (!r?.conflict) return;
    const cloud = r.conflict;
    if (choice === "both" && !r.deleted) write(w, { ...r, id: crypto.randomUUID() });
    if (choice === "cloud" || choice === "both") Object.assign(r, cloud, { dirty: false });
    else {
      r.revision = cloud.revision;
      r.generation++;
      r.dirty = true;
    }
    delete r.conflict;
  });
export async function getDraft(key: string) {
  return (await database()).get("drafts", key);
}
let pendingDraft = Promise.resolve();
export function setDraft(key: string, value: unknown) {
  pendingDraft = pendingDraft
    .catch(() => {})
    .then(async () => {
      const db = await database();
      if (value === null) await db.delete("drafts", key);
      else await db.put("drafts", value, key);
    });
  return pendingDraft;
}
export const flushDrafts = () => pendingDraft;
export async function removeWorkspace(key: string) {
  await (await database()).delete("workspaces", key);
  await setDraft(key, null);
  changed();
}
