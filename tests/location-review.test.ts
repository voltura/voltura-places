import { test, expect, vi } from "vitest";
import { formatAccuracy } from "../src/client/foundation/distance";
test("accuracy units change display only and round the radius upward", () => {
  expect(formatAccuracy(6, "metric")).toBe("±6 m");
  expect(formatAccuracy(6, "imperial")).toBe("±20 ft");
  expect(formatAccuracy(3.048, "imperial")).toBe("±10 ft");
  expect(formatAccuracy(8.2, "metric")).toBe("±9 m");
});
import {
  watchLocation,
  freshPosition,
  accuracyLevel,
  type LocationReviewState,
} from "../src/client/foundation/location-review";
const fix = (accuracy: number, timestamp = Date.now()) =>
  ({ timestamp, coords: { latitude: 0, longitude: 0, accuracy } }) as GeolocationPosition;
function fixture() {
  let success!: PositionCallback, failure!: PositionErrorCallback;
  const geo = {
    watchPosition: vi.fn((s: PositionCallback, e: PositionErrorCallback) => {
      success = s;
      failure = e;
      return 42;
    }),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const states: LocationReviewState[] = [];
  const stop = watchLocation((s) => states.push(s), geo);
  return { geo, states, stop, success, failure };
}
test("GPS review accepts fresh improving estimates, rejects stale/invalid fixes, and cancels cleanly", () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    f.success(fix(80));
    f.success(fix(6));
    expect(f.states.at(-1)?.position?.coords.accuracy).toBe(6);
    f.success(fix(NaN));
    f.success(fix(2, Date.now() - 16000));
    expect(f.states).toHaveLength(2);
    expect([6, 15, 30, 80].map(accuracyLevel)).toEqual([4, 3, 2, 1]);
    expect(freshPosition(fix(6, Date.now() - 16000))).toBe(false);
    f.stop();
    f.success(fix(1));
    vi.advanceTimersByTime(60000);
    expect(f.states).toHaveLength(2);
    expect(f.geo.clearWatch).toHaveBeenCalledTimes(1);
  } finally {
    f.stop();
    vi.useRealTimers();
  }
});
test("GPS review pauses after one minute and rejects late callbacks", () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    f.success(fix(20));
    vi.advanceTimersByTime(60000);
    expect(f.states.at(-1)?.running).toBe(false);
    f.success(fix(3));
    expect(f.states).toHaveLength(2);
    expect(f.geo.clearWatch).toHaveBeenCalledWith(42);
  } finally {
    f.stop();
    vi.useRealTimers();
  }
});
test("GPS review exposes denial and timeout with no fabricated position", () => {
  vi.useFakeTimers();
  const denied = fixture(),
    timeout = fixture();
  try {
    denied.failure({ code: 1 } as GeolocationPositionError);
    expect(denied.states.at(-1)).toEqual({ position: null, running: false, error: "gpsDenied" });
    vi.advanceTimersByTime(60000);
    expect(timeout.states.at(-1)?.error).toBe("gpsTimeout");
  } finally {
    denied.stop();
    timeout.stop();
    vi.useRealTimers();
  }
});
