import { useEffect, useState } from "react";
import { applyAppearance } from "../foundation/appearance";
import { loadPreferences } from "../foundation/preferences";

export function usePreferences() {
  const [preferences, setPreferences] = useState(loadPreferences);
  useEffect(() => {
    const url = new URL(location.href);
    if (["sv", "en"].includes(url.searchParams.get("lang") ?? "")) {
      url.searchParams.delete("lang");
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = preferences.language;
    try {
      localStorage.setItem("places-preferences", JSON.stringify(preferences));
    } catch {}
  }, [preferences]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyAppearance(preferences.theme, preferences.skin, media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme, preferences.skin]);
  return [preferences, setPreferences] as const;
}
