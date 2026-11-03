import { z } from "zod";
import { routeSchema, categorySchema } from "../../shared/model";
import { canonicalGeometry, geometrySchema } from "../../shared/routes";
import { decodePhoto } from "../../shared/photos";
import { putGeometry } from "./route-store";
import { makeBackupPhoto, putPhotos } from "./photo-store";
import { changeWorkspace, readWorkspace } from "./library";
import { write, sameValue } from "./library-records";
import { digest } from "../../shared/digest";
import { api } from "./http";

export const routeSnapshotSchema = z
  .object({
    version: z.literal(1),
    route: routeSchema,
    category: categorySchema,
    geometry: geometrySchema,
    photo: z.string().max(350000).optional(),
  })
  .strict();
export type RouteSnapshot = z.infer<typeof routeSnapshotSchema>;

export async function fetchRouteShare(token: string) {
  const response = await fetch("/api/v1/route-share", {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    mode: "same-origin",
    headers: { "X-Places-Route-Token": token },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    void response.body?.cancel();
    throw new Error("invalidShare");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("invalidShare");
  }
  const bytes = new Uint8Array(2 * 1024 * 1024);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (size + value.length > bytes.length) {
        throw new Error("invalidShare");
      }
      bytes.set(value, size);
      size += value.length;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const snapshot = routeSnapshotSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))),
  );
  const geometry = await canonicalGeometry(snapshot.geometry);
  if (
    Boolean(snapshot.photo) !== Boolean(snapshot.route.photoId) ||
    geometry.id !== snapshot.route.geometryId ||
    Object.entries(geometry.summary).some(
      ([key, value]) =>
        JSON.stringify(value) !==
        JSON.stringify(snapshot.route[key as keyof typeof snapshot.route]),
    )
  ) {
    throw new Error("invalidShare");
  }
  if (snapshot.photo) {
    decodePhoto(snapshot.photo);
  }

  return snapshot;
}

export async function createRouteShare(workspace: string, id: string) {
  const result = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(await api(`/api/v1/route-shares/${id}`, {}, workspace));

  return `${location.origin}/#route=${result.token}`;
}

export async function revokeRouteShare(workspace: string, id: string) {
  await api(`/api/v1/route-shares/${id}`, undefined, workspace, "DELETE");
}

export async function saveRouteSnapshot(
  workspace: string,
  id: string,
  snapshot: RouteSnapshot,
  isCurrent: () => boolean,
) {
  if ((await readWorkspace(workspace)).records.some((r) => r.id === id)) {
    return;
  }
  await putGeometry(workspace, snapshot.geometry, isCurrent);
  const photoId = snapshot.photo ? crypto.randomUUID() : null;
  if (photoId && snapshot.photo) {
    await putPhotos([await makeBackupPhoto(workspace, photoId, snapshot.photo)], isCurrent);
  }
  const categoryId = "shared-" + (await digest(JSON.stringify(snapshot.category)));
  await changeWorkspace(
    workspace,
    (w) => {
      if (w.records.some((r) => r.id === id)) {
        return false;
      }
      let category = w.records.find(
        (r) => r.kind === "category" && !r.deleted && sameValue(r.value, snapshot.category),
      );
      if (!category && !w.records.some((r) => r.id === categoryId)) {
        category = write(w, { id: categoryId, kind: "category", value: snapshot.category });
      }
      write(w, {
        id,
        kind: "route",
        value: {
          ...snapshot.route,
          categoryId: category?.id ?? "other",
          photoId,
          updatedAt: new Date().toISOString(),
        },
      });
    },
    { isCurrent },
  );
}
