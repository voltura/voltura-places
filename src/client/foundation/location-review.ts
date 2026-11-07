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
    !!c &&
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

// Keep coordinates and their reported accuracy together; never replace the
// selected fix with a worse (or equally accurate) reading.
export function refineLocation(
  accuracy: number,
  onImprovement: (position: GeolocationPosition) => void,
  geo = navigator.geolocation,
) {
  if (accuracy === 0) {
    return () => {};
  }
  let best = accuracy;
  let stop: (() => void) | undefined;
  stop = watchLocation((state) => {
    if (state.position && state.position.coords.accuracy < best) {
      best = state.position.coords.accuracy;
      onImprovement(state.position);
      if (best === 0) {
        stop?.();
      }
    }
  }, geo);
  // A synchronous provider may have delivered the final improvement at setup.
  if (best === 0) {
    stop();
  }

  return stop;
}

export function watchLocation(
  onState: (state: LocationReviewState) => void,
  geo = navigator.geolocation,
) {
  let active = true;
  let id: number | undefined;
  let state: LocationReviewState = { position: null, running: true, error: null };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let recovery: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let permission: PermissionStatus | undefined;
  let generation = 0;
  let resumes = 0;
  let lastResume = -Infinity;
  let transientRetries = 0;
  let denialRetried = false;
  let awaitingPermission = false;
  let lastAcquisitionError: "gpsUnavailable" | "gpsTimeout" | null = null;
  const retryDelays = [1000, 3000, 6000];
  const started = Date.now();

  const foreground = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }
    if (Date.now() - started > 500) {
      resume();
    }
  };

  const permissionChanged = () => {
    if (permission?.state === "denied" && state.position) {
      handleDenial();
    } else if (permission?.state === "granted") {
      resume();
    }
  };

  const clearWatch = (watch: number) => {
    try {
      geo.clearWatch(watch);
    } catch {
      // A revoked or detached provider may no longer accept the watch handle.
    }
  };

  const stop = () => {
    active = false;
    generation++;
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", foreground);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", foreground);
    }
    permission?.removeEventListener?.("change", permissionChanged);
    if (retry) {
      clearTimeout(retry);
    }
    if (recovery) {
      clearInterval(recovery);
    }
    if (id !== undefined) {
      clearWatch(id);
      id = undefined;
    }
    if (deadline) {
      clearTimeout(deadline);
      deadline = undefined;
    }
  };

  const finish = (error: LocationReviewState["error"]) => {
    if (!active) {
      return;
    }
    stop();
    state = { position: error ? null : state.position, running: false, error };
    onState(state);
  };

  const handleDenial = () => {
    if (!active) {
      return;
    }
    // The permission status can lag a system grant. Retry the initial native
    // refusal once and use the new acquisition's own result.
    if (!state.position) {
      if (awaitingPermission) {
        return;
      }
      if (!denialRetried) {
        denialRetried = true;
        awaitingPermission = true;
        if (retry) {
          clearTimeout(retry);
        }
        retry = setTimeout(() => {
          retry = undefined;
          start();
        }, 1000);

        return;
      }
    }
    finish("gpsDenied");
  };

  const finishDeadline = () =>
    finish(
      freshPosition(state.position)
        ? null
        : awaitingPermission
          ? "gpsDenied"
          : (lastAcquisitionError ?? "gpsTimeout"),
    );

  const expired = () => {
    if (Date.now() - started < 60000) {
      return false;
    }
    finishDeadline();

    return true;
  };

  if (!geo) {
    finish("gpsUnsupported");

    return stop;
  }

  const resume = () => {
    const now = Date.now();
    if (!active || resumes >= 2 || now - lastResume < 500 || freshPosition(state.position)) {
      return;
    }
    // A focus/visibility event can come from the browser's still-open permission
    // prompt. Keep that request alive rather than opening another acquisition.
    if (permission && permission.state !== "granted") {
      return;
    }
    resumes++;
    lastResume = now;
    start();
  };

  const start = () => {
    if (!active || expired()) {
      return;
    }
    const current = ++generation;
    awaitingPermission = false;
    if (id !== undefined) {
      clearWatch(id);
      id = undefined;
    }
    if (retry) {
      clearTimeout(retry);
      retry = undefined;
    }
    try {
      const acquire =
        typeof geo.watchPosition === "function"
          ? geo.watchPosition.bind(geo)
          : geo.getCurrentPosition.bind(geo);
      const watch = acquire(
        (position) => {
          if (!active || current !== generation || expired() || !validPosition(position)) {
            return;
          }
          if (state.position && position.timestamp < state.position.timestamp) {
            return;
          }
          if (retry) {
            clearTimeout(retry);
            retry = undefined;
          }
          lastAcquisitionError = null;
          awaitingPermission = false;
          state = { position, running: true, error: null };
          onState(state);
        },
        (error) => {
          if (!active || current !== generation || expired()) {
            return;
          }
          if (error.code === 1) {
            handleDenial();

            return;
          }
          lastAcquisitionError = error.code === 3 ? "gpsTimeout" : "gpsUnavailable";
          // A watch can recover after acquisition errors. Give the phone time to
          // start its location provider instead of treating them as a refusal.
          if (!retry && transientRetries < retryDelays.length) {
            const delay = retryDelays[transientRetries++];
            retry = setTimeout(() => {
              retry = undefined;
              if (!permission || permission.state === "granted") {
                start();
              }
            }, delay);
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
      if (typeof watch === "number") {
        if (active && current === generation) {
          id = watch;
        } else {
          clearWatch(watch);
        }
      }
    } catch {
      finish("gpsUnavailable");
    }
  };

  deadline = setTimeout(finishDeadline, 60000);
  if (typeof window !== "undefined") {
    window.addEventListener("focus", foreground);
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", foreground);
  }
  try {
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
          if (!active) {
            return;
          }
          permission = status;
          status.addEventListener?.("change", permissionChanged);
          if (status.state !== "denied") {
            recovery = setInterval(() => {
              if (status.state === "denied") {
                permissionChanged();
              } else if (
                status.state === "granted" &&
                (typeof document === "undefined" || document.visibilityState === "visible")
              ) {
                resume();
              }
              if (resumes >= 2 && typeof status.addEventListener === "function") {
                clearInterval(recovery);
              }
            }, 8000);
          }
          if (status.state === "granted" && Date.now() - started > 500) {
            permissionChanged();
          }
        })
        .catch(() => {});
    }
  } catch {
    /* Some older browsers throw for an unsupported permission name. */
  }
  start();

  return stop;
}

