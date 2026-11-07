import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { createMapSearch, mapSearchPlacements } from "../src/server/map-search";
import type { Environment } from "../src/server/types";

const origin = "https://places.example";

const point = (easting: number, northing: number) => ({
  kommunnamn: "Arvidsjaur",
  lannamn: "Norrbotten",
  punkt: { type: "Point", coordinates: [easting, northing] },
});

const provider = (...placements: unknown[]) => ({
  type: "FeatureCollection",
  crs: { properties: { name: "urn:ogc:def:crs:EPSG::3006" } },
  features: [
    { type: "Feature", id: "3440005", properties: { namn: "Arvidsjaur", placering: placements } },
  ],
});

test("normalizes separate GeoJSON placements, checks axis order, and caps results", () => {
  const first = point(692839, 7281385);
  const reversed = point(7281385, 692839);
  const value = provider(
    first,
    reversed,
    ...Array.from({ length: 12 }, (_, i) => point(690000 + i, 7280000)),
  );
  const results = mapSearchPlacements(value);
  expect(results).toHaveLength(10);
  expect(results[0]).toMatchObject({
    id: "3440005:0",
    name: "Arvidsjaur",
    municipality: "Arvidsjaur",
    county: "Norrbotten",
  });
  // Independent EPSG:3006 to EPSG:4326 reference from PROJ.
  expect(results[0].latitude).toBeCloseTo(65.59677991, 6);
  expect(results[0].longitude).toBeCloseTo(19.18532723, 6);
  expect(results[1].id).toBe("3440005:2");
  expect(mapSearchPlacements({ type: "FeatureCollection", features: [] })).toEqual([]);
  expect(() => mapSearchPlacements(provider(reversed))).toThrow();
  expect(() =>
    mapSearchPlacements({ ...value, crs: { properties: { name: "EPSG:4326" } } }),
  ).toThrow();
});

const database = () => {
  const db = new DatabaseSync(":memory:");
  db.function("unixepoch", () => 18000);
  db.exec(
    "CREATE TABLE auth_rate_limit (id TEXT PRIMARY KEY, key TEXT UNIQUE, count INTEGER, lastRequest INTEGER)",
  );

  return {
    db,
    env: {
      DB: {
        prepare: (sql: string) => {
          const statement = db.prepare(sql);

          const run = async (...args: (string | number)[]) => ({
            meta: { changes: Number(statement.run(...args).changes) },
          });

          return { run, bind: (...args: (string | number)[]) => ({ run: () => run(...args) }) };
        },
      },
      AUTH_ORIGIN: origin,
      AUTH_SECRET: "fixture-hash-key",
      ACCOUNTS_ENABLED: "false",
      LANTMATERIET_CLIENT_ID: "fixture-client",
      LANTMATERIET_CLIENT_SECRET: "fixture-secret",
    } as Environment,
  };
};

const request = (query: unknown = " Slåboda ", headers: Record<string, string> = {}) =>
  new Request(origin + "/api/v1/map-search", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ query }),
  });

afterEach(() => vi.unstubAllGlobals());

test("validates origin and input before contacting Ortnamn and limits concurrent requests", async () => {
  const { db, env } = database();
  try {
    const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (typeof url === "string") {
        expect(url).toBe("https://apimanager.lantmateriet.se/oauth2/token");
        expect(new URLSearchParams(String(init?.body)).get("scope")).toBe("ortnamn_direkt_read");

        return Response.json({
          access_token: "fixture-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      expect(url.pathname).toBe("/distribution/produkter/ortnamn/v2.2/kriterier");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        namn: "Slåboda",
        match: "startsWith",
        maxHits: "10",
        srid: "3006",
      });
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-token");
      expect(init?.redirect).toBe("error");

      return Response.json({ type: "FeatureCollection", features: [] });
    });
    vi.stubGlobal("fetch", fetch);
    const search = createMapSearch();
    expect(
      (await search(request("Slåboda", { Origin: "https://other.example" }), env)).status,
    ).toBe(403);
    expect((await search(request("Slåboda", { "Sec-Fetch-Site": "cross-site" }), env)).status).toBe(
      403,
    );
    expect((await search(request(" "), env)).status).toBe(400);
    expect((await search(request("x".repeat(161)), env)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const first = await search(request(), env);
    expect(await first.json()).toEqual({ results: [] });
    expect(first.headers.get("Cache-Control")).toContain("no-store");
    const responses = await Promise.all(Array.from({ length: 13 }, () => search(request(), env)));
    expect(responses.filter(({ status }) => status === 200)).toHaveLength(11);
    expect(responses.filter(({ status }) => status === 429)).toHaveLength(2);
    expect(fetch.mock.calls.filter(([url]) => typeof url === "string")).toHaveLength(1);
  } finally {
    db.close();
  }
});

test("maps upstream throttling and timeout to separate safe failures", async () => {
  const { db, env } = database();
  try {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockRejectedValueOnce(new DOMException("fixture-timeout", "TimeoutError"));
    vi.stubGlobal("fetch", fetch);
    const search = createMapSearch();
    expect((await search(request(), env)).status).toBe(429);
    const unavailable = await search(request(), env);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "serviceUnavailable" });
  } finally {
    db.close();
  }
});
