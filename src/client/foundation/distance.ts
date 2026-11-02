export type DistanceUnits = "metric" | "imperial";
type Coordinates = { latitude: number; longitude: number };

export function distanceMetres(a: Coordinates, b: Coordinates) {
  const radians = Math.PI / 180;
  const longitudeDelta = b.longitude - a.longitude;
  if (a.latitude === b.latitude && (longitudeDelta % 360 === 0 || Math.abs(a.latitude) === 90)) {
    return 0;
  }
  const h =
    Math.sin(((b.latitude - a.latitude) * radians) / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(((b.longitude - a.longitude) * radians) / 2) ** 2;

  return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export const formatAccuracy = (metres: number, units: DistanceUnits) => {
  const value = units === "imperial" ? metres / 0.3048 : metres;
  // Compare the radius in metres to preserve exact feet without rounding
  // a genuinely larger radius down.
  const nearest = Math.round(value);
  const rounded =
    units === "imperial" ? nearest + Number(metres > nearest * 0.3048) : Math.ceil(value);

  return `±${rounded} ${units === "imperial" ? "ft" : "m"}`;
};
