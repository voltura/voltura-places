import { digest } from "./auth.js";
import { WorkspaceError } from "./workspace";
import type { Environment } from "./types";

export async function pendingRequest(env: Environment, account: string) {
  return env.DB.prepare(
    "SELECT c.expires_at AS expiresAt FROM places_family_requests r JOIN places_family_codes c ON c.family_id=r.family_id AND c.code_hash=r.code_hash WHERE r.account_id=? AND (c.expires_at=0 OR c.expires_at>?)",
  )
    .bind(account, Date.now())
    .first();
}
export async function codeRequests(env: Environment, family: string) {
  return (
    await env.DB.prepare(
      "SELECT r.account_id AS id,COALESCE((SELECT MIN(label) FROM places_identities i WHERE i.account_id=r.account_id),'Member') AS label FROM places_family_requests r JOIN places_family_codes c ON c.family_id=r.family_id AND c.code_hash=r.code_hash WHERE r.family_id=? AND (c.expires_at=0 OR c.expires_at>?) ORDER BY r.created_at,r.account_id LIMIT 5",
    )
      .bind(family, Date.now())
      .all<{ id: string; label: string }>()
  ).results;
}
async function limit(env: Environment, account: string, request: Request, purpose: string) {
  const now = Date.now();
  const keys: [string, number][] = [[`${purpose}:account:${account}`, 5]];
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) keys.push([`${purpose}:ip:${await digest(ip)}`, 20]);
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM places_family_code_limits WHERE resets_at<=?").bind(now),
    ...keys.map(([key, maximum]) =>
      env.DB.prepare(
        "INSERT INTO places_family_code_limits(key,attempts,resets_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 WHERE attempts<?",
      ).bind(key, now + 15 * 60000, maximum),
    ),
  ]);
  if (results.slice(1).some((r) => !r.meta.changes))
    throw new WorkspaceError(429, "familyCodeLimited");
}
type Body = { action: string; code?: string; member?: string };
export async function handleFamilyCode(
  b: Body,
  request: Request,
  env: Environment,
  account: string,
  family: { id: string; ownerId: string } | null,
) {
  if (!b.action.startsWith("code-")) return null;
  const now = Date.now();
  if (b.action === "code-request") {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM places_family_members WHERE account_id=?",
    )
      .bind(account)
      .first<{ total: number }>();
    if ((count?.total ?? 0) >= 20) throw new WorkspaceError(409, "familyGroupLimit");
    await limit(env, account, request, "join");
    if (!b.code) throw new WorkspaceError(422, "invalidFamilyCode");
    const hash = await digest(`family-code:${b.code}`);
    const result = await env.DB.prepare(
      "INSERT INTO places_family_requests(account_id,family_id,code_hash,created_at) SELECT ?,c.family_id,c.code_hash,? FROM places_family_codes c WHERE c.code_hash=? AND (c.expires_at=0 OR c.expires_at>?) AND (SELECT COUNT(*) FROM places_family_requests WHERE family_id=c.family_id)<5 AND NOT EXISTS(SELECT 1 FROM places_family_members WHERE account_id=? AND family_id=c.family_id) AND (SELECT COUNT(*) FROM places_family_members WHERE account_id=?)<20 ON CONFLICT(account_id) DO UPDATE SET family_id=excluded.family_id,code_hash=excluded.code_hash,created_at=excluded.created_at",
    )
      .bind(account, now, hash, now, account, account)
      .run();
    if (!result.meta.changes) throw new WorkspaceError(410, "invalidFamilyCode");
    return Response.json({ pendingRequest: await pendingRequest(env, account) });
  }
  if (!family || family.ownerId !== account) throw new WorkspaceError(403, "familyOwnerOnly");
  if (b.action === "code-create") {
    await limit(env, account, request, "create");
    await env.DB.prepare("DELETE FROM places_family_codes WHERE expires_at>0 AND expires_at<=?")
      .bind(now)
      .run();
    for (let attempt = 0; attempt < 20; attempt++) {
      let random: number;
      do {
        random = crypto.getRandomValues(new Uint32Array(1))[0];
      } while (random >= 4294960000);
      const code = String(random % 10000).padStart(4, "0"),
        hash = await digest(`family-code:${code}`),
        // Zero denotes an invitation without a time limit; legacy timed codes retain their expiry.
        expiresAt = 0;
      try {
        const results = await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM places_family_requests WHERE family_id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?)",
          ).bind(family.id, family.id, account),
          env.DB.prepare(
            "INSERT INTO places_family_codes(family_id,code_hash,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?) ON CONFLICT(family_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at",
          ).bind(family.id, hash, expiresAt, family.id, account),
        ]);
        if (!results[1].meta.changes) throw new WorkspaceError(403, "familyOwnerOnly");
        return Response.json({ code, expiresAt });
      } catch (error) {
        // An active code belongs to exactly one family. Retry random collisions only.
        if (
          !(
            error instanceof Error &&
            /UNIQUE constraint failed: places_family_codes.code_hash/.test(error.message)
          )
        )
          throw error;
      }
    }
    throw new WorkspaceError(503, "serviceUnavailable");
  }
  if (!b.member) throw new WorkspaceError(422, "invalidFamilyAction");
  if (b.action === "code-reject") {
    await env.DB.prepare(
      "DELETE FROM places_family_requests WHERE account_id=? AND family_id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?)",
    )
      .bind(b.member, family.id, family.id, account)
      .run();
    return Response.json({ ok: true });
  }
  if (b.action === "code-approve") {
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO places_family_members(family_id,account_id,joined_at) SELECT r.family_id,r.account_id,? FROM places_family_requests r JOIN places_family_codes c ON c.family_id=r.family_id AND c.code_hash=r.code_hash JOIN places_families f ON f.id=r.family_id WHERE r.account_id=? AND r.family_id=? AND (c.expires_at=0 OR c.expires_at>?) AND f.owner_id=? AND (SELECT COUNT(*) FROM places_family_members WHERE family_id=r.family_id)<10 AND NOT EXISTS(SELECT 1 FROM places_family_members WHERE account_id=r.account_id AND family_id=r.family_id) AND (SELECT COUNT(*) FROM places_family_members WHERE account_id=r.account_id)<20",
      ).bind(now, b.member, family.id, now, account),
      env.DB.prepare(
        "DELETE FROM places_family_codes WHERE family_id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?) AND EXISTS(SELECT 1 FROM places_family_members WHERE family_id=? AND account_id=?) AND EXISTS(SELECT 1 FROM places_family_requests WHERE family_id=? AND account_id=? AND code_hash=places_family_codes.code_hash)",
      ).bind(family.id, family.id, account, family.id, b.member, family.id, b.member),
    ]);
    if (!results[0].meta.changes) throw new WorkspaceError(409, "familyCodeChanged");
    return Response.json({ ok: true });
  }
  throw new WorkspaceError(422, "invalidFamilyAction");
}
