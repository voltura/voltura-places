import { expect, test } from "vitest";
import { distanceMetres } from "../src/client/foundation/distance";

test("straight-line distance handles zero, the date line and antipodes", () => {
  const origin = { latitude: 0, longitude: 0 };
  expect(distanceMetres(origin, origin)).toBe(0);
  expect(distanceMetres(origin, { latitude: 1, longitude: 0 })).toBeCloseTo(111195, 0);
  expect(
    distanceMetres({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 }),
  ).toBeCloseTo(22239, 0);
  expect(distanceMetres(origin, { latitude: 0, longitude: 180 })).toBeCloseTo(Math.PI * 6371000);
});
