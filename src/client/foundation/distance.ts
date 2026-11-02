export type DistanceUnits = "metric" | "imperial";
type Coordinates = { latitude: number; longitude: number };

export function distanceMetres(a: Coordinates, b: Coordinates) {
  const radians = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * radians) / 2) ** 2 +
    Math.cos(a.latitude * radians) *
      Math.cos(b.latitude * radians) *
      Math.sin(((b.longitude - a.longitude) * radians) / 2) ** 2;

  return 6371000 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export const formatAccuracy = (metres: number, units: DistanceUnits) => {
  const value = units === "imperial" ? metres / 0.3048 : metres;
  // Ignore conversion noise within one floating-point rounding step.
  const adjusted = units === "imperial" ? value - Number.EPSILON * Math.abs(value) : value;

  return `±${Math.ceil(adjusted)} ${units === "imperial" ? "ft" : "m"}`;
};
