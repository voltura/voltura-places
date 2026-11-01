import { useCallback, useEffect, useRef, useState } from "react";
import { validPosition } from "../foundation/location-review";

// Session-only location: never infer the user's position from a saved place.
export function useCurrentPosition() {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rememberPosition = useCallback((next: GeolocationPosition | null) => {
    clearTimeout(expiry.current);
    if (!next || !validPosition(next)) {
      setPosition(null);
      return;
    }
    setPosition(next);
    expiry.current = setTimeout(() => setPosition(null), 60000 - (Date.now() - next.timestamp));
  }, []);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let permission: PermissionStatus | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      generation++;
      clearInterval(poll);
      poll = undefined;
    };
    const update = () => {
      stop();
      if (document.hidden || permission?.state !== "granted") {
        rememberPosition(null);
        return;
      }
      const request = generation;
      const locate = () =>
        navigator.geolocation.getCurrentPosition(
          (next) => {
            if (active && request === generation) rememberPosition(next);
          },
          () => {
            if (active && request === generation) rememberPosition(null);
          },
          { maximumAge: 0, timeout: 15000, enableHighAccuracy: false },
        );
      locate();
      poll = setInterval(locate, 30000);
    };
    // Save position can supply a fix even without a usable Permissions API.
    document.addEventListener("visibilitychange", update);
    // Querying permission never opens the browser's location prompt.
    if (typeof navigator.geolocation?.getCurrentPosition === "function" && navigator.permissions) {
      void navigator.permissions
        .query({ name: "geolocation" })
        .then((result) => {
          if (!active) return;
          permission = result;
          permission.addEventListener("change", update);
          update();
        })
        .catch(() => {});
    }
    return () => {
      active = false;
      stop();
      clearTimeout(expiry.current);
      permission?.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [rememberPosition]);
  return { position, rememberPosition };
}
