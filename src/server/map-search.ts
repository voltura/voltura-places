import { z } from "zod";
import { digest } from "../shared/digest";
import {
  mapSearchLimit,
  mapSearchQuery,
  mapSearchResults,
  type MapSearchResult,
} from "../shared/map-search";
import { hasCanonicalOrigin, privateJSON as json, readBytes, readJSON, RequestError } from "./http";
import { fromSweref } from "./sweref";
import type { Environment } from "./types";

const tokenEndpoint = "https://apimanager.lantmateriet.se/oauth2/token";
const readScope = "ortnamn_direkt_read";
const searchEndpoint = "https://api.lantmateriet.se/distribution/produkter/ortnamn/v2.2/kriterier";
const tokenSchema = z.object({
  access_token: z
    .string()
    .max(4096)
    .regex(/^[A-Za-z0-9._~+/=-]+$/),
  token_type: z.string().refine((type) => type.toLowerCase() === "bearer"),
  expires_in: z.number().positive(),
});
const collection = z.object({
  type: z.literal("FeatureCollection"),
  crs: z
    .object({ properties: z.object({ name: z.literal("urn:ogc:def:crs:EPSG::3006") }) })
    .optional(),
  features: z.array(z.unknown()).max(mapSearchLimit),
});
const feature = z.object({
  type: z.literal("Feature"),
  id: z.union([z.string().min(1).max(140), z.number().int()]),
  properties: z.object({
    namn: z.string().trim().min(1).max(160),
    placering: z.array(z.unknown()).default([]),
  }),
});
const placement = z.object({
  kommunnamn: z.string().trim().max(160).nullish(),
  lannamn: z.string().trim().max(160).nullish(),
  punkt: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number().min(0).max(1200000), z.number().min(6000000).max(8000000)]),
  }),
});

export function mapSearchPlacements(value: unknown) {
  const results: MapSearchResult[] = [];
  const ids = new Set<string>();
  let rejectedPlacement = false;
  for (const item of collection.parse(value).features) {
    const { id, properties } = feature.parse(item);
    for (const [index, candidate] of properties.placering.entries()) {
      const result = placement.safeParse(candidate);
      if (!result.success) {
        rejectedPlacement = true;
        continue;
      }
      const placementId = `${id}:${index}`;
      if (ids.has(placementId)) {
        throw new Error("Duplicate place-name placement.");
      }
      ids.add(placementId);
      const [easting, northing] = result.data.punkt.coordinates;
      results.push({
        id: placementId,
        name: properties.namn,
        municipality: result.data.kommunnamn ?? "",
        county: result.data.lannamn ?? "",
        ...fromSweref(easting, northing),
      });
      if (results.length === mapSearchLimit) {
        return mapSearchResults.parse(results);
      }
    }
  }
  if (!results.length && rejectedPlacement) {
    throw new Error("Invalid place-name placements.");
  }

  return mapSearchResults.parse(results);
}

async function upstreamJSON(response: Response, limit: number) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new RequestError(response.status === 429 ? 429 : 503, "serviceUnavailable");
  }

  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(response, limit)),
  ) as unknown;
}

async function takeSearchQuota(env: Environment, address: string) {
  const client = "map-search:" + (await digest(`${env.AUTH_SECRET}\n${address}`));
  const global = "map-search:global";
  // SQLite uses one clock for the check and both counter updates.
  const result = await env.DB.prepare(`
    INSERT INTO auth_rate_limit (id, key, count, lastRequest)
    SELECT column1, column1, 1, (unixepoch() / 60) * 60000 FROM (VALUES (?), (?))
    WHERE NOT EXISTS (
      SELECT 1 FROM auth_rate_limit WHERE lastRequest = (unixepoch() / 60) * 60000 AND
      ((key = ? AND count >= 120) OR (key = ? AND count >= 12))
    )
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN lastRequest = excluded.lastRequest THEN count + 1 ELSE 1 END,
      lastRequest = excluded.lastRequest
  `)
    .bind(global, client, global, client)
    .run();
  if (!result.meta.changes) {
    return false;
  }
  await env.DB.prepare(`DELETE FROM auth_rate_limit WHERE id IN (
    SELECT id FROM auth_rate_limit WHERE lastRequest < ((unixepoch() / 60) - 1) * 60000 AND
    key GLOB 'map-search:*' LIMIT 12
  )`).run();

  return true;
}

export function createMapSearch() {
  // Cache only completed credentials, never a Promise tied to another Worker's request.
  let cached: { credentials: string; value: string; expires: number } | undefined;

  return async (request: Request, env: Environment) => {
    if (request.method !== "POST") {
      return json({ error: "methodNotAllowed" }, 405, { Allow: "POST" });
    }
    if (!hasCanonicalOrigin(request, env.AUTH_ORIGIN)) {
      return json({ error: "invalidOrigin" }, 403);
    }
    let query;
    try {
      query = mapSearchQuery.safeParse((await readJSON(request, 2048)).query);
    } catch (error) {
      return json({ error: "invalidQuery" }, error instanceof RequestError ? error.status : 400);
    }
    if (!query.success) {
      return json({ error: "invalidQuery" }, 400);
    }
    const { LANTMATERIET_CLIENT_ID: id, LANTMATERIET_CLIENT_SECRET: secret } = env;
    if (!id || !secret) {
      return json({ error: "serviceUnavailable" }, 503);
    }

    const rateLimited = () => json({ error: "rateLimited" }, 429, { "Retry-After": "60" });

    try {
      if (!(await takeSearchQuota(env, request.headers.get("CF-Connecting-IP") ?? ""))) {
        return rateLimited();
      }
      const signal = AbortSignal.timeout(8000);
      const credentials = await digest(`${id}\n${secret}`);
      let token = cached;
      if (!token || token.credentials !== credentials || token.expires <= Date.now()) {
        const requestedAt = Date.now();
        const response = await fetch(tokenEndpoint, {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ grant_type: "client_credentials", scope: readScope }),
        });
        const parsed = tokenSchema.parse(await upstreamJSON(response, 16384));
        token = {
          credentials,
          value: parsed.access_token,
          expires: requestedAt + (Math.min(parsed.expires_in, 3600) - 30) * 1000,
        };
        cached = token;
      }
      const url = new URL(searchEndpoint);
      url.search = new URLSearchParams({
        namn: query.data,
        match: "startsWith",
        srid: "3006",
        maxHits: String(mapSearchLimit),
      }).toString();
      const response = await fetch(url, {
        redirect: "error",
        signal,
        headers: { Authorization: `Bearer ${token.value}`, Accept: "application/json" },
      });
      if (response.status === 401 && cached === token) {
        cached = undefined;
      }

      return json({ results: mapSearchPlacements(await upstreamJSON(response, 524288)) });
    } catch (error) {
      return error instanceof RequestError && error.status === 429
        ? rateLimited()
        : json({ error: "serviceUnavailable" }, 503);
    }
  };
}
