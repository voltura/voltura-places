import { readBytes, RequestError, hasCanonicalOrigin } from "./http";
import { authorizedWorkspace, WorkspaceError, membershipSQL, membershipArgs } from "./workspace";
import { jpegDimensions, photoHash, PHOTO_BYTES, PHOTO_QUOTA } from "../shared/photos";
import type { Environment } from "./types";
import { z } from "zod";

const photoIdSchema = z.string().uuid();

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
  const id = new URL(request.url).pathname.slice("/api/v1/photos/".length);
  if (!photoIdSchema.safeParse(id).success) {
    return json("invalidPhoto", 400);
  }
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
  if (request.method !== "PUT") {
    return json("methodNotAllowed", 405);
  }
  if (!hasCanonicalOrigin(request, env.AUTH_ORIGIN)) {
    return json("invalidOrigin", 403);
  }
  if (request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "image/jpeg") {
    return json("invalidPhoto", 415);
  }
  let bytes;
  try {
    bytes = await readBytes(request, PHOTO_BYTES, 422);
  } catch (error) {
    if (!(error instanceof RequestError)) {
      throw error;
    }

    return json("invalidPhoto", error.status);
  }
  const length = bytes.byteLength;
  try {
    jpegDimensions(bytes);
  } catch {
    return json("invalidPhoto", 422);
  }
  const hash = await photoHash(bytes);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO places_photos(account_id,id,hash,bytes,data) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM places_photos WHERE account_id=? AND id=?) AND (SELECT COUNT(*) < 1000 AND COALESCE(SUM(bytes),0) + ? <= ? FROM places_photos WHERE account_id=?) AND ${membershipSQL}`,
  )
    .bind(
      identity.storage,
      id,
      hash,
      length,
      bytes,
      identity.storage,
      id,
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
  const stored = await env.DB.prepare(
    `SELECT hash FROM places_photos WHERE account_id=? AND id=? AND ${membershipSQL}`,
  )
    .bind(identity.storage, id, ...membershipArgs(identity))
    .first<{ hash: string }>();
  if (!stored) {
    return json("photoQuota", 413);
  }

  return stored.hash === hash ? Response.json({ ok: true }) : json("invalidPhoto", 409);
}
