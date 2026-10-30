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
export async function shareOrCopy(data: ShareData, fallback: string) {
  if (!supportsNativeShare(data)) {
    await navigator.clipboard.writeText(fallback);
    return "copied" as const;
  }
  try {
    await navigator.share(data);
    return "shared" as const;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "dismissed" as const;
    throw error;
  }
}
