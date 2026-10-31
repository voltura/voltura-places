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
  const registration = Object.assign(new EventTarget(), {
    update,
    waiting: null,
    installing: null,
  }) as unknown as ServiceWorkerRegistration;
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

test("tracks delayed installations, including one already running, and detaches on disposal", async () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "hidden" }));
  vi.stubGlobal("navigator", { onLine: true });
  const worker = Object.assign(new EventTarget(), { state: "installing" });
  const registration = Object.assign(new EventTarget(), {
    installing: worker as typeof worker | null,
    waiting: null as typeof worker | null,
    update: vi.fn(async () => {}),
  });
  const ready = vi.fn();
  const monitor = watchForUpdates(registration as unknown as ServiceWorkerRegistration, ready);
  try {
    expect(await monitor.check(true)).toBe("checking");
    registration.waiting = worker;
    registration.installing = null;
    worker.state = "installed";
    worker.dispatchEvent(new Event("statechange"));
    expect(ready).toHaveBeenCalledTimes(1);
    worker.dispatchEvent(new Event("statechange"));
    expect(ready).toHaveBeenCalledTimes(1);

    registration.waiting = null;
    const next = Object.assign(new EventTarget(), { state: "installing" });
    registration.installing = next;
    registration.dispatchEvent(new Event("updatefound"));
    // A failed install never offers an update.
    next.state = "redundant";
    next.dispatchEvent(new Event("statechange"));
    expect(ready).toHaveBeenCalledTimes(1);

    const final = Object.assign(new EventTarget(), { state: "installing" });
    registration.installing = final;
    registration.dispatchEvent(new Event("updatefound"));
    registration.waiting = final;
    final.state = "installed";
    final.dispatchEvent(new Event("statechange"));
    expect(ready).toHaveBeenCalledTimes(2);

    monitor.dispose();
    registration.waiting = worker;
    final.dispatchEvent(new Event("statechange"));
    registration.dispatchEvent(new Event("updatefound"));
    expect(ready).toHaveBeenCalledTimes(2);
  } finally {
    monitor.dispose();
    vi.unstubAllGlobals();
  }
});
