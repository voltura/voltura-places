import { geometryIdSchema, routeBoundsSchema, ROUTE_POINTS } from "./routes";
import { entityLimits, syncLimits } from "./limits";
import { z } from "zod";
import { decodePhoto, encodedPhotoSize, PHOTO_QUOTA } from "./photos";

export const idSchema = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
export const categoryIcons = [
  "pin",
  "none",
  "car",
  "utensils",
  "trees",
  "house",
  "mushroom",
  "coffee",
  "tent",
  "fish",
  "camera",
  "heart",
  "star",
  "dog",
  "bike",
  "boat",
  "shopping",
  "flag",
  "flower",
  "mountain",
  "waves",
  "book",
  "music",
  "plane",
  "wrench",
  "footprints",
  "route",
  "binoculars",
  "bird",
  "cat",
  "leaf",
  "sun",
  "snowflake",
  "flame",
  "water",
  "palm",
  "castle",
  "church",
  "landmark",
  "hospital",
  "bed",
  "store",
  "fuel",
  "train",
  "bus",
  "ship",
  "dumbbell",
  "volleyball",
  "wine",
  "icecream",
] as const;
export const categoryColors = [
  "green",
  "blue",
  "amber",
  "purple",
  "rose",
  "slate",
  "red",
  "orange",
  "yellow",
  "lime",
  "teal",
  "cyan",
] as const;
export const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    names: z
      .object({
        en: z.string().trim().min(1).max(60).optional(),
        sv: z.string().trim().min(1).max(60).optional(),
      })
      .strict()
      .refine((names) => !!(names.en || names.sv))
      .optional(),
    color: z.enum(categoryColors),
    icon: z.enum(categoryIcons).optional(),
    builtIn: z.string().max(30).optional(),
  })
  .strict();
export const placeSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    categoryId: idSchema,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().min(0).max(10000000).nullable(),
    capturedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    photoId: z.string().uuid().nullable().optional(),
  })
  .strict();
export const routeSchema = placeSchema
  .extend({
    geometryId: geometryIdSchema,
    startedAt: z.string().datetime(),
    stoppedAt: z.string().datetime(),
    duration: z.number().finite().min(0),
    distance: z.number().finite().min(0),
    pointCount: z.number().int().min(2).max(ROUTE_POINTS),
    bounds: routeBoundsSchema,
  })
  .refine(
    (route) =>
      Date.parse(route.stoppedAt) >= Date.parse(route.startedAt) &&
      Date.parse(route.stoppedAt) - Date.parse(route.startedAt) === route.duration,
  );
export type Route = z.infer<typeof routeSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Category = z.infer<typeof categorySchema>;
export const visitStatusSchema = z.enum(["none", "want", "visited"]);
export type VisitStatus = z.infer<typeof visitStatusSchema>;
export const visitSchema = z
  .object({
    placeId: idSchema,
    libraryId: z.string().uuid().nullable(),
    status: visitStatusSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();
export const entitySchema = z.discriminatedUnion("kind", [
  z.object({ id: idSchema, kind: z.literal("place"), value: placeSchema }),
  z.object({ id: idSchema, kind: z.literal("route"), value: routeSchema }),
  z.object({ id: idSchema, kind: z.literal("category"), value: categorySchema }),
  z.object({ id: idSchema, kind: z.literal("visit"), value: visitSchema }),
]);
export type Entity = z.infer<typeof entitySchema>;
export type RecordState = Entity & { revision: number; deleted: boolean };
export const recordSchema = z.intersection(
  entitySchema,
  z.object({ revision: z.number().int().min(0), deleted: z.boolean() }),
);
export const snapshotSchema = z.object({
  version: z.literal(1),
  accountId: z.string(),
  records: z.array(recordSchema).max(syncLimits.pageSize),
  nextCursor: z.string().nullable().optional(),
});
export type LocalRecord = RecordState & {
  generation: number;
  dirty: boolean;
  conflict?: RecordState;
};
export type PlaceRecord = Extract<LocalRecord, { kind: "place" | "route" }>;

export const mutationSchema = z
  .object({
    version: z.literal(1),
    mutationId: z.string().uuid(),
    baseRevision: z.number().int().min(0),
    deleted: z.boolean(),
    entity: entitySchema,
  })
  .strict();
export type Mutation = z.infer<typeof mutationSchema>;
export const backupSchema = z
  .object({
    format: z.literal("voltura-places"),
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    routes: z
      .array(z.object({ id: idSchema, value: routeSchema }).strict())
      .max(entityLimits.place)
      .optional(),
    geometry: z
      .array(z.object({ id: geometryIdSchema, data: z.string().max(1024 * 1024) }).strict())
      .max(entityLimits.place)
      .optional(),
    photos: z
      .array(z.object({ id: z.string().uuid(), data: z.string().max(350000) }).strict())
      .max(1000)
      .optional(),
    exportedAt: z.string().datetime(),
    places: z
      .array(z.object({ id: idSchema, value: placeSchema }).strict())
      .max(entityLimits.place),
    categories: z
      .array(z.object({ id: idSchema, value: categorySchema }).strict())
      .max(entityLimits.category),
    visits: z
      .array(z.object({ placeId: idSchema, status: visitStatusSchema }).strict())
      .max(entityLimits.place)
      .optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const locations = [...b.places, ...(b.routes ?? [])];
    if (
      locations.length > entityLimits.place ||
      (b.version !== 3 && (b.routes?.length || b.geometry?.length))
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid routes" });
    }
    const ids = [...locations, ...b.categories].map((x) => x.id);
    if (ids.some((id) => id.startsWith("visit-"))) {
      ctx.addIssue({ code: "custom", message: "Reserved identifier" });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "Duplicate identifiers" });
    }
    const cats = new Set(b.categories.map((x) => x.id));
    if (!cats.has("other") || locations.some((p) => !cats.has(p.value.categoryId))) {
      ctx.addIssue({ code: "custom", message: "Missing category" });
    }
    const placeIds = new Set(locations.map((p) => p.id));
    if (
      new Set(b.visits?.map((v) => v.placeId)).size !== (b.visits?.length ?? 0) ||
      b.visits?.some((v) => !placeIds.has(v.placeId))
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid personal statuses" });
    }
  });
