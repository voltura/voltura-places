import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { PlaceRecord } from "../../shared/model";
import type { RouteGeometry } from "../../shared/routes";
import type { Message } from "../foundation/i18n";
import { loadGeometry } from "../foundation/route-geometry";
import { followLocation, type FollowLocation } from "../foundation/route-following";
import { Sheet } from "../ui/Sheet";

function UnavailableMap({ t, retryMap }: { t: (key: Message) => string; retryMap: () => void }) {
  return (
    <div className="stack" role="alert">
      <p>{t("mapModuleUnavailable")}</p>
      <button className="button outline" onClick={retryMap}>
        {t("retry")}
      </button>
    </div>
  );
}

export function FollowRoute({
  record,
  workspace,
  t,
  categoryColor,
  onClose,
}: {
  record: PlaceRecord;
  workspace: string;
  t: (key: Message) => string;
  categoryColor: (id: string) => string;
  onClose: () => void;
}) {
  const [mapAttempt, setMapAttempt] = useState(0);
  const FollowRouteMap = useMemo(
    () => lazy(() => import("./FollowRouteMap").catch(() => ({ default: UnavailableMap }))),
    [mapAttempt],
  );
  const [geometry, setGeometry] = useState<RouteGeometry | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [location, setLocation] = useState<FollowLocation>({ position: null, status: "finding" });
  const locator = useRef<ReturnType<typeof followLocation> | null>(null);
  useEffect(() => {
    locator.current = followLocation(setLocation);

    return () => locator.current?.stop();
  }, []);
  const geometryId = record.kind === "route" ? record.value.geometryId : "";
  useEffect(() => {
    let active = true;
    setFailed(false);
    setGeometry(null);
    void loadGeometry(workspace, geometryId, () => active)
      .then((value) => {
        if (active) {
          setGeometry(value);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [workspace, geometryId, attempt]);
  const status = {
    finding: "followFinding",
    live: "followLive",
    denied: "followDenied",
    unavailable: "followUnavailable",
    stale: "followStale",
    paused: "followPaused",
  } as const;

  return (
    <Sheet
      title={record.value.name || t("followRoute")}
      closeLabel={t("close")}
      onClose={onClose}
      className="follow-route-view"
    >
      <div className="follow-route-status" role="status">
        <span className="follow-route-key">
          <span className="follow-route-swatch" aria-hidden="true" />
          {t("followSavedRoute")}
        </span>
        {t(status[location.status])}
        {location.position && ` ± ${Math.round(location.position.coords.accuracy)} m`}
        {location.status !== "live" && location.status !== "paused" && (
          <button className="button outline" onClick={() => locator.current?.retry()}>
            {t("retry")}
          </button>
        )}
      </div>
      {failed ? (
        <div className="stack" role="alert">
          <p>{t("followGeometryFailed")}</p>
          <button className="button outline" onClick={() => setAttempt((value) => value + 1)}>
            {t("retry")}
          </button>
        </div>
      ) : geometry ? (
        <Suspense fallback={<p role="status">{t("working")}</p>}>
          <FollowRouteMap
            {...{ record, geometry, location, categoryColor, t }}
            retryMap={() => setMapAttempt((value) => value + 1)}
          />
        </Suspense>
      ) : (
        <p role="status">{t("working")}</p>
      )}
    </Sheet>
  );
}
