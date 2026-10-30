import { useEffect, useEffectEvent, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import type { PlaceRecord } from "./PlaceDetails";
import type { Message } from "../foundation/i18n";
import { Sheet } from "../ui/Sheet";

type Props = {
  preview?: boolean;
  focusId?: string | null;
  focusRequest?: number;
  places: PlaceRecord[];
  fitKey: string;
  selected: string | null;
  onSelect: (id: string) => void;
  categoryColor: (id: string) => string;
  t: (key: Message) => string;
};

// Web Mercator cannot display the poles. Keep the stored destination unchanged.
function point(place: PlaceRecord): L.LatLngTuple {
  return [
    Math.max(-85.05112878, Math.min(85.05112878, place.value.latitude)),
    place.value.longitude,
  ];
}
function fitPlaces(map: L.Map | null, places: PlaceRecord[], preview = false) {
  if (!map || !places.length) return;
  const bounds = L.latLngBounds(places.map(point));
  if (preview) {
    for (const place of places) {
      if (place.value.accuracy !== null && place.value.accuracy > 0)
        bounds.extend(L.latLng(point(place)).toBounds(place.value.accuracy * 2));
    }
  }
  map.fitBounds(bounds, {
    padding: preview ? [24, 24] : [36, 36],
    maxZoom: 15,
    animate: false,
  });
}

export default function PlacesMap({
  places,
  fitKey,
  selected,
  onSelect,
  categoryColor,
  t,
  preview = false,
  focusId = null,
  focusRequest = 0,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const [offline, setOffline] = useState(!navigator.onLine);
  const [tileFailed, setTileFailed] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);
  const [allVisible, setAllVisible] = useState(true);
  const choiceRecords = places.filter((place) => choices.includes(place.id));
  const dataKey = JSON.stringify(
    places.map((place) => [
      place.id,
      place.value.latitude,
      place.value.longitude,
      place.value.accuracy,
      place.value.name,
      categoryColor(place.value.categoryId),
    ]),
  );
  const live = useEffectEvent(() => ({ places, categoryColor, t, onSelect, selected }));
  const updateVisibility = useEffectEvent(() => {
    const map = mapRef.current;
    if (!map || preview) return;
    const size = map.getSize();
    setAllVisible(
      places.every((place) => {
        const position = map.latLngToContainerPoint(point(place));
        return (
          position.x >= 24 &&
          position.x <= size.x - 24 &&
          position.y >= 24 &&
          position.y <= size.y - 24
        );
      }),
    );
  });
  const fit = useEffectEvent(() => {
    fitPlaces(mapRef.current, places, preview);
    updateVisibility();
  });

  useEffect(() => {
    const map = L.map(container.current!, {
      zoomControl: false,
      attributionControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      minZoom: 0,
      maxZoom: 19,
      dragging: !preview,
      touchZoom: !preview,
      scrollWheelZoom: !preview,
      doubleClickZoom: !preview,
      boxZoom: !preview,
      keyboard: !preview,
    }).setView([0, 0], 2);
    mapRef.current = map;
    const visibilityChanged = () => updateVisibility();
    map.on("moveend zoomend resize", visibilityChanged);
    fitPlaces(map, live().places, preview);
    const { t } = live();
    if (!preview)
      L.control.zoom({ zoomInTitle: t("zoomIn"), zoomOutTitle: t("zoomOut") }).addTo(map);
    map.attributionControl.setPrefix(false);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      maxZoom: 19,
      referrerPolicy: "origin",
      crossOrigin: false,
      keepBuffer: 0,
      updateWhenIdle: true,
    });
    tiles.on("loading", () => setTileFailed(false));
    tiles.on("tileerror", () => setTileFailed(true));
    const connectivity = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) {
        setTileFailed(false);
        if (!map.hasLayer(tiles)) tiles.addTo(map);
        else tiles.redraw();
      } else tiles.remove();
    };
    connectivity();
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    const group = L.markerClusterGroup({
      animate: false,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: false,
      spiderfyOnMaxZoom: false,
      maxClusterRadius: 48,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const label = document.createElement("span");
        label.textContent = String(count);
        label.setAttribute("aria-label", `${count} ${live().t("mapPlaces")}`);
        return L.divIcon({ html: label, className: "places-map-cluster", iconSize: [48, 48] });
      },
    }).addTo(map);
    groupRef.current = group;
    group.on("clusterclick clusterkeypress", (event: L.LeafletEvent) => {
      if (event.type === "clusterkeypress") {
        const key = (event as L.LeafletKeyboardEvent).originalEvent;
        if (key.key !== "Enter" && key.key !== " ") return;
        key.preventDefault();
      }
      const cluster = (event as L.LeafletEvent & { layer: L.MarkerCluster }).layer;
      const children: L.Marker[] = cluster.getAllChildMarkers();
      const first = children[0].getLatLng();
      if (
        map.getZoom() === map.getMaxZoom() ||
        children.every((marker) => marker.getLatLng().equals(first, 0))
      ) {
        const members = new Set(children);
        setChoices(
          [...markersRef.current].filter(([, marker]) => members.has(marker)).map(([id]) => id),
        );
      } else cluster.zoomToBounds({ padding: [36, 36], animate: false });
    });
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: true, animate: false }));
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      map.off("moveend zoomend resize", visibilityChanged);
      map.remove();
      markersRef.current.clear();
      mapRef.current = null;
      groupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!preview) return;
    const map = mapRef.current!;
    const circles = L.layerGroup().addTo(map);
    for (const place of places) {
      if (place.value.accuracy !== null && place.value.accuracy > 0)
        L.circle(point(place), {
          radius: place.value.accuracy,
          className: "place-accuracy-radius",
          color: "#167b9b",
          weight: 1.5,
          opacity: 0.6,
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(circles);
    }
    fit();
    return () => {
      circles.remove();
    };
  }, [dataKey, preview]);

  useEffect(() => {
    const group = groupRef.current!;
    const { places, categoryColor, onSelect } = live();
    group.clearLayers();
    markersRef.current.clear();
    const markers = places.map((place) => {
      const pin = document.createElement("span");
      pin.className = `places-map-dot ${categoryColor(place.value.categoryId)}`;
      const marker = L.marker(point(place), {
        title: place.value.name,
        alt: place.value.name,
        keyboard: !preview,
        interactive: !preview,
        icon: L.divIcon({
          html: pin,
          className: "places-map-pin",
          iconSize: [48, 48],
          iconAnchor: [24, 24],
        }),
      });
      marker.on("click keypress", (event: L.LeafletEvent) => {
        if (event.type === "keypress") {
          const key = (event as L.LeafletKeyboardEvent).originalEvent;
          if (key.key !== "Enter" && key.key !== " ") return;
          key.preventDefault();
        }
        setChoices([]);
        onSelect(place.id);
      });
      marker.on("add", () => {
        const active = place.id === live().selected;
        marker.getElement()?.classList.toggle("is-selected", active);
        marker.getElement()?.setAttribute("aria-pressed", String(active));
      });
      markersRef.current.set(place.id, marker);
      return marker;
    });
    group.addLayers(markers);
    updateVisibility();
  }, [dataKey]);

  useEffect(() => {
    setChoices([]);
    fit();
  }, [fitKey]);
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const element = marker.getElement();
      element?.classList.toggle("is-selected", id === selected);
      element?.setAttribute("aria-pressed", String(id === selected));
    }
  }, [selected, dataKey]);
  const focusPlace = useEffectEvent(() => {
    const place = places.find((place) => place.id === focusId);
    if (place) {
      mapRef.current?.setView(point(place), 15, { animate: false });
      container.current?.scrollIntoView({ block: "center", behavior: "instant" });
    }
  });
  useEffect(() => {
    if (focusId) focusPlace();
  }, [focusId, focusRequest]);

  return (
    <section
      className={`places-map-section${preview ? " places-map-preview" : ""}`}
      aria-label={t(preview ? "mapPreview" : "mapView")}
    >
      <div className="map-toolbar sr-only" aria-live="polite">
        <p>
          {places.length} {t(places.length === 1 ? "mapPlace" : "mapPlaces")}
        </p>
      </div>
      {(offline || tileFailed) && (
        <p className="map-warning" role="status">
          {t(preview ? "mapPreviewUnavailable" : "mapBackgroundUnavailable")}
        </p>
      )}
      <div className="map-frame">
        <div
          ref={container}
          className="places-map"
          aria-label={t(preview ? "mapPreview" : "mapInstructions")}
        />
        {!preview && !allVisible && (
          <button
            className="button outline map-show-all"
            onClick={() => {
              fitPlaces(mapRef.current, places);
              mapRef.current?.getContainer().focus({ preventScroll: true });
            }}
          >
            {t("showAllPlaces")}
          </button>
        )}
      </div>
      {choiceRecords.length > 0 && (
        <Sheet title={t("choosePlace")} closeLabel={t("close")} onClose={() => setChoices([])}>
          <div className="stack">
            {choiceRecords.map((place) => (
              <button
                key={place.id}
                className="button outline"
                onClick={() => {
                  setChoices([]);
                  onSelect(place.id);
                }}
              >
                {place.value.name}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  );
}
