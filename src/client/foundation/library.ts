import { clearRouteRecordings } from "./route-recording";
import { canonicalGeometry, ROUTE_QUOTA } from "../../shared/routes";
import { loadGeometry } from "./route-geometry";
import { putGeometry, clearGeometry } from "./route-store";
import { digest } from "../../shared/digest";
import type { Workspace, WorkspaceChangeOptions } from "./library-types";
import {
  enforceCapacity,
  write,
  recordBatch,
  valueKey,
  sameValue,
  mergeRecords,
  acknowledgeRecord,
} from "./library-records";
import { entityLimits } from "../../shared/limits";
import { workspaceIdentity } from "../../shared/families";
import { visitEntity, visitOwner, visitStatuses } from "../../shared/visits";
import { type DBSchema } from "idb";
import { abortTransaction, localDatabase, openChannel, broadcast } from "./database";
import {
  copyPhotos,
  clearPhotos,
  clearAccountPhotos,
  makeBackupPhoto,
  putPhotos,
  workspacePhotos,
  type StoredPhoto,
} from "./photo-store";
import { loadPhoto } from "./photos";
import {
  starters,
  entitySchema,
  recordSchema,
  validateBackup,
  parseBackupManifest,
  type Backup,
  type Entity,
  type Place,
  type LocalRecord,
  type RecordState,
  type VisitStatus,
} from "../../shared/model";

export type { Workspace } from "./library-types";

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

export const channel = openChannel("places-library");

const changed = (workspaces?: string[]) => {
  const detail = workspaces ? { workspaces } : undefined;
  window.dispatchEvent(new CustomEvent("places-library", { detail }));
  broadcast(channel, detail ?? "changed");
};

export async function readWorkspace(key: string) {
  const db = await database();
  let existing = await db.get("workspaces", key);
  if (!existing) {
    return seed(key);
  }
  // Older Keep both writes copied the source's conflict onto a fresh identity.
  // Its cloud version already belongs to the original record, not this copy.
  if (existing.records.some((r) => r.conflict && r.conflict.id !== r.id)) {
    existing = await changeWorkspace(
      key,
      (w) => {
        let repaired = false;
        for (const r of w.records) {
          if (r.conflict && r.conflict.id !== r.id) {
            delete r.conflict;
            repaired = true;
          }
        }
        if (!repaired) {
          return false;
        }
      },
      { existingOnly: true },
    );
  }
  if ((existing.presetRevision ?? 1) >= 2) {
    return existing;
  }
  // Add the new preset once, preserving custom names, tombstones and in-flight writes.
  if (
    !existing.records.some((r) => r.id === "mushrooms") &&
    existing.records.filter((r) => r.kind === "category" && !r.deleted).length >=
      entityLimits.category
  ) {
    return existing;
  }

  return changeWorkspace(
    key,
    (w) => {
      if ((w.presetRevision ?? 1) >= 2) {
        return false;
      }
      if (!w.records.some((r) => r.id === "mushrooms")) {
        if (
          w.records.filter((r) => r.kind === "category" && !r.deleted).length >=
          entityLimits.category
        ) {
          return false;
        }
        w.records.push({
          ...structuredClone(starters.find((e) => e.id === "mushrooms")!),
          revision: 0,
          deleted: false,
          generation: 0,
          dirty: key !== "guest" && w.reconciled,
        });
      }
      w.presetRevision = 2;
    },
    { existingOnly: true },
  );
}

