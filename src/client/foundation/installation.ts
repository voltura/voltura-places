type InstallOffer = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
type InstallState = {
  installed: boolean;
  available: boolean;
  pending: boolean;
  failed: boolean;
};

// Browser infrastructure starts before rendering, including while Settings is closed.
export function createInstallation(win: Window, nav: Navigator) {
  const display = win.matchMedia("(display-mode: standalone)");
  const fullscreen = win.matchMedia("(display-mode: fullscreen)");
  const installed = () =>
    display.matches ||
    fullscreen.matches ||
    (nav as Navigator & { standalone?: boolean }).standalone === true;
  let state: InstallState = {
    installed: installed(),
    available: false,
    pending: false,
    failed: false,
  };
  let offer: InstallOffer | null = null;
  let observedInstall = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<InstallState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const refresh = () => {
    const isInstalled = observedInstall || installed();
    if (isInstalled) offer = null;
    update({ installed: isInstalled, available: !!offer && !isInstalled });
  };
  const receive = (event: Event) => {
    if (state.installed || typeof (event as InstallOffer).prompt !== "function") return;
    event.preventDefault();
    offer = event as InstallOffer;
    update({ available: true, failed: false });
  };
  const onInstalled = () => {
    observedInstall = true;
    refresh();
  };
  win.addEventListener("beforeinstallprompt", receive);
  win.addEventListener("appinstalled", onInstalled);
  display.addEventListener("change", refresh);
  fullscreen.addEventListener("change", refresh);
  win.addEventListener("pageshow", refresh);
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async install() {
      if (!offer || state.pending || state.installed) return;
      const current = offer;
      offer = null; // Browser offers can only be used once, including dismissal/failure.
      update({ available: false, pending: true, failed: false });
      try {
        await current.prompt(); // Called synchronously from the user's click.
        await current.userChoice;
      } catch {
        update({ failed: true });
      } finally {
        update({ pending: false });
      }
    },
    dispose() {
      win.removeEventListener("beforeinstallprompt", receive);
      win.removeEventListener("appinstalled", onInstalled);
      display.removeEventListener("change", refresh);
      fullscreen.removeEventListener("change", refresh);
      win.removeEventListener("pageshow", refresh);
      listeners.clear();
    },
  };
}

export function installationPlatform(
  nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
) {
  if (
    /iPhone|iPad|iPod/i.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)
  )
    return "ios";
  return /Android/i.test(nav.userAgent) ? "android" : "other";
}

// Browser identity only tailors help text; native install availability is event-based.
export function appleInstallBrowser(nav: Pick<Navigator, "userAgent">) {
  if (/CriOS\//i.test(nav.userAgent)) return "chrome";
  if (
    /Safari\//i.test(nav.userAgent) &&
    !/FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\//i.test(nav.userAgent)
  )
    return "safari";
  return "other";
}
