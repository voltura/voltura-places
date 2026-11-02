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
export const preferencesKey = "places-preferences";

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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
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

export function loadPreferences(fallback?: Preferences): Preferences {
  let value: unknown;
  try {
    value = JSON.parse(localStorage.getItem(preferencesKey) ?? "null");
  } catch {
    if (fallback) {
      return fallback;
    }
  }

  return parsePreferences(value, location.search, navigator.language ?? "");
}

// Merge only fields edited by this tab. Another tab may already have changed other fields.
export function storePreferences(fallback: Preferences, changes: Partial<Preferences>) {
  let merged = { ...fallback, ...changes };
  try {
    const raw = localStorage.getItem(preferencesKey);
    let value: unknown;
    if (raw) {
      try {
        value = JSON.parse(raw);
      } catch {}
    }
    merged = { ...parsePreferences(value, "", navigator.language ?? ""), ...changes };
    const encoded = JSON.stringify(merged);
    if (encoded !== raw) {
      localStorage.setItem(preferencesKey, encoded);
    }

    return { value: merged, saved: true };
  } catch {
    return { value: merged, saved: false };
  }
}
