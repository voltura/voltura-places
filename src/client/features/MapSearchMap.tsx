import { useContext, useEffect, useRef, useState } from "react";
import { Crosshair } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapSearchResult } from "../../shared/map-search";
import type { Message } from "../foundation/i18n";
import { MapBackgroundContext } from "./MapBackgroundContext";
import { mapBackgroundLayers } from "./map-background-layers";
import { NaturkartanLegend } from "./NaturkartanLegend";
import type { Preferences } from "../foundation/preferences";

export type MapSearchPoint = Pick<MapSearchResult, "latitude" | "longitude">;

export default function MapSearchMap({
  results,
  selected,
  onSelect,
  onPick,
  t,
}: {
  results: MapSearchResult[];
  selected: string | null;
  onSelect?: (id: string) => void;
  onPick?: (point: MapSearchPoint | null) => void;
  t: (key: Message) => string;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const background = useContext(MapBackgroundContext);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [failed, setFailed] = useState(false);
  const [source, setSource] = useState<Preferences["mapBackground"] | null>(null);

  useEffect(() => {
    const instance = L.map(surface.current!, {
      scrollWheelZoom: !!onPick,
      zoomAnimation: false,
      fadeAnimation: false,
    });
    map.current = instance;
    instance.attributionControl.setPrefix(false);
    if (onPick) {
      const { latitude, longitude } = results[0];
      instance.setView([latitude, longitude], 17);

      const updatePoint = () => {
        const { lat, lng } = instance.getCenter().wrap();
        onPick({
          latitude: Math.max(-85.051128, Math.min(85.051128, Number(lat.toFixed(6)))),
          longitude: Number(lng.toFixed(6)),
        });
      };

      instance.on("movestart", () => onPick(null));
      instance.on("moveend", updatePoint);
      instance.on("click", (event: L.LeafletMouseEvent) =>
        instance.panTo(event.latlng, { animate: false }),
      );
      updatePoint();
    } else {
      const bounds = L.latLngBounds(
        results.map(({ latitude, longitude }) => [latitude, longitude]),
      );
      instance.fitBounds(bounds, { maxZoom: 15, padding: [32, 32], animate: false });
    }
    for (const result of results) {
      const label = [result.name, result.municipality, result.county].filter(Boolean).join(", ");
      const marker = L.marker([result.latitude, result.longitude], {
        icon: L.divIcon({ className: "map-search-pin", iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).addTo(instance);
      marker.getElement()?.setAttribute("aria-label", label);
      const content = document.createElement("span");
      content.textContent = label;
      const tooltip = L.tooltip({
        className: "map-search-tooltip",
        direction: "top",
        offset: [0, -14],
        opacity: 1,
      }).setContent(content);
      if (onPick) {
        instance.on("movestart", () => tooltip.remove());
        marker.on("click", () => {
          instance.setView(marker.getLatLng(), instance.getZoom(), { animate: false });
          onPick({ latitude: result.latitude, longitude: result.longitude });
          tooltip.setLatLng(marker.getLatLng()).addTo(instance);
        });
      } else {
        marker.bindTooltip(tooltip);
        marker.on("click", () => onSelect?.(result.id));
      }
      markers.current.set(result.id, marker);
    }
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }));
    observer.observe(surface.current!);
    const installed = markers.current;

    return () => {
      observer.disconnect();
      instance.remove();
      installed.clear();
      map.current = null;
    };
  }, [results, onSelect, onPick]);

  useEffect(() => {
    for (const [direction, label] of [
      ["in", t("zoomIn")],
      ["out", t("zoomOut")],
    ]) {
      const control = surface.current?.querySelector(`.leaflet-control-zoom-${direction}`);
      control?.setAttribute("title", label);
      control?.setAttribute("aria-label", label);
    }
  }, [t, results, onSelect, onPick]);

  useEffect(
    () => mapBackgroundLayers(map.current!, background, setOffline, setFailed, setSource),
    [background, results, onSelect, onPick],
  );

  useEffect(() => {
    if (onPick) {
      return;
    }
    for (const [id, marker] of markers.current) {
      marker.getElement()?.setAttribute("aria-pressed", String(id === selected));
      marker.setZIndexOffset(id === selected ? 1000 : 0);
    }
    const instance = map.current;
    const marker = selected ? markers.current.get(selected) : null;
    if (instance && marker && !instance.getBounds().contains(marker.getLatLng())) {
      instance.panTo(marker.getLatLng(), { animate: false });
    }
  }, [selected, results, onSelect, onPick]);

  return (
    <div className="map-search-map">
      {(offline || failed) && (
        <p className="map-warning" role="status">
          {t("mapBackgroundUnavailable")}
        </p>
      )}
      <div className="map-search-canvas">
        <div ref={surface} className="places-map" aria-label={t("mapInstructions")} />
        {onPick && <Crosshair className="map-search-crosshair" size={38} aria-hidden="true" />}
      </div>
      {source === "naturkartan" && (
        <div className="map-search-map-credit">
          <NaturkartanLegend t={t} />
          <span>{t("naturkartan")}</span>
        </div>
      )}
    </div>
  );
}
