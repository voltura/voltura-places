import { test, expect, vi } from "vitest";
import { watchForUpdates } from "../src/client/foundation/updates";
test("visible tabs check on return and each minute, deduplicate work and announce once", async () => {
  vi.useFakeTimers();
  const window = new EventTarget(),
    document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const navigator = { onLine: true };
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", navigator);
  const update = vi.fn(async () => {}),
    ready = vi.fn();
  const registration = {
    update,
    waiting: null,
    installing: null,
  } as unknown as ServiceWorkerRegistration;
  const monitor = watchForUpdates(registration, ready);
  try {
    await vi.advanceTimersByTimeAsync(60000);
    expect(update).toHaveBeenCalledTimes(2);
    document.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(60000);
    expect(update).toHaveBeenCalledTimes(2);
    document.visibilityState = "visible";
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(3);
    Object.assign(registration, { waiting: {} });
    expect(await monitor.check(true)).toBe("ready");
    await monitor.check(true);
    expect(ready).toHaveBeenCalledTimes(1);
    Object.assign(registration, { waiting: null });
    navigator.onLine = false;
    expect(await monitor.check(true)).toBe("offline");
    monitor.dispose();
    await vi.advanceTimersByTimeAsync(60000);
    expect(update).toHaveBeenCalledTimes(3);
  } finally {
    monitor.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
