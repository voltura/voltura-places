import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import L from "leaflet";
import { longitudeArcStart, wrapLongitude } from "../foundation/map-coordinates";
import { Maximize, Minimize } from "lucide-react";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import type { PlaceRecord } from "./PlaceDetails";
import type { Message } from "../foundation/i18n";
import { Sheet } from "../ui/Sheet";

type Props = {
  onExpand?: () => void;
  onBrowse?: () => void;
  fullscreen?: boolean;
  onFullscreenChange?: (value: boolean) => void;
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

// Keep the same children mounted while promoting the inline surface to the top layer.
function MapSurface({
  preview,
  fullscreen,
  onClose,
  label,
  children,
}: {
  preview: boolean;
  fullscreen: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const surface = dialog.current;
    if (!surface) return;
    if (fullscreen) {
      scroll.current = { x: window.scrollX, y: window.scrollY };
      surface.close();
      surface.showModal();
      surface
        .querySelector<HTMLButtonElement>(".map-fullscreen-toggle")
        ?.focus({ preventScroll: true });
    } else if (surface.matches(":modal")) {
      surface.close();
      surface.show();
      window.scrollTo(scroll.current.x, scroll.current.y);
      surface
        .querySelector<HTMLButtonElement>(".map-fullscreen-toggle")
        ?.focus({ preventScroll: true });
    }
  }, [fullscreen]);
  if (preview) return children;
  return (
    <dialog
      ref={dialog}
      open
      className={`map-surface${fullscreen ? " is-fullscreen" : ""}`}
      role={fullscreen ? "dialog" : "region"}
      aria-label={label}
      aria-modal={fullscreen ? true : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

// Web Mercator cannot display the poles. Keep the stored destination unchanged.
function point(place: PlaceRecord, start = -180): L.LatLngTuple {
  return [
    Math.max(-85.05112878, Math.min(85.05112878, place.value.latitude)),
    wrapLongitude(place.value.longitude, start),
  ];
}
function fitPlaces(map: L.Map | null, places: PlaceRecord[], preview = false) {
  if (!map || !places.length) return;
  const start = longitudeArcStart(places.map((p) => p.value.longitude));
  const bounds = L.latLngBounds(places.map((p) => point(p, start)));
  if (preview) {
    for (const place of places) {
      if (place.value.accuracy !== null && place.value.accuracy > 0)
        bounds.extend(L.latLng(point(place, start)).toBounds(place.value.accuracy * 2));
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
  fullscreen = false,
  onFullscreenChange,
  onBrowse,
  onExpand,
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
  const start = useMemo(() => longitudeArcStart(places.map((p) => p.value.longitude)), [places]);
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
  const browsing = useEffectEvent(() => {
    if (!preview && !fullscreen) onBrowse?.();
  });
  const live = useEffectEvent(() => ({ places, categoryColor, t, onSelect, selected, start }));
  const updateVisibility = useEffectEvent(() => {
    const map = mapRef.current;
    if (!map || preview) return;
    const size = map.getSize();
    setAllVisible(
      places.every((place) => {
        const position = map.latLngToContainerPoint(point(place, start));
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
    // Drag is always user initiated; zoom/pan from fitBounds and resize must not hide UI.
    const userBrowse = () => browsing();
    const userKey = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "+", "-", "="].includes(event.key))
        browsing();
    };
    const userWheel = (event: WheelEvent) => {
      if (event.deltaY) browsing();
    };
    const userTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) browsing();
    };
    const userZoomButton = (event: MouseEvent) => {
      if ((event.target as Element).closest(".leaflet-control-zoom a")) browsing();
    };
    const surface = map.getContainer();
    map.on("dragstart", userBrowse);
    surface.addEventListener("keydown", userKey);
    surface.addEventListener("wheel", userWheel, { passive: true });
    surface.addEventListener("touchmove", userTouch, { passive: true });
    surface.addEventListener("click", userZoomButton, true);
    surface.addEventListener("dblclick", userBrowse);

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
      surface.removeEventListener("keydown", userKey);
      surface.removeEventListener("wheel", userWheel);
      surface.removeEventListener("touchmove", userTouch);
      surface.removeEventListener("click", userZoomButton, true);
      surface.removeEventListener("dblclick", userBrowse);
      map.off("dragstart", userBrowse);
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
        L.circle(point(place, start), {
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
    const { places, categoryColor, start } = live();
    group.clearLayers();
    markersRef.current.clear();
    const markers = places.map((place) => {
      const pin = document.createElement("span");
      pin.className = `places-map-dot ${categoryColor(place.value.categoryId)}`;
      const marker = L.marker(point(place, start), {
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
        live().onSelect(place.id);
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
      mapRef.current?.setView(point(place, start), 15, { animate: false });
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
      <MapSurface
        preview={preview}
        fullscreen={fullscreen}
        onClose={() => onFullscreenChange?.(false)}
        label={t("mapView")}
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
          {preview && onExpand && (
            <button
              type="button"
              className="icon-button map-preview-expand"
              aria-label={t("expandMap")}
              onClick={onExpand}
            >
              <Maximize aria-hidden="true" />
            </button>
          )}
          {!preview && (
            <div className="map-actions">
              <button
                type="button"
                className="icon-button map-fullscreen-toggle"
                aria-label={t(fullscreen ? "exitFullscreenMap" : "fullscreenMap")}
                aria-pressed={fullscreen}
                onClick={() => onFullscreenChange?.(!fullscreen)}
              >
                {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
              </button>
              {!allVisible && (
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
          )}
        </div>
      </MapSurface>
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
