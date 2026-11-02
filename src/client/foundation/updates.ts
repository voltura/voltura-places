export function watchForUpdates(registration: ServiceWorkerRegistration, onReady: () => void) {
  let lastCheck = -Infinity;
  let pending: Promise<"ready" | "current" | "checking" | "offline"> | undefined;
  let announced: ServiceWorker | null = null;
  let disposed = false;
  let installing: ServiceWorker | null = null;

  const announce = () => {
    // First installation briefly passes through waiting before activating itself.
    // A replacement needs an existing active worker as well as a waiting one.
    const replacement = Boolean(registration.active && registration.waiting);
    if (replacement && registration.waiting !== announced && !disposed) {
      announced = registration.waiting;
      onReady();
    }

    return replacement;
  };

  const stateChanged = () => {
    announce();
    if (installing?.state === "activated" || installing?.state === "redundant") {
      installing.removeEventListener("statechange", stateChanged);
      installing = null;
    }
  };

  const trackInstallation = () => {
    if (disposed) {
      return;
    }
    if (installing !== registration.installing) {
      installing?.removeEventListener("statechange", stateChanged);
      installing = registration.installing;
      installing?.addEventListener("statechange", stateChanged);
    }
    announce();
  };

  registration.addEventListener("updatefound", trackInstallation);
  trackInstallation();

  const check = (force = false) => {
    if (announce()) {
      return Promise.resolve("ready" as const);
    }
    if (!navigator.onLine) {
      return Promise.resolve("offline" as const);
    }
    if (pending) {
      return pending;
    }
    if (registration.installing) {
      trackInstallation();

      return Promise.resolve("checking" as const);
    }
    if (!force && performance.now() - lastCheck < 10000) {
      return Promise.resolve("checking" as const);
    }
    lastCheck = performance.now();
    pending = (async () => {
      await registration.update();
      trackInstallation();
      if (announce()) {
        return "ready" as const;
      }

      return registration.installing || registration.waiting
        ? ("checking" as const)
        : ("current" as const);
    })()
      .catch((error: unknown) => {
        lastCheck = -Infinity;
        throw error;
      })
      .finally(() => {
        pending = undefined;
      });

    return pending;
  };

  const foreground = () => {
    if (document.visibilityState === "visible") {
      void check().catch(() => {});
    }
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
      registration.removeEventListener("updatefound", trackInstallation);
      installing?.removeEventListener("statechange", stateChanged);
      clearInterval(timer);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", foreground);
      document.removeEventListener("visibilitychange", foreground);
    },
  };
}
