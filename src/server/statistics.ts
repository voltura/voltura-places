import { readJSON, RequestError, hasCanonicalOrigin } from "./http";
import { digest } from "../shared/digest";
import type { Environment } from "./types";

const minute = 60_000;
const day = 24 * 60 * minute;

export function stockholmMidnight(now: number) {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = (time: number) =>
    Object.fromEntries(format.formatToParts(time).map((p) => [p.type, p.value]));
  const current = parts(now);
  const target = Date.UTC(+current.year, +current.month - 1, +current.day);
  let result = target;
  for (let i = 0; i < 3; i++) {
    const p = parts(result);
    result += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  return result;
}

export async function handleStatistics(request: Request, env: Environment) {
  const activity = new URL(request.url).pathname === "/api/v1/activity";
  const origin = request.headers.get("Origin");
  const local = /^http:\/\/127\.0\.0\.1:517[34]$/.test(env.AUTH_ORIGIN);
  const allowed =
    origin === env.AUTH_ORIGIN ||
    origin === "https://voltura.se" ||
    (local && origin === "http://127.0.0.1:5175");
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (!activity && origin && allowed) headers["Access-Control-Allow-Origin"] = origin;
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (activity ? request.method !== "POST" : request.method !== "GET")
    return json({ error: "methodNotAllowed" }, 405);
  if (activity && !hasCanonicalOrigin(request, env.AUTH_ORIGIN))
    return json({ error: "invalidOrigin" }, 403);
  if (!activity && origin && !allowed) return json({ error: "invalidOrigin" }, 403);
  if (!env.DB || !env.AUTH_SECRET) return json({ error: "serviceUnavailable" }, 503);
  const now = Date.now();
  if (activity) {
    let input;
    try {
      input = await readJSON(request, 128);
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      return json({ error: "invalidActivity" }, error.status);
    }
    if (
      Object.keys(input).length !== 1 ||
      typeof input.browserId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.browserId,
      )
    )
      return json({ error: "invalidActivity" }, 422);
    const hash = await digest(
      `places-activity:${env.AUTH_SECRET}:${input.browserId.toLowerCase()}`,
    );
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO places_activity(browser_hash,last_seen) VALUES(?,?)
        ON CONFLICT(browser_hash) DO UPDATE SET last_seen=excluded.last_seen
        WHERE places_activity.last_seen <= ?`).bind(hash, now, now - minute),
      env.DB.prepare(`DELETE FROM places_activity WHERE browser_hash IN
        (SELECT browser_hash FROM places_activity WHERE last_seen < ? ORDER BY last_seen LIMIT 100)`).bind(
        now - 31 * day,
      ),
    ]);
    return json({ ok: true });
  }
  // The conditional update serializes refreshes in D1, including concurrent cache misses.
  await env.DB.prepare(`UPDATE places_statistics SET generated_at=?, payload=(
    WITH people AS (SELECT id FROM places_accounts a WHERE NOT EXISTS
      (SELECT 1 FROM places_families f WHERE f.id=a.id)),
    live AS (SELECT account_id FROM places_records WHERE kind='place' AND deleted=0)
    SELECT json_object(
      'activeNow',(SELECT count(*) FROM places_activity WHERE last_seen >= ?),
      'activeToday',(SELECT count(*) FROM places_activity WHERE last_seen >= ?),
      'active30Days',(SELECT count(*) FROM places_activity WHERE last_seen >= ?),
      'registeredAccounts',(SELECT count(*) FROM people),
      'cloudPlaces',(SELECT count(*) FROM live),
      'averagePersonalPlaces',coalesce((SELECT count(*) * 1.0 FROM live WHERE account_id IN
        (SELECT id FROM people)) / nullif((SELECT count(*) FROM people),0),0))
    ) WHERE id=1 AND (payload IS NULL OR generated_at <= ?)`)
    .bind(now, now - 2 * minute, stockholmMidnight(now), now - 30 * day, now - minute)
    .run();
  const row = await env.DB.prepare(
    "SELECT started_at,generated_at,payload FROM places_statistics WHERE id=1",
  ).first<{ started_at: number; generated_at: number; payload: string }>();
  if (!row?.payload) return json({ error: "serviceUnavailable" }, 503);
  return json({
    version: 1,
    generatedAt: row.generated_at,
    activityStartedAt: row.started_at,
    ...JSON.parse(row.payload),
  });
}
