const settingKey = "places-activity-enabled";
const idKey = "places-activity-id";
const changedEvent = "places-activity-changed";
let memoryEnabled: boolean | undefined;
let settingWriteFailed = false;
let memoryId: string | undefined;
let ignoreSavedId = false;

export function activityEnabled() {
  if (settingWriteFailed && memoryEnabled !== undefined) {
    return memoryEnabled;
  }
  try {
    const value = localStorage.getItem(settingKey);
    memoryEnabled = value !== "false";
  } catch {}

  return memoryEnabled ?? true;
}

export function setActivityEnabled(enabled: boolean) {
  memoryEnabled = enabled;
  try {
    localStorage.setItem(settingKey, String(enabled));
    settingWriteFailed = false;
  } catch {
    settingWriteFailed = true;
  }
  if (!enabled) {
    clearIdentifier();
  }
  window.dispatchEvent(new Event(changedEvent));
}

function clearIdentifier() {
  memoryId = undefined;
  ignoreSavedId = true;
  try {
    localStorage.removeItem(idKey);
    ignoreSavedId = false;
  } catch {}
}

function identifier() {
  try {
    const saved = ignoreSavedId ? null : localStorage.getItem(idKey);
    if (
      saved &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)
    ) {
      memoryId = saved;

      return saved;
    }
    memoryId ??= crypto.randomUUID();
    localStorage.setItem(idKey, memoryId);
    ignoreSavedId = false;
  } catch {
    memoryId ??= crypto.randomUUID();
  }

  return memoryId;
}

export function startActivityReporting(request: typeof fetch = fetch) {
  let stopped = false;
  let pending: AbortController | undefined;

  const report = async () => {
    if (
      stopped ||
      pending ||
      !activityEnabled() ||
      document.visibilityState !== "visible" ||
      !navigator.onLine
    ) {
      return;
    }
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      await request("/api/v1/activity", {
        method: "POST",
        credentials: "omit",
        mode: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: identifier() }),
      });
    } catch {
    } finally {
      clearTimeout(timeout);
      if (pending === controller) {
        pending = undefined;
      }
    }
  };

  const changed = () => {
    const enabled = activityEnabled();
    if (!enabled) {
      clearIdentifier();
    }
    if (!enabled || document.visibilityState !== "visible" || !navigator.onLine) {
      pending?.abort();
      pending = undefined;
    } else {
      void report();
    }
  };

  const storage = (event: StorageEvent) => {
    try {
      if (event.storageArea && event.storageArea !== localStorage) {
        return;
      }
    } catch {
      // Without storage access, honor opt-out conservatively until the preference can be read again.
      if (event.key !== settingKey || event.newValue !== "false") {
        return;
      }
    }
    if (event.key === idKey || event.key === null) {
      memoryId = undefined;
      ignoreSavedId = false;
    }
    if (event.key === settingKey || event.key === null) {
      settingWriteFailed = false;
      if (event.key === settingKey && (event.newValue === "true" || event.newValue === "false")) {
        memoryEnabled = event.newValue === "true";
      }
      changed();
    }
  };

  const timer = setInterval(() => void report(), 60_000);
  document.addEventListener("visibilitychange", changed);
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  window.addEventListener(changedEvent, changed);
  window.addEventListener("storage", storage);
  changed();

  return () => {
    stopped = true;
    pending?.abort();
    clearInterval(timer);
    document.removeEventListener("visibilitychange", changed);
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
    window.removeEventListener(changedEvent, changed);
    window.removeEventListener("storage", storage);
  };
}