export async function changeWorkspace(
  key: string,
  update: (w: Workspace) => void | false,
  options: WorkspaceChangeOptions = {},
) {
  const {
    clearDraftId,
    isCurrent = () => true,
    importToken,
    personalVisit,
    preservePersonalVisits = false,
  } = options;
  const db = await database();
  const tx = db.transaction(clearDraftId ? ["workspaces", "drafts"] : ["workspaces"], "readwrite");
  const store = tx.objectStore("workspaces");
  let w: Workspace;
  let modified = false;
  const affected = [key];
  try {
    const saved = await store.get(key);
    if (!saved && options.existingOnly) {
      await tx.done;

      return seed(key);
    }
    w = saved ?? seed(key);
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    if (
      w.importLease &&
      w.importLease.expiresAt > Date.now() &&
      w.importLease.token !== importToken
    ) {
      throw new Error("syncBusy");
    }
    const required = options.requirePlace;
    if (required) {
      const source = required.workspace === key ? w : await store.get(required.workspace);
      const place = source?.records.find((r) => r.id === required.id);
      if (
        !place ||
        place.deleted ||
        (place.kind !== "place" && place.kind !== "route") ||
        (required.original && !sameValue(place.value, required.original.value))
      ) {
        throw new Error("placeChanged");
      }
    }
    modified = update(w) !== false;
    if (modified) {
      if (personalVisit && (!Array.isArray(personalVisit) || personalVisit.length)) {
        const owner = visitOwner(key);
        const personal = owner === key ? w : ((await store.get(owner)) ?? seed(owner));
        if (
          (importToken && owner !== key && personal.importLease?.token !== importToken) ||
          (personal.importLease &&
            personal.importLease.expiresAt > Date.now() &&
            personal.importLease.token !== importToken)
        ) {
          throw new Error("syncBusy");
        }
        const personalChanged = applyPersonalVisits(
          personal,
          Array.isArray(personalVisit) ? personalVisit : [personalVisit],
          preservePersonalVisits,
        );
        const releasePersonal = !!importToken && personal.importLease?.token === importToken;
        if (releasePersonal) {
          delete personal.importLease;
        }
        if ((personalChanged || releasePersonal) && owner !== key) {
          enforceCapacity(personal);
          await store.put(personal);
          affected.push(owner);
        }
      }
      enforceCapacity(w);
      await store.put(w);
    }
    if (clearDraftId) {
      const drafts = tx.objectStore("drafts");
      const draft = await drafts.get(key);
      if (draft && typeof draft === "object" && "id" in draft && draft.id === clearDraftId) {
        await drafts.delete(key);
        modified = true;
      }
    }
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
  if (modified) {
    changed(affected);
  }

  return w;
}

function applyPersonalVisits(personal: Workspace, visits: Entity[], preserve: boolean) {
  if (!visits.length) {
    return false;
  }
  const batch = recordBatch(personal);
  let changed = false;
  for (const visit of visits) {
    const previous = batch.get(visit.id);
    if (preserve && previous) {
      continue;
    }
    if (
      previous?.kind === "visit" &&
      !previous.deleted &&
      visit.kind === "visit" &&
      previous.value.status === visit.value.status
    ) {
      continue;
    }
    batch.write(visit);
    changed = true;
  }
  if (changed) {
    batch.commit();
  }

  return changed;
}

// Editors stamp Save time and materialize blank optional fields even on an untouched form.
function editablePlace(value: Place) {
  return {
    ...value,
    updatedAt: undefined,
    photoId: value.photoId ?? null,
    description: value.description ?? "",
  };
}

export async function saveEntity(
  key: string,
  e: Entity,
  base?: Entity | null,
  clearDraft = false,
  isCurrent = () => true,
  personalStatus?: VisitStatus,
) {
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if (e.kind === "route") {
    const checked = await canonicalGeometry(await loadGeometry(key, e.value.geometryId, isCurrent));
    if (
      Object.entries(checked.summary).some(
        ([field, value]) => !sameValue(value, e.value[field as keyof typeof e.value]),
      )
    ) {
      throw new Error("invalidGeometry");
    }
  }
  if (clearDraft) {
    await flushDrafts().catch(() => {});
  }

  return changeWorkspace(
    key,
    (w) => {
      if (
        clearDraft &&
        !personalStatus &&
        (base?.kind === "place" || base?.kind === "route") &&
        (e.kind === "place" || e.kind === "route") &&
        base.id === e.id &&
        sameValue(editablePlace(base.value), editablePlace(e.value))
      ) {
        // The draft still clears in this transaction. Preserve any other tab's newer record.
        return false;
      }
      const previous = w.records.find((r) => r.id === e.id);
      const stale =
        base !== undefined &&
        previous &&
        (base === null || previous.deleted || !sameValue(previous.value, base.value)) &&
        (previous.deleted || !sameValue(previous.value, e.value));
      if (stale && previous.dirty) {
        throw new Error("placeChanged");
      }
      const saved = write(w, e);
      if (stale && !saved.conflict) {
        saved.conflict = recordSchema.parse(previous);
      }
    },
    {
      clearDraftId: clearDraft ? e.id : undefined,
      isCurrent,
      personalVisit:
        (e.kind === "place" || e.kind === "route") && personalStatus
          ? await visitEntity(key, e.id, personalStatus)
          : undefined,
    },
  );
}

export async function saveVisit(
  key: string,
  placeId: string,
  status: VisitStatus,
  isCurrent = () => true,
) {
  const entity = await visitEntity(key, placeId, status);

  return changeWorkspace(
    visitOwner(key),
    (w) => {
      const previous = w.records.find((record) => record.id === entity.id);
      if (previous?.kind === "visit" && !previous.deleted && previous.value.status === status) {
        return false;
      }
      write(w, entity);
      // The guest transfer guards against edits by source generation, including
      // status-only edits made while its destination is awaiting confirmation.
      if (key === "guest") {
        const place = w.records.find((record) => record.id === placeId)!;
        place.generation++;
      }
    },
    { isCurrent, requirePlace: { workspace: key, id: placeId } },
  );
}

export async function copyPlaceToWorkspace(
  from: string,
  to: string,
  id: string,
  isCurrent = () => true,
) {
  const source = await readWorkspace(from);
  const place = source.records.find(
    (r) => r.id === id && (r.kind === "place" || r.kind === "route") && !r.deleted,
  );
  if (!place || (place.kind !== "place" && place.kind !== "route")) {
    throw new Error("invalidImport");
  }
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const identity = workspaceIdentity(from);
  const sourceLibrary = identity.family ? `family:${identity.family}` : from;
  const newId = "copy-" + (await digest(JSON.stringify([sourceLibrary, id])));

  // A known copy needs no source attachment download. Recheck inside the
  // transaction so cancellation, source edits and destination deletion still win.
  if ((await readWorkspace(to)).records.some((record) => record.id === newId)) {
    const workspace = await changeWorkspace(
      to,
      (w) => {
        const previous = w.records.find((record) => record.id === newId);
        if (
          !previous ||
          previous.deleted ||
          (previous.kind !== "place" && previous.kind !== "route")
        ) {
          throw new Error("placeChanged");
        }

        return false;
      },
      { isCurrent, requirePlace: { workspace: from, id, original: place } },
    );

    return { workspace, copied: false };
  }
  if (place.kind === "route") {
    await putGeometry(to, await loadGeometry(from, place.value.geometryId, isCurrent), isCurrent);
  }
  if (place.value.photoId) {
    await loadPhoto(from, place.value.photoId, isCurrent);
  }
  const photoIds = place.value.photoId
    ? await copyPhotos(from, to, [place.value.photoId], isCurrent)
    : new Map<string, string>();
  const category = source.records.find(
    (r) => r.id === place.value.categoryId && r.kind === "category" && !r.deleted,
  );
  const copiedCategoryId = category
    ? "copy-" + (await digest(JSON.stringify([sourceLibrary, category.id])))
    : "other";
  let copied = false;

  const workspace = await changeWorkspace(
    to,
    (w) => {
      if (!isCurrent()) {
        throw new Error("accountChanged");
      }
      const previous = w.records.find((record) => record.id === newId);
      if (previous) {
        if (previous.deleted || (previous.kind !== "place" && previous.kind !== "route")) {
          throw new Error("placeChanged");
        }

        return false;
      }

      // Older copies used random IDs. Ignore category and edit timestamps when
      // recognizing their otherwise unchanged content; never merge by name alone.
      const content = (value: Place) => ({
        ...value,
        categoryId: "other",
        updatedAt: "",
        photoId: value.photoId ?? null,
      });

      const expected = content({
        ...place.value,
        ...(place.value.photoId ? { photoId: photoIds.get(place.value.photoId)! } : {}),
      });
      if (
        w.records.some(
          (record) =>
            (record.kind === "place" || record.kind === "route") &&
            !record.deleted &&
            sameValue(content(record.value), expected),
        )
      ) {
        return false;
      }
      let categoryId = "other";
      if (category?.kind === "category") {
        let same = w.records.find(
          (record) =>
            record.id === copiedCategoryId && record.kind === "category" && !record.deleted,
        );
        for (const candidate of same ? [] : w.records) {
          if (
            candidate.kind !== "category" ||
            candidate.deleted ||
            candidate.value.name !== category.value.name
          ) {
            continue;
          }
          same ??= candidate;
          if (sameValue(candidate.value, category.value)) {
            same = candidate;
            break;
          }
        }
        const reserved = w.records.some((record) => record.id === copiedCategoryId);
        categoryId = same?.id ?? (reserved ? "other" : copiedCategoryId);
        if (!same && !reserved) {
          write(w, { ...category, id: categoryId });
        }
      }
      write(
        w,
        entitySchema.parse({
          ...place,
          id: newId,
          value: {
            ...place.value,
            ...(place.value.photoId ? { photoId: photoIds.get(place.value.photoId)! } : {}),
            categoryId,
          },
        }),
      );
      copied = true;
    },
    { isCurrent, requirePlace: { workspace: from, id, original: place } },
  );

  return { workspace, copied };
}

export async function deleteEntity(key: string, id: string, isCurrent = () => true) {
  await flushDrafts().catch(() => {});

  return changeWorkspace(
    key,
    (w) => {
      const r = w.records.find((r) => r.id === id);
      if (!r || r.deleted || id === "other") {
        return false;
      }
      if (r.kind !== "category") {
        write(w, r, true);

        return;
      }
      const batch = recordBatch(w);
      const updatedAt = new Date().toISOString();
      for (const place of w.records) {
        if (
          (place.kind === "place" || place.kind === "route") &&
          !place.deleted &&
          place.value.categoryId === id
        ) {
          batch.write(
            entitySchema.parse({
              ...place,
              value: { ...place.value, categoryId: "other", updatedAt },
            }),
          );
        }
      }
      batch.write(r, true);
      batch.commit();
    },
    { clearDraftId: id, isCurrent },
  );
}

export function exportBackup(
  w: Workspace,
  photos?: { id: string; data: string }[],
  personalRecords = w.records,
  geometry: { id: string; data: string }[] = [],
): Backup {
  const geometryIds = new Set(geometry.map((item) => item.id));
  if (
    w.records.some((r) => r.kind === "route" && !r.deleted && !geometryIds.has(r.value.geometryId))
  ) {
    throw new Error("geometryUnavailable");
  }
  const categories = w.records
    .filter((r) => r.kind === "category" && !r.deleted)
    .map((r) => ({ id: r.id, value: r.value }));
  const ids = new Set(categories.map((c) => c.id));
  const placeIds = new Set(
    w.records
      .filter((r) => (r.kind === "place" || r.kind === "route") && !r.deleted)
      .map((r) => r.id),
  );

  return validateBackup({
    format: "voltura-places",
    version: geometry.length ? 3 : photos?.length ? 2 : 1,
    ...(geometry.length
      ? {
          geometry,
          routes: w.records
            .filter((r) => r.kind === "route" && !r.deleted)
            .map((r) => ({ id: r.id, value: r.value })),
        }
      : {}),
    ...(photos?.length ? { photos } : {}),
    exportedAt: new Date().toISOString(),
    categories,
    visits: [...visitStatuses(personalRecords, w.key)]
      .filter(([id]) => placeIds.has(id))
      .map(([placeId, status]) => ({ placeId, status })),
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
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const b = parseBackupManifest(input);
  const neededGeometry = new Map((b.routes ?? []).map((r) => [r.value.geometryId, r.value]));
  if (
    neededGeometry.size !== (b.geometry?.length ?? 0) ||
    new Set(b.geometry?.map((g) => g.id)).size !== (b.geometry?.length ?? 0)
  ) {
    throw new Error("invalidImport");
  }
  let geometryBytes = 0;
  for (const attachment of b.geometry ?? []) {
    const checked = await canonicalGeometry(JSON.parse(attachment.data));
    if (checked.id !== attachment.id || !neededGeometry.has(checked.id)) {
      throw new Error("invalidImport");
    }
    geometryBytes += checked.bytes;
    if (geometryBytes > ROUTE_QUOTA) {
      throw new Error("routeQuota");
    }
    for (const route of b.routes ?? []) {
      if (
        route.value.geometryId === checked.id &&
        Object.entries(checked.summary).some(
          ([key, value]) => !sameValue(value, route.value[key as keyof typeof route.value]),
        )
      ) {
        throw new Error("invalidImport");
      }
    }
  }
  const prepared = [];
  for (const item of b.photos ?? []) {
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    prepared.push(await makeBackupPhoto(key, item.id, item.data));
  }
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const existingWorkspace = await readWorkspace(key);
  if (existingWorkspace.flight || existingWorkspace.deferredFlights?.length) {
    throw new Error("syncBusy");
  }
  const placeRemaps = new Map((b.visits ?? []).map((v) => [v.placeId, crypto.randomUUID()]));
  const visitImports = new Map(
    await Promise.all(
      (b.visits ?? []).map(
        async (v) =>
          [
            v.placeId,
            {
              original: await visitEntity(key, v.placeId, v.status),
              copy: await visitEntity(key, placeRemaps.get(v.placeId)!, v.status),
            },
          ] as const,
      ),
    ),
  );
  const personalVisits: Entity[] = [];
  if (!prepared.length && !b.geometry?.length) {
    return changeWorkspace(
      key,
      (w) => {
        if (w.flight || w.deferredFlights?.length) {
          throw new Error("syncBusy");
        }
        personalVisits.push(...applyImport(w, b, replace, placeRemaps, visitImports));
      },
      { isCurrent, personalVisit: personalVisits, preservePersonalVisits: !replace },
    );
  }
  const existingPhotos = await workspacePhotos(key);
  const photosById = new Map(existingPhotos.map((photo) => [photo.id, photo]));
  const idsByHash = new Map<string, string>();
  for (const photo of existingPhotos) {
    if (!idsByHash.has(photo.hash)) {
      idsByHash.set(photo.hash, photo.id);
    }
  }
  const ids = new Map<string, string>();
  const stored: StoredPhoto[] = [];
  for (const photo of prepared) {
    const originalId = photo.id;
    const existing = photosById.get(photo.id);
    if (existing && existing.hash !== photo.hash) {
      photo.id = idsByHash.get(photo.hash) ?? crypto.randomUUID();
    }
    photosById.set(photo.id, photo);
    if (!idsByHash.has(photo.hash)) {
      idsByHash.set(photo.hash, photo.id);
    }
    ids.set(originalId, photo.id);
    stored.push(photo);
  }
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  for (const place of [...b.places, ...(b.routes ?? [])]) {
    if (place.value.photoId) {
      place.value.photoId = ids.get(place.value.photoId)!;
    }
  }
  const token = crypto.randomUUID();
  // Reserve the validated capacity before photo persistence. Other tabs cannot
  // introduce a capacity failure between staging bytes and committing records.
  const owner = visitOwner(key);
  const reservations = owner !== key && visitImports.size ? [key, owner] : [key];
  const db = await database();
  const reservation = db.transaction("workspaces", "readwrite");
  try {
    const lease = { token, expiresAt: Date.now() + 300000 };
    const w = (await reservation.store.get(key)) ?? seed(key);
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    if (
      w.flight ||
      w.deferredFlights?.length ||
      (w.importLease && w.importLease.expiresAt > Date.now())
    ) {
      throw new Error("syncBusy");
    }
    // applyImport replaces records through recordBatch; checking a shallow
    // workspace projection does not mutate persisted records or their values.
    const planned = { ...w };
    const visits = applyImport(planned, b, replace, placeRemaps, visitImports);
    enforceCapacity(planned);
    if (reservations.length === 2) {
      const personal = (await reservation.store.get(owner)) ?? seed(owner);
      if (personal.importLease && personal.importLease.expiresAt > Date.now()) {
        throw new Error("syncBusy");
      }
      const plannedPersonal = { ...personal };
      applyPersonalVisits(plannedPersonal, visits, !replace);
      enforceCapacity(plannedPersonal);
      await reservation.store.put({ ...personal, importLease: lease });
    }
    await reservation.store.put({ ...w, importLease: lease });
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await reservation.done;
  } catch (error) {
    await abortTransaction(reservation);
    throw error;
  }
  try {
    for (const attachment of b.geometry ?? []) {
      await putGeometry(key, JSON.parse(attachment.data), isCurrent);
    }
    await putPhotos(stored, isCurrent);

    return await changeWorkspace(
      key,
      (w) => {
        if (w.importLease?.token !== token) {
          throw new Error("syncBusy");
        }
        personalVisits.push(...applyImport(w, b, replace, placeRemaps, visitImports));
        delete w.importLease;
      },
      {
        isCurrent,
        importToken: token,
        personalVisit: personalVisits,
        preservePersonalVisits: !replace,
      },
    );
  } catch (error) {
    // Never seed a removed account while releasing an interrupted reservation.
    await releaseImport(reservations, token).catch(() => {});
    throw error;
  }
}

async function releaseImport(keys: string[], token: string) {
  const db = await database();
  const tx = db.transaction("workspaces", "readwrite");
  try {
    for (const key of keys) {
      const w = await tx.store.get(key);
      if (w?.importLease?.token === token) {
        delete w.importLease;
        await tx.store.put(w);
      }
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
}

function applyImport(
  w: Workspace,
  b: Backup,
  replace: boolean,
  placeRemaps: Map<string, string>,
  visitImports: Map<string, { original: Entity; copy: Entity }>,
) {
  const personalVisits: Entity[] = [];
  const batch = recordBatch(w);
  const incoming = new Map([
    ...b.places.map((e) => [e.id, "place"] as const),
    ...(b.routes ?? []).map((e) => [e.id, "route"] as const),
    ...b.categories.map((e) => [e.id, "category"] as const),
  ]);
  if (replace) {
    for (const r of w.records) {
      if (r.kind !== "visit" && !r.deleted && incoming.get(r.id) !== r.kind) {
        batch.write(r, true);
      }
    }
  }
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
    if (old?.kind === "category" && !old.deleted && sameValue(old.value, e.value)) {
      continue;
    }
    batch.write({ id, kind: "category", value: e.value });
  }
  for (const e of [
    ...b.places.map((r) => ({ ...r, kind: "place" as const })),
    ...(b.routes ?? []).map((r) => ({ ...r, kind: "route" as const })),
  ]) {
    const value = { ...e.value, categoryId: categoryMap.get(e.value.categoryId) ?? "other" };
    const old = batch.get(e.id);
    const identical = old?.kind === e.kind && !old.deleted && sameValue(old.value, value);
    if (old && !identical && (old.kind !== e.kind || !replace) && !placeRemaps.has(e.id)) {
      placeRemaps.set(e.id, crypto.randomUUID());
    }
    const id = identical
      ? e.id
      : old && (old.kind !== e.kind || !replace)
        ? placeRemaps.get(e.id)!
        : e.id;
    if (!identical) {
      batch.write(entitySchema.parse({ id, kind: e.kind, value }));
    }
    const visit = visitImports.get(e.id);
    if (visit) {
      const personal = id === e.id ? visit.original : visit.copy;
      if (visitOwner(w.key) !== w.key) {
        personalVisits.push(personal);
      } else {
        const current = batch.get(personal.id);
        if (
          !current ||
          (replace &&
            (current.deleted ||
              current.kind !== "visit" ||
              personal.kind !== "visit" ||
              current.value.status !== personal.value.status))
        ) {
          batch.write(personal);
        }
      }
    }
  }
  batch.commit();

  return personalVisits;
}

type DevicePlace = Extract<LocalRecord, { kind: "place" | "route" }>;

const liveDevicePlaces = (guest: Workspace) =>
  guest.records.filter(
    (r): r is DevicePlace => (r.kind === "place" || r.kind === "route") && !r.deleted,
  );

function handledDevicePlaces(w: Workspace, guest: Workspace) {
  const receipts = new Set(Object.keys(w.guestPlaces ?? {}));
  const devicePlaces = liveDevicePlaces(guest);
  if (devicePlaces.every((r) => receipts.has(r.id))) {
    return receipts;
  }
  const places = w.records.filter((r) => r.kind === "place" || r.kind === "route");
  const values = new Set(places.map((r) => valueKey(r.value)));
  const legacyIds = new Set(w.reconciled && !w.guestPlaces ? places.map((r) => r.id) : []);
  for (const r of devicePlaces) {
    if (legacyIds.has(r.id) || values.has(valueKey(r.value))) {
      receipts.add(r.id);
    }
  }

  return receipts;
}

function placeMatches(records: RecordState[]) {
  const byId = new Map<string, { record: RecordState; order: number }>();
  const byValue = new Map<string, { record: RecordState; order: number }>();
  let order = 0;

  const add = (record: RecordState) => {
    if (record.kind !== "place" && record.kind !== "route") {
      return;
    }
    const entry = { record, order: order++ };
    byId.set(record.id, entry);
    const key = valueKey(record.value);
    if (!byValue.has(key)) {
      byValue.set(key, entry);
    }
  };

  for (const record of records) {
    add(record);
  }

  return {
    add,
    find(id: string, value: unknown, matchValue = true) {
      const identity = byId.get(id);
      if (!matchValue) {
        return identity?.record;
      }
      const equal = byValue.get(valueKey(value));

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
  if (guest.deviceAccounts?.length) {
    return guest.deviceAccounts;
  }

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
    if (w.key === "guest" || workspaceIdentity(w.key).family) {
      continue;
    }
    const legacy = w.reconciled && !w.guestPlaces ? handledDevicePlaces(w, guest) : null;
    const matches = legacy ? placeMatches(w.records) : null;
    for (const r of places) {
      const destination =
        (w.guestPlaces && Object.hasOwn(w.guestPlaces, r.id) ? w.guestPlaces[r.id] : null) ??
        (legacy?.has(r.id) ? matches?.find(r.id, r.value)?.id : null);
      if (destination && !transfers[r.id]) {
        transfers[r.id] = { account: w.key, destination, generation: r.generation };
      }
    }
  }

  return transfers;
}

async function legacyTransferWorkspaces(guest: Workspace) {
  if (guest.deviceTransfers) {
    return [];
  }
  const db = await database();
  if (!guest.deviceAccounts?.length) {
    return db.getAll("workspaces");
  }
  const workspaces = await Promise.all(
    guest.deviceAccounts.map((key) => db.get("workspaces", key)),
  );

  return workspaces.filter((w): w is Workspace => !!w);
}

export async function devicePlacePlan(key: string) {
  if (key === "guest" || workspaceIdentity(key).family) {
    return { needed: false, ask: false, pending: 0 };
  }
  const guest = await readWorkspace("guest");
  const account = await readWorkspace(key);
  const transfers = deviceTransfers(guest, await legacyTransferWorkspaces(guest));
  const pending = liveDevicePlaces(guest).filter((r) => {
    const transfer = transfers[r.id];
    const skipped = account.guestPlaces?.[r.id] === null;

    return transfer
      ? transfer.account === key &&
          transfer.skippedGeneration !== r.generation &&
          (!skipped || transfer.generation !== r.generation)
      : !skipped;
  }).length;

  return {
    needed: !account.reconciled || pending > 0 || !guest.deviceAccounts?.includes(key),
    ask: false,
    pending,
  };
}

function initializePrivateRecords(w: Workspace, cloud: RecordState[]) {
  // Edits made after offline sign-in or a deferred transfer already belong to
  // this account. Apply the first snapshot using ordinary conflict semantics.
  w.records = w.records.filter((record) => record.dirty || record.conflict);
  mergeRecords(w, cloud);
  const presets = [
    starters.find((e) => e.id === "other")!,
    ...starters.filter((e) => e.id !== "other"),
  ];
  let count = w.records.filter((r) => r.kind === "category" && !r.deleted).length;
  for (const e of presets) {
    if (count < entityLimits.category && !w.records.some((r) => r.id === e.id)) {
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
}

export async function initializePrivateAccount(
  key: string,
  cloud: RecordState[],
  isCurrent = () => true,
) {
  if (key === "guest" || workspaceIdentity(key).family) {
    throw new Error("invalidImport");
  }

  return changeWorkspace(
    key,
    (w) => {
      if (w.reconciled) {
        return false;
      }
      initializePrivateRecords(w, cloud);
      w.reconciled = true;
      w.guestPlaces ??= {};
    },
    { isCurrent },
  );
}

export async function reconcileDevicePlaces(
  key: string,
  cloud: RecordState[],
  decision: "auto" | "copy" | "skip",
  isCurrent = () => true,
) {
  if (key === "guest" || workspaceIdentity(key).family) {
    throw new Error("invalidImport");
  }
  const guest = await readWorkspace("guest");
  if (guest.importLease && guest.importLease.expiresAt > Date.now()) {
    throw new Error("syncBusy");
  }
  const account = await readWorkspace(key);
  const transfers = deviceTransfers(guest, await legacyTransferWorkspaces(guest));
  const receipts = new Set(Object.keys(account.guestPlaces ?? {}));
  const sourceVisits = visitStatuses(guest.records, "guest");
  const destinationStatusIds = new Set(
    account.records.flatMap((r) =>
      r.kind === "visit" && r.value.libraryId === null ? [r.value.placeId] : [],
    ),
  );
  const source = liveDevicePlaces(guest).filter((r) => {
    const previous = transfers[r.id];

    return previous
      ? previous.account === key &&
          previous.skippedGeneration !== r.generation &&
          (!receipts.has(r.id) ||
            previous.generation !== r.generation ||
            (sourceVisits.has(r.id) && !destinationStatusIds.has(previous.destination)))
      : !receipts.has(r.id);
  });
  if (
    !source.length &&
    account.reconciled &&
    guest.deviceTransfers &&
    guest.deviceAccounts?.includes(key)
  ) {
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }

    return 0;
  }
  const ids = new Map(
    await Promise.all(
      source.map(async (r) => {
        if (transfers[r.id]?.account === key && transfers[r.id].generation === r.generation) {
          return [r.id, transfers[r.id].destination] as const;
        }

        const identity = transfers[r.id] ? [key, r.id, r.generation] : [key, r.id];

        return [r.id, "guest-" + (await digest(JSON.stringify(identity)))] as const;
      }),
    ),
  );
  const existingMatches = placeMatches(account.reconciled ? account.records : cloud);

  const matchByValue = (r: DevicePlace) =>
    !transfers[r.id] || transfers[r.id].generation === r.generation;

  if (decision !== "skip") {
    for (const route of source) {
      if (route.kind === "route") {
        await putGeometry(
          key,
          await loadGeometry("guest", route.value.geometryId, isCurrent),
          isCurrent,
        );
      }
    }
  }
  let photoIds = new Map<string, string>();
  if (decision !== "skip") {
    photoIds = await copyPhotos(
      "guest",
      key,
      source
        .filter((r) => !existingMatches.find(ids.get(r.id)!, r.value, matchByValue(r)))
        .flatMap((r) => (r.value.photoId ? [r.value.photoId] : [])),
      isCurrent,
    );
  }
  const destinations = source
    .filter((r) => sourceVisits.has(r.id))
    .map(
      (r) => existingMatches.find(ids.get(r.id)!, r.value, matchByValue(r))?.id ?? ids.get(r.id)!,
    );
  const visitCandidates = new Map(
    await Promise.all(
      [...new Set(destinations)].map(
        async (id) => [id, await visitEntity(key, id, "none")] as const,
      ),
    ),
  );

  const transferVisit = (
    batch: ReturnType<typeof recordBatch>,
    statuses: Map<string, VisitStatus>,
    sourceId: string,
    destination: string,
  ) => {
    const status = statuses.get(sourceId);
    const entity = visitCandidates.get(destination);
    if (status && entity?.kind === "visit" && !batch.get(entity.id)) {
      batch.write({ ...entity, value: { ...entity.value, status } });
    }
  };

  const db = await database();
  const tx = db.transaction("workspaces", "readwrite");
  let added = 0;
  try {
    const currentGuest = (await tx.store.get("guest")) ?? seed("guest");
    const w = (await tx.store.get(key)) ?? seed(key);
    if (
      (w.importLease && w.importLease.expiresAt > Date.now()) ||
      (currentGuest.importLease && currentGuest.importLease.expiresAt > Date.now())
    ) {
      throw new Error("syncBusy");
    }
    const allWorkspaces = currentGuest.deviceAccounts?.length ? [] : await tx.store.getAll();
    const accounts = currentGuest.deviceAccounts?.length
      ? currentGuest.deviceAccounts
      : knownAccounts(currentGuest, allWorkspaces);
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    const legacy = currentGuest.deviceTransfers
      ? []
      : currentGuest.deviceAccounts?.length
        ? (await Promise.all(currentGuest.deviceAccounts.map((id) => tx.store.get(id)))).filter(
            (w): w is Workspace => !!w,
          )
        : allWorkspaces;
    currentGuest.deviceTransfers = deviceTransfers(currentGuest, legacy);
    if (!w.reconciled) {
      initializePrivateRecords(w, cloud);
    }
    if (w.reconciled && !w.guestPlaces) {
      const legacyIds = new Set(
        w.records.filter((r) => r.kind === "place" || r.kind === "route").map((r) => r.id),
      );
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
      if (record.kind !== "category" || record.deleted) {
        continue;
      }
      const value = valueKey(record.value);
      if (!existingCategories.has(value)) {
        existingCategories.set(value, record);
      }
    }
    const batch = recordBatch(w);
    const categories = new Map<string, string>();
    for (const r of source) {
      const current = guestById.get(r.id);
      if (!current || current.deleted || current.generation !== r.generation) {
        continue;
      }
      const owner = currentGuest.deviceTransfers[r.id];
      if (owner && (owner.account !== key || owner.skippedGeneration === r.generation)) {
        continue;
      }
      if (Object.hasOwn(w.guestPlaces, r.id) && (!owner || owner.generation === r.generation)) {
        continue;
      }
      if (decision === "skip" && owner && owner.generation !== r.generation) {
        w.guestPlaces[r.id] = null;
        owner.skippedGeneration = r.generation;
        continue;
      }
      const existing = existingPlaces.find(ids.get(r.id)!, r.value, matchByValue(r));
      if (existing) {
        w.guestPlaces[r.id] = existing.id;
        if (owner && decision !== "skip") {
          currentGuest.deviceTransfers[r.id] = {
            account: key,
            destination: existing.id,
            generation: r.generation,
          };
        }
        continue;
      }
      if (decision === "skip") {
        w.guestPlaces[r.id] = null;
        continue;
      }
      let categoryId = categories.get(r.value.categoryId);
      if (!categoryId) {
        const currentCategory = guestById.get(r.value.categoryId);
        const category =
          currentCategory?.kind === "category" && !currentCategory.deleted
            ? currentCategory
            : undefined;
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
      const copied = batch.write(
        entitySchema.parse({
          ...r,
          id,
          value: {
            ...r.value,
            ...(r.value.photoId
              ? { photoId: photoIds.get(r.value.photoId) ?? r.value.photoId }
              : {}),
            categoryId,
          },
        }),
      );
      existingPlaces.add(copied);
      w.guestPlaces[r.id] = id;
      currentGuest.deviceTransfers[r.id] = {
        account: key,
        destination: id,
        generation: r.generation,
      };
      added++;
    }
    batch.commit();
    const currentVisits = visitStatuses(currentGuest.records, "guest");
    const personalBatch = recordBatch(w);
    if (decision !== "skip") {
      for (const r of source) {
        const destination = w.guestPlaces[r.id];
        if (destination) {
          transferVisit(personalBatch, currentVisits, r.id, destination);
        }
      }
    }
    personalBatch.commit();
    if (decision !== "skip") {
      for (const r of liveDevicePlaces(currentGuest)) {
        const destination = Object.hasOwn(w.guestPlaces, r.id) ? w.guestPlaces[r.id] : null;
        if (destination && !currentGuest.deviceTransfers[r.id]) {
          currentGuest.deviceTransfers[r.id] = {
            account: key,
            destination,
            generation: r.generation,
          };
        }
      }
    }
    w.reconciled = true;
    currentGuest.deviceAccounts = [...accounts.filter((id) => id !== key), key];
    enforceCapacity(w);
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await tx.store.put(w);
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await tx.store.put(currentGuest);
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
  changed(["guest", key]);

  return added;
}

// Retain the guest source until the account's record has a cloud revision and
// no pending write/conflict. Ownership outlives the source and the account cache.
export async function finishDevicePlaceTransfer(key: string, isCurrent = () => true) {
  if (key === "guest" || workspaceIdentity(key).family) {
    throw new Error("invalidImport");
  }
  await flushDrafts();
  const db = await database();
  const tx = db.transaction(["workspaces", "drafts"], "readwrite");
  let completed = 0;
  try {
    const guest = (await tx.objectStore("workspaces").get("guest")) ?? seed("guest");
    if (guest.importLease && guest.importLease.expiresAt > Date.now()) {
      throw new Error("syncBusy");
    }
    const account = (await tx.objectStore("workspaces").get(key)) ?? seed(key);
    const byId = new Map(account.records.map((r) => [r.id, r]));
    const privateVisits = new Map(
      account.records.flatMap((r) =>
        r.kind === "visit" && r.value.libraryId === null ? [[r.value.placeId, r] as const] : [],
      ),
    );
    const guestVisits = visitStatuses(guest.records, "guest");
    const pendingIds = new Set([
      ...(account.deferredFlights ?? []).map((f) => f.mutation.entity.id),
      account.flight?.mutation.entity.id,
    ]);
    const removed = new Set<string>();
    for (const r of liveDevicePlaces(guest)) {
      const transfer = guest.deviceTransfers?.[r.id];
      if (
        !transfer ||
        transfer.account !== key ||
        transfer.generation !== r.generation ||
        account.guestPlaces?.[r.id] === null
      ) {
        continue;
      }
      const destination = byId.get(transfer.destination);
      if (
        !destination ||
        (destination.kind !== "place" && destination.kind !== "route") ||
        destination.dirty ||
        destination.conflict ||
        destination.revision < 1
      ) {
        continue;
      }
      if (pendingIds.has(destination.id)) {
        continue;
      }
      if (!destination.deleted && guestVisits.has(r.id)) {
        const visit = privateVisits.get(destination.id);
        if (
          !visit ||
          visit.dirty ||
          visit.conflict ||
          visit.revision < 1 ||
          pendingIds.has(visit.id)
        ) {
          continue;
        }
      }
      removed.add(r.id);
    }
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    if (removed.size) {
      guest.records = guest.records.filter(
        (r) =>
          !removed.has(r.id) &&
          !(r.kind === "visit" && r.value.libraryId === null && removed.has(r.value.placeId)),
      );
      await tx.objectStore("workspaces").put(guest);
      const draft = await tx.objectStore("drafts").get("guest");
      if (
        draft &&
        typeof draft === "object" &&
        "id" in draft &&
        typeof draft.id === "string" &&
        removed.has(draft.id)
      ) {
        await tx.objectStore("drafts").delete("guest");
      }
      completed = removed.size;
    }
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
  if (completed) {
    changed(["guest"]);
  }

  return completed;
}

export async function reconcileAccount(
  key: string,
  cloud: RecordState[],
  merge: boolean,
  isCurrent = () => true,
) {
  const existing = await readWorkspace(key);
  if (existing.reconciled) {
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }

    return existing;
  }
  await reconcileDevicePlaces(key, cloud, merge ? "copy" : "skip", isCurrent);

  return readWorkspace(key);
}

export const mergeSnapshot = (key: string, remote: RecordState[], isCurrent = () => true) =>
  changeWorkspace(key, (w) => mergeRecords(w, remote), { isCurrent });

export async function prepareMutation(
  key: string,
  isCurrent = () => true,
  retrySnapshotLimit = true,
) {
  let flight: Workspace["flight"];
  await changeWorkspace(
    key,
    (w) => {
      if (!w.reconciled) {
        return false;
      }
      if (w.flight) {
        flight = structuredClone(w.flight);

        return false;
      }
      const deferred = w.deferredFlights ?? [];
      const blockedIndex = deferred.findIndex((f) => f.snapshotBlocked);
      const deferredIds =
        blockedIndex >= 0 ? new Set(deferred.map((f) => f.mutation.entity.id)) : null;

      const eligible = (r: LocalRecord) =>
        r.dirty && !r.conflict && (!deferredIds || (r.revision > 0 && !deferredIds.has(r.id)));

      const r = w.records.find((r) => r.deleted && eligible(r)) ?? w.records.find(eligible);
      // A history ceiling blocks new identities permanently while the account
      // stays full. Known-revision updates/tombstones can still commit. Never
      // manufacture a second request for an identity with a durable flight.
      let next = deferred.findIndex((f) => blockedIndex < 0 || f.mutation.baseRevision > 0);
      if (next < 0 && !r && retrySnapshotLimit) {
        next = blockedIndex;
      }
      if (!r?.deleted && next >= 0) {
        const { generation, mutation } = deferred.splice(next, 1)[0];
        w.flight = { generation, mutation };
      } else if (r) {
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
      } else {
        return false;
      }
      flight = structuredClone(w.flight);
    },
    { isCurrent },
  );

  return flight;
}

export const deferCapacityFlight = (
  key: string,
  mutationId: string,
  isCurrent = () => true,
  snapshotBlocked = false,
) =>
  changeWorkspace(
    key,
    (w) => {
      if (w.flight?.mutation.mutationId !== mutationId) {
        return false;
      }
      if (!snapshotBlocked && !w.records.some((r) => r.dirty && r.deleted && !r.conflict)) {
        return false;
      }
      w.deferredFlights ??= [];
      w.deferredFlights.push(snapshotBlocked ? { ...w.flight, snapshotBlocked: true } : w.flight);
      delete w.flight;
    },
    { isCurrent },
  );

export const acknowledge = (
  key: string,
  mutationId: string,
  remote: RecordState,
  conflict = false,
  isCurrent = () => true,
) => changeWorkspace(key, (w) => acknowledgeRecord(w, mutationId, remote, conflict), { isCurrent });

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
      if (!r?.conflict) {
        return false;
      }
      const cloud = r.conflict;
      if (r.kind === "visit" && choice === "both") {
        throw new Error("invalidImport");
      }
      if (choice === "both" && !r.deleted) {
        write(w, { ...r, id: crypto.randomUUID() });
      }
      if (choice === "cloud" || choice === "both") {
        Object.assign(r, cloud, { dirty: false });
      } else {
        r.revision = cloud.revision;
        r.generation++;
        r.dirty = true;
      }
      delete r.conflict;
    },
    { isCurrent },
  );

export async function getDraft(key: string) {
  await flushDrafts().catch(() => {});

  return (await database()).get("drafts", key);
}

let pendingDraft = Promise.resolve();

export function setDraft(key: string, value: unknown) {
  pendingDraft = pendingDraft
    .catch(() => {})
    .then(async () => {
      const db = await database();
      if (value === null) {
        await db.delete("drafts", key);
      } else {
        await db.put("drafts", value, key);
      }
    });

  return pendingDraft;
}

export function clearDraft(key: string, id: string) {
  pendingDraft = pendingDraft
    .catch(() => {})
    .then(async () => {
      const db = await database();
      const tx = db.transaction("drafts", "readwrite");
      try {
        const draft = await tx.store.get(key);
        if (draft && typeof draft === "object" && "id" in draft && draft.id === id) {
          await tx.store.delete(key);
        }
        await tx.done;
      } catch (error) {
        await abortTransaction(tx);
        throw error;
      }
    });

  return pendingDraft;
}

export const flushDrafts = () => pendingDraft;

async function removeWorkspaceRecords(scope: string, allAccountWorkspaces: boolean) {
  await flushDrafts().catch(() => {});
  const db = await database();
  const tx = db.transaction(["workspaces", "drafts"], "readwrite");
  try {
    for (const storeName of ["workspaces", "drafts"] as const) {
      const store = tx.objectStore(storeName);
      if (allAccountWorkspaces) {
        await store.delete(scope);
        const prefix = `family:${scope}:`;
        const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
        for (const key of await store.getAllKeys(range)) {
          if (workspaceIdentity(key).account === scope) {
            await store.delete(key);
          }
        }
      } else {
        await store.delete(scope);
      }
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
}

export async function removeWorkspace(key: string) {
  await removeWorkspaceRecords(key, false);
  await clearPhotos(key);
  await clearGeometry(key);
  await clearRouteRecordings(key);
  changed([key]);
}

export async function removeAccountWorkspaces(account: string) {
  await removeWorkspaceRecords(account, true);
  await clearAccountPhotos(account);
  await clearGeometry(account, true);
  await clearRouteRecordings(account, true);
  try {
    localStorage.removeItem(`places-family:${account}`);
    localStorage.removeItem(`places-workspace:${account}`);
  } catch {}
  changed();
}