export function captureLocation(
  onPosition: (p: GeolocationPosition) => void,
  onError: (error: NonNullable<LocationReviewState["error"]>) => void,
  geo = navigator.geolocation,
) {
  let active = true;

  let stopWatch = () => {};

  let deadline: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    active = false;
    clearTimeout(deadline);
    stopWatch();
  };

  if (geo && typeof geo.watchPosition === "function") {
    stopWatch = watchLocation((state) => {
      if (!active) {
        return;
      }
      if (state.position) {
        stop();
        onPosition(state.position);
      } else if (state.error) {
        stop();
        onError(state.error);
      }
    }, geo);
    if (!active) {
      stopWatch();
    }
  } else {
    // Compatibility with browsers exposing only one-shot acquisition.
    try {
      if (!geo) {
        active = false;
        onError("gpsUnsupported");

        return stop;
      }
      // Native acquisition timeouts can exclude time waiting for permission.
      const expires = Date.now() + 60000;
      deadline = setTimeout(() => {
        stop();
        onError("gpsTimeout");
      }, 60000);
      geo.getCurrentPosition(
        (p) => {
          if (!active) {
            return;
          }
          stop();
          if (Date.now() >= expires) {
            onError("gpsTimeout");
          } else if (validPosition(p)) {
            onPosition(p);
          } else {
            onError("gpsUnavailable");
          }
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
