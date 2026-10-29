import { authorizedWorkspace, WorkspaceError, membershipSQL, membershipArgs } from "./workspace";
import { jpegDimensions, photoHash, PHOTO_BYTES, PHOTO_QUOTA } from "../shared/photos";
import type { Environment } from "./types";
const json = (error: string, status: number) => Response.json({ error }, { status });
export async function handlePhoto(request: Request, env: Environment) {
  let identity;
  try {
    identity = await authorizedWorkspace(request, env);
  } catch (error) {
    return json(
      error instanceof WorkspaceError ? error.message : "serviceUnavailable",
      error instanceof WorkspaceError ? error.status : 503,
    );
  }
  const id = new URL(request.url).pathname.split("/").at(-1)!;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    return json("invalidPhoto", 400);
  if (request.method === "GET") {
    const photo = await env.DB.prepare(
      `SELECT data FROM places_photos WHERE account_id=? AND id=? AND ${membershipSQL}`,
    )
      .bind(identity.storage, id, ...membershipArgs(identity))
      .first<{ data: number[] }>();
    return photo
      ? new Response(new Uint8Array(photo.data), {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        })
      : json("photoUnavailable", 404);
  }
  if (request.method !== "PUT") return json("methodNotAllowed", 405);
  if (
    request.headers.get("Origin") !== env.AUTH_ORIGIN ||
    new URL(request.url).origin !== env.AUTH_ORIGIN ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    return json("invalidOrigin", 403);
  if (request.headers.get("Content-Type") !== "image/jpeg") return json("invalidPhoto", 415);
  const reader = request.body?.getReader();
  if (!reader) return json("invalidPhoto", 422);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > PHOTO_BYTES) {
      await reader.cancel();
      return json("invalidPhoto", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    jpegDimensions(bytes);
  } catch {
    return json("invalidPhoto", 422);
  }
  const hash = await photoHash(bytes);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO places_photos(account_id,id,hash,bytes,data) SELECT ?,?,?,?,? WHERE (SELECT COALESCE(SUM(bytes),0) FROM places_photos WHERE account_id=?) + ? <= ? AND (SELECT COUNT(*) FROM places_photos WHERE account_id=?) < 1000 AND ${membershipSQL}`,
  )
    .bind(
      identity.storage,
      id,
      hash,
      length,
      bytes.buffer,
      identity.storage,
      length,
      PHOTO_QUOTA,
      identity.storage,
      ...membershipArgs(identity),
    )
    .run();
  try {
    await authorizedWorkspace(request, env);
  } catch (error) {
    return json(
      error instanceof WorkspaceError ? error.message : "serviceUnavailable",
      error instanceof WorkspaceError ? error.status : 503,
    );
  }
  const stored = await env.DB.prepare("SELECT hash FROM places_photos WHERE account_id=? AND id=?")
    .bind(identity.storage, id)
    .first<{ hash: string }>();
  if (!stored) return json("photoQuota", 413);
  return stored.hash === hash ? Response.json({ ok: true }) : json("invalidPhoto", 409);
}
