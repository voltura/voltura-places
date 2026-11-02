import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { mapURL, directionsURL, type Place, type MapAction } from "../../shared/model";
import { mapProviders } from "../foundation/map-providers";
import type { Preferences } from "../foundation/preferences";

export function useBrowsing(
  scope: string,
  hasPosition: boolean,
  prefs: Preferences,
  setPrefs: Dispatch<SetStateAction<Preferences>>,
) {
  const [maps, setMaps] = useState<{ place: Place; action: MapAction } | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [visitFilter, setVisitFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState<string | null>(null);
  const [libraryView, setLibraryView] = useState<"list" | "map">("list");
  const [fullscreenDetails, setFullscreenDetails] = useState(false);
  const [fullscreenScope, setFullscreenScope] = useState<string | null>(null);
  const [mapFocus, setMapFocus] = useState<{
    workspace: string;
    id: string;
    request: number;
  } | null>(null);
  useEffect(() => {
    if (!hasPosition && sort === "closest") {
      setSort("newest");
    }
  }, [hasPosition, sort]);
  useEffect(() => setFullscreenScope(null), [scope, libraryView]);

  const reset = () => {
    setMaps(null);
    setSearch("");
    setFilter("all");
    setSelected(null);
    setMapFocus(null);
    setFullscreenScope(null);
    setFullscreenDetails(false);
  };

  const openMaps = (place: Place) => {
    if (prefs.provider && mapProviders().includes(prefs.provider)) {
      window.open(mapURL(prefs.provider, place), "_blank", "noopener,noreferrer");
    } else {
      setMaps({ place, action: "show" });
    }
  };

  const navigate = (place: Place) => {
    if (prefs.provider === "google" || prefs.provider === "apple") {
      window.open(directionsURL(prefs.provider, place), "_blank", "noopener,noreferrer");
    } else {
      setMaps({ place, action: "navigate" });
    }
  };

  const chooseProvider = (provider: Preferences["provider"]) => {
    setPrefs((previous) => ({ ...previous, provider }));
    setMaps(null);
  };

  return {
    maps,
    setMaps,
    openMaps,
    navigate,
    chooseProvider,
    search,
    setSearch,
    filter,
    setFilter,
    visitFilter,
    setVisitFilter,
    sort,
    setSort,
    selected,
    setSelected,
    libraryView,
    setLibraryView,
    fullscreenDetails,
    setFullscreenDetails,
    fullscreenScope,
    setFullscreenScope,
    mapFocus,
    setMapFocus,
    reset,
  };
}
