import { Buffer } from "node:buffer";
import { digest } from "../shared/digest";
import { idSchema, routeSchema } from "../shared/model";
import { privateJSON as json, hasCanonicalOrigin } from "./http";
import { authorizedWorkspace, WorkspaceError, membershipSQL, membershipArgs } from "./workspace";
import type { Environment } from "./types";

export async function handleRouteShare(request: Request, env: Environment) {
  const path = new URL(request.url).pathname;
  if (path === "/api/v1/route-share") {
    if (request.method !== "GET") {
      return json({ error: "methodNotAllowed" }, 405);
    }
    const token = request.headers.get("X-Places-Route-Token") ?? "";
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return json({ error: "invalidShare" }, 404);
    }
    // Deliberately no session lookup: the fragment bearer is the sole read credential.
    const row = await env.DB.prepare(`SELECT snapshots.data FROM places_route_shares shares
      JOIN places_route_snapshots snapshots ON snapshots.publisher=shares.publisher AND snapshots.hash=shares.snapshot_hash
      JOIN places_accounts publisher ON publisher.id=shares.publisher
      JOIN places_records source ON source.account_id=shares.workspace AND source.id=shares.route_id AND source.kind='route' AND source.deleted=0
      WHERE shares.token_hash=? AND (shares.workspace=shares.publisher OR EXISTS(
        SELECT 1 FROM places_family_members WHERE family_id=shares.workspace AND account_id=shares.publisher))`)
      .bind(await digest(token))
      .first<{ data: string }>();

    return row
      ? new Response(row.data, {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        })
      : json({ error: "invalidShare" }, 404);
  }
  let identity;
  try {
    identity = await authorizedWorkspace(request, env);
  } catch (error) {
    return json(
      { error: error instanceof WorkspaceError ? error.message : "serviceUnavailable" },
      error instanceof WorkspaceError ? error.status : 503,
    );
  }
  if (!hasCanonicalOrigin(request, env.AUTH_ORIGIN)) {
    return json({ error: "invalidOrigin" }, 403);
  }
  const id = path.slice("/api/v1/route-shares/".length);
  if (!idSchema.safeParse(id).success) {
    return json({ error: "invalidShare" }, 400);
  }
  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM places_route_shares WHERE workspace=? AND route_id=? AND
      (publisher=? OR EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?)) AND ${membershipSQL}`)
      .bind(
        identity.storage,
        id,
        identity.account,
        identity.family,
        identity.account,
        ...membershipArgs(identity),
      )
      .run();
    await cleanup(env, identity.account);

    return json({ ok: true });
  }
  if (request.method !== "POST") {
    return json({ error: "methodNotAllowed" }, 405);
  }
  const attempt = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM places_route_share_attempts WHERE publisher=? AND created_at <= unixepoch('subsec')*1000-3600000",
    ).bind(identity.account),
    env.DB.prepare(`INSERT INTO places_route_share_attempts SELECT ?,?,unixepoch('subsec')*1000 WHERE
      (SELECT count(*) FROM places_route_share_attempts WHERE publisher=? AND created_at > unixepoch('subsec')*1000-3600000)<10 AND ${membershipSQL}`).bind(
      identity.account,
      attempt,
      identity.account,
      ...membershipArgs(identity),
    ),
  ]);
  if (
    !(await env.DB.prepare("SELECT id FROM places_route_share_attempts WHERE publisher=? AND id=?")
      .bind(identity.account, attempt)
      .first())
  ) {
    return json({ error: "rateLimited" }, 429);
  }
  const source = await env.DB.prepare(
    `SELECT value,revision FROM places_records WHERE account_id=? AND id=? AND kind='route' AND deleted=0 AND ${membershipSQL}`,
  )
    .bind(identity.storage, id, ...membershipArgs(identity))
    .first<{ value: string; revision: number }>();
  if (!source) {
    return json({ error: "invalidShare" }, 404);
  }
  const route = routeSchema.parse(JSON.parse(source.value));
  const geometry = await env.DB.prepare(
    `SELECT data FROM places_geometry WHERE account_id=? AND id=? AND ${membershipSQL}`,
  )
    .bind(identity.storage, route.geometryId, ...membershipArgs(identity))
    .first<{ data: string }>();
  if (!geometry) {
    return json({ error: "geometryUnavailable" }, 422);
  }
  const category = await env.DB.prepare(
    "SELECT value FROM places_records WHERE account_id=? AND id=? AND kind='category' AND deleted=0",
  )
    .bind(identity.storage, route.categoryId)
    .first<{ value: string }>();
  const photo = route.photoId
    ? await env.DB.prepare(
        `SELECT data FROM places_photos WHERE account_id=? AND id=? AND ${membershipSQL}`,
      )
        .bind(identity.storage, route.photoId, ...membershipArgs(identity))
        .first<{ data: number[] }>()
    : null;
  if (route.photoId && !photo) {
    return json({ error: "photoUnavailable" }, 422);
  }
  const data = JSON.stringify({
    version: 1,
    route,
    category: category ? JSON.parse(category.value) : { name: "Other", color: "slate" },
    geometry: JSON.parse(geometry.data),
    ...(photo
      ? { photo: "data:image/jpeg;base64," + Buffer.from(photo.data).toString("base64") }
      : {}),
  });
  const hash = await digest(data);
  const bytes = new TextEncoder().encode(data).length;
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const tokenHash = await digest(token);
  await cleanup(env, identity.account);
  const sourceCurrent = `EXISTS(SELECT 1 FROM places_records WHERE account_id=? AND id=? AND revision=? AND deleted=0) AND ${membershipSQL}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO places_route_snapshots(publisher,hash,bytes,data) SELECT ?,?,?,? WHERE
      (SELECT COALESCE(sum(bytes),0) FROM places_route_snapshots snapshots WHERE publisher=? AND EXISTS(
        SELECT 1 FROM places_route_shares shares WHERE shares.publisher=snapshots.publisher AND shares.snapshot_hash=snapshots.hash
        AND NOT(shares.workspace=? AND shares.route_id=?))) + ? <= 52428800 AND ${sourceCurrent}`).bind(
      identity.account,
      hash,
      bytes,
      data,
      identity.account,
      identity.storage,
      id,
      bytes,
      identity.storage,
      id,
      source.revision,
      ...membershipArgs(identity),
    ),
    env.DB.prepare(`INSERT INTO places_route_shares(publisher,workspace,route_id,token_hash,snapshot_hash) SELECT ?,?,?,?,?
      WHERE EXISTS(SELECT 1 FROM places_route_snapshots WHERE publisher=? AND hash=?) AND ${sourceCurrent}
      ON CONFLICT(publisher,workspace,route_id) DO UPDATE SET token_hash=excluded.token_hash,snapshot_hash=excluded.snapshot_hash`).bind(
      identity.account,
      identity.storage,
      id,
      tokenHash,
      hash,
      identity.account,
      hash,
      identity.storage,
      id,
      source.revision,
      ...membershipArgs(identity),
    ),
  ]);
  const accepted = await env.DB.prepare(
    `SELECT token_hash FROM places_route_shares WHERE publisher=? AND workspace=? AND route_id=? AND token_hash=? AND ${membershipSQL}`,
  )
    .bind(identity.account, identity.storage, id, tokenHash, ...membershipArgs(identity))
    .first();
  await cleanup(env, identity.account);

  return accepted ? json({ token }) : json({ error: "shareUnavailable" }, 409);
}

async function cleanup(env: Environment, publisher: string) {
  // References are counted by existence; equal immutable snapshots share one byte charge.
  await env.DB.prepare(`DELETE FROM places_route_snapshots WHERE publisher=? AND NOT EXISTS(
    SELECT 1 FROM places_route_shares WHERE publisher=places_route_snapshots.publisher AND snapshot_hash=places_route_snapshots.hash)`)
    .bind(publisher)
    .run();
}
