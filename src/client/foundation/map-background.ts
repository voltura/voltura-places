import sweden from "./sweden-boundary.json";
import type { Preferences } from "./preferences";

function insideRing(longitude: number, latitude: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i];
    const [previousX, previousY] = ring[j];
    if (
      y > latitude !== previousY > latitude &&
      longitude < ((previousX - x) * (latitude - y)) / (previousY - y) + x
    ) {
      inside = !inside;
    }
  }

  return inside;
}

export function mapBackgroundAt(
  preference: Preferences["mapBackground"],
  latitude: number,
  longitude: number,
  zoom: number,
) {
  longitude = ((((longitude + 180) % 360) + 360) % 360) - 180;
  if (
    preference !== "naturkartan" ||
    zoom < 7 ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return "osm";
  }

  return sweden.coordinates.some(
    (polygon) =>
      insideRing(longitude, latitude, polygon[0]) &&
      !polygon.slice(1).some((hole) => insideRing(longitude, latitude, hole)),
  )
    ? "naturkartan"
    : "osm";
}
