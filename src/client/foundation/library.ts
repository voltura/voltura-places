import { workspaceIdentity } from "../../shared/families";
import { type DBSchema } from "idb";
import { localDatabase } from "./database";
import {
  copyPhotos,
  clearPhotos,
  clearAccountPhotos,
  makeStoredPhoto,
  putPhotos,
  workspacePhotos,
  type StoredPhoto,
} from "./photo-store";
import { loadPhoto } from "./photos";
import { decodePhoto } from "../../shared/photos";
import {
  starters,
  entitySchema,
  recordSchema,
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
  deferredFlights?: NonNullable<Workspace["flight"]>[];
  importLease?: { token: string; expiresAt: number };
  reconciled: boolean;
  presetRevision?: number;
  deviceAccounts?: string[];
  guestPlaces?: Record<string, string | null>;
  deviceTransfers?: Record<string, { account: string; destination: string; generation: number }>;
};
interface PlacesDB extends DBSchema {
  workspaces: { key: string; value: Workspace };
  drafts: { key: string; value: unknown };
}
const database = localDatabase<PlacesDB>("voltura-places", 1, (db) => {
  db.createObjectStore("workspaces", { keyPath: "key" });
  db.createObjectStore("drafts");
});
const seed = (key: string): Workspace => ({
  key,
  reconciled: key === "guest" || !!workspaceIdentity(key).family,
  presetRevision: 2,
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
  let existing = await db.get("workspaces", key);
  if (!existing) return seed(key);
  // Older Keep both writes copied the source's conflict onto a fresh identity.
  // Its cloud version already belongs to the original record, not this copy.
  if (existing.records.some((r) => r.conflict && r.conflict.id !== r.id))
    existing = await changeWorkspace(key, (w) => {
      for (const r of w.records) if (r.conflict && r.conflict.id !== r.id) delete r.conflict;
    });
  if ((existing.presetRevision ?? 1) >= 2) return existing;
  // Add the new preset once, preserving custom names, tombstones and in-flight writes.
  if (
    !existing.records.some((r) => r.id === "mushrooms") &&
    existing.records.filter((r) => r.kind === "category" && !r.deleted).length >= 200
  )
    return existing;
  return changeWorkspace(key, (w) => {
    if ((w.presetRevision ?? 1) >= 2) return;
    if (!w.records.some((r) => r.id === "mushrooms")) {
      if (w.records.filter((r) => r.kind === "category" && !r.deleted).length >= 200) return;
      w.records.push({
        ...structuredClone(starters.find((e) => e.id === "mushrooms")!),
        revision: 0,
        deleted: false,
        generation: 0,
        dirty: key !== "guest" && w.reconciled,
      });
    }
    w.presetRevision = 2;
  });
}
export async function changeWorkspace(
  key: string,
  update: (w: Workspace) => void | false,
  clearDraftId?: string,
  isCurrent = () => true,
  importToken?: string,
) {
  const db = await database(),
    tx = db.transaction(clearDraftId ? ["workspaces", "drafts"] : ["workspaces"], "readwrite");
  const store = tx.objectStore("workspaces");
  const w = (await store.get(key)) ?? seed(key);
  let modified = false;
  try {
    if (!isCurrent()) throw new Error("accountChanged");
    if (
      w.importLease &&
      w.importLease.expiresAt > Date.now() &&
      w.importLease.token !== importToken
    )
      throw new Error("syncBusy");
    modified = update(w) !== false;
    if (modified) {
      enforceCapacity(w);
      await store.put(w);
    }
    if (clearDraftId) {
      const drafts = tx.objectStore("drafts"),
        draft = await drafts.get(key);
      if (draft && typeof draft === "object" && "id" in draft && draft.id === clearDraftId) {
        await drafts.delete(key);
        modified = true;
      }
    }
    if (!isCurrent()) throw new Error("accountChanged");
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
  if (modified) changed();
  return w;
}
function enforceCapacity(w: Workspace) {
  if (
    w.records.filter((r) => r.kind === "place" && !r.deleted).length > 5000 ||
    w.records.filter((r) => r.kind === "category" && !r.deleted).length > 200
  )
    throw new Error("libraryLimit");
}
function editedRecord(previous: LocalRecord | undefined, e: Entity, deleted = false): LocalRecord {
  if (previous && previous.kind !== e.kind) throw new Error("invalidImport");
  return {
    ...entitySchema.parse(e),
    revision: previous?.revision ?? 0,
    generation: (previous?.generation ?? 0) + 1,
    dirty: true,
    deleted,
    ...(previous?.conflict ? { conflict: previous.conflict } : {}),
  };
}
function write(w: Workspace, e: Entity, deleted = false) {
  const next = editedRecord(
    w.records.find((r) => r.id === e.id),
    e,
    deleted,
  );
  w.records = w.records.filter((r) => r.id !== e.id).concat(next);
}
// Bulk operations preserve the same replacement order, revisions, generations
// and conflict metadata as individual writes without rebuilding an array per edit.
function recordBatch(w: Workspace) {
  const records = new Map(w.records.map((record) => [record.id, record]));
  return {
    get: (id: string) => records.get(id),
    write(e: Entity, deleted = false) {
      const next = editedRecord(records.get(e.id), e, deleted);
      records.delete(e.id);
      records.set(e.id, next);
      return next;
    },
    commit() {
      w.records = [...records.values()];
    },
  };
}
export async function saveEntity(
  key: string,
  e: Entity,
  base?: Entity | null,
  clearDraft = false,
  isCurrent = () => true,
) {
  if (!isCurrent()) throw new Error("accountChanged");
  if (clearDraft) await flushDrafts().catch(() => {});
  return changeWorkspace(
    key,
    (w) => {
      const previous = w.records.find((r) => r.id === e.id);
      const stale =
        base !== undefined &&
        previous &&
        (base === null || previous.deleted || !sameValue(previous.value, base.value)) &&
        (previous.deleted || !sameValue(previous.value, e.value));
      if (stale && previous.dirty) throw new Error("placeChanged");
      write(w, e);
      const saved = w.records.find((r) => r.id === e.id)!;
      if (stale && !saved.conflict) saved.conflict = recordSchema.parse(previous);
    },
    clearDraft ? e.id : undefined,
    isCurrent,
  );
}
export async function copyPlaceToWorkspace(
  from: string,
  to: string,
  id: string,
  isCurrent = () => true,
) {
  const source = await readWorkspace(from),
    place = source.records.find((r) => r.id === id && r.kind === "place" && !r.deleted);
  if (!place || place.kind !== "place") throw new Error("invalidImport");
  if (!isCurrent()) throw new Error("accountChanged");
  if (place.value.photoId) await loadPhoto(from, place.value.photoId, isCurrent);
  const photoIds = place.value.photoId
    ? await copyPhotos(from, to, [place.value.photoId], isCurrent)
    : new Map<string, string>();
  const category = source.records.find(
    (r) => r.id === place.value.categoryId && r.kind === "category" && !r.deleted,
  );
  const newId = crypto.randomUUID();
  return changeWorkspace(
    to,
    (w) => {
      if (!isCurrent()) throw new Error("accountChanged");
      let categoryId = "other";
      if (category?.kind === "category") {
        const same = w.records.find(
          (r) => r.kind === "category" && !r.deleted && r.value.name === category.value.name,
        );
        categoryId = same?.id ?? crypto.randomUUID();
        if (!same) write(w, { ...category, id: categoryId });
      }
      write(w, {
        id: newId,
        kind: "place",
        value: {
          ...place.value,
          ...(place.value.photoId ? { photoId: photoIds.get(place.value.photoId)! } : {}),
          categoryId,
          updatedAt: new Date().toISOString(),
        },
      });
    },
    undefined,
    isCurrent,
  );
}
export async function deleteEntity(key: string, id: string, isCurrent = () => true) {
  await flushDrafts().catch(() => {});
  return changeWorkspace(
    key,
    (w) => {
      const r = w.records.find((r) => r.id === id);
      if (!r || id === "other") return false;
      const batch = recordBatch(w);
      if (r.kind === "category")
        for (const place of w.records.filter((p) => p.kind === "place" && !p.deleted)) {
          if (place.kind === "place" && place.value.categoryId === id)
            batch.write({
              ...place,
              value: { ...place.value, categoryId: "other", updatedAt: new Date().toISOString() },
            });
        }
      batch.write(r, true);
      batch.commit();
    },
    id,
    isCurrent,
  );
}
export function exportBackup(w: Workspace, photos?: { id: string; data: string }[]): Backup {
  const categories = w.records
    .filter((r) => r.kind === "category" && !r.deleted)
    .map((r) => ({ id: r.id, value: r.value }));
  const ids = new Set(categories.map((c) => c.id));
  return validateBackup({
    format: "voltura-places",
    version: photos?.length ? 2 : 1,
    ...(photos?.length ? { photos } : {}),
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
export async function importBackup(
  key: string,
  input: unknown,
  replace = false,
  isCurrent = () => true,
) {
  const b = validateBackup(input);
  if ((await readWorkspace(key)).flight) throw new Error("syncBusy");
  const existingPhotos = await workspacePhotos(key);
  const photos = b.photos ?? [],
    ids = new Map<string, string>();
  const stored: StoredPhoto[] = [];
  // Decode one bounded image at a time, especially on memory-constrained phones.
  for (const p of photos) {
    if (!isCurrent()) throw new Error("accountChanged");
    const photo = await makeStoredPhoto(
      key,
      p.id,
      new Blob([decodePhoto(p.data)], { type: "image/jpeg" }),
    );
    const existing = existingPhotos.find((p) => p.id === photo.id);
    if (existing && existing.hash !== photo.hash)
      photo.id = existingPhotos.find((p) => p.hash === photo.hash)?.id ?? crypto.randomUUID();
    ids.set(p.id, photo.id);
    stored.push(photo);
  }
  if (!isCurrent()) throw new Error("accountChanged");
  for (const place of b.places)
    if (place.value.photoId) place.value.photoId = ids.get(place.value.photoId)!;
  const token = crypto.randomUUID();
  // Reserve the validated capacity before photo persistence. Other tabs cannot
  // introduce a capacity failure between staging bytes and committing records.
  await changeWorkspace(
    key,
    (w) => {
      if (w.flight || w.deferredFlights?.length) throw new Error("syncBusy");
      const planned = structuredClone(w);
      applyImport(planned, b, replace);
      enforceCapacity(planned);
      w.importLease = { token, expiresAt: Date.now() + 300000 };
    },
    undefined,
    isCurrent,
  );
  try {
    await putPhotos(stored, isCurrent);
    return await changeWorkspace(
      key,
      (w) => {
        if (w.importLease?.token !== token) throw new Error("syncBusy");
        applyImport(w, b, replace);
        delete w.importLease;
      },
      undefined,
      isCurrent,
      token,
    );
  } finally {
    // Never seed a removed account while releasing an interrupted reservation.
    await releaseImport(key, token).catch(() => {});
  }
}
async function releaseImport(key: string, token: string) {
  const db = await database(),
    tx = db.transaction("workspaces", "readwrite");
  const w = await tx.store.get(key);
  if (w?.importLease?.token === token) {
    delete w.importLease;
    await tx.store.put(w);
  }
  await tx.done;
}

function applyImport(w: Workspace, b: Backup, replace: boolean) {
  const batch = recordBatch(w);
  const incoming = new Map([
    ...b.places.map((e) => [e.id, "place"] as const),
    ...b.categories.map((e) => [e.id, "category"] as const),
  ]);
  if (replace)
    for (const r of [...w.records])
      if (!r.deleted && incoming.get(r.id) !== r.kind) batch.write(r, true);
  // Merge retains a conflicting local value under its own identity.
  const categoryMap = new Map<string, string>();
  for (const e of b.categories) {
    const old = batch.get(e.id);
    const different =
      old && (old.kind !== "category" || old.deleted || !sameValue(old.value, e.value));
    if (!replace && different && e.id === "other") {
      categoryMap.set(e.id, "other");
      continue;
    }
    const id =
      old && (old.kind !== "category" || (!replace && different)) ? crypto.randomUUID() : e.id;
    categoryMap.set(e.id, id);
    if (old?.kind === "category" && !old.deleted && sameValue(old.value, e.value)) continue;
    batch.write({ id, kind: "category", value: e.value });
  }
  for (const e of b.places) {
    const value = { ...e.value, categoryId: categoryMap.get(e.value.categoryId) ?? "other" };
    const old = batch.get(e.id);
    if (old?.kind === "place" && !old.deleted && sameValue(old.value, value)) continue;
    const id = old && (old.kind !== "place" || !replace) ? crypto.randomUUID() : e.id;
    batch.write({ id, kind: "place", value });
  }
  batch.commit();
}

type DevicePlace = LocalRecord & { kind: "place" };
const liveDevicePlaces = (guest: Workspace) =>
  guest.records.filter((r): r is DevicePlace => r.kind === "place" && !r.deleted);
// Compare JSON values independently of member order, including localized names.
// Undefined optional fields retain their normal JSON omission semantics.
const valueKey = (value: unknown) =>
  JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry,
  );
const sameValue = (a: unknown, b: unknown) => valueKey(a) === valueKey(b);
function handledDevicePlaces(w: Workspace, guest: Workspace) {
  const receipts = new Set(Object.keys(w.guestPlaces ?? {}));
  const devicePlaces = liveDevicePlaces(guest);
  if (devicePlaces.every((r) => receipts.has(r.id))) return receipts;
  const places = w.records.filter((r) => r.kind === "place");
  const values = new Set(places.map((r) => valueKey(r.value)));
  const legacyIds = new Set(w.reconciled && !w.guestPlaces ? places.map((r) => r.id) : []);
  for (const r of devicePlaces)
    if (legacyIds.has(r.id) || values.has(valueKey(r.value))) receipts.add(r.id);
  return receipts;
}
function placeMatches(records: RecordState[]) {
  const byId = new Map<string, { record: RecordState; order: number }>();
  const byValue = new Map<string, { record: RecordState; order: number }>();
  let order = 0;
  const add = (record: RecordState) => {
    if (record.kind !== "place") return;
    const entry = { record, order: order++ };
    byId.set(record.id, entry);
    const key = valueKey(record.value);
    if (!byValue.has(key)) byValue.set(key, entry);
  };
  for (const record of records) add(record);
  return {
    add,
    find(id: string, value: unknown) {
      const identity = byId.get(id),
        equal = byValue.get(valueKey(value));
      // Preserve the first matching record, including deletion markers, just
      // as an array scan did when identity and value match different records.
      return !identity
        ? equal?.record
        : !equal || identity.order < equal.order
          ? identity.record
          : equal.record;
    },
  };
}
function knownAccounts(guest: Workspace, workspaces: Workspace[]) {
  if (guest.deviceAccounts?.length) return guest.deviceAccounts;
  return [
    ...new Set([
      ...workspaces
        .filter((w) => w.key !== "guest" && !workspaceIdentity(w.key).family && w.reconciled)
        .map((w) => w.key),
    ]),
  ];
}
function deviceTransfers(guest: Workspace, workspaces: Workspace[]) {
  const transfers: NonNullable<Workspace["deviceTransfers"]> = Object.assign(
    Object.create(null),
    guest.deviceTransfers,
  );
  const places = liveDevicePlaces(guest);
  for (const w of workspaces) {
    if (w.key === "guest" || workspaceIdentity(w.key).family) continue;
    const legacy = w.reconciled && !w.guestPlaces ? handledDevicePlaces(w, guest) : null;
    const matches = legacy ? placeMatches(w.records) : null;
    for (const r of places) {
      const destination =
        (w.guestPlaces && Object.hasOwn(w.guestPlaces, r.id) ? w.guestPlaces[r.id] : null) ??
        (legacy?.has(r.id) ? matches?.find(r.id, r.value)?.id : null);
      if (destination && !transfers[r.id])
        transfers[r.id] = { account: w.key, destination, generation: r.generation };
    }
  }
  return transfers;
}
async function legacyTransferWorkspaces(guest: Workspace) {
  if (guest.deviceTransfers) return [];
  const db = await database();
  if (!guest.deviceAccounts?.length) return db.getAll("workspaces");
  const workspaces = await Promise.all(
    guest.deviceAccounts.map((key) => db.get("workspaces", key)),
  );
  return workspaces.filter((w): w is Workspace => !!w);
}
export async function devicePlacePlan(key: string) {
  if (key === "guest" || workspaceIdentity(key).family)
    return { needed: false, ask: false, pending: 0 };
  const guest = await readWorkspace("guest"),
    account = await readWorkspace(key);
  const transfers = deviceTransfers(guest, await legacyTransferWorkspaces(guest));
  const pending = liveDevicePlaces(guest).filter(
    (r) => !transfers[r.id] || transfers[r.id].account === key,
  ).length;
  return {
    needed: !account.reconciled || pending > 0 || !guest.deviceAccounts?.includes(key),
    ask: false,
    pending,
  };
}
function initializePrivateRecords(w: Workspace, cloud: RecordState[]) {
  w.records = cloud.map((r) => ({ ...r, generation: 0, dirty: false }));
  const presets = [
    starters.find((e) => e.id === "other")!,
    ...starters.filter((e) => e.id !== "other"),
  ];
  let count = w.records.filter((r) => r.kind === "category" && !r.deleted).length;
  for (const e of presets)
    if (count < 200 && !w.records.some((r) => r.id === e.id)) {
      w.records.push({
        ...structuredClone(e),
        revision: 0,
        deleted: false,
        generation: 0,
        dirty: false,
      });
      count++;
    }
}
export async function initializePrivateAccount(
  key: string,
  cloud: RecordState[],
  isCurrent = () => true,
) {
  if (key === "guest" || workspaceIdentity(key).family) throw new Error("invalidImport");
  return changeWorkspace(
    key,
    (w) => {
      if (w.reconciled) return false;
      initializePrivateRecords(w, cloud);
      w.reconciled = true;
      w.guestPlaces ??= {};
    },
    undefined,
    isCurrent,
  );
}
export async function reconcileDevicePlaces(
  key: string,
  cloud: RecordState[],
  decision: "auto" | "copy" | "skip",
  isCurrent = () => true,
) {
  if (key === "guest" || workspaceIdentity(key).family) throw new Error("invalidImport");
  const guest = await readWorkspace("guest"),
    account = await readWorkspace(key);
  const transfers = deviceTransfers(guest, await legacyTransferWorkspaces(guest));
  const handled = handledDevicePlaces(account, guest);
  const source = liveDevicePlaces(guest).filter(
    (r) => !handled.has(r.id) && (!transfers[r.id] || transfers[r.id].account === key),
  );
  const ids = new Map(
    await Promise.all(
      source.map(async (r) => {
        if (transfers[r.id]?.account === key) return [r.id, transfers[r.id].destination] as const;
        const hash = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify([key, r.id])),
        );
        return [
          r.id,
          "guest-" + [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join(""),
        ] as const;
      }),
    ),
  );
  let photoIds = new Map<string, string>();
  if (decision !== "skip") {
    const existing = placeMatches(account.reconciled ? account.records : cloud);
    photoIds = await copyPhotos(
      "guest",
      key,
      source
        .filter((r) => !existing.find(ids.get(r.id)!, r.value))
        .flatMap((r) => (r.value.photoId ? [r.value.photoId] : [])),
      isCurrent,
    );
  }
  const db = await database(),
    tx = db.transaction("workspaces", "readwrite");
  let added = 0;
  try {
    const currentGuest = (await tx.store.get("guest")) ?? seed("guest");
    const w = (await tx.store.get(key)) ?? seed(key);
    if (w.importLease && w.importLease.expiresAt > Date.now()) throw new Error("syncBusy");
    const accounts = currentGuest.deviceAccounts?.length
      ? currentGuest.deviceAccounts
      : knownAccounts(currentGuest, await tx.store.getAll());
    if (!isCurrent()) throw new Error("accountChanged");
    const legacy = currentGuest.deviceTransfers
      ? []
      : currentGuest.deviceAccounts?.length
        ? (await Promise.all(currentGuest.deviceAccounts.map((id) => tx.store.get(id)))).filter(
            (w): w is Workspace => !!w,
          )
        : await tx.store.getAll();
    currentGuest.deviceTransfers = deviceTransfers(currentGuest, legacy);
    if (!w.reconciled) initializePrivateRecords(w, cloud);
    if (w.reconciled && !w.guestPlaces) {
      const legacyIds = new Set(w.records.filter((r) => r.kind === "place").map((r) => r.id));
      w.guestPlaces = Object.fromEntries(
        liveDevicePlaces(guest)
          .filter((r) => legacyIds.has(r.id))
          .map((r) => [r.id, r.id]),
      );
    }
    w.guestPlaces ??= {};
    const guestById = new Map(currentGuest.records.map((record) => [record.id, record]));
    const existingPlaces = placeMatches(w.records);
    const existingCategories = new Map<string, LocalRecord>();
    for (const record of w.records) {
      if (record.kind !== "category" || record.deleted) continue;
      const value = valueKey(record.value);
      if (!existingCategories.has(value)) existingCategories.set(value, record);
    }
    const batch = recordBatch(w);
    const categories = new Map<string, string>();
    for (const r of source) {
      const current = guestById.get(r.id);
      if (!current || current.deleted || current.generation !== r.generation) continue;
      const owner = currentGuest.deviceTransfers[r.id];
      if (owner && owner.account !== key) continue;
      if (Object.hasOwn(w.guestPlaces, r.id)) continue;
      const existing = existingPlaces.find(ids.get(r.id)!, r.value);
      if (existing) {
        w.guestPlaces[r.id] = existing.id;
        continue;
      }
      if (decision === "skip") {
        w.guestPlaces[r.id] = null;
        continue;
      }
      const category = guest.records.find(
        (c) => c.id === r.value.categoryId && c.kind === "category" && !c.deleted,
      );
      let categoryId = categories.get(r.value.categoryId);
      if (!categoryId) {
        const existingCategory = category && existingCategories.get(valueKey(category.value));
        categoryId =
          existingCategory?.id ??
          (batch.get(category?.id ?? "") ? crypto.randomUUID() : category?.id) ??
          "other";
        if (category && !existingCategory) {
          const added = batch.write({ ...category, id: categoryId });
          existingCategories.set(valueKey(added.value), added);
        }
        categories.set(r.value.categoryId, categoryId);
      }
      const id = ids.get(r.id)!;
      const copied = batch.write({
        id,
        kind: "place",
        value: {
          ...r.value,
          ...(r.value.photoId ? { photoId: photoIds.get(r.value.photoId) ?? r.value.photoId } : {}),
          categoryId,
        },
      });
      existingPlaces.add(copied);
      w.guestPlaces[r.id] = id;
      added++;
    }
    batch.commit();
    if (decision !== "skip")
      for (const r of liveDevicePlaces(currentGuest)) {
        const destination = Object.hasOwn(w.guestPlaces, r.id) ? w.guestPlaces[r.id] : null;
        if (destination && !currentGuest.deviceTransfers[r.id])
          currentGuest.deviceTransfers[r.id] = {
            account: key,
            destination,
            generation: r.generation,
          };
      }
    w.reconciled = true;
    currentGuest.deviceAccounts = [...accounts.filter((id) => id !== key), key];
    enforceCapacity(w);
    if (!isCurrent()) throw new Error("accountChanged");
    await tx.store.put(w);
    if (!isCurrent()) throw new Error("accountChanged");
    await tx.store.put(currentGuest);
    if (!isCurrent()) throw new Error("accountChanged");
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
  changed();
  return added;
}
// Retain the guest source until the account's record has a cloud revision and
// no pending write/conflict. Ownership outlives the source and the account cache.
export async function finishDevicePlaceTransfer(key: string, isCurrent = () => true) {
  if (key === "guest" || workspaceIdentity(key).family) throw new Error("invalidImport");
  await flushDrafts();
  const db = await database(),
    tx = db.transaction(["workspaces", "drafts"], "readwrite");
  let completed = 0;
  try {
    const guest = (await tx.objectStore("workspaces").get("guest")) ?? seed("guest");
    const account = (await tx.objectStore("workspaces").get(key)) ?? seed(key);
    const byId = new Map(account.records.map((r) => [r.id, r]));
    const removed = new Set<string>();
    for (const r of liveDevicePlaces(guest)) {
      const transfer = guest.deviceTransfers?.[r.id];
      if (!transfer || transfer.account !== key || transfer.generation !== r.generation) continue;
      const destination = byId.get(transfer.destination);
      if (
        !destination ||
        destination.kind !== "place" ||
        destination.dirty ||
        destination.conflict ||
        destination.revision < 1
      )
        continue;
      if (
        account.flight?.mutation.entity.id === destination.id ||
        account.deferredFlights?.some((f) => f.mutation.entity.id === destination.id)
      )
        continue;
      removed.add(r.id);
    }
    if (!isCurrent()) throw new Error("accountChanged");
    if (removed.size) {
      guest.records = guest.records.filter((r) => !removed.has(r.id));
      await tx.objectStore("workspaces").put(guest);
      const draft = await tx.objectStore("drafts").get("guest");
      if (
        draft &&
        typeof draft === "object" &&
        "id" in draft &&
        typeof draft.id === "string" &&
        removed.has(draft.id)
      )
        await tx.objectStore("drafts").delete("guest");
      completed = removed.size;
    }
    if (!isCurrent()) throw new Error("accountChanged");
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
  if (completed) changed();
  return completed;
}
export async function reconcileAccount(
  key: string,
  cloud: RecordState[],
  merge: boolean,
  isCurrent = () => true,
) {
  if ((await readWorkspace(key)).reconciled) {
    if (!isCurrent()) throw new Error("accountChanged");
    return readWorkspace(key);
  }
  await reconcileDevicePlaces(key, cloud, merge ? "copy" : "skip", isCurrent);
  return readWorkspace(key);
}
export const mergeSnapshot = (key: string, remote: RecordState[], isCurrent = () => true) =>
  changeWorkspace(
    key,
    (w) => {
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
        if (local.kind !== r.kind) throw new Error("invalidResponse");
        if (r.revision < Math.max(local.revision, local.conflict?.revision ?? 0)) continue;
        if (!local.dirty) {
          if (
            !local.conflict &&
            local.revision === r.revision &&
            local.deleted === r.deleted &&
            sameValue(local.value, r.value)
          )
            continue;
          Object.assign(local, r);
          delete local.conflict;
          modified = true;
        } else if (r.deleted === local.deleted && sameValue(r.value, local.value)) {
          Object.assign(local, r, { dirty: false });
          delete local.conflict;
          modified = true;
        } else if (r.revision !== local.revision) {
          if (
            local.conflict?.revision === r.revision &&
            local.conflict.deleted === r.deleted &&
            sameValue(local.conflict.value, r.value)
          )
            continue;
          local.conflict = r;
          modified = true;
        }
      }
      if (!modified) return false;
    },
    undefined,
    isCurrent,
  );
export async function prepareMutation(key: string, isCurrent = () => true) {
  let flight: Workspace["flight"];
  await changeWorkspace(
    key,
    (w) => {
      if (!w.reconciled) return false;
      if (w.flight) {
        flight = structuredClone(w.flight);
        return false;
      }
      if (!w.flight) {
        const r =
          w.records.find((r) => r.dirty && r.deleted && !r.conflict) ??
          w.records.find((r) => r.dirty && !r.conflict);
        if (!r) {
          if (!w.deferredFlights?.length) return false;
          w.flight = w.deferredFlights?.shift();
          flight = structuredClone(w.flight);
          return;
        }
        if (!r.deleted && w.deferredFlights?.length) {
          w.flight = w.deferredFlights.shift();
          flight = structuredClone(w.flight);
          return;
        }
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
    },
    undefined,
    isCurrent,
  );
  return flight;
}
export const deferCapacityFlight = (key: string, mutationId: string, isCurrent = () => true) =>
  changeWorkspace(
    key,
    (w) => {
      if (w.flight?.mutation.mutationId !== mutationId) return false;
      if (!w.records.some((r) => r.dirty && r.deleted && !r.conflict)) return false;
      w.deferredFlights ??= [];
      w.deferredFlights.push(w.flight);
      delete w.flight;
    },
    undefined,
    isCurrent,
  );
export const acknowledge = (
  key: string,
  mutationId: string,
  remote: RecordState,
  conflict = false,
  isCurrent = () => true,
) =>
  changeWorkspace(
    key,
    (w) => {
      const flight = w.flight;
      if (!flight || flight.mutation.mutationId !== mutationId) return false;
      if (remote.id !== flight.mutation.entity.id || remote.kind !== flight.mutation.entity.kind)
        throw new Error("invalidResponse");
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
        if (conflict && !identical) r.conflict = newerConflict ?? remote;
        else if (r.generation === flight.generation) {
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
    },
    undefined,
    isCurrent,
  );
export const resolveConflict = (
  key: string,
  id: string,
  choice: "device" | "cloud" | "both",
  isCurrent = () => true,
) =>
  changeWorkspace(
    key,
    (w) => {
      const r = w.records.find((r) => r.id === id);
      if (!r?.conflict) return false;
      const cloud = r.conflict;
      if (choice === "both" && !r.deleted) write(w, { ...r, id: crypto.randomUUID() });
      if (choice === "cloud" || choice === "both") Object.assign(r, cloud, { dirty: false });
      else {
        r.revision = cloud.revision;
        r.generation++;
        r.dirty = true;
      }
      delete r.conflict;
    },
    undefined,
    isCurrent,
  );
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
export function clearDraft(key: string, id: string) {
  pendingDraft = pendingDraft
    .catch(() => {})
    .then(async () => {
      const db = await database(),
        tx = db.transaction("drafts", "readwrite");
      const draft = await tx.store.get(key);
      if (draft && typeof draft === "object" && "id" in draft && draft.id === id)
        await tx.store.delete(key);
      await tx.done;
    });
  return pendingDraft;
}
export const flushDrafts = () => pendingDraft;
export async function removeWorkspace(key: string) {
  await (await database()).delete("workspaces", key);
  await setDraft(key, null);
  await clearPhotos(key);
  changed();
}
export async function removeAccountWorkspaces(account: string) {
  // A family may exist only as a queued draft, with no workspace row yet.
  await flushDrafts().catch(() => {});
  const db = await database();
  const keys = new Set([
    ...(await db.getAllKeys("workspaces")),
    ...(await db.getAllKeys("drafts")),
  ]);
  for (const key of keys)
    if (workspaceIdentity(key).account === account) await removeWorkspace(key);
  await clearAccountPhotos(account);
  try {
    localStorage.removeItem(`places-family:${account}`);
    localStorage.removeItem(`places-workspace:${account}`);
  } catch {}
}
