import { Suspense, useEffect, useMemo, useState } from "react";
import { Map } from "lucide-react";
import { draftGeometry, type RouteDraft } from "../foundation/route-recording";
import { geometrySummary, type RouteGeometry } from "../../shared/routes";
import type { PlaceRecord } from "../../shared/model";
import type { Message } from "../foundation/i18n";
import { DeferredPlacesMap } from "./DeferredPlacesMap";

const select = () => {};

const color = () => "green";

const previewGeometryId = "0".repeat(64);

export function RecordingPreview({ draft, t }: { draft: RouteDraft; t: (key: Message) => string }) {
  const { id, workspace, count, startedAt } = draft;
  const [snapshot, setSnapshot] = useState<{ id: string; geometry: RouteGeometry } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    if (count) {
      void draftGeometry({ id })
        .then((geometry) => {
          if (current) {
            setSnapshot({ id, geometry });
            setFailed(false);
          }
        })
        .catch(() => {
          if (current) {
            setFailed(true);
          }
        });
    }

    return () => {
      current = false;
    };
  }, [id, workspace, count]);
  const geometry = snapshot?.id === id ? snapshot.geometry : null;
  const mapData = useMemo(() => {
    if (!geometry?.segments.length) {
      return null;
    }
    const timestamp = new Date(startedAt).toISOString();
    const record: PlaceRecord = {
      id,
      kind: "route",
      revision: 0,
      generation: 0,
      dirty: false,
      deleted: false,
      value: {
        name: "",
        categoryId: "other",
        capturedAt: timestamp,
        updatedAt: timestamp,
        startedAt: timestamp,
        stoppedAt: timestamp,
        duration: 0,
        geometryId: previewGeometryId,
        ...geometrySummary(geometry),
      },
    };

    return { places: [record], geometry: { [previewGeometryId]: geometry } };
  }, [geometry, id, startedAt]);
  const placeholder = (
    <div className="recording-map-placeholder">
      <Map size={24} aria-hidden="true" />
      <p>{t(failed ? "mapModuleUnavailable" : count ? "working" : "recordingWaiting")}</p>
    </div>
  );

  return (
    <div className="recording-preview">
      <p className="small route-point-count">
        {count === 0
          ? t("routeNoPoints")
          : count === 1
            ? t("routeStartRecorded")
            : `${count} ${t("routePointsRecorded")}`}
      </p>
      <Suspense fallback={placeholder}>
        {mapData ? (
          <DeferredPlacesMap
            recording
            workspace={workspace}
            places={mapData.places}
            geometry={mapData.geometry}
            selected={id}
            fitKey={id}
            onSelect={select}
            categoryColor={color}
            t={t}
            fullscreen={fullscreen}
            onFullscreenChange={setFullscreen}
          />
        ) : (
          placeholder
        )}
      </Suspense>
    </div>
  );
}
