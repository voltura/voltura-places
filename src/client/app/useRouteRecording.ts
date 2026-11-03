import { libraryErrorMessage, type Message } from "../foundation/i18n";
import { useEffect, useRef, useState } from "react";
import {
  readRouteDraft,
  startRouteRecording,
  discardRouteDraft,
  type RouteDraft,
  type RecordingState,
} from "../foundation/route-recording";
import {
  prepareRecordedRoute,
  saveRecordedRoute,
  cleanupRecordedRoutes,
} from "../foundation/route-save";
import { readWorkspace } from "../foundation/library";
import type { Entity } from "../../shared/model";
import type { Operation } from "./operations";
import type { WorkspaceController } from "./useWorkspace";

export function useRouteRecording(
  workspace: WorkspaceController,
  interval: 5 | 10 | 30,
  saved: () => void,
) {
  const { scope, beginWrite, canWrite } = workspace;
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locationState, setLocationState] = useState<RecordingState["location"]>("waiting");
  const [accuracy, setAccuracy] = useState<number | undefined>();
  const [error, setError] = useState<Message | "">("");
  const [entity, setEntity] = useState<Extract<Entity, { kind: "route" }> | null>(null);
  const capture = useRef<Awaited<ReturnType<typeof startRouteRecording>> | null>(null);
  const operation = useRef<Operation | null>(null);
  useEffect(() => {
    let current = true;
    setDraft(null);
    setEntity(null);
    setActive(false);
    setBusy(false);
    setError("");
    void cleanupRecordedRoutes(scope, () => current)
      .then(async () => {
        const recovered = await readRouteDraft(scope);
        const w = await readWorkspace(scope);
        if (current && recovered && !w.records.some((r) => r.id === recovered.id)) {
          setDraft(recovered);
          if (canWrite && recovered.recording !== false) {
            void start();
          }
        }
      })
      .catch(() => {
        if (current) {
          setError("storageFailure");
        }
      });

    return () => {
      current = false;
      void capture.current?.stop(true).catch(() => {});
      capture.current = null;
    };
  }, [scope, canWrite]);

  const start = async () => {
    if (busy || active || !canWrite) {
      return;
    }
    const op = beginWrite();
    operation.current = op;
    setBusy(true);
    setError("");
    try {
      const recording = await startRouteRecording(
        scope,
        interval,
        op.isCurrent,
        (state: RecordingState) => {
          if (op.isCurrent()) {
            setLocationState(state.location);
            setAccuracy(state.accuracy);
            setDraft(state.draft);
            setActive(state.active);
            if (state.error) {
              setError(
                state.error === "locationUnavailable" ? "routeLocationUnavailable" : state.error,
              );
            }
          }
        },
        async (draft) => (await readWorkspace(scope)).records.some((r) => r.id === draft.id),
      );
      if (!op.isCurrent()) {
        await recording.stop();

        return;
      }
      capture.current = recording;
    } catch (e) {
      if (op.isCurrent()) {
        setError(libraryErrorMessage(e));
      }
    } finally {
      if (op.isCurrent()) {
        setBusy(false);
      }
    }
  };

  const stop = async () => {
    const op = operation.current;
    if (!op?.isCurrent()) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const current = await capture.current?.stop();
      if (op.isCurrent()) {
        setActive(false);
        if (current) {
          setDraft(current);
          if (current.count >= 2) {
            const route = await prepareRecordedRoute(current, op.isCurrent);
            if (op.isCurrent()) {
              setEntity(route);
            }
          } else {
            setError("routeInsufficient");
          }
        }
      }
    } catch (error) {
      if (op.isCurrent()) {
        setError(libraryErrorMessage(error));
      }
    } finally {
      if (op.isCurrent()) {
        setBusy(false);
      }
    }
  };

  const edit = async () => {
    if (!draft || busy || active) {
      return;
    }
    const op = beginWrite();
    operation.current = op;
    setBusy(true);
    setError("");
    try {
      const route = await prepareRecordedRoute(draft, op.isCurrent);
      if (op.isCurrent()) {
        setEntity(route);
      }
    } catch (error) {
      if (op.isCurrent()) {
        setError(libraryErrorMessage(error));
      }
    } finally {
      if (op.isCurrent()) {
        setBusy(false);
      }
    }
  };

  const save = async (value: Entity) => {
    if (value.kind !== "route" || !operation.current?.isCurrent()) {
      throw new Error("accountChanged");
    }
    await saveRecordedRoute(scope, value, operation.current.isCurrent);
    if (operation.current.isCurrent()) {
      setDraft(null);
      setEntity(null);
      setError("");
      saved();
    }
  };

  const discard = async () => {
    if (!draft || active) {
      return;
    }
    const op = beginWrite();
    setBusy(true);
    try {
      await discardRouteDraft(scope, draft.id);
      if (op.isCurrent()) {
        setDraft(null);
        setEntity(null);
        setError("");
      }
    } catch (error) {
      if (op.isCurrent()) {
        setError(libraryErrorMessage(error));
      }
    } finally {
      if (op.isCurrent()) {
        setBusy(false);
      }
    }
  };

  return {
    locationState,
    accuracy,
    retry: () => capture.current?.retry(),
    draft,
    active,
    busy,
    error,
    entity,
    setEntity,
    start,
    stop,
    edit,
    save,
    discard,
  };
}
