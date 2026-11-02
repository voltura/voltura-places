// Browser permission is best-effort and must never block local saving or launch.
let pending: Promise<boolean> | undefined;

async function requestRetention(): Promise<boolean> {
  try {
    const storage = navigator.storage;
    try {
      if (await storage?.persisted?.()) {
        return true;
      }
    } catch {}

    return (await storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function keepOfflineData(): Promise<boolean> {
  pending ??= requestRetention().finally(() => {
    pending = undefined;
  });

  return pending;
}

export async function offlineDataProtected(): Promise<boolean> {
  if (pending) {
    return pending;
  }
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
