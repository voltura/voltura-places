import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  deleteEntity,
  getDraft,
  readWorkspace,
  saveEntity,
  resolveConflict,
} from "../foundation/library";
import { validPosition, captureLocation } from "../foundation/location-review";
import type { Preferences } from "../foundation/preferences";
import { libraryErrorMessage, type Message } from "../foundation/i18n";
import type { SyncStatus } from "../foundation/sync";
import { placeSchema, type Entity, type LocalRecord, type PlaceRecord } from "../../shared/model";
import type { Session } from "./useSession";
import type { WorkspaceController } from "./useWorkspace";
import type { Operation } from "./operations";

export function usePlaceEditing({
  session,
  workspace,
  prefs,
  setPrefs,
  categories,
  t,
  notify,
  sync,
  setStatus,
  setSelected,
  rememberPosition,
  onRemoved,
}: {
  session: Session;
  workspace: WorkspaceController;
  prefs: Preferences;
  setPrefs: Dispatch<SetStateAction<Preferences>>;
  categories: LocalRecord[];
  t: (key: Message) => string;
  notify: (key: Message, error?: boolean) => void;
  sync: () => void;
  setStatus: Dispatch<SetStateAction<SyncStatus>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  rememberPosition: (position: GeolocationPosition) => void;
  onRemoved: () => void;
}) {
  const { operations } = session;
  const { scope, refresh, beginWrite } = workspace;
  const rendered = operations.capture();
  const [editor, setEditor] = useState<{
    entity?: Entity;
    fresh?: boolean;
    draftId?: string;
  } | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<{ entity?: LocalRecord } | null>(null);
  const [deletePlace, setDeletePlace] = useState<{ place: PlaceRecord; scope: string } | null>(
    null,
  );
  const [deleteCategory, setDeleteCategory] = useState<{
    entity: LocalRecord;
    scope: string;
  } | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);
  const categoryDeletePending = useRef<symbol | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsReview, setGpsReview] = useState(false);
  const capture = useRef(0);
  const stopCapture = useRef(() => {});

  const cancelCapture = () => {
    capture.current++;
    stopCapture.current();
    setLocating(false);
  };

  const reset = () => {
    setEditor(null);
    setCategoryEdit(null);
    setDeletePlace(null);
    setDeleteCategory(null);
    categoryDeletePending.current = null;
    setDeletingCategory(false);
    setGpsReview(false);
    capture.current++;
    stopCapture.current();
    setLocating(false);
  };

  useEffect(() => () => stopCapture.current(), []);
  useEffect(() => {
    let active = true;
    const operation = operations.capture();
    void Promise.all([getDraft(scope), readWorkspace(scope)])
      .then(([draft, w]) => {
        if (
          active &&
          operation.isCurrent() &&
          draft &&
          typeof draft === "object" &&
          "id" in draft &&
          typeof draft.id === "string"
        ) {
          setEditor({
            entity: w.records.find((r) => r.id === draft.id && !r.deleted),
            draftId: draft.id,
          });
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [scope, operations]);

  async function save(
    entity: Entity,
    base?: Entity | null,
    clearDraft = false,
    visitedHere = false,
  ) {
    const operation = beginWrite();

    const isCurrent = () => rendered.isCurrent() && operation.isCurrent();

    if (!isCurrent()) {
      throw new Error("familyAccessEnded");
    }
    if (!(await readWorkspace(operation.workspace)).reconciled) {
      throw new Error("syncBusy");
    }
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await saveEntity(
      operation.workspace,
      entity,
      base,
      clearDraft,
      isCurrent,
      visitedHere ? "visited" : undefined,
    );
    if (!isCurrent()) {
      return;
    }
    if (entity.kind === "place") {
      setPrefs((p) => ({ ...p, lastCategory: entity.value.categoryId }));
    }
    await refresh();
    if (!isCurrent()) {
      return;
    }
    setStatus(operation.workspace === "guest" ? "localOnly" : "pending");
    sync();
  }

  async function persistPosition(
    position: GeolocationPosition,
    operation: Operation,
    attempt: number,
  ) {
    const isCurrent = () => operation.isCurrent() && attempt === capture.current;

    if (!isCurrent()) {
      return;
    }
    if (!validPosition(position)) {
      setLocating(false);
      notify("gpsUnavailable", true);

      return;
    }
    rememberPosition(position);
    const now = new Date().toISOString();
    const categoryId = categories.some((c) => c.id === prefs.lastCategory)
      ? prefs.lastCategory
      : "other";
    const entity: Entity = {
      id: crypto.randomUUID(),
      kind: "place",
      value: placeSchema.parse({
        name: `${t("currentLocation")} · ${new Intl.DateTimeFormat(prefs.language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date())}`,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        categoryId,
        capturedAt: new Date(position.timestamp).toISOString(),
        updatedAt: now,
      }),
    };
    try {
      await saveEntity(operation.workspace, entity, undefined, false, isCurrent, "visited");
      if (!isCurrent()) {
        return;
      }
      await refresh();
      if (!isCurrent()) {
        return;
      }
      setSelected(entity.id);
      setEditor({ entity, fresh: true });
      sync();
    } catch {
      if (isCurrent()) {
        notify("storageFailure", true);
      }
    } finally {
      if (attempt === capture.current) {
        setLocating(false);
      }
    }
  }

  function saveHere() {
    const operation = beginWrite();
    if (!rendered.isCurrent() || !operation.isCurrent()) {
      notify("familyAccessEnded", true);

      return;
    }
    if (!navigator.geolocation) {
      notify("gpsUnsupported", true);

      return;
    }
    if (prefs.reviewGps) {
      setGpsReview(true);

      return;
    }
    const attempt = ++capture.current;
    setLocating(true);
    stopCapture.current();
    stopCapture.current = captureLocation(
      (position) => void persistPosition(position, operation, attempt),
      (error) => {
        if (attempt === capture.current && operation.isCurrent()) {
          setLocating(false);
          notify(error, true);
        }
      },
    );
  }

  function confirmPosition(position: GeolocationPosition) {
    if (!rendered.isCurrent()) {
      return;
    }
    setGpsReview(false);
    setLocating(true);
    void persistPosition(position, beginWrite(), ++capture.current);
  }

  async function discardPlace(id: string) {
    const operation = beginWrite();

    const isCurrent = () => rendered.isCurrent() && operation.isCurrent();

    if (!isCurrent()) {
      throw new Error("familyAccessEnded");
    }
    await deleteEntity(operation.workspace, id, isCurrent);
    if (!isCurrent()) {
      return;
    }
    setSelected(null);
    await refresh();
    if (isCurrent()) {
      sync();
    }
  }

  async function remove(p: PlaceRecord, key: string) {
    setDeletePlace(null);
    const operation = beginWrite();
    if (key !== operation.workspace || !rendered.isCurrent() || !operation.isCurrent()) {
      return;
    }
    try {
      await deleteEntity(key, p.id, operation.isCurrent);
      if (!operation.isCurrent()) {
        return;
      }
      setSelected(null);
      onRemoved();
      setEditor((current) => (current?.entity?.id === p.id ? null : current));
      await refresh();
      if (operation.isCurrent()) {
        sync();
      }
    } catch {
      if (operation.isCurrent()) {
        notify("storageFailure", true);
      }
    }
  }

  async function resolve(key: string, id: string, choice: "device" | "cloud" | "both") {
    const operation = beginWrite();
    if (!rendered.isCurrent() || !operation.isCurrent()) {
      return;
    }
    try {
      await resolveConflict(key, id, choice, operation.isCurrent);
      if (!operation.isCurrent()) {
        return;
      }
      await refresh();
      if (operation.isCurrent()) {
        sync();
      }
    } catch {
      if (operation.isCurrent()) {
        notify("storageFailure", true);
      }
    }
  }

  async function removeCategory(setFilter: Dispatch<SetStateAction<string>>) {
    if (!deleteCategory || categoryDeletePending.current) {
      return;
    }
    const { entity, scope: key } = deleteCategory;
    const operation = beginWrite();

    const isCurrent = () =>
      rendered.isCurrent() && key === operation.workspace && operation.isCurrent();

    if (!isCurrent()) {
      return;
    }
    const pending = Symbol();
    categoryDeletePending.current = pending;
    setDeletingCategory(true);
    try {
      await deleteEntity(key, entity.id, isCurrent);
      if (!isCurrent()) {
        return;
      }
      setDeleteCategory(null);
      setFilter((previous) => (previous === entity.id ? "all" : previous));
      await refresh();
      if (isCurrent()) {
        sync();
      }
    } catch (error) {
      if (isCurrent()) {
        notify(libraryErrorMessage(error), true);
      }
    } finally {
      if (categoryDeletePending.current === pending) {
        categoryDeletePending.current = null;
        setDeletingCategory(false);
      }
    }
  }

  return {
    editor,
    setEditor,
    categoryEdit,
    setCategoryEdit,
    deletePlace,
    setDeletePlace,
    deleteCategory,
    setDeleteCategory,
    deletingCategory,
    locating,
    gpsReview,
    setGpsReview,
    save,
    saveHere,
    confirmPosition,
    cancelCapture,
    remove,
    removeCategory,
    discardPlace,
    resolve,
    reset,
  };
}

export type PlaceEditing = ReturnType<typeof usePlaceEditing>;
