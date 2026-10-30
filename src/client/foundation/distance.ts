export type DistanceUnits = "metric" | "imperial";
export const formatAccuracy = (metres: number, units: DistanceUnits) => {
  const value = units === "imperial" ? metres / 0.3048 : metres;
  // Ignore conversion noise within one floating-point rounding step.
  const adjusted = units === "imperial" ? value - Number.EPSILON * Math.abs(value) : value;
  return `±${Math.ceil(adjusted)} ${units === "imperial" ? "ft" : "m"}`;
};
