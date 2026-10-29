export type DistanceUnits = "metric" | "imperial";
export const formatAccuracy = (metres: number, units: DistanceUnits) =>
  `±${Math.ceil(units === "imperial" ? metres / 0.3048 : metres)} ${units === "imperial" ? "ft" : "m"}`;
