import { workspaceIdentity } from "../../shared/families";
import { openDB, type DBSchema } from "idb";
import {
  copyPhotos,
  clearPhotos,
  clearAccountPhotos,
  makeStoredPhoto,
  putPhotos,
  getPhoto,
} from "./photo-store";
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
  reconciled: boolean;
  presetRevision?: number;
  deviceAccounts?: string[];
  guestPlaces?: Record<string, string | null>;
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
  update: (w: Workspace) => void,
  clearDraftId?: string,
) {
  const db = await database(),
    tx = db.transaction(clearDraftId ? ["workspaces", "drafts"] : ["workspaces"], "readwrite");
  const store = tx.objectStore("workspaces");
  const w = (await store.get(key)) ?? seed(key);
  try {
    update(w);
    enforceCapacity(w);
    await store.put(w);
    if (clearDraftId) {
      const drafts = tx.objectStore("drafts"),
        draft = await drafts.get(key);
      if (draft && typeof draft === "object" && "id" in draft && draft.id === clearDraftId)
        await drafts.delete(key);
    }
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
    ...entitySchema.parse(e),
    revision: previous?.revision ?? 0,
    generation: (previous?.generation ?? 0) + 1,
    dirty: true,
    deleted,
    ...(previous?.conflict ? { conflict: previous.conflict } : {}),
  };
  w.records = w.records.filter((r) => r.id !== e.id).concat(next);
}
export async function saveEntity(key: string, e: Entity, base?: Entity, clearDraft = false) {
  if (clearDraft) await flushDrafts().catch(() => {});
  return changeWorkspace(
    key,
    (w) => {
      const previous = w.records.find((r) => r.id === e.id);
      const stale =
        base &&
        previous &&
        (previous.deleted || !sameValue(previous.value, base.value)) &&
        (previous.deleted || !sameValue(previous.value, e.value));
      if (stale && previous.dirty) throw new Error("placeChanged");
      write(w, e);
      const saved = w.records.find((r) => r.id === e.id)!;
      if (stale && !saved.conflict) saved.conflict = recordSchema.parse(previous);
    },
    clearDraft ? e.id : undefined,
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
  const photoIds = place.value.photoId
    ? await copyPhotos(from, to, [place.value.photoId], isCurrent)
    : new Map<string, string>();
  const category = source.records.find(
    (r) => r.id === place.value.categoryId && r.kind === "category" && !r.deleted,
  );
  const newId = crypto.randomUUID();
  return changeWorkspace(to, (w) => {
    if (!isCurrent()) throw new Error("accountChanged");
    let categoryId = "other";
    if (category?.kind === "category") {
      const same = w.records.find(
        (r) =>
          r.kind === "category" &&
          !r.deleted &&
          (category.value.builtIn
            ? r.value.builtIn === category.value.builtIn
            : r.value.name === category.value.name),
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
  });
}
export async function deleteEntity(key: string, id: string) {
  await flushDrafts().catch(() => {});
  return changeWorkspace(
    key,
    (w) => {
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
    },
    id,
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
  const photos = b.photos ?? [],
    ids = new Map<string, string>();
  const stored = await Promise.all(
    photos.map(async (p) => {
      const photo = await makeStoredPhoto(
        key,
        p.id,
        new Blob([decodePhoto(p.data)], { type: "image/jpeg" }),
      );
      const existing = await getPhoto(key, p.id);
      if (existing && existing.hash !== photo.hash) photo.id = crypto.randomUUID();
      ids.set(p.id, photo.id);
      return photo;
    }),
  );
  if (!isCurrent()) throw new Error("accountChanged");
  await putPhotos(stored, isCurrent);
  for (const place of b.places)
    if (place.value.photoId) place.value.photoId = ids.get(place.value.photoId)!;
  return changeWorkspace(key, (w) => {
    if (!isCurrent()) throw new Error("accountChanged");
    if (w.flight) throw new Error("syncBusy");
    const incoming = new Map([
      ...b.places.map((e) => [e.id, "place"] as const),
      ...b.categories.map((e) => [e.id, "category"] as const),
    ]);
    if (replace)
      for (const r of [...w.records])
        if (!r.deleted && incoming.get(r.id) !== r.kind) write(w, r, true);
    // Merge retains a conflicting local value under its own identity.
    const categoryMap = new Map<string, string>();
    for (const e of b.categories) {
      const old = w.records.find((r) => r.id === e.id);
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
      write(w, { id, kind: "category", value: e.value });
    }
    for (const e of b.places) {
      const value = { ...e.value, categoryId: categoryMap.get(e.value.categoryId) ?? "other" };
      const old = w.records.find((r) => r.id === e.id);
      if (old?.kind === "place" && !old.deleted && sameValue(old.value, value)) continue;
      const id = old && (old.kind !== "place" || !replace) ? crypto.randomUUID() : e.id;
      write(w, { id, kind: "place", value });
    }
  });
}
type DevicePlace = LocalRecord & { kind: "place" };
const liveDevicePlaces = (guest: Workspace) =>
  guest.records.filter((r): r is DevicePlace => r.kind === "place" && !r.deleted);
const valueKey = (value: unknown) => JSON.stringify(Object.entries(value as object).sort());
const sameValue = (a: unknown, b: unknown) => valueKey(a) === valueKey(b);
function handledDevicePlaces(w: Workspace, guest: Workspace) {
  const receipts = new Set(Object.keys(w.guestPlaces ?? {}));
  const places = w.records.filter((r) => r.kind === "place");
  const values = new Set(places.map((r) => valueKey(r.value)));
  const legacyIds = new Set(w.reconciled && !w.guestPlaces ? places.map((r) => r.id) : []);
  for (const r of liveDevicePlaces(guest))
    if (legacyIds.has(r.id) || values.has(valueKey(r.value))) receipts.add(r.id);
  return receipts;
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
export async function devicePlacePlan(key: string) {
  if (key === "guest" || workspaceIdentity(key).family)
    return { needed: false, ask: false, pending: 0 };
  const guest = await readWorkspace("guest"),
    account = await readWorkspace(key);
  const accounts = knownAccounts(guest, await (await database()).getAll("workspaces"));
  const handled = handledDevicePlaces(account, guest);
  const pending = liveDevicePlaces(guest).filter((r) => !handled.has(r.id)).length;
  return {
    needed: !account.reconciled || pending > 0 || !guest.deviceAccounts?.includes(key),
    ask: pending > 0 && accounts.length > 0 && accounts.at(-1) !== key,
    pending,
  };
}
export async function reconcileDevicePlaces(
  key: string,
  cloud: RecordState[],
  decision: "auto" | "copy" | "skip",
  isCurrent = () => true,
) {
  if (key === "guest" || workspaceIdentity(key).family) throw new Error("invalidImport");
  const plan = await devicePlacePlan(key);
  if (decision === "auto" && plan.ask) throw new Error("accountChoiceRequired");
  const guest = await readWorkspace("guest"),
    account = await readWorkspace(key);
  const handled = handledDevicePlaces(account, guest);
  const source = liveDevicePlaces(guest).filter((r) => !handled.has(r.id));
  const ids = new Map(
    await Promise.all(
      source.map(async (r) => {
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
  if (decision !== "skip")
    photoIds = await copyPhotos(
      "guest",
      key,
      source
        .filter(
          (r) =>
            !(account.reconciled ? account.records : cloud).some(
              (c) => c.kind === "place" && (c.id === ids.get(r.id) || sameValue(c.value, r.value)),
            ),
        )
        .flatMap((r) => (r.value.photoId ? [r.value.photoId] : [])),
      isCurrent,
    );
  const db = await database(),
    tx = db.transaction("workspaces", "readwrite");
  let added = 0;
  try {
    const currentGuest = (await tx.store.get("guest")) ?? seed("guest");
    const w = (await tx.store.get(key)) ?? seed(key);
    const accounts = knownAccounts(currentGuest, await tx.store.getAll());
    if (!isCurrent()) throw new Error("accountChanged");
    const handledNow = handledDevicePlaces(w, currentGuest);
    if (
      decision === "auto" &&
      source.some((r) => !handledNow.has(r.id)) &&
      accounts.length > 0 &&
      accounts.at(-1) !== key
    )
      throw new Error("accountChoiceRequired");
    if (!w.reconciled) {
      w.records = cloud.map((r) => ({ ...r, generation: 0, dirty: false }));
      const presets = [
        starters.find((e) => e.id === "other")!,
        ...starters.filter((e) => e.id !== "other"),
      ];
      let categoryCount = w.records.filter((r) => r.kind === "category" && !r.deleted).length;
      for (const e of presets)
        if (categoryCount < 200 && !w.records.some((r) => r.id === e.id)) {
          w.records.push({
            ...structuredClone(e),
            revision: 0,
            deleted: false,
            generation: 0,
            dirty: false,
          });
          categoryCount++;
        }
    }
    if (w.reconciled && !w.guestPlaces) {
      const legacyIds = new Set(w.records.filter((r) => r.kind === "place").map((r) => r.id));
      w.guestPlaces = Object.fromEntries(
        liveDevicePlaces(guest)
          .filter((r) => legacyIds.has(r.id))
          .map((r) => [r.id, r.id]),
      );
    }
    w.guestPlaces ??= {};
    const categories = new Map<string, string>();
    for (const r of source) {
      if (
        !currentGuest.records.some(
          (c) => c.id === r.id && !c.deleted && c.generation === r.generation,
        )
      )
        continue;
      if (Object.hasOwn(w.guestPlaces, r.id)) continue;
      const existing = w.records.find(
        (c) => c.kind === "place" && (c.id === ids.get(r.id) || sameValue(c.value, r.value)),
      );
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
        const existingCategory =
          category &&
          w.records.find(
            (c) => c.kind === "category" && !c.deleted && sameValue(c.value, category.value),
          );
        categoryId =
          existingCategory?.id ??
          (w.records.some((c) => c.id === category?.id) ? crypto.randomUUID() : category?.id) ??
          "other";
        if (category && !existingCategory) write(w, { ...category, id: categoryId });
        categories.set(r.value.categoryId, categoryId);
      }
      const id = ids.get(r.id)!;
      write(w, {
        id,
        kind: "place",
        value: {
          ...r.value,
          ...(r.value.photoId ? { photoId: photoIds.get(r.value.photoId) ?? r.value.photoId } : {}),
          categoryId,
        },
      });
      w.guestPlaces[r.id] = id;
      added++;
    }
    w.reconciled = true;
    currentGuest.deviceAccounts = [...accounts.filter((id) => id !== key), key];
    enforceCapacity(w);
    if (!isCurrent()) throw new Error("accountChanged");
    await tx.store.put(w);
    await tx.store.put(currentGuest);
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
export const mergeSnapshot = (key: string, remote: RecordState[]) =>
  changeWorkspace(key, (w) => {
    for (const r of remote) {
      const local = w.records.find((l) => l.id === r.id);
      if (!local) {
        w.records.push({ ...r, generation: 0, dirty: false });
        continue;
      }
      if (local.kind !== r.kind) throw new Error("invalidResponse");
      if (r.revision < Math.max(local.revision, local.conflict?.revision ?? 0)) continue;
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
    if (remote.id !== flight.mutation.entity.id || remote.kind !== flight.mutation.entity.kind)
      throw new Error("invalidResponse");
    const r = w.records.find((r) => r.id === remote.id);
    if (r) {
      if (r.revision > remote.revision) {
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