export type Backup = z.infer<typeof backupSchema>;
export const starters: Entity[] = [
  {
    id: "parking",
    kind: "category",
    value: { name: "Parking", color: "blue", builtIn: "parking" },
  },
  {
    id: "food",
    kind: "category",
    value: { name: "Food & drink", color: "amber", builtIn: "food" },
  },
  {
    id: "outdoors",
    kind: "category",
    value: { name: "Outdoors", color: "green", builtIn: "outdoors" },
  },
  {
    id: "accommodation",
    kind: "category",
    value: { name: "Accommodation", color: "purple", builtIn: "accommodation" },
  },
  {
    id: "mushrooms",
    kind: "category",
    value: { name: "Mushrooms", color: "amber", builtIn: "mushrooms" },
  },
  {
    id: "route",
    kind: "category",
    value: { name: "Route", color: "green", builtIn: "route" },
  },
  { id: "other", kind: "category", value: { name: "Other", color: "slate", builtIn: "other" } },
];

// geo: URIs require decimal degrees. String(number) switches to exponent
// notation below 0.000001, which map apps may interpret as a text search.
const coordinateText = (value: number) => {
  const text = String(value);
  const exponent = text.indexOf("e-");
  if (exponent < 0) {
    return text;
  }
  const digits = text.slice(value < 0 ? 1 : 0, exponent).replace(".", "");

  return `${value < 0 ? "-" : ""}0.${"0".repeat(Number(text.slice(exponent + 2)) - 1)}${digits}`;
};

const coordinatePair = (place: Pick<Place, "latitude" | "longitude">) =>
  `${coordinateText(place.latitude)},${coordinateText(place.longitude)}`;

export function mapURL(provider: string, p: Pick<Place, "latitude" | "longitude" | "name">) {
  const coordinates = coordinatePair(p);
  if (provider === "apple") {
    return `https://maps.apple.com/?${new URLSearchParams({ ll: coordinates, q: p.name })}`;
  }
  if (provider === "geo") {
    return `geo:0,0?${new URLSearchParams({ q: `${coordinates}(${p.name})` }).toString().replaceAll("+", "%20")}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
}

export type MapAction = "show" | "navigate";

export function directionsURL(
  provider: "google" | "apple",
  p: Pick<Place, "latitude" | "longitude">,
) {
  const destination = encodeURIComponent(coordinatePair(p));

  return provider === "apple"
    ? `https://maps.apple.com/directions?destination=${destination}`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}&dir_action=navigate`;
}

export const shareSchema = z
  .object({
    version: z.literal(1),
    name: placeSchema.shape.name,
    description: placeSchema.shape.description,
    category: categorySchema.shape.name,
    latitude: placeSchema.shape.latitude,
    longitude: placeSchema.shape.longitude,
  })
  .strict();

export function shareURL(p: Place, category: string, origin: string) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      name: p.name,
      ...(p.description ? { description: p.description } : {}),
      category,
      latitude: p.latitude,
      longitude: p.longitude,
    }),
  );

  return `${origin}/#place=${btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")}`;
}

export function parseShare(hash: string) {
  if (!hash.startsWith("#place=") || hash.length > 12288) {
    return null;
  }
  try {
    return shareSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(hash.slice(7).replaceAll("-", "+").replaceAll("_", "/")), (c) =>
            c.charCodeAt(0),
          ),
        ),
      ),
    );
  } catch {
    return null;
  }
}

export function parseBackupManifest(input: unknown) {
  // Array validators collect element errors even when the array already exceeds
  // the protocol limit. Reject impossible cardinalities before walking elements.
  if (input && typeof input === "object") {
    const candidate = input as Record<string, unknown>;
    for (const [field, limit] of Object.entries({
      places: entityLimits.place,
      routes: entityLimits.place,
      geometry: entityLimits.place,
      categories: entityLimits.category,
      visits: entityLimits.place,
      photos: 1000,
    })) {
      const rows = candidate[field];
      if (Array.isArray(rows) && rows.length > limit) {
        throw new Error("invalidImport");
      }
    }
  }
  const backup = backupSchema.parse(input);
  const photos = backup.photos ?? [];
  const needed = new Set(
    [...backup.places, ...(backup.routes ?? [])].flatMap((p) =>
      p.value.photoId ? [p.value.photoId] : [],
    ),
  );
  if (
    (photos.length && backup.version === 1) ||
    new Set(photos.map((p) => p.id)).size !== photos.length ||
    photos.length !== needed.size ||
    photos.some((p) => !needed.has(p.id))
  ) {
    throw new Error("invalidImport");
  }
  let bytes = 0;
  for (const p of photos) {
    bytes += encodedPhotoSize(p.data);
    if (bytes > PHOTO_QUOTA) {
      throw new Error("photoQuota");
    }
  }

  return backup;
}

export function validateBackup(input: unknown) {
  const backup = parseBackupManifest(input);
  for (const p of backup.photos ?? []) {
    decodePhoto(p.data);
  }

  return backup;
}
