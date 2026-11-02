// Shared native Web Share path for places and invitations, including desktop browsers.
export function supportsNativeShare(data: ShareData): boolean {
  try {
    return (
      typeof navigator.share === "function" &&
      (typeof navigator.canShare !== "function" || navigator.canShare(data))
    );
  } catch {
    return false;
  }
}

export async function shareOrCopy(data: ShareData, fallback: string, isCurrent = () => true) {
  if (!isCurrent()) {
    return "dismissed" as const;
  }
  if (supportsNativeShare(data)) {
    try {
      await navigator.share(data);

      return "shared" as const;
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
        return "dismissed" as const;
      }
      // A platform may advertise sharing but have no available native target.
    }
  }
  if (!isCurrent()) {
    return "dismissed" as const;
  }
  await navigator.clipboard.writeText(fallback);

  return "copied" as const;
}
