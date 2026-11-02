import { ApiError } from "./http";
import { workspaceHeaders } from "../../shared/families";
import { PHOTO_BYTES, SOURCE_PHOTO_BYTES } from "../../shared/photos";
import {
  getPhoto,
  makeStoredPhoto,
  makeCanvasPhoto,
  markPhotoUploaded,
  putPhotos,
} from "./photo-store";

export async function preparePhoto(file: File, workspace: string, isCurrent = () => true) {
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if ((file.type && !file.type.startsWith("image/")) || file.size > SOURCE_PHOTO_BYTES) {
    throw new Error("invalidPhoto");
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    // Load metadata before requesting a pixel decode of a potentially huge camera image.
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("invalidPhoto"));
      image.src = url;
    });
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 80000000
    ) {
      throw new Error("invalidPhoto");
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("invalidPhoto");
    }
    let previousScale = 0;
    for (const maximum of [1280, 960, 640]) {
      if (!isCurrent()) {
        throw new Error("accountChanged");
      }
      const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
      if (scale === previousScale) {
        continue;
      }
      previousScale = scale;
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.65, 0.45]) {
        if (!isCurrent()) {
          throw new Error("accountChanged");
        }
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (!isCurrent()) {
          throw new Error("accountChanged");
        }
        if (blob && blob.size <= PHOTO_BYTES) {
          const photo = await makeCanvasPhoto(workspace, crypto.randomUUID(), blob);
          if (!isCurrent()) {
            throw new Error("accountChanged");
          }
          await putPhotos([photo], isCurrent);

          return photo.id;
        }
      }
    }
    throw new Error("invalidPhoto");
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Download = {
  clients: Set<() => boolean>;
  result: Promise<Blob>;
};
const downloads = new Map<string, Download>();

export async function loadPhoto(workspace: string, id: string, isCurrent = () => true) {
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const cached = await getPhoto(workspace, id);
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if (cached) {
    return cached.blob;
  }
  if (workspace === "guest" || !navigator.onLine) {
    throw new Error("photoUnavailable");
  }
  const key = JSON.stringify([workspace, id]);
  let flight = downloads.get(key);
  // A new visit to the same account must not revive a discarded operation.
  if (!flight || !Array.from(flight.clients).some((current) => current())) {
    const clients = new Set([isCurrent]);

    const current = () => Array.from(clients).some((check) => check());

    const result = downloadPhoto(workspace, id, current);
    flight = { clients, result };
    downloads.set(key, flight);
  } else {
    flight.clients.add(isCurrent);
  }
  try {
    return await flight.result;
  } finally {
    flight.clients.delete(isCurrent);
    if (!flight.clients.size && downloads.get(key) === flight) {
      downloads.delete(key);
    }
    // A closed consumer must receive neither the data nor another consumer's
    // transport error after its workspace has changed.
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
  }
}

async function downloadPhoto(workspace: string, id: string, isCurrent: () => boolean) {
  const response = await fetch(`/api/v1/photos/${id}`, {
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: workspaceHeaders(workspace),
    signal: AbortSignal.timeout(20000),
  });
  if (!isCurrent()) {
    void response.body?.cancel().catch(() => {});
    throw new Error("accountChanged");
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403 || response.status === 409) {
      throw new ApiError(
        response.status,
        response.status === 401
          ? "signInAgain"
          : response.status === 403
            ? "familyAccessEnded"
            : "accountChanged",
      );
    }
    throw new ApiError(response.status, "photoUnavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("invalidPhoto");
  }
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (!isCurrent()) {
        throw new Error("accountChanged");
      }
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > PHOTO_BYTES) {
        throw new Error("invalidPhoto");
      }
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const photo = await makeStoredPhoto(workspace, id, new Blob(chunks, { type: "image/jpeg" }));
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  await putPhotos([{ ...photo, uploaded: true }], isCurrent);

  return photo.blob;
}

export async function uploadPhoto(
  workspace: string,
  id: string,
  isCurrent = () => true,
  force = false,
) {
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  let photo = await getPhoto(workspace, id);
  if (!photo) {
    await loadPhoto(workspace, id, isCurrent);
    photo = await getPhoto(workspace, id);
  }
  if (!photo) {
    throw new Error("photoUnavailable");
  }
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if (photo.uploaded && !force) {
    return;
  }
  const response = await fetch(`/api/v1/photos/${id}`, {
    method: "PUT",
    credentials: "same-origin",
    redirect: "error",
    mode: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "image/jpeg", ...workspaceHeaders(workspace) },
    body: photo.blob,
    signal: AbortSignal.timeout(20000),
  });
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.status === 413 ? "photoQuota" : "photoUploadFailed",
    );
  }
  await markPhotoUploaded(workspace, id, photo.hash, isCurrent);
}
