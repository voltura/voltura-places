import { validSkin, type Skin } from "./appearance";
import type { Language } from "./i18n";
import type { DistanceUnits } from "./distance";

export type Preferences = {
  language: Language;
  theme: "light" | "dark" | "system";
  skin: Skin;
  provider: "google" | "apple" | "geo" | "";
  lastCategory: string;
  reviewGps: boolean;
  autoHideControls: boolean;
  units: DistanceUnits;
};

/** Treat device storage as untrusted input; only retain known, valid fields. */
export function parsePreferences(
  value: unknown,
  search: string,
  browserLanguage: string,
): Preferences {
  const requested = new URLSearchParams(search).get("lang");
  const linkedLanguage = requested === "sv" || requested === "en" ? requested : null;
  const defaults: Preferences = {
    language: linkedLanguage ?? (/^sv(?:-|$)/i.test(browserLanguage) ? "sv" : "en"),
    theme: "dark",
    skin: "forest",
    provider: "",
    lastCategory: "other",
    reviewGps: false,
    autoHideControls: false,
    units: "metric",
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const v = value as Record<string, unknown>;
  return {
    language:
      linkedLanguage ??
      (v.language === "en" || v.language === "sv" ? v.language : defaults.language),
    theme: v.theme === "light" || v.theme === "system" ? v.theme : "dark",
    skin: validSkin(v.skin),
    provider:
      v.provider === "google" || v.provider === "apple" || v.provider === "geo" ? v.provider : "",
    lastCategory:
      typeof v.lastCategory === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(v.lastCategory)
        ? v.lastCategory
        : "other",
    reviewGps: v.reviewGps === true,
    autoHideControls: v.autoHideControls === true,
    units: v.units === "imperial" ? "imperial" : "metric",
  };
}

export function loadPreferences(): Preferences {
  let value: unknown;
  try {
    value = JSON.parse(localStorage.getItem("places-preferences") ?? "null");
  } catch {}
  return parsePreferences(value, location.search, navigator.language ?? "");
}
