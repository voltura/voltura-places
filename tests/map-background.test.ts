import { expect, test } from "vitest";
import { mapBackgroundAt } from "../src/client/foundation/map-background";
import { parsePreferences } from "../src/client/foundation/preferences";

test("Swedish terrain is opt-in and separate from the external navigation app", () => {
  expect(
    parsePreferences({ mapBackground: "naturkartan", provider: "apple" }, "", "sv"),
  ).toMatchObject({ mapBackground: "naturkartan", provider: "apple" });
  expect(parsePreferences({ mapBackground: "unknown" }, "", "sv").mapBackground).toBe("osm");
  expect(mapBackgroundAt("osm", 59.18, 18.25, 14)).toBe("osm");
});

test.each([
  [59.18, 18.25],
  [59.33, 18.06],
  [67.86, 20.22],
  [59.67, 12.65],
  [57.5, 18.5],
])("Swedish terrain at %s,%s", (latitude, longitude) => {
  expect(mapBackgroundAt("naturkartan", latitude, longitude, 14)).toBe("naturkartan");
  expect(mapBackgroundAt("naturkartan", latitude, longitude + 360, 14)).toBe("naturkartan");
  expect(mapBackgroundAt("naturkartan", latitude, longitude, 6)).toBe("osm");
});

test.each([
  [61, 9],
  [55.68, 12.57],
  [60.17, 24.94],
  [52.52, 13.4],
  [0, 0],
  [NaN, 18],
])("world coverage falls back at %s,%s", (latitude, longitude) => {
  expect(mapBackgroundAt("naturkartan", latitude, longitude, 14)).toBe("osm");
});
