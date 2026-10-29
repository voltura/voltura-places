import { z } from "zod";

export const idSchema = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
export const categorySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    color: z.enum(["green", "blue", "amber", "purple", "slate"]),
    builtIn: z.string().max(30).optional(),
  })
  .strict();
export const placeSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    categoryId: idSchema,
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().min(0).max(10000000).nullable(),
    capturedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Place = z.infer<typeof placeSchema>;
export type Category = z.infer<typeof categorySchema>;
export const entitySchema = z.discriminatedUnion("kind", [
  z.object({ id: idSchema, kind: z.literal("place"), value: placeSchema }),
  z.object({ id: idSchema, kind: z.literal("category"), value: categorySchema }),
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
  records: z.array(recordSchema).max(250),
  nextCursor: z.string().nullable().optional(),
});
export type LocalRecord = RecordState & {
  generation: number;
  dirty: boolean;
  conflict?: RecordState;
};
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
    version: z.literal(1),
    exportedAt: z.string().datetime(),
    places: z.array(z.object({ id: idSchema, value: placeSchema }).strict()).max(5000),
    categories: z.array(z.object({ id: idSchema, value: categorySchema }).strict()).max(200),
  })
  .strict()
  .superRefine((b, ctx) => {
    const ids = [...b.places, ...b.categories].map((x) => x.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate identifiers" });
    const cats = new Set(b.categories.map((x) => x.id));
    if (!cats.has("other") || b.places.some((p) => !cats.has(p.value.categoryId)))
      ctx.addIssue({ code: "custom", message: "Missing category" });
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
  { id: "other", kind: "category", value: { name: "Other", color: "slate", builtIn: "other" } },
];
export function mapURL(provider: string, p: Pick<Place, "latitude" | "longitude" | "name">) {
  const coordinates = `${p.latitude},${p.longitude}`;
  if (provider === "apple")
    return `https://maps.apple.com/?ll=${encodeURIComponent(coordinates)}&q=${encodeURIComponent(p.name)}`;
  if (provider === "geo") return `geo:0,0?q=${encodeURIComponent(`${coordinates}(${p.name})`)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinates)}`;
}
export const shareSchema = z
  .object({
    version: z.literal(1),
    name: placeSchema.shape.name,
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
  if (!hash.startsWith("#place=") || hash.length > 4096) return null;
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
export function validateBackup(input: unknown) {
  return backupSchema.parse(input);
}
