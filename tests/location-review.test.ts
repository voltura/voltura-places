import { test, expect, vi } from "vitest";
import { formatAccuracy } from "../src/client/foundation/distance";

test("accuracy units change display only and round the radius upward", () => {
  expect(formatAccuracy(6, "metric")).toBe("±6 m");
  expect(formatAccuracy(6, "imperial")).toBe("±20 ft");
  expect(formatAccuracy(3.048, "imperial")).toBe("±10 ft");
  expect(formatAccuracy(8.2, "metric")).toBe("±9 m");
});

test("imperial conversion does not add a foot to exact whole-foot accuracy values", () => {
  for (let feet = 1; feet <= 1000; feet++) {
    expect(formatAccuracy(feet * 0.3048, "imperial")).toBe(`±${feet} ft`);
  }
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
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { permissions: { query: async () => status } });
  const callbacks: PositionCallback[] = [];
  const clearWatch = vi.fn();
  const geo = {
    watchPosition: vi.fn((success: PositionCallback) => {
      callbacks.push(success);

      return callbacks.length;
    }),
    clearWatch,
  } as unknown as Geolocation;
  const saved = vi.fn();
  const failed = vi.fn();
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
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", {});
  const callbacks: PositionCallback[] = [];
  const errors: PositionErrorCallback[] = [];
  const geo = {
    watchPosition: vi.fn((s: PositionCallback, e: PositionErrorCallback) => {
      callbacks.push(s);
      errors.push(e);

      return callbacks.length;
    }),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const saved = vi.fn();
  const failed = vi.fn();
  const stop = captureLocation(saved, failed, geo);
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
    let success!: PositionCallback;
    let failure!: PositionErrorCallback;
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
      if (ending === "cancel") {
        stop();
      }
      if (ending === "deadline") {
        vi.advanceTimersByTime(60000);
      }
      if (ending === "denied") {
        failure({ code: 1 } as GeolocationPositionError);
      }
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
  const successes: PositionCallback[] = [];
  const failures: PositionErrorCallback[] = [];
  const geo = {
    watchPosition: vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
      successes.push(success);
      failures.push(failure);

      return successes.length;
    }),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const saved = vi.fn();
  const failed = vi.fn();
  const stop = captureLocation(saved, failed, geo);
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

test("persistent unavailable results finish at the deadline and confirmed denial does not retry", async () => {
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
  const failed = vi.fn();
  const stop = captureLocation(vi.fn(), failed, geo);
  try {
    failure({ code: 2 } as GeolocationPositionError);
    await vi.advanceTimersByTimeAsync(59999);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failed).toHaveBeenCalledWith("gpsUnavailable");
    vi.stubGlobal("navigator", { permissions: { query: async () => ({ state: "denied" }) } });
    const denied = vi.fn();
    const stopDenied = captureLocation(vi.fn(), denied, geo);
    await Promise.resolve();
    failure({ code: 1 } as GeolocationPositionError);
    await vi.advanceTimersByTimeAsync(1000);
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

for (const support of ["prompt", "granted", "missing", "rejected", "denied"] as const) {
  test(`initial denial recovers automatically with ${support} permission support`, async () => {
    vi.useFakeTimers();
    const permission = Object.assign(new EventTarget(), { state: support });
    vi.stubGlobal("navigator", {
      permissions:
        support === "missing"
          ? undefined
          : {
              query: () =>
                support === "rejected"
                  ? Promise.reject(new Error("Unsupported"))
                  : Promise.resolve(permission),
            },
    });
    const successes: PositionCallback[] = [];
    const failures: PositionErrorCallback[] = [];
    const geo = {
      watchPosition: vi.fn((success: PositionCallback, failure: PositionErrorCallback) => {
        successes.push(success);
        failures.push(failure);

        return successes.length;
      }),
      clearWatch: vi.fn(),
    } as unknown as Geolocation;
    const states: LocationReviewState[] = [];
    const stop = watchLocation((state) => states.push(state), geo);
    try {
      // Include a native error arriving before the Permissions query resolves.
      failures[0]({ code: 1 } as GeolocationPositionError);
      if (support === "denied") {
        await vi.advanceTimersByTimeAsync(100);
        permission.state = "granted";
        permission.dispatchEvent(new Event("change"));
      }
      await vi.advanceTimersByTimeAsync(1000);
      if (support === "prompt") {
        expect(geo.watchPosition).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(2000);
        permission.state = "granted";
        permission.dispatchEvent(new Event("change"));
      }
      expect(geo.watchPosition).toHaveBeenCalledTimes(2);
      expect(states).toEqual([]);
      failures[0]({ code: 1 } as GeolocationPositionError);
      successes[0](fix(1));
      expect(states).toEqual([]);
      successes[1](fix(7));
      expect(states.at(-1)?.position?.coords.accuracy).toBe(7);
      expect(states.at(-1)?.error).toBeNull();
      stop();
      await vi.advanceTimersByTimeAsync(60000);
      expect(geo.watchPosition).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stop();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
}

for (const ending of ["cancel", "deny", "deadline"] as const) {
  test(`pending initial denial handles ${ending} without restarting GPS`, async () => {
    vi.useFakeTimers();
    const permission = Object.assign(new EventTarget(), { state: "prompt" });
    vi.stubGlobal("navigator", { permissions: { query: async () => permission } });
    const f = fixture();
    try {
      await Promise.resolve();
      f.failure({ code: 1 } as GeolocationPositionError);
      if (ending === "cancel") {
        f.stop();
        permission.state = "granted";
        permission.dispatchEvent(new Event("change"));
      } else if (ending === "deny") {
        permission.state = "denied";
        permission.dispatchEvent(new Event("change"));
        await vi.advanceTimersByTimeAsync(1000);
        expect(f.states.at(-1)?.error).toBe("gpsDenied");
      }
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.geo.watchPosition).toHaveBeenCalledTimes(1);
      expect(f.states.at(-1)?.error).toBe(ending === "cancel" ? undefined : "gpsDenied");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      f.stop();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
}

test("denial without a Permissions API retries once and then terminates", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", {});
  const failed = vi.fn();
  const geo = {
    watchPosition: vi.fn((_success: PositionCallback, failure: PositionErrorCallback) => {
      failure({ code: 1 } as GeolocationPositionError);

      return 42;
    }),
    clearWatch: vi.fn(),
  } as unknown as Geolocation;
  const stop = captureLocation(vi.fn(), failed, geo);
  try {
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(failed).toHaveBeenCalledExactlyOnceWith("gpsDenied");
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

function fixture() {
  let success!: PositionCallback;
  let failure!: PositionErrorCallback;
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
test("GPS review exposes denial and timeout with no fabricated position", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { permissions: { query: async () => ({ state: "denied" }) } });
  const denied = fixture();
  await Promise.resolve();
  vi.stubGlobal("navigator", {});
  const timeout = fixture();
  try {
    denied.failure({ code: 1 } as GeolocationPositionError);
    await vi.advanceTimersByTimeAsync(1000);
    expect(denied.states.at(-1)).toEqual({ position: null, running: false, error: "gpsDenied" });
    vi.advanceTimersByTime(60000);
    expect(timeout.states.at(-1)?.error).toBe("gpsTimeout");
  } finally {
    denied.stop();
    timeout.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

test("revoking GPS permission discards a previous fix immediately", async () => {
  const permission = Object.assign(new EventTarget(), { state: "granted" });
  vi.stubGlobal("navigator", { permissions: { query: async () => permission } });
  const f = fixture();
  try {
    await Promise.resolve();
    f.success(fix(5));
    permission.state = "denied";
    permission.dispatchEvent(new Event("change"));
    expect(f.states.at(-1)).toEqual({ position: null, running: false, error: "gpsDenied" });
    expect(f.geo.clearWatch).toHaveBeenCalledOnce();
  } finally {
    f.stop();
    vi.unstubAllGlobals();
  }
});

test("out-of-order GPS callbacks cannot displace the newest reading and expired fixes time out", () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    const newest = fix(8);
    f.success(newest);
    f.success(fix(9, newest.timestamp - 1000));
    expect(f.states.at(-1)?.position).toBe(newest);
    vi.advanceTimersByTime(60000);
    expect(f.states.at(-1)).toEqual({ position: null, running: false, error: "gpsTimeout" });
  } finally {
    f.stop();
    vi.useRealTimers();
  }
});

test("a measurable radius above an exact foot is rounded up", () => {
  expect(formatAccuracy(0.3048 + Number.EPSILON / 4, "imperial")).toBe("±2 ft");
});

test("a silent one-shot GPS prompt has an application deadline and ignores a late result", () => {
  vi.useFakeTimers();
  let success!: PositionCallback;
  const geo = {
    getCurrentPosition: (callback: PositionCallback) => {
      success = callback;
    },
  } as Geolocation;
  const saved = vi.fn();
  const error = vi.fn();
  const stop = captureLocation(saved, error, geo);
  try {
    vi.advanceTimersByTime(60000);
    expect(error).toHaveBeenCalledWith("gpsTimeout");
    success(fix(4));
    expect(saved).not.toHaveBeenCalled();
  } finally {
    stop();
    vi.useRealTimers();
  }
});

test("GPS review accepts single-shot providers without a watch API", () => {
  const geo = {
    getCurrentPosition: (callback: PositionCallback) => callback(fix(2)),
  } as Geolocation;
  const updates = vi.fn();
  const stop = watchLocation(updates, geo);
  try {
    expect(updates.mock.lastCall?.[0].position.coords.accuracy).toBe(2);
  } finally {
    stop();
  }
});

test("paired visibility and focus events restart a stalled watch only once", async () => {
  vi.useFakeTimers();
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", {});
  const geo = { watchPosition: vi.fn(() => 9), clearWatch: vi.fn() } as unknown as Geolocation;
  const stop = watchLocation(vi.fn(), geo);
  try {
    await vi.advanceTimersByTimeAsync(1000);
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("focus"));
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  } finally {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

test("late GPS callbacks after suspension cannot defeat the wall-clock acquisition deadline", () => {
  vi.useFakeTimers();
  try {
    for (const watch of [true, false]) {
      let success!: PositionCallback;

      const acquire = (callback: PositionCallback) => {
        success = callback;

        return 2;
      };

      const geo = (watch
        ? { watchPosition: acquire, clearWatch: () => {} }
        : { getCurrentPosition: acquire }) as unknown as Geolocation;
      const saved = vi.fn();
      const error = vi.fn();
      const stop = captureLocation(saved, error, geo);
      vi.setSystemTime(Date.now() + 61000);
      success(fix(2));
      expect(saved).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith("gpsTimeout");
      stop();
    }
  } finally {
    vi.useRealTimers();
  }
});

test("minimal permission status and revoked watch handles do not interrupt GPS cleanup", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { permissions: { query: async () => ({ state: "denied" }) } });
  const geo = {
    watchPosition: () => 7,
    clearWatch: () => {
      throw new Error("detached");
    },
  } as unknown as Geolocation;
  const updated = vi.fn();
  const stop = watchLocation(updated, geo);
  try {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(updated).toHaveBeenCalledWith({ position: null, running: false, error: "gpsDenied" });
    expect(vi.getTimerCount()).toBe(0);
    expect(stop).not.toThrow();
  } finally {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

test("a zero-radius estimate stops improvement watches and avoids starting a redundant one", () => {
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((callback: PositionCallback) => {
    callback(fix(0));

    return 4;
  });
  const geo = { clearWatch, watchPosition } as unknown as Geolocation;
  const improved = vi.fn();
  refineLocation(0, improved, geo)();
  expect(watchPosition).not.toHaveBeenCalled();
  const stop = refineLocation(5, improved, geo);
  expect(improved).toHaveBeenCalledOnce();
  expect(clearWatch).toHaveBeenCalledWith(4);
  stop();
});

test("unavailable permissions do not start a periodic recovery timer that cannot run", () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", {});
  const geo = { watchPosition: () => 9, clearWatch: () => {} } as unknown as Geolocation;
  const stop = watchLocation(vi.fn(), geo);
  try {
    expect(vi.getTimerCount()).toBe(1); // Acquisition deadline only.
  } finally {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
