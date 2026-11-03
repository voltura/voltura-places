import { useContext, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { PlaceRecord } from "../../shared/model";
import type { RouteGeometry } from "../../shared/routes";
import type { FollowLocation } from "../foundation/route-following";
import type { Message } from "../foundation/i18n";
import { longitudeArcStart, wrapLongitude } from "../foundation/map-coordinates";
import { MapBackgroundContext } from "./MapBackgroundContext";
import { mapBackgroundLayers } from "./map-background-layers";
import { routeLayers } from "./route-layers";

export default function FollowRouteMap({
  record,
  geometry,
  location,
  categoryColor,
  t,
}: {
  retryMap: () => void;
  record: PlaceRecord;
  geometry: RouteGeometry;
  location: FollowLocation;
  categoryColor: (id: string) => string;
  t: (key: Message) => string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const currentLayer = useRef<L.LayerGroup | null>(null);
  const initialFit = useRef(false);
  const centring = useRef(true);
  const [centred, setCentred] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [failed, setFailed] = useState(false);
  const background = useContext(MapBackgroundContext);
  const { points, longitude, routeCenter } = useMemo(() => {
    const points = geometry.segments.flat();
    const longitude = longitudeArcStart(points.map((p) => p[1]));
    let west = Infinity;
    let east = -Infinity;
    for (const point of points) {
      const value = wrapLongitude(point[1], longitude);
      west = Math.min(west, value);
      east = Math.max(east, value);
    }

    return { points, longitude, routeCenter: (west + east) / 2 };
  }, [geometry]);

  const positionLongitude = (value: number) =>
    value + 360 * Math.round((routeCenter - value) / 360);

  const fit = () => {
    if (!map.current) {
      return;
    }
    const bounds = L.latLngBounds(
      points.map(
        (p) =>
          [
            Math.max(-85.05112878, Math.min(85.05112878, p[0])),
            wrapLongitude(p[1], longitude),
          ] as L.LatLngTuple,
      ),
    );
    if (location.position) {
      bounds.extend([
        Math.max(-85.05112878, Math.min(85.05112878, location.position.coords.latitude)),
        positionLongitude(location.position.coords.longitude),
      ]);
    }
    map.current.fitBounds(bounds, { maxZoom: 16, padding: [40, 40], animate: false });
  };

  useEffect(() => {
    const instance = L.map(container.current!, {
      zoomControl: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([record.value.latitude, record.value.longitude], 15);
    instance.attributionControl.setPrefix(false);
    map.current = instance;
    instance.createPane("follow-location").style.zIndex = "650";
    currentLayer.current = L.layerGroup().addTo(instance);

    const pause = () => {
      centring.current = false;
      setCentred(false);
    };

    const wheel = (event: WheelEvent) => {
      if (event.deltaY) {
        pause();
      }
    };

    const key = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "+", "-", "="].includes(event.key)) {
        pause();
      }
    };

    const click = (event: MouseEvent) => {
      if ((event.target as Element).closest(".leaflet-control-zoom")) {
        pause();
      }
    };

    const touch = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        pause();
      }
    };

    instance.on("dragstart dblclick", pause);
    const surface = container.current!;
    surface.addEventListener("wheel", wheel);
    surface.addEventListener("keydown", key);
    surface.addEventListener("click", click, true);
    surface.addEventListener("touchmove", touch);
    const observer = new ResizeObserver(() => {
      const center = instance.getCenter();
      instance.invalidateSize({ pan: false });
      instance.panTo(center, { animate: false });
    });
    observer.observe(surface);
    fit();

    return () => {
      observer.disconnect();
      surface.removeEventListener("wheel", wheel);
      surface.removeEventListener("keydown", key);
      surface.removeEventListener("click", click, true);
      surface.removeEventListener("touchmove", touch);
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(
    () => mapBackgroundLayers(map.current!, background, setOffline, setFailed),
    [background],
  );
  useEffect(
    () =>
      routeLayers(
        map.current!,
        "guest",
        [record],
        record.id,
        categoryColor,
        () => {},
        { start: t("routeStartMarker"), end: t("routeEndMarker") },
        false,
        record.kind === "route" ? { [record.value.geometryId]: geometry } : undefined,
        false,
        true,
      ),
    [record, geometry, categoryColor, t],
  );
  useEffect(() => {
    const instance = map.current!;
    const layer = currentLayer.current!;
    layer.clearLayers();
    const position = location.position;
    if (!position) {
      return;
    }
    const coords: L.LatLngTuple = [
      Math.max(-85.05112878, Math.min(85.05112878, position.coords.latitude)),
      positionLongitude(position.coords.longitude),
    ];
    L.circle(coords, {
      radius: position.coords.accuracy,
      color: "#1479ce",
      weight: 1,
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(layer);
    L.circleMarker(coords, {
      pane: "follow-location",
      radius: 8,
      color: "#fff",
      weight: 3,
      fillColor: "#1479ce",
      fillOpacity: 1,
      className: "follow-current-position",
    })
      .bindTooltip(t("followLive"))
      .addTo(layer);
    if (!initialFit.current) {
      initialFit.current = true;
      if (centring.current) {
        fit();
      }
    } else if (centring.current) {
      instance.panTo(coords, { animate: false });
    }
  }, [location.position, t]);

  return (
    <div className="follow-route-map">
      {(offline || failed) && (
        <p className="map-warning" role="status">
          {t("mapBackgroundUnavailable")}
        </p>
      )}
      <div ref={container} className="places-map" aria-label={t("mapInstructions")} />
      <div className="follow-route-controls">
        <button
          className="button outline"
          aria-pressed={centred}
          disabled={!location.position}
          onClick={() => {
            centring.current = true;
            setCentred(true);
            const p = location.position!;
            map.current?.panTo(
              [
                Math.max(-85.05112878, Math.min(85.05112878, p.coords.latitude)),
                positionLongitude(p.coords.longitude),
              ],
              { animate: false },
            );
          }}
        >
          {t("followRecentre")}
        </button>
        <button
          className="button outline"
          onClick={() => {
            centring.current = false;
            setCentred(false);
            fit();
          }}
        >
          {t("followShowRoute")}
        </button>
      </div>
    </div>
  );
}
