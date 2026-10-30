export type MapProvider = "google" | "apple" | "geo";

export function mapProviders(): MapProvider[] {
  return /Android/i.test(navigator.userAgent) ? ["google", "apple", "geo"] : ["google", "apple"];
}
