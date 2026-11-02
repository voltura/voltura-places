import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { applyAppearance } from "../foundation/appearance";
import {
  loadPreferences,
  preferencesKey,
  storePreferences,
  type Preferences,
} from "../foundation/preferences";

export function usePreferences() {
  const [preferences, setState] = useState(loadPreferences);
  const current = useRef(preferences);
  const unsaved = useRef<Partial<Preferences>>({});

  const commit = useCallback((changes: Partial<Preferences>) => {
    const pending = { ...unsaved.current, ...changes };
    const { value, saved } = storePreferences(current.current, pending);
    unsaved.current = saved ? {} : pending;
    if (
      Object.entries(value).some(
        ([key, field]) => current.current[key as keyof Preferences] !== field,
      )
    ) {
      current.current = value;
      setState(value);
    }
    const url = new URL(location.href);
    if (["sv", "en"].includes(url.searchParams.get("lang") ?? "")) {
      // A linked language must survive reload when browser settings cannot be written.
      if (saved) {
        url.searchParams.delete("lang");
      } else {
        url.searchParams.set("lang", value.language);
      }
      try {
        history.replaceState(history.state, "", url.pathname + url.search + url.hash);
      } catch {}
    }
  }, []);

  const setPreferences = useCallback(
    (action: SetStateAction<Preferences>) => {
      // Object updates are based on the caller's render. Functional updates use the latest value.
      const previous = typeof action === "function" ? current.current : preferences;
      const next = typeof action === "function" ? action(previous) : action;
      const changes = Object.fromEntries(
        Object.entries(next).filter(([key, value]) => previous[key as keyof Preferences] !== value),
      );
      commit(changes);
    },
    [commit, preferences],
  );

  useEffect(() => {
    const language = new URL(location.href).searchParams.get("lang");
    commit(language === "en" || language === "sv" ? { language } : {});

    const synchronize = (event: StorageEvent) => {
      try {
        if (
          (event.key !== null && event.key !== preferencesKey) ||
          event.storageArea !== localStorage
        ) {
          return;
        }
        // Read current storage, since the queued event may predate a newer local edit.
        const next = { ...loadPreferences(current.current), ...unsaved.current };
        current.current = next;
        setState(next);
      } catch {}
    };

    window.addEventListener("storage", synchronize);

    return () => window.removeEventListener("storage", synchronize);
  }, [commit]);
  useEffect(() => {
    document.documentElement.lang = preferences.language;
  }, [preferences.language]);
  useEffect(() => {
    if (preferences.theme !== "system") {
      applyAppearance(preferences.theme, preferences.skin, false);

      return;
    }
    const media = matchMedia("(prefers-color-scheme: dark)");

    const apply = () => applyAppearance("system", preferences.skin, media.matches);

    apply();
    media.addEventListener("change", apply);

    return () => media.removeEventListener("change", apply);
  }, [preferences.theme, preferences.skin]);

  return [preferences, setPreferences] as const;
}
