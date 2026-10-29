export function watchForUpdates(registration: ServiceWorkerRegistration, onReady: () => void) {
  let lastCheck = -Infinity;
  let pending: Promise<"ready" | "current" | "checking" | "offline"> | undefined;
  let announced: ServiceWorker | null = null;
  let disposed = false;
  const announce = () => {
    if (registration.waiting && registration.waiting !== announced && !disposed) {
      announced = registration.waiting;
      onReady();
    }
    return Boolean(registration.waiting);
  };
  const check = (force = false) => {
    if (announce()) return Promise.resolve("ready" as const);
    if (!navigator.onLine) return Promise.resolve("offline" as const);
    if (pending) return pending;
    if (!force && Date.now() - lastCheck < 10000) return Promise.resolve("checking" as const);
    lastCheck = Date.now();
    pending = (async () => {
      await registration.update();
      if (announce()) return "ready" as const;
      return registration.installing ? ("checking" as const) : ("current" as const);
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  const foreground = () => {
    if (document.visibilityState === "visible") void check().catch(() => {});
  };
  const timer = setInterval(foreground, 60000);
  window.addEventListener("focus", foreground);
  window.addEventListener("online", foreground);
  document.addEventListener("visibilitychange", foreground);
  foreground();
  return {
    check,
    dispose() {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", foreground);
      document.removeEventListener("visibilitychange", foreground);
    },
  };
}
