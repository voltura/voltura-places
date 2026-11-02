import { useEffect, useState } from "react";
import { RotateCw, LocateFixed } from "lucide-react";
import { Sheet } from "../ui/Sheet";
import {
  accuracyLevel,
  freshPosition,
  watchLocation,
  type LocationReviewState,
} from "../foundation/location-review";
import type { Message } from "../foundation/i18n";
import { formatAccuracy, type DistanceUnits } from "../foundation/distance";

export function LocationReview({
  t,
  onConfirm,
  onClose,
  units,
}: {
  t: (key: Message) => string;
  onConfirm: (position: GeolocationPosition) => void;
  onClose: () => void;
  units: DistanceUnits;
}) {
  const [state, setState] = useState<LocationReviewState>({
    position: null,
    running: true,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);
  const [, setClock] = useState(0);
  useEffect(() => {
    setState({ position: null, running: true, error: null });

    return watchLocation(setState);
  }, [attempt]);
  useEffect(() => {
    if (!state.position) {
      return;
    }
    const expiresIn = state.position.timestamp + 15001 - Date.now();
    const timer = setTimeout(() => setClock((clock) => clock + 1), Math.max(0, expiresIn));

    return () => clearTimeout(timer);
  }, [state.position]);
  const fresh = freshPosition(state.position);
  const accuracy = state.position ? state.position.coords.accuracy : null;
  const level = accuracy === null || !fresh ? 0 : accuracyLevel(accuracy);
  const quality = t(
    level === 4 ? "gpsExcellent" : level === 3 ? "gpsGood" : level === 2 ? "gpsFair" : "gpsWeak",
  );

  return (
    <Sheet title={t("reviewLocation")} onClose={onClose} closeLabel={t("close")}>
      <div className="stack gps-review">
        <div className="gps-reading" role="status" aria-live="polite" aria-atomic="true">
          {fresh && accuracy !== null ? (
            <>
              <strong className="gps-number">{formatAccuracy(accuracy, units)}</strong>
              <span className="muted">{t("gpsEstimatedAccuracy")}</span>
            </>
          ) : state.running ? (
            <div className="gps-waiting">
              <span className="gps-spinner" aria-hidden="true" />
              <span>{t("gpsWaiting")}</span>
            </div>
          ) : null}
          {!state.running && !state.error && <span>{t("gpsFinished")}</span>}
        </div>
        {fresh && accuracy !== null && (
          <div className="gps-quality">
            <div
              className={`gps-bars gps-level-${level}`}
              role="meter"
              aria-label={t("accuracy")}
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={level}
              aria-valuetext={`${quality} · ${formatAccuracy(accuracy, units)}`}
            >
              {[1, 2, 3, 4].map((n) => (
                <span key={n} className={n <= level ? "active" : ""} />
              ))}
            </div>
            <span className="small">{quality}</span>
          </div>
        )}
        {state.running && <p className="muted small">{t("gpsReviewIntro")}</p>}
        {state.error && (
          <p role="alert" className="error">
            {t(state.error)}
          </p>
        )}
        {fresh && <p className="muted small">{t("gpsEstimateHint")}</p>}
        <div className="gps-actions">
          {(state.running || fresh) && (
            <button
              className="button primary"
              disabled={!fresh}
              onClick={() => {
                if (freshPosition(state.position)) {
                  onConfirm(state.position!);
                }
              }}
            >
              <LocateFixed size={20} aria-hidden="true" />
              {t("confirmLocation")}
            </button>
          )}
          {!state.running && (
            <button
              className={`button ${fresh ? "outline" : "primary"}`}
              onClick={() => setAttempt((n) => n + 1)}
            >
              <RotateCw size={20} aria-hidden="true" />
              {t("gpsRetry")}
            </button>
          )}
          <button className="button outline subdued" onClick={onClose}>
            {t("cancel")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
