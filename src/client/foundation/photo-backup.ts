import { exportBackup, type Workspace } from "./library";
import { loadPhoto } from "./photos";
export async function exportWithPhotos(workspace: Workspace) {
  const ids = new Set(
    workspace.records.flatMap((r) =>
      r.kind === "place" && !r.deleted && r.value.photoId ? [r.value.photoId] : [],
    ),
  );
  const photos: { id: string; data: string }[] = [];
  for (const id of ids) {
    const bytes = new Uint8Array(await (await loadPhoto(workspace.key, id)).arrayBuffer());
    let raw = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    photos.push({ id, data: `data:image/jpeg;base64,${btoa(raw)}` });
  }
  return exportBackup(workspace, photos);
}
