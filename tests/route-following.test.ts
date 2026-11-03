import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { followLocation, type FollowLocation } from "../src/client/foundation/route-following";

let callbacks: PositionCallback[];
let errors: PositionErrorCallback[];
let states: FollowLocation[];
let doc: EventTarget & { hidden: boolean };
let clearWatch: ReturnType<typeof vi.fn>;
let release: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  callbacks = [];
  errors = [];
  states = [];
  doc = Object.assign(new EventTarget(), { hidden: false });
  clearWatch = vi.fn();
  release = vi.fn(async () => {});
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", {
    geolocation: {
      watchPosition: (success: PositionCallback, error: PositionErrorCallback) => {
        callbacks.push(success);
        errors.push(error);

        return callbacks.length;
      },
      clearWatch,
    },
    wakeLock: { request: vi.fn(async () => ({ release })) },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fix = (accuracy = 500, timestamp = Date.now()) =>
  ({ timestamp, coords: { latitude: 59.33, longitude: 18.06, accuracy } }) as GeolocationPosition;

const publish = (state: FollowLocation) => states.push(state);

test("accepts coarse fresh fixes, expires at 15 seconds and ignores late callbacks", () => {
  const session = followLocation(publish);
  callbacks[0](fix());
  expect(states.at(-1)?.position?.coords.accuracy).toBe(500);
  vi.advanceTimersByTime(15000);
  expect(states.at(-1)).toEqual({ position: null, status: "stale" });
  callbacks[0](fix(5, Date.now() - 16000));
  expect(states.at(-1)?.status).toBe("stale");
  session.stop();
  const count = states.length;
  callbacks[0](fix());
  expect(states).toHaveLength(count);
  expect(clearWatch).toHaveBeenCalledWith(1);
});

test("visibility releases resources, resumes, and rejects callbacks from the old watch", async () => {
  const session = followLocation(publish);
  await Promise.resolve();
  doc.hidden = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(release).toHaveBeenCalledOnce();
  expect(states.at(-1)?.status).toBe("paused");
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  callbacks[0](fix());
  expect(states.at(-1)?.status).toBe("finding");
  callbacks[1](fix());
  expect(states.at(-1)?.status).toBe("live");
  session.stop();
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(callbacks).toHaveLength(2);
});

test("denial is explicit and retry replaces the watch", () => {
  const session = followLocation(publish);
  errors[0]({ code: 1 } as GeolocationPositionError);
  expect(states.at(-1)?.status).toBe("denied");
  vi.advanceTimersByTime(60000);
  expect(callbacks).toHaveLength(1);
  session.retry();
  errors[0]({ code: 2 } as GeolocationPositionError);
  expect(states.at(-1)?.status).toBe("finding");
  errors[1]({ code: 2 } as GeolocationPositionError);
  expect(states.at(-1)?.status).toBe("unavailable");
  session.stop();
});

test("missing or throwing APIs report unavailable without preventing cleanup", () => {
  vi.stubGlobal("navigator", {});
  const first = followLocation(publish);
  expect(states.at(-1)?.status).toBe("unavailable");
  first.stop();
  vi.stubGlobal("navigator", {
    geolocation: {
      watchPosition: () => {
        throw new Error();
      },
    },
    wakeLock: {
      request: () => {
        throw new Error();
      },
    },
  });
  const second = followLocation(publish);
  expect(states.at(-1)?.status).toBe("unavailable");
  second.stop();
});

test("wake lock rejected or resolved after closing cannot leak a lock", async () => {
  let resolve!: (lock: { release: typeof release }) => void;
  navigator.wakeLock.request = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  ) as typeof navigator.wakeLock.request;
  const session = followLocation(publish);
  session.stop();
  resolve({ release });
  await Promise.resolve();
  expect(release).toHaveBeenCalledOnce();
  navigator.wakeLock.request = vi.fn(async () => {
    throw new Error();
  });
  const second = followLocation(publish);
  callbacks[1](fix());
  await Promise.resolve();
  expect(states.at(-1)?.status).toBe("live");
  second.stop();
});
