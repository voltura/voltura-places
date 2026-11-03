import { canonicalGeometry, geometryIdSchema, ROUTE_BYTES, ROUTE_QUOTA } from "../shared/routes";
import { readJSON, RequestError, hasCanonicalOrigin, privateJSON as json } from "./http";
import { authorizedWorkspace, WorkspaceError, membershipSQL, membershipArgs } from "./workspace";
import type { Environment } from "./types";

export async function handleGeometry(request: Request, env: Environment) {
  let identity;
  try {
    identity = await authorizedWorkspace(request, env);
  } catch (error) {
    return json(
      { error: error instanceof WorkspaceError ? error.message : "serviceUnavailable" },
      error instanceof WorkspaceError ? error.status : 503,
    );
  }
  const id = new URL(request.url).pathname.slice("/api/v1/geometry/".length);
  if (!geometryIdSchema.safeParse(id).success) {
    return json({ error: "invalidGeometry" }, 400);
  }
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      `SELECT data FROM places_geometry WHERE account_id=? AND id=? AND ${membershipSQL}`,
    )
      .bind(identity.storage, id, ...membershipArgs(identity))
      .first<{ data: string }>();

    return row
      ? new Response(row.data, {
          headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
        })
      : json({ error: "geometryUnavailable" }, 404);
  }
  if (request.method !== "PUT") {
    return json({ error: "methodNotAllowed" }, 405);
  }
  if (!hasCanonicalOrigin(request, env.AUTH_ORIGIN)) {
    return json({ error: "invalidOrigin" }, 403);
  }
  let geometry;
  try {
    geometry = await canonicalGeometry(await readJSON(request, ROUTE_BYTES));
  } catch (error) {
    return json({ error: "invalidGeometry" }, error instanceof RequestError ? error.status : 422);
  }
  if (geometry.id !== id) {
    return json({ error: "invalidGeometry" }, 422);
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO places_geometry(account_id,id,bytes,data,summary) SELECT ?,?,?,?,? WHERE
    (SELECT COALESCE(SUM(bytes),0) FROM places_geometry WHERE account_id=?) + ? <= ? AND ${membershipSQL}`)
    .bind(
      identity.storage,
      id,
      geometry.bytes,
      geometry.canonical,
      JSON.stringify(geometry.summary),
      identity.storage,
      geometry.bytes,
      ROUTE_QUOTA,
      ...membershipArgs(identity),
    )
    .run();
  try {
    await authorizedWorkspace(request, env);
  } catch (error) {
    return json(
      { error: error instanceof WorkspaceError ? error.message : "serviceUnavailable" },
      error instanceof WorkspaceError ? error.status : 503,
    );
  }
  const stored = await env.DB.prepare(
    `SELECT id FROM places_geometry WHERE account_id=? AND id=? AND ${membershipSQL}`,
  )
    .bind(identity.storage, id, ...membershipArgs(identity))
    .first();

  return stored ? json({ ok: true }) : json({ error: "routeQuota" }, 413);
}
