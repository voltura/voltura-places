import { type DBSchema } from "idb";
import { abortTransaction, broadcast, localDatabase, openChannel } from "./database";
import { workspaceIdentity } from "../../shared/families";
import {
  PHOTO_BYTES,
  PHOTO_QUOTA,
  jpegDimensions,
  photoHash,
  decodePhoto,
} from "../../shared/photos";

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
const database = localDatabase<PhotoDB>("voltura-places-photos", 1, (db) => {
  db.createObjectStore("photos", { keyPath: ["workspace", "id"] }).createIndex(
    "workspace",
    "workspace",
  );
});
const photoChannel = openChannel("places-photos");

export function watchPhoto(workspace: string, id: string, onChange: () => void) {
  const receive = (data: { workspace?: string; ids?: string[] }) => {
    if (data?.workspace === workspace && Array.isArray(data.ids) && data.ids.includes(id)) {
      onChange();
    }
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

export async function workspacePhotos(workspace: string) {
  return (await database()).getAllFromIndex("photos", "workspace", workspace);
}

export async function workspacePhotoIds(workspace: string) {
  const keys = await (await database()).getAllKeysFromIndex("photos", "workspace", workspace);

  return new Set(keys.map((key) => key[1]));
}

export async function getPhoto(workspace: string, id: string) {
  return (await database()).get("photos", [workspace, id]);
}

async function storedJpeg(
  workspace: string,
  id: string,
  blob: Blob,
  verifyPixels: boolean,
): Promise<StoredPhoto> {
  if (blob.size > PHOTO_BYTES) {
    throw new Error("invalidPhoto");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  jpegDimensions(bytes);
  if (verifyPixels) {
    await decodeJpeg(blob);
  }

  return {
    workspace,
    id,
    blob: blob.type === "image/jpeg" ? blob : blob.slice(0, blob.size, "image/jpeg"),
    hash: await photoHash(bytes),
    uploaded: false,
  };
}

async function decodeJpeg(blob: Blob) {
  // A browser decoder verifies entropy data as well as the shared structural checks.
  if (typeof createImageBitmap === "function") {
    const image = await createImageBitmap(blob).catch(() => {
      throw new Error("invalidPhoto");
    });
    image.close();
  } else if (typeof Image !== "undefined") {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
    } catch {
      throw new Error("invalidPhoto");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export const makeStoredPhoto = (workspace: string, id: string, blob: Blob) =>
  storedJpeg(workspace, id, blob, true);

// Reuse the structurally checked backup bytes for hashing and browser pixel validation.
export async function makeBackupPhoto(
  workspace: string,
  id: string,
  data: string,
): Promise<StoredPhoto> {
  const bytes = decodePhoto(data);
  const blob = new Blob([bytes], { type: "image/jpeg" });
  await decodeJpeg(blob);

  return { workspace, id, blob, hash: await photoHash(bytes), uploaded: false };
}

// Only the browser canvas encoder uses this path. Imported and downloaded bytes
// retain both the structural and pixel decoder checks.
export const makeCanvasPhoto = (workspace: string, id: string, blob: Blob) =>
  storedJpeg(workspace, id, blob, false);

async function persistPhotos(
  workspace: string,
  photos: StoredPhoto[],
  remap: boolean,
  isCurrent: () => boolean,
) {
  const mapping = new Map<string, string>();
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if (!photos.length) {
    return mapping;
  }
  const db = await database();
  const tx = db.transaction("photos", "readwrite");
  try {
    const existing = await tx.store.index("workspace").getAll(workspace);
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    const indexed = new Map<string, StoredPhoto>();
    const byHash = new Map<string, string>();
    let total = 0;
    for (const photo of existing) {
      indexed.set(photo.id, photo);
      total += photo.blob.size;
      if (remap && !byHash.has(photo.hash)) {
        byHash.set(photo.hash, photo.id);
      }
    }
    const added: string[] = [];
    for (const photo of photos) {
      if (!isCurrent()) {
        throw new Error("accountChanged");
      }
      if ((!remap && photo.workspace !== workspace) || photo.blob.size > PHOTO_BYTES) {
        throw new Error("invalidPhoto");
      }
      let id = photo.id;
      const collision = indexed.get(id);
      if (collision && collision.hash !== photo.hash) {
        if (!remap) {
          throw new Error("invalidPhoto");
        }
        id = byHash.get(photo.hash) ?? crypto.randomUUID();
        while (indexed.has(id) && indexed.get(id)!.hash !== photo.hash) {
          id = crypto.randomUUID();
        }
      }
      mapping.set(photo.id, id);
      if (indexed.has(id)) {
        continue;
      }
      const next = remap ? { ...photo, id, workspace, uploaded: false } : photo;
      total += photo.blob.size;
      if (indexed.size >= 1000 || total > PHOTO_QUOTA) {
        throw new Error("photoQuota");
      }
      await tx.store.add(next);
      indexed.set(id, next);
      if (remap && !byHash.has(photo.hash)) {
        byHash.set(photo.hash, id);
      }
      added.push(id);
    }
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await tx.done;
    if (added.length) {
      const detail = { workspace, ids: added };
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("places-photos", { detail }));
      }
      broadcast(photoChannel, detail);
    }

    return mapping;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
}

export async function putPhotos(photos: StoredPhoto[], isCurrent = () => true) {
  await persistPhotos(photos[0]?.workspace ?? "", photos, false, isCurrent);
}

export async function markPhotoUploaded(
  workspace: string,
  id: string,
  hash: string,
  isCurrent = () => true,
) {
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const db = await database();
  const tx = db.transaction("photos", "readwrite");
  try {
    const photo = await tx.store.get([workspace, id]);
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    if (photo?.hash === hash && !photo.uploaded) {
      await tx.store.put({ ...photo, uploaded: true });
    }
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
}

export async function copyPhotos(from: string, to: string, ids: string[], isCurrent = () => true) {
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const mapping = new Map<string, string>();
  if (!ids.length) {
    return mapping;
  }
  const db = await database();
  const source = db.transaction("photos");
  const photos = await Promise.all([...new Set(ids)].map((id) => source.store.get([from, id])));
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if (photos.some((p) => !p)) {
    throw new Error("photoUnavailable");
  }

  return persistPhotos(to, photos as StoredPhoto[], true, isCurrent);
}

export async function clearPhotos(workspace: string) {
  const db = await database();
  const tx = db.transaction("photos", "readwrite");
  try {
    await tx.store.delete(IDBKeyRange.bound([workspace], [workspace, []]));
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
}

export async function clearAccountPhotos(account: string) {
  const db = await database();
  const tx = db.transaction("photos", "readwrite");
  try {
    await tx.store.delete(IDBKeyRange.bound([account], [account, []]));
    const prefix = `family:${account}:`;
    const familyRange = IDBKeyRange.bound([prefix], [prefix + "\uffff"]);
    for (const key of await tx.store.getAllKeys(familyRange)) {
      if (workspaceIdentity(key[0]).account === account) {
        await tx.store.delete(key);
      }
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
}
