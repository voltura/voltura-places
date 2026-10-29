export type LocationReviewState = {
  position: GeolocationPosition | null;
  running: boolean;
  error: "gpsDenied" | "gpsTimeout" | "gpsUnavailable" | "gpsUnsupported" | null;
};
export const freshPosition = (position: GeolocationPosition | null, now = Date.now()) =>
  !!position && now - position.timestamp <= 15000 && position.timestamp <= now + 5000;
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
  const stop = () => {
    active = false;
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
  deadline = setTimeout(() => finish(state.position ? null : "gpsTimeout"), 60000);
  try {
    id = geo.watchPosition(
      (position) => {
        if (!active) return;
        const c = position.coords;
        if (
          !freshPosition(position) ||
          !Number.isFinite(c.latitude) ||
          Math.abs(c.latitude) > 90 ||
          !Number.isFinite(c.longitude) ||
          Math.abs(c.longitude) > 180 ||
          !Number.isFinite(c.accuracy) ||
          c.accuracy < 0
        )
          return;
        state = { position, running: true, error: null };
        onState(state);
      },
      (error) =>
        finish(error.code === 1 ? "gpsDenied" : error.code === 3 ? "gpsTimeout" : "gpsUnavailable"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    if (!active) {
      geo.clearWatch(id);
      id = undefined;
    }
  } catch {
    finish("gpsUnavailable");
  }
  return stop;
}
