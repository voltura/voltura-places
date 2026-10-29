import { PHOTO_BYTES, jpegDimensions } from "../../shared/photos";
import { getPhoto, makeStoredPhoto, markPhotoUploaded, putPhotos } from "./photo-store";
export async function preparePhoto(file: File, workspace: string) {
  if (!file.type.startsWith("image/") || file.size > 32 * 1024 * 1024)
    throw new Error("invalidPhoto");
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 80000000)
      throw new Error("invalidPhoto");
    const canvas = document.createElement("canvas"),
      context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("invalidPhoto");
    for (const maximum of [1280, 960, 640]) {
      const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.65, 0.45]) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (blob && blob.size <= PHOTO_BYTES) {
          const photo = await makeStoredPhoto(workspace, crypto.randomUUID(), blob);
          await putPhotos([photo]);
          return photo.id;
        }
      }
    }
    throw new Error("invalidPhoto");
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function loadPhoto(workspace: string, id: string) {
  const cached = await getPhoto(workspace, id);
  if (cached) return cached.blob;
  if (workspace === "guest" || !navigator.onLine) throw new Error("photoUnavailable");
  const response = await fetch(`/api/v1/photos/${id}`, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "X-Places-Account": workspace },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("photoUnavailable");
  const buffer = await response.arrayBuffer();
  jpegDimensions(new Uint8Array(buffer));
  const photo = await makeStoredPhoto(workspace, id, new Blob([buffer], { type: "image/jpeg" }));
  await putPhotos([{ ...photo, uploaded: true }]);
  return photo.blob;
}
export async function uploadPhoto(workspace: string, id: string) {
  const photo = await getPhoto(workspace, id);
  if (!photo) throw new Error("photoUnavailable");
  if (photo.uploaded) return;
  const response = await fetch(`/api/v1/photos/${id}`, {
    method: "PUT",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "image/jpeg", "X-Places-Account": workspace },
    body: photo.blob,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(response.status === 413 ? "photoQuota" : "photoUnavailable");
  await markPhotoUploaded(workspace, id, photo.hash);
}
