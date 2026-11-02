import { visitOwner } from "../../shared/visits";
import { readWorkspace, exportBackup, type Workspace } from "./library";
import { loadPhoto } from "./photos";

export async function exportWithPhotos(workspace: Workspace, isCurrent = () => true) {
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const ids = new Set(
    workspace.records.flatMap((r) =>
      r.kind === "place" && !r.deleted && r.value.photoId ? [r.value.photoId] : [],
    ),
  );
  const photos: { id: string; data: string }[] = [];

  const encode = async (id: string) => {
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    const blob = await loadPhoto(workspace.key, id, isCurrent);

    return { id, data: await jpegDataURL(blob) };
  };

  // Keep network latency and file encoding off the serial critical path without
  // holding an entire backup's raw photographs in memory.
  const ordered = [...ids];
  for (let offset = 0; offset < ordered.length; offset += 4) {
    photos.push(...(await Promise.all(ordered.slice(offset, offset + 4).map(encode))));
  }
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const personal =
    visitOwner(workspace.key) === workspace.key
      ? workspace
      : await readWorkspace(visitOwner(workspace.key));
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }

  return exportBackup(workspace, photos, personal.records);
}

async function jpegDataURL(blob: Blob) {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.onabort = () => reject(new Error("photoUnavailable"));
      reader.readAsDataURL(
        blob.type === "image/jpeg" ? blob : blob.slice(0, blob.size, "image/jpeg"),
      );
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }

  return `data:image/jpeg;base64,${btoa(raw)}`;
}
