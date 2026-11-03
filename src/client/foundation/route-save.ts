import { changeWorkspace, readWorkspace } from "./library";
import { write } from "./library-records";
import {
  withRecordingIdle,
  draftGeometry,
  discardRouteDraft,
  readRouteDraft,
  type RouteDraft,
} from "./route-recording";
import { putGeometry } from "./route-store";
import { routeSchema, type Entity } from "../../shared/model";
import { visitEntity } from "../../shared/visits";

export async function prepareRecordedRoute(
  draft: RouteDraft,
  isCurrent = () => true,
): Promise<Extract<Entity, { kind: "route" }>> {
  const geometry = await withRecordingIdle(async () => {
    const latest = await readRouteDraft(draft.workspace);
    if (
      latest?.id !== draft.id ||
      latest.count !== draft.count ||
      latest.elapsed !== draft.elapsed
    ) {
      throw new Error("placeChanged");
    }

    return putGeometry(draft.workspace, await draftGeometry(draft), isCurrent);
  });
  const startedAt = new Date(draft.startedAt).toISOString();
  const workspace = await readWorkspace(draft.workspace);
  const categoryId = workspace.records.some(
    (r) => r.kind === "category" && r.id === "route" && !r.deleted,
  )
    ? "route"
    : "other";

  return {
    id: draft.id,
    kind: "route",
    value: routeSchema.parse({
      name: "Route",
      categoryId,
      capturedAt: startedAt,
      updatedAt: new Date().toISOString(),
      ...geometry.summary,
      geometryId: geometry.id,
      startedAt,
      stoppedAt: new Date(draft.startedAt + draft.elapsed).toISOString(),
      duration: draft.elapsed,
    }),
  };
}

export async function saveRecordedRoute(
  workspace: string,
  entity: Extract<Entity, { kind: "route" }>,
  isCurrent: () => boolean,
) {
  const visit = await visitEntity(workspace, entity.id, "visited");
  await withRecordingIdle(async () => {
    const existing = await readWorkspace(workspace);
    if (existing.records.some((r) => r.id === entity.id && r.kind === "route")) {
      return;
    }
    const draft = await readRouteDraft(workspace);
    if (
      draft?.id !== entity.id ||
      draft.count !== entity.value.pointCount ||
      draft.elapsed !== entity.value.duration
    ) {
      throw new Error("placeChanged");
    }
    await changeWorkspace(
      workspace,
      (w) => {
        if (w.completedRouteDrafts?.includes(entity.id)) {
          return false;
        }
        if (w.records.some((r) => r.id === entity.id && r.kind === "route")) {
          return false;
        }
        write(w, entity);
        w.completedRouteDrafts = [...(w.completedRouteDrafts ?? []), entity.id];
      },
      { isCurrent, personalVisit: visit, clearDraftId: entity.id },
    );
  });
  // The completion marker makes a retry harmless even if cleanup is interrupted.
  await cleanupRecordedRoutes(workspace, isCurrent).catch(() => {});
}

export async function cleanupRecordedRoutes(workspace: string, isCurrent = () => true) {
  for (const id of (await readWorkspace(workspace)).completedRouteDrafts ?? []) {
    if (!isCurrent()) {
      return;
    }
    await discardRouteDraft(workspace, id);
    await changeWorkspace(
      workspace,
      (w) => {
        w.completedRouteDrafts = w.completedRouteDrafts?.filter((entry) => entry !== id);
      },
      { isCurrent, existingOnly: true },
    );
  }
}
