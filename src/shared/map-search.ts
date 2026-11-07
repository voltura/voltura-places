import { z } from "zod";

export const mapSearchLimit = 10;
export const mapSearchQuery = z.string().trim().min(1).max(160);
export const mapSearchResults = z
  .array(
    z.object({
      id: z.string().min(1).max(160),
      name: z.string().trim().min(1).max(160),
      municipality: z.string().trim().max(160),
      county: z.string().trim().max(160),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    }),
  )
  .max(mapSearchLimit);

export type MapSearchResult = z.infer<typeof mapSearchResults>[number];
