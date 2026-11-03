import { validPosition } from "./location-review";

export type FollowLocation = {
  position: GeolocationPosition | null;
  status: "finding" | "live" | "denied" | "unavailable" | "stale" | "paused";
};

// Following is session-only: no location is stored or sent to the server.
export function followLocation(publish: (state: FollowLocation) => void) {
  let disposed = false;
  let generation = 0;
  let watch: number | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let wake: WakeLockSentinel | undefined;

  const stop = () => {
    generation++;
    clearTimeout(expiry);
    if (watch !== undefined) {
      try {
        navigator.geolocation.clearWatch(watch);
      } catch {}
      watch = undefined;
    }
    void wake?.release().catch(() => {});
    wake = undefined;
  };

  const start = () => {
    stop();
    if (disposed) {
      return;
    }
    if (document.hidden) {
      publish({ position: null, status: "paused" });

      return;
    }
    const version = generation;

    const current = () => !disposed && version === generation && !document.hidden;

    publish({ position: null, status: "finding" });
    try {
      void navigator.wakeLock
        ?.request("screen")
        .then((lock) => {
          if (current()) {
            wake = lock;
          } else {
            void lock.release().catch(() => {});
          }
        })
        .catch(() => {});
    } catch {}

    const stale = () => {
      if (current()) {
        publish({ position: null, status: "stale" });
      }
    };

    expiry = setTimeout(stale, 15000);
    try {
      const id = navigator.geolocation.watchPosition(
        (position) => {
          if (!current() || !validPosition(position)) {
            return;
          }
          clearTimeout(expiry);
          publish({ position, status: "live" });
          expiry = setTimeout(stale, Math.max(0, 15000 - (Date.now() - position.timestamp)));
        },
        (error) => {
          if (current()) {
            clearTimeout(expiry);
            publish({ position: null, status: error.code === 1 ? "denied" : "unavailable" });
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
      if (current()) {
        watch = id;
      } else {
        navigator.geolocation.clearWatch(id);
      }
    } catch {
      clearTimeout(expiry);
      publish({ position: null, status: "unavailable" });
    }
  };

  document.addEventListener("visibilitychange", start);
  start();

  return {
    retry: start,
    stop: () => {
      disposed = true;
      document.removeEventListener("visibilitychange", start);
      stop();
    },
  };
}
