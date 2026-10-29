import { openDB, type DBSchema } from "idb";
import { workspaceIdentity } from "../../shared/families";
import { PHOTO_BYTES, PHOTO_QUOTA, jpegDimensions, photoHash } from "../../shared/photos";
export type StoredPhoto = {
  workspace: string;
  id: string;
  blob: Blob;
  hash: string;
  uploaded: boolean;
};
interface PhotoDB extends DBSchema {
  photos: { key: [string, string]; value: StoredPhoto; indexes: { workspace: string } };
}
const database = () =>
  openDB<PhotoDB>("voltura-places-photos", 1, {
    upgrade(db) {
      db.createObjectStore("photos", { keyPath: ["workspace", "id"] }).createIndex(
        "workspace",
        "workspace",
      );
    },
  });
export async function getPhoto(workspace: string, id: string) {
  return (await database()).get("photos", [workspace, id]);
}
export async function makeStoredPhoto(
  workspace: string,
  id: string,
  blob: Blob,
): Promise<StoredPhoto> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  jpegDimensions(bytes);
  return {
    workspace,
    id,
    blob: new Blob([bytes], { type: "image/jpeg" }),
    hash: await photoHash(bytes),
    uploaded: false,
  };
}
export async function putPhotos(photos: StoredPhoto[]) {
  if (!photos.length) return;
  const workspace = photos[0].workspace;
  if (photos.some((p) => p.workspace !== workspace || p.blob.size > PHOTO_BYTES))
    throw new Error("invalidPhoto");
  const db = await database(),
    tx = db.transaction("photos", "readwrite");
  try {
    const existing = await tx.store.index("workspace").getAll(workspace);
    const all = new Map(existing.map((p) => [p.id, p]));
    for (const p of photos) {
      const previous = all.get(p.id);
      if (previous && previous.hash !== p.hash) throw new Error("invalidPhoto");
      all.set(p.id, previous ?? p);
    }
    if (all.size > 1000 || [...all.values()].reduce((n, p) => n + p.blob.size, 0) > PHOTO_QUOTA)
      throw new Error("photoQuota");
    for (const p of photos) await tx.store.put(all.get(p.id)!);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
export async function markPhotoUploaded(workspace: string, id: string, hash: string) {
  const db = await database(),
    tx = db.transaction("photos", "readwrite"),
    photo = await tx.store.get([workspace, id]);
  if (photo?.hash === hash) await tx.store.put({ ...photo, uploaded: true });
  await tx.done;
}
export async function copyPhotos(from: string, to: string, ids: string[], isCurrent = () => true) {
  const photos = await Promise.all([...new Set(ids)].map((id) => getPhoto(from, id)));
  if (photos.some((p) => !p)) throw new Error("photoUnavailable");
  if (!isCurrent()) throw new Error("accountChanged");
  await putPhotos(photos.map((p) => ({ ...p!, workspace: to, uploaded: false })));
}
export async function clearPhotos(workspace: string) {
  const db = await database(),
    tx = db.transaction("photos", "readwrite");
  for (const key of await tx.store.index("workspace").getAllKeys(workspace))
    await tx.store.delete(key);
  await tx.done;
}
export async function clearAccountPhotos(account: string) {
  const db = await database(),
    tx = db.transaction("photos", "readwrite");
  for (const key of await tx.store.getAllKeys())
    if (workspaceIdentity(key[0]).account === account) await tx.store.delete(key);
  await tx.done;
}
