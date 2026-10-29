import { useEffect, useState } from "react";
import { LocateFixed } from "lucide-react";
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
  const [attempt, setAttempt] = useState(0),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    setState({ position: null, running: true, error: null });
    const stop = watchLocation(setState);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [attempt]);
  const fresh = freshPosition(state.position, now);
  const accuracy = state.position ? state.position.coords.accuracy : null;
  const level = accuracy === null || !fresh ? 0 : accuracyLevel(accuracy);
  return (
    <Sheet title={t("reviewLocation")} onClose={onClose} closeLabel={t("close")}>
      <div className="stack gps-review">
        <LocateFixed size={36} aria-hidden="true" />
        <p className="muted">{t("gpsReviewIntro")}</p>
        <div className="gps-reading" role="status" aria-live="polite" aria-atomic="true">
          <strong className="gps-number">
            {accuracy === null ? "—" : formatAccuracy(accuracy, units)}
          </strong>
          <span>
            {t(
              !fresh
                ? "gpsWaiting"
                : level === 4
                  ? "gpsExcellent"
                  : level === 3
                    ? "gpsGood"
                    : level === 2
                      ? "gpsFair"
                      : "gpsWeak",
            )}
          </span>
        </div>
        <div
          className={`gps-bars gps-level-${level}`}
          role="meter"
          aria-label={t("accuracy")}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={level}
          aria-valuetext={
            fresh && accuracy !== null ? formatAccuracy(accuracy, units) : t("gpsWaiting")
          }
        >
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={n <= level ? "active" : ""} />
          ))}
        </div>
        <p className="muted small">
          {t(state.running ? "gpsRefining" : state.error ? "gpsStopped" : "gpsPaused")}
        </p>
        {state.position && (
          <p className="muted small">
            {t("gpsFixAge")}: {Math.max(0, Math.floor((now - state.position.timestamp) / 1000))} s
          </p>
        )}
        {state.error && (
          <p role="alert" className="error">
            {t(state.error)}
          </p>
        )}
        <p className="muted small">{t("gpsEstimateHint")}</p>
        <button
          className="button primary"
          disabled={!fresh}
          onClick={() => {
            if (freshPosition(state.position)) onConfirm(state.position!);
          }}
        >
          {t("confirmLocation")}
        </button>
        {!state.running && (
          <button className="button outline" onClick={() => setAttempt((n) => n + 1)}>
            {t("gpsRetry")}
          </button>
        )}
        <button className="button quiet" onClick={onClose}>
          {t("cancel")}
        </button>
      </div>
    </Sheet>
  );
}
