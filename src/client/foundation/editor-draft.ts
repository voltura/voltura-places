import { entitySchema } from "../../shared/model";

export function hasUnfinishedEdits(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const draft = value as Record<string, unknown>;
  if (typeof draft.id !== "string" || typeof draft.name !== "string") {
    return false;
  }
  const parsed = entitySchema.safeParse(draft.base);
  const base =
    parsed.success && (parsed.data.kind === "place" || parsed.data.kind === "route")
      ? parsed.data.value
      : null;
  if (!base) {
    return !!(
      draft.name ||
      draft.description ||
      draft.latitude ||
      draft.longitude ||
      draft.photoId ||
      (draft.categoryId && draft.categoryId !== "other")
    );
  }

  return (
    draft.name !== base.name ||
    (draft.description ?? base.description ?? "") !== (base.description ?? "") ||
    draft.categoryId !== base.categoryId ||
    draft.latitude !== String(base.latitude) ||
    draft.longitude !== String(base.longitude) ||
    (draft.photoId === undefined ? (base.photoId ?? null) : draft.photoId) !==
      (base.photoId ?? null) ||
    (draft.accuracy === undefined ? base.accuracy : draft.accuracy) !== base.accuracy ||
    (draft.capturedAt ?? base.capturedAt) !== base.capturedAt ||
    draft.visitedHere === true
  );
}
