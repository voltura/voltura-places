import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { stockholmMidnight } from "../src/server/statistics";

for (const [instant, midnight] of [
  ["2026-11-01T12:00:00Z", "2026-10-31T23:00:00Z"],
  ["2026-07-01T12:00:00Z", "2026-06-30T22:00:00Z"],
  ["2026-03-29T12:00:00Z", "2026-03-28T23:00:00Z"],
  ["2026-10-25T12:00:00Z", "2026-10-24T22:00:00Z"],
  ["2026-11-01T23:00:00Z", "2026-11-01T23:00:00Z"],
])
  test(`Swedish midnight at ${instant}`, () => {
    expect(stockholmMidnight(Date.parse(instant))).toBe(Date.parse(midnight));
  });

let data: Map<string, string>;
let doc: EventTarget & { visibilityState: string };
let win: EventTarget;
let online: { onLine: boolean };
let stops: (() => void)[];
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  data = new Map();
  stops = [];
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  win = new EventTarget();
  online = { onLine: true };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", online);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
});
afterEach(() => {
  stops.forEach((stop) => stop());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("reports immediately and every minute, sharing an ID across reporters", async () => {
  const { startActivityReporting } = await import("../src/client/foundation/activity");
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
  stops.push(startActivityReporting(request), startActivityReporting(request));
  expect(request).toHaveBeenCalledTimes(2);
  const first = request.mock.calls[0][1]!;
  expect(first.credentials).toBe("omit");
  expect(first.body).toBe(request.mock.calls[1][1]!.body);
  expect(JSON.parse(String(first.body))).toEqual({ browserId: data.get("places-activity-id") });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(4);
});

test("hidden/offline pages pause; foreground and reconnection resume", async () => {
  const { startActivityReporting } = await import("../src/client/foundation/activity");
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
  doc.visibilityState = "hidden";
  stops.push(startActivityReporting(request));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).not.toHaveBeenCalled();
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(1);
  online.onLine = false;
  win.dispatchEvent(new Event("offline"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(1);
  online.onLine = true;
  win.dispatchEvent(new Event("online"));
  expect(request).toHaveBeenCalledTimes(2);
});

test("opt-out removes the ID and stops reporting, including after reload", async () => {
  const { startActivityReporting, setActivityEnabled } =
    await import("../src/client/foundation/activity");
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
  stops.push(startActivityReporting(request));
  const old = data.get("places-activity-id");
  setActivityEnabled(false);
  expect(data.has("places-activity-id")).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000);
  stops.push(startActivityReporting(request));
  expect(request).toHaveBeenCalledTimes(1);
  setActivityEnabled(true);
  expect(data.get("places-activity-id")).not.toBe(old);
});

test("blocked storage and request failures are tolerated; cleanup stops timers", async () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw Error();
    },
    setItem() {
      throw Error();
    },
    removeItem() {
      throw Error();
    },
  });
  const { startActivityReporting, setActivityEnabled } =
    await import("../src/client/foundation/activity");
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
  const stop = startActivityReporting(request);
  stops.push(stop);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[0][1]!.body).toBe(request.mock.calls[1][1]!.body);
  setActivityEnabled(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(2);
  stop();
  setActivityEnabled(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(request).toHaveBeenCalledTimes(2);
});

test("opt-out wins when storage can be read but writes fail", async () => {
  data.set("places-activity-enabled", "true");
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem() {
      throw Error("quota");
    },
    removeItem() {
      throw Error("blocked");
    },
  });
  const { startActivityReporting, setActivityEnabled, activityEnabled } =
    await import("../src/client/foundation/activity");
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
  stops.push(startActivityReporting(request));
  setActivityEnabled(false);
  expect(activityEnabled()).toBe(false);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(request).toHaveBeenCalledTimes(1);
});

test("another tab's opt-out stops reporting and clears the identifier", async () => {
  const { startActivityReporting, setActivityEnabled } =
    await import("../src/client/foundation/activity");
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
  setActivityEnabled(true);
  stops.push(startActivityReporting(request));
  data.set("places-activity-enabled", "false");
  const event = Object.assign(new Event("storage"), { key: "places-activity-enabled" });
  win.dispatchEvent(event);
  expect(data.has("places-activity-id")).toBe(false);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(request).toHaveBeenCalledTimes(1);
});
