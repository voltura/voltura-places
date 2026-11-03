import { z } from "zod";
import { digest } from "./digest";

export const ROUTE_POINTS = 10_000;
export const ROUTE_BYTES = 1024 * 1024;
export const ROUTE_QUOTA = 25 * ROUTE_BYTES;
export const geometryIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
// Compact canonical points: latitude, longitude, timestamp, accuracy in metres.
export const routePointSchema = z.tuple([
  z.number().finite().min(-90).max(90),
  z.number().finite().min(-180).max(180),
  z.number().int().min(0).max(8640000000000000),
  z.number().finite().min(0).max(100),
]);
export type RoutePoint = z.infer<typeof routePointSchema>;
export const geometrySchema = z
  .object({
    version: z.literal(1),
    segments: z.array(z.array(routePointSchema).min(1).max(ROUTE_POINTS)).min(1).max(ROUTE_POINTS),
  })
  .strict();
export type RouteGeometry = z.infer<typeof geometrySchema>;
export const routeBoundsSchema = z
  .object({
    south: z.number().finite().min(-90).max(90),
    north: z.number().finite().min(-90).max(90),
    west: z.number().finite().min(-180).max(180),
    east: z.number().finite().min(-180).max(180),
  })
  .strict();

export function routeDistance(a: RoutePoint, b: RoutePoint) {
  const radians = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * radians) / 2) ** 2 +
    Math.cos(a[0] * radians) *
      Math.cos(b[0] * radians) *
      Math.sin(((b[1] - a[1]) * radians) / 2) ** 2;

  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function geometrySummary(geometry: RouteGeometry) {
  let pointCount = 0;
  let distance = 0;
  const bounds = { south: 90, north: -90, west: 180, east: -180 };
  for (const segment of geometry.segments) {
    let previous: RoutePoint | undefined;
    for (const point of segment) {
      pointCount++;
      bounds.south = Math.min(bounds.south, point[0]);
      bounds.north = Math.max(bounds.north, point[0]);
      bounds.west = Math.min(bounds.west, point[1]);
      bounds.east = Math.max(bounds.east, point[1]);
      if (previous) {
        distance += routeDistance(previous, point);
      }
      previous = point;
    }
  }
  const first = geometry.segments[0][0];

  return {
    pointCount,
    distance,
    bounds,
    latitude: first[0],
    longitude: first[1],
    accuracy: first[3],
  };
}

export async function canonicalGeometry(input: unknown) {
  // Bound work before Zod walks attacker-controlled arrays.
  const segments = (input as Partial<RouteGeometry> | null)?.segments;
  if (!Array.isArray(segments) || segments.length > ROUTE_POINTS) {
    throw new Error("invalidGeometry");
  }
  let count = 0;
  for (const segment of segments) {
    if (!Array.isArray(segment) || (count += segment.length) > ROUTE_POINTS) {
      throw new Error("invalidGeometry");
    }
  }
  if (count < 2) {
    throw new Error("invalidGeometry");
  }
  const geometry = geometrySchema.parse(input);
  const canonical = JSON.stringify(geometry);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (bytes > ROUTE_BYTES) {
    throw new Error("invalidGeometry");
  }

  return {
    geometry,
    canonical,
    bytes,
    id: await digest(canonical),
    summary: geometrySummary(geometry),
  };
}

export function acceptedRouteFix(
  position: Pick<GeolocationPosition, "coords" | "timestamp">,
  interval: number,
  now: number,
): RoutePoint | null {
  const { latitude, longitude, accuracy } = position.coords;
  const point = routePointSchema.safeParse([
    latitude,
    longitude,
    Math.round(position.timestamp),
    accuracy,
  ]);

  return point.success &&
    now - position.timestamp <= interval * 1000 &&
    position.timestamp <= now + 5000
    ? point.data
    : null;
}
