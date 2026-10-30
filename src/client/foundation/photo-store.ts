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
const photoChannel =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("places-photos") : null;
export function watchPhoto(workspace: string, id: string, onChange: () => void) {
  const receive = (data: { workspace?: string; ids?: string[] }) => {
    if (data?.workspace === workspace && Array.isArray(data.ids) && data.ids.includes(id))
      onChange();
  };
  const local = (event: Event) => receive((event as CustomEvent).detail);
  const remote = (event: MessageEvent) => receive(event.data);
  window.addEventListener("places-photos", local);
  photoChannel?.addEventListener("message", remote);
  return () => {
    window.removeEventListener("places-photos", local);
    photoChannel?.removeEventListener("message", remote);
  };
}
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
export async function putPhotos(photos: StoredPhoto[], isCurrent = () => true) {
  if (!isCurrent()) throw new Error("accountChanged");
  if (!photos.length) return;
  const workspace = photos[0].workspace;
  if (photos.some((p) => p.workspace !== workspace || p.blob.size > PHOTO_BYTES))
    throw new Error("invalidPhoto");
  const db = await database(),
    tx = db.transaction("photos", "readwrite");
  try {
    const existing = await tx.store.index("workspace").getAll(workspace);
    if (!isCurrent()) throw new Error("accountChanged");
    const all = new Map(existing.map((p) => [p.id, p]));
    for (const p of photos) {
      const previous = all.get(p.id);
      if (previous && previous.hash !== p.hash) throw new Error("invalidPhoto");
      all.set(p.id, previous ?? p);
    }
    if (all.size > 1000 || [...all.values()].reduce((n, p) => n + p.blob.size, 0) > PHOTO_QUOTA)
      throw new Error("photoQuota");
    for (const p of photos) {
      if (!isCurrent()) throw new Error("accountChanged");
      await tx.store.put(all.get(p.id)!);
    }
    if (!isCurrent()) throw new Error("accountChanged");
    await tx.done;
    const ids = [
      ...new Set(photos.filter((p) => !existing.some((e) => e.id === p.id)).map((p) => p.id)),
    ];
    if (ids.length) {
      const detail = { workspace, ids };
      if (typeof window !== "undefined")
        window.dispatchEvent(new CustomEvent("places-photos", { detail }));
      photoChannel?.postMessage(detail);
    }
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
  const mapping = new Map<string, string>();
  if (!photos.length) return mapping;
  const existing = await (await database()).getAllFromIndex("photos", "workspace", to);
  const all = new Map(existing.map((p) => [p.id, p]));
  const copies = photos.map((photo) => {
    const p = photo!;
    let id = p.id;
    const previous = all.get(id);
    if (previous && previous.hash !== p.hash) {
      id =
        [...all.values()].find((candidate) => candidate.hash === p.hash)?.id ?? crypto.randomUUID();
      while (all.has(id) && all.get(id)!.hash !== p.hash) id = crypto.randomUUID();
    }
    mapping.set(p.id, id);
    const copy = { ...p, id, workspace: to, uploaded: false };
    all.set(id, all.get(id) ?? copy);
    return copy;
  });
  await putPhotos(copies, isCurrent);
  return mapping;
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
