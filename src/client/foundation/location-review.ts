export type LocationReviewState = {
  position: GeolocationPosition | null;
  running: boolean;
  error: "gpsDenied" | "gpsTimeout" | "gpsUnavailable" | "gpsUnsupported" | null;
};
export const freshPosition = (position: GeolocationPosition | null, now = Date.now()) =>
  !!position && now - position.timestamp <= 15000 && position.timestamp <= now + 5000;
export const validPosition = (position: GeolocationPosition) => {
  const c = position.coords;
  return (
    freshPosition(position) &&
    Number.isFinite(c.latitude) &&
    Math.abs(c.latitude) <= 90 &&
    Number.isFinite(c.longitude) &&
    Math.abs(c.longitude) <= 180 &&
    Number.isFinite(c.accuracy) &&
    c.accuracy >= 0 &&
    c.accuracy <= 10000000
  );
};
export const accuracyLevel = (metres: number) =>
  metres <= 10 ? 4 : metres <= 20 ? 3 : metres <= 50 ? 2 : 1;

export function watchLocation(
  onState: (state: LocationReviewState) => void,
  geo = navigator.geolocation,
) {
  let active = true,
    id: number | undefined;
  let state: LocationReviewState = { position: null, running: true, error: null };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let recovery: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined, permission: PermissionStatus | undefined;
  let generation = 0,
    resumes = 0,
    transientRetries = 0;
  const started = Date.now();
  const foreground = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (Date.now() - started > 500) resume();
  };
  const permissionChanged = () => {
    if (permission?.state === "granted") resume();
  };
  const stop = () => {
    active = false;
    generation++;
    if (typeof window !== "undefined") window.removeEventListener("focus", foreground);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", foreground);
    permission?.removeEventListener("change", permissionChanged);
    if (retry) clearTimeout(retry);
    if (recovery) clearInterval(recovery);
    if (id !== undefined) {
      geo.clearWatch(id);
      id = undefined;
    }
    if (deadline) {
      clearTimeout(deadline);
      deadline = undefined;
    }
  };
  const finish = (error: LocationReviewState["error"]) => {
    if (!active) return;
    stop();
    state = { ...state, running: false, error };
    onState(state);
  };
  if (!geo) {
    finish("gpsUnsupported");
    return stop;
  }
  const resume = () => {
    if (!active || resumes >= 2 || freshPosition(state.position)) return;
    resumes++;
    start();
  };
  const start = () => {
    if (!active) return;
    const current = ++generation;
    if (id !== undefined) {
      geo.clearWatch(id);
      id = undefined;
    }
    if (retry) {
      clearTimeout(retry);
      retry = undefined;
    }
    try {
      const watch = geo.watchPosition(
        (position) => {
          if (!active || current !== generation || !validPosition(position)) return;
          state = { position, running: true, error: null };
          onState(state);
        },
        (error) => {
          if (!active || current !== generation) return;
          if (error.code === 2 && transientRetries++ === 0) {
            retry = setTimeout(() => {
              retry = undefined;
              start();
            }, 250);
            return;
          }
          finish(
            error.code === 1 ? "gpsDenied" : error.code === 3 ? "gpsTimeout" : "gpsUnavailable",
          );
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
      if (active && current === generation) id = watch;
      else geo.clearWatch(watch);
    } catch {
      finish("gpsUnavailable");
    }
  };
  deadline = setTimeout(() => finish(state.position ? null : "gpsTimeout"), 60000);
  if (typeof window !== "undefined") window.addEventListener("focus", foreground);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", foreground);
  try {
    if (typeof navigator !== "undefined" && navigator.permissions?.query)
      void navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
          if (!active) return;
          permission = status;
          status.addEventListener("change", permissionChanged);
          if (status.state === "granted" && Date.now() - started > 500) resume();
        })
        .catch(() => {});
  } catch {
    /* Some older browsers throw for an unsupported permission name. */
  }
  recovery = setInterval(() => {
    if (
      permission?.state === "granted" &&
      (typeof document === "undefined" || document.visibilityState === "visible")
    )
      resume();
  }, 8000);
  start();
  return stop;
}
export function captureLocation(
  onPosition: (p: GeolocationPosition) => void,
  onError: (error: NonNullable<LocationReviewState["error"]>) => void,
  geo = navigator.geolocation,
) {
  let active = true,
    stopWatch = () => {};
  const stop = () => {
    active = false;
    stopWatch();
  };
  if (geo && typeof geo.watchPosition === "function") {
    stopWatch = watchLocation((state) => {
      if (!active) return;
      if (state.position) {
        stop();
        onPosition(state.position);
      } else if (state.error) {
        stop();
        onError(state.error);
      }
    }, geo);
    if (!active) stopWatch();
  } else {
    // Compatibility with browsers exposing only one-shot acquisition.
    try {
      if (!geo) {
        active = false;
        onError("gpsUnsupported");
        return stop;
      }
      geo.getCurrentPosition(
        (p) => {
          if (!active) return;
          stop();
          if (validPosition(p)) onPosition(p);
          else onError("gpsUnavailable");
        },
        (e) => {
          if (active) {
            stop();
            onError(e.code === 1 ? "gpsDenied" : e.code === 3 ? "gpsTimeout" : "gpsUnavailable");
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
    } catch {
      if (active) {
        stop();
        onError("gpsUnavailable");
      }
    }
  }
  return stop;
}
