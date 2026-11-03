import type { RouteGeometry } from "../../shared/routes";
import L from "leaflet";
import { loadGeometry } from "../foundation/route-geometry";
import { longitudeArcStart, wrapLongitude } from "../foundation/map-coordinates";
import type { PlaceRecord } from "../../shared/model";

export function routeLayers(
  map: L.Map,
  workspace: string,
  records: PlaceRecord[],
  selected: string | null,
  categoryColor: (id: string) => string,
  onSelect: (id: string) => void,
  labels: { start: string; end: string },
  recording: boolean,
  provided?: Record<string, RouteGeometry>,
) {
  const layer = L.layerGroup().addTo(map);
  let generation = 0;
  let disposed = false;
  let fitted = false;

  const markerFor = (
    route: PlaceRecord,
    point: readonly number[],
    finish: boolean,
    start: number,
  ) => {
    const label = document.createElement("span");
    label.textContent = finish ? (recording ? "●" : "■") : "▶";
    label.className = `route-endpoint ${recording && finish ? "route-current" : ""} ${categoryColor(route.value.categoryId)}`;
    const name = `${finish ? labels.end : labels.start}${route.value.name ? `: ${route.value.name}` : ""}`;
    const marker = L.marker(
      [Math.max(-85.05112878, Math.min(85.05112878, point[0])), wrapLongitude(point[1], start)],
      {
        title: name,
        alt: name,
        icon: L.divIcon({
          html: label,
          className: "route-marker",
          iconSize: [24, 24],
          iconAnchor: finish ? [-3, 12] : route.id === selected ? [27, 12] : [12, 12],
        }),
      },
    )
      .on("click", () => onSelect(route.id))
      .addTo(layer);
    marker.getElement()?.setAttribute("aria-label", name);
  };

  const render = async () => {
    const version = ++generation;
    layer.clearLayers();
    const view = map.getBounds();
    const routes = records.filter(
      (r) =>
        r.kind === "route" &&
        (r.id === selected ||
          (r.value.bounds.north >= view.getSouth() &&
            r.value.bounds.south <= view.getNorth() &&
            (r.value.bounds.east - r.value.bounds.west > 180 ||
              [-360, 0, 360].some(
                (offset) =>
                  r.value.bounds.east + offset >= view.getWest() &&
                  r.value.bounds.west + offset <= view.getEast(),
              )))),
    );
    let index = 0;

    const current = () => !disposed && generation === version;

    const worker = async () => {
      while (index < routes.length && current()) {
        const route = routes[index++];
        if (route.kind !== "route") {
          continue;
        }
        if (route.id !== selected) {
          markerFor(
            route,
            [route.value.latitude, route.value.longitude],
            false,
            map.getCenter().lng - 180,
          );
          continue;
        }
        try {
          const geometry =
            provided?.[route.value.geometryId] ??
            (await loadGeometry(workspace, route.value.geometryId, current));
          if (!current()) {
            return;
          }
          const all = geometry.segments.flat();
          const start = longitudeArcStart(all.map((p) => p[1]));
          const bounds = L.latLngBounds([]);
          for (const segment of geometry.segments) {
            const points: L.LatLngTuple[] = [];
            for (let i = 0; i < segment.length; i++) {
              const p = segment[i];
              const point: L.LatLngTuple = [
                Math.max(-85.05112878, Math.min(85.05112878, p[0])),
                wrapLongitude(p[1], start),
              ];
              bounds.extend(point);
              points.push(point);
            }
            if (points.length > 1) {
              L.polyline(points, {
                className: `route-line ${categoryColor(route.value.categoryId)}`,
                weight: 5,
                opacity: 1,
              })
                .on("click", () => onSelect(route.id))
                .addTo(layer);
            }
          }
          for (const [finish, p] of [
            [false, all[0]],
            [true, all.at(-1)!],
          ] as const) {
            if (recording && finish && all.length === 1) {
              continue;
            }
            markerFor(route, p, finish, start);
          }
          if (!fitted && bounds.isValid()) {
            fitted = true;
            map.fitBounds(bounds, { maxZoom: 16, padding: [36, 36], animate: false });
          }
        } catch {
          if (current()) {
            markerFor(
              route,
              [route.value.latitude, route.value.longitude],
              false,
              map.getCenter().lng - 180,
            );
          }
        }
      }
    };

    await Promise.all([worker(), worker(), worker()]);
  };

  const changed = () => {
    void render();
  };

  map.on("moveend", changed);
  window.addEventListener("online", changed);
  changed();

  return () => {
    disposed = true;
    generation++;
    map.off("moveend", changed);
    window.removeEventListener("online", changed);
    layer.remove();
  };
}
