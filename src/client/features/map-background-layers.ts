import L from "leaflet";
import { mapBackgroundAt } from "../foundation/map-background";
import type { Preferences } from "../foundation/preferences";

export function mapBackgroundLayers(
  map: L.Map,
  preference: Preferences["mapBackground"],
  offline: (value: boolean) => void,
  failed: (value: boolean) => void,
  onSourceChange?: (source: Preferences["mapBackground"] | null) => void,
) {
  let active: L.TileLayer | null = null;
  let source: Preferences["mapBackground"] | null = null;
  let naturkartanFailed = false;
  const surface = map.getContainer();

  const refresh = (redraw = false) => {
    offline(!navigator.onLine);
    if (!navigator.onLine) {
      active?.remove();
      active = null;
      source = null;
      onSourceChange?.(null);
      failed(false);

      return;
    }
    const center = map.getCenter();
    const next = naturkartanFailed
      ? "osm"
      : mapBackgroundAt(preference, center.lat, center.lng, map.getZoom());
    if (source === next && active) {
      if (redraw) {
        active.redraw();
      }

      return;
    }
    active?.remove();
    source = next;
    failed(false);
    const naturkartan = next === "naturkartan";
    const tiles = L.tileLayer(
      naturkartan
        ? "https://new-maptiles.naturkartan-cdn.se/SWE/{z}/{x}/{y}.png"
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution: naturkartan
          ? ""
          : '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        maxZoom: 19,
        maxNativeZoom: naturkartan ? 15 : 19,
        referrerPolicy: "origin",
        crossOrigin: false,
        keepBuffer: 2,
        updateWhenIdle: false,
        updateInterval: 100,
      },
    );
    active = tiles;
    onSourceChange?.(next);
    const failures = new Set<HTMLElement>();
    tiles.on("tileerror", (event: L.TileErrorEvent) => {
      if (active !== tiles || !surface.contains(event.tile)) {
        return;
      }
      if (naturkartan) {
        naturkartanFailed = true;
        refresh();
      } else {
        failures.add(event.tile);
        failed(true);
      }
    });

    const clear = (event: L.TileEvent) => {
      if (active === tiles && failures.delete(event.tile)) {
        failed(failures.size !== 0);
      }
    };

    tiles.on("tileunload", clear);
    tiles.on("tileload", clear);
    tiles.addTo(map);
  };

  const move = () => refresh();

  const connect = () => {
    naturkartanFailed = false;
    refresh(true);
  };

  map.on("moveend zoomend", move);
  window.addEventListener("online", connect);
  window.addEventListener("offline", move);
  refresh();

  return () => {
    map.off("moveend zoomend", move);
    window.removeEventListener("online", connect);
    window.removeEventListener("offline", move);
    active?.remove();
    active = null;
  };
}
