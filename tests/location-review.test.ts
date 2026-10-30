import { test, expect, vi } from "vitest";
import { formatAccuracy } from "../src/client/foundation/distance";
test("accuracy units change display only and round the radius upward", () => {
  expect(formatAccuracy(6, "metric")).toBe("±6 m");
  expect(formatAccuracy(6, "imperial")).toBe("±20 ft");
  expect(formatAccuracy(3.048, "imperial")).toBe("±10 ft");
  expect(formatAccuracy(8.2, "metric")).toBe("±9 m");
});

test("imperial conversion does not add a foot to exact whole-foot accuracy values", () => {
  for (let feet = 1; feet <= 1000; feet++)
    expect(formatAccuracy(feet * 0.3048, "imperial")).toBe(`±${feet} ft`);
  expect(formatAccuracy(0, "imperial")).toBe("±0 ft");
  expect(formatAccuracy(1e-20, "imperial")).toBe("±1 ft");
  expect(formatAccuracy(53.01 * 0.3048, "imperial")).toBe("±54 ft");
});
import {
  watchLocation,
  freshPosition,
  accuracyLevel,
  captureLocation,
  refineLocation,
  type LocationReviewState,
} from "../src/client/foundation/location-review";

test("first permission grant restarts a stalled watch and saves once without reloading", async () => {
  vi.useFakeTimers();
  const status = Object.assign(new EventTarget(), { state: "prompt" });
  const win = new EventTarget(),
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { permissions: { query: async () => status } });
  const callbacks: PositionCallback[] = [],
    clearWatch = vi.fn();
  const geo = {
    watchPosition: vi.fn((success: PositionCallback) => {
      callbacks.push(success);
      return callbacks.length;
    }),
    clearWatch,
  } as unknown as Geolocation;
  const saved = vi.fn(),
    failed = vi.fn();
  const stop = captureLocation(saved, failed, geo);
  try {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    status.state = "granted";
    status.dispatchEvent(new Event("change"));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    callbacks[0](fix(5)); // A late pre-grant callback must not duplicate a save.
    expect(saved).not.toHaveBeenCalled();
    callbacks[1](fix(5));
    callbacks[1](fix(4));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(60000);
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(clearWatch).toHaveBeenCalledWith(1);
    expect(clearWatch).toHaveBeenCalledWith(2);
  } finally {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

test("returning from a system prompt resumes GPS and unavailable-first-fix retries stay bounded", async () => {
  vi.useFakeTimers();
  const win = new EventTarget(),
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", {});
  const callbacks: PositionCallback[] = [],
    errors: PositionErrorCallback[] = [];
  const geo = {
    watchPosition: vi.fn((s: PositionCallback, e: PositionErrorCallback) => {
      callbacks.push(s);
      errors.push(e);
      return callbacks.length;
    }),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const saved = vi.fn(),
    failed = vi.fn(),
    stop = captureLocation(saved, failed, geo);
  try {
    await vi.advanceTimersByTimeAsync(1000);
    win.dispatchEvent(new Event("focus"));
    expect(callbacks).toHaveLength(2);
    errors[1]({ code: 2 } as GeolocationPositionError);
    await vi.advanceTimersByTimeAsync(1000);
    expect(callbacks).toHaveLength(3);
    callbacks[2](fix(8, Date.now() - 20000));
    expect(saved).not.toHaveBeenCalled();
    callbacks[2](fix(8));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
const fix = (accuracy: number, timestamp = Date.now()) =>
  ({ timestamp, coords: { latitude: 0, longitude: 0, accuracy } }) as GeolocationPosition;

test("pending permission keeps one acquisition through focus and transient retry events", async () => {
  vi.useFakeTimers();
  const permission = Object.assign(new EventTarget(), { state: "prompt" });
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { permissions: { query: async () => permission } });
  const successes: PositionCallback[] = [];
  const failures: PositionErrorCallback[] = [];
  const geo = {
    watchPosition: vi.fn((success: PositionCallback, error: PositionErrorCallback) => {
      successes.push(success);
      failures.push(error);
      return successes.length;
    }),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const saved = vi.fn();
  const failed = vi.fn();
  const stop = captureLocation(saved, failed, geo);
  try {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 4; i++) {
      win.dispatchEvent(new Event("focus"));
      doc.dispatchEvent(new Event("visibilitychange"));
    }
    failures[0]({ code: 2 } as GeolocationPositionError);
    await vi.advanceTimersByTimeAsync(16000);
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(geo.clearWatch).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    permission.state = "granted";
    permission.dispatchEvent(new Event("change"));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    successes[1](fix(6));
    expect(saved).toHaveBeenCalledTimes(1);
  } finally {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

for (const ending of ["cancel", "deadline", "denied"] as const) {
  test(`refinement retains the best valid fix and ignores callbacks after ${ending}`, () => {
    vi.useFakeTimers();
    let success!: PositionCallback, failure!: PositionErrorCallback;
    const geo = {
      watchPosition: (s: PositionCallback, e: PositionErrorCallback) => {
        success = s;
        failure = e;
        return 7;
      },
      clearWatch: vi.fn(),
    } as unknown as Geolocation;
    const improved = vi.fn();
    const stop = refineLocation(500, improved, geo);
    try {
      success(fix(600));
      success(fix(500));
      expect(improved).not.toHaveBeenCalled();
      success(fix(25));
      success(fix(80));
      success(fix(25));
      success(fix(1, Date.now() - 16000));
      success(fix(NaN));
      success({ ...fix(1), coords: { ...fix(1).coords, latitude: NaN } });
      expect(improved).toHaveBeenCalledTimes(1);
      success(fix(6));
      expect(improved).toHaveBeenLastCalledWith(fix(6));
      if (ending === "cancel") stop();
      if (ending === "deadline") vi.advanceTimersByTime(60000);
      if (ending === "denied") failure({ code: 1 } as GeolocationPositionError);
      success(fix(1));
      expect(improved).toHaveBeenCalledTimes(2);
      expect(geo.clearWatch).toHaveBeenCalledWith(7);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
}

test("quick save waits through repeated acquisition errors after approval and saves a later fix", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", {});
  const successes: PositionCallback[] = [],
    failures: PositionErrorCallback[] = [];
  const geo = {
    watchPosition: vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
      successes.push(success);
      failures.push(failure);
      return successes.length;
    }),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const saved = vi.fn(),
    failed = vi.fn(),
    stop = captureLocation(saved, failed, geo);
  try {
    for (const [attempt, delay] of [1000, 3000, 6000].entries()) {
      failures[attempt]({ code: attempt === 2 ? 3 : 2 } as GeolocationPositionError);
      await vi.advanceTimersByTimeAsync(delay);
      expect(failed).not.toHaveBeenCalled();
    }
    failures[3]({ code: 2 } as GeolocationPositionError);
    await vi.advanceTimersByTimeAsync(10000);
    expect(geo.watchPosition).toHaveBeenCalledTimes(4);
    expect(failed).not.toHaveBeenCalled();
    successes[0](fix(1)); // Superseded attempts cannot save.
    expect(saved).not.toHaveBeenCalled();
    successes[3](fix(7));
    successes[3](fix(6));
    expect(saved).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(failed).not.toHaveBeenCalled();
  } finally {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

test("persistent unavailable results finish at the deadline and denial stays immediate", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", {});
  let failure!: PositionErrorCallback;
  const geo = {
    watchPosition: (_s: PositionCallback, e: PositionErrorCallback) => {
      failure = e;
      return 1;
    },
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const failed = vi.fn(),
    stop = captureLocation(vi.fn(), failed, geo);
  try {
    failure({ code: 2 } as GeolocationPositionError);
    await vi.advanceTimersByTimeAsync(59999);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenCalledWith("gpsUnavailable");
    const denied = vi.fn(),
      stopDenied = captureLocation(vi.fn(), denied, geo);
    failure({ code: 1 } as GeolocationPositionError);
    expect(denied).toHaveBeenCalledWith("gpsDenied");
    stopDenied();
  } finally {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

test("a granted but silent acquisition retries automatically and stops on cancel", async () => {
  vi.useFakeTimers();
  const status = Object.assign(new EventTarget(), { state: "granted" });
  vi.stubGlobal("navigator", { permissions: { query: async () => status } });
  const geo = { watchPosition: vi.fn(() => 9), clearWatch: vi.fn() } as unknown as Geolocation;
  const stopped = captureLocation(vi.fn(), vi.fn(), geo);
  try {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8000);
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    stopped();
    await vi.advanceTimersByTimeAsync(60000);
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  } finally {
    stopped();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
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
