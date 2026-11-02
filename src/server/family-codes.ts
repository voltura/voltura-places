import { digest } from "../shared/digest";
import {
  authorizedWorkspace,
  currentSessionSQL,
  currentSessionArgs,
  WorkspaceError,
} from "./workspace";
import type { Environment } from "./types";

export const invitationVersion = (
  env: Environment,
  family: string,
  hash: string,
  generation = "",
) =>
  digest(
    `family-invitation:${env.AUTH_SECRET}:${family}:${hash}${generation ? ":" + generation : ""}`,
  );

export function pendingRequest(env: Environment, account: string) {
  return env.DB.prepare(
    "SELECT c.expires_at AS expiresAt FROM places_family_requests r JOIN places_family_codes c ON c.family_id=r.family_id AND c.code_hash=r.code_hash WHERE r.account_id=? AND (c.expires_at=0 OR c.expires_at>?)",
  ).bind(account, Date.now());
}

async function limit(env: Environment, account: string, request: Request, purpose: string) {
  const now = Date.now();
  const keys: [string, number][] = [[`${purpose}:account:${account}`, 5]];
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) {
    keys.push([`${purpose}:ip:${await digest(ip)}`, 20]);
  }
  const targets = keys.map(() => "(?,?)").join(",");
  const results = await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM places_family_code_limits WHERE key IN (SELECT key FROM places_family_code_limits WHERE resets_at<=? LIMIT 100)",
    ).bind(now),
    env.DB.prepare(`WITH targets(key,maximum) AS (VALUES ${targets}),
      permitted AS MATERIALIZED (SELECT NOT EXISTS(SELECT 1 FROM targets t JOIN places_family_code_limits l ON l.key=t.key WHERE l.resets_at>? AND l.attempts>=t.maximum) AS ok)
      INSERT INTO places_family_code_limits(key,attempts,resets_at) SELECT key,1,? FROM targets WHERE (SELECT ok FROM permitted)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN resets_at<=? THEN 1 ELSE attempts+1 END,
      resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END`).bind(
      ...keys.flat(),
      now,
      now + 15 * 60000,
      now,
      now,
    ),
  ]);
  if (results[1].meta.changes !== keys.length) {
    throw new WorkspaceError(429, "familyCodeLimited");
  }
}

type Body = { action: string; code?: string; member?: string; invitationVersion?: string };

export async function handleFamilyCode(
  b: Body,
  request: Request,
  env: Environment,
  identity: { account: string; sessionHash: string },
  family: { id: string; ownerId: string } | null,
) {
  if (!b.action.startsWith("code-") && b.action !== "revoke") {
    return null;
  }
  const { account } = identity;
  const sessionArgs = currentSessionArgs(identity);
  const now = Date.now();
  if (b.action === "code-request") {
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM places_family_members WHERE account_id=?",
    )
      .bind(account)
      .first<{ total: number }>();
    if ((count?.total ?? 0) >= 20) {
      throw new WorkspaceError(409, "familyGroupLimit");
    }
    if (!b.code) {
      throw new WorkspaceError(422, "invalidFamilyCode");
    }
    await limit(env, account, request, "join");
    const hash = await digest(`family-code:${b.code}`);
    const result = await env.DB.prepare(
      `INSERT INTO places_family_requests(account_id,family_id,code_hash,created_at) SELECT ?,c.family_id,c.code_hash,? FROM places_family_codes c WHERE c.code_hash=? AND (c.expires_at=0 OR c.expires_at>?) AND (SELECT COUNT(*) FROM places_family_requests WHERE family_id=c.family_id AND account_id<>?)<5 AND NOT EXISTS(SELECT 1 FROM places_family_members WHERE account_id=? AND family_id=c.family_id) AND (SELECT COUNT(*) FROM places_family_members WHERE account_id=?)<20 AND ${currentSessionSQL} ON CONFLICT(account_id) DO UPDATE SET family_id=excluded.family_id,code_hash=excluded.code_hash,created_at=CASE WHEN family_id=excluded.family_id AND code_hash=excluded.code_hash THEN created_at ELSE excluded.created_at END`,
    )
      .bind(account, now, hash, now, account, account, account, ...sessionArgs)
      .run();
    if (!result.meta.changes) {
      throw new WorkspaceError(410, "invalidFamilyCode");
    }

    return Response.json({ pendingRequest: await pendingRequest(env, account).first() });
  }
  if (!family || family.ownerId !== account) {
    throw new WorkspaceError(403, "familyOwnerOnly");
  }
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
      const code = String(random % 10000).padStart(4, "0");
      const hash = await digest(`family-code:${code}`);
      // Zero denotes an invitation without a time limit; legacy timed codes retain their expiry.
      const expiresAt = 0;
      const generation = crypto.randomUUID();
      try {
        const results = await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO places_family_codes(family_id,code_hash,expires_at,generation) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?) AND ${currentSessionSQL} ON CONFLICT(family_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,generation=excluded.generation WHERE code_hash<>excluded.code_hash`,
          ).bind(family.id, hash, expiresAt, generation, family.id, account, ...sessionArgs),
          env.DB.prepare(
            "DELETE FROM places_family_requests WHERE family_id=? AND code_hash<>? AND changes()=1",
          ).bind(family.id, hash),
        ]);
        if (!results[0].meta.changes) {
          await authorizedWorkspace(request, env);
          if (
            !(await env.DB.prepare("SELECT 1 FROM places_families WHERE id=? AND owner_id=?")
              .bind(family.id, account)
              .first())
          ) {
            throw new WorkspaceError(403, "familyOwnerOnly");
          }
          continue;
        }

        return Response.json({
          code,
          expiresAt,
          version: await invitationVersion(env, family.id, hash, generation),
        });
      } catch (error) {
        // An active code belongs to exactly one family. Retry random collisions only.
        if (
          !(
            error instanceof Error &&
            /UNIQUE constraint failed: places_family_codes.code_hash/.test(error.message)
          )
        ) {
          throw error;
        }
      }
    }
    throw new WorkspaceError(503, "serviceUnavailable");
  }
  let expectedGeneration: string | null = null;
  let expectedHash: string | null = null;
  if (b.invitationVersion) {
    const invitation = await env.DB.prepare(
      "SELECT code_hash,generation FROM places_family_codes WHERE family_id=? AND (expires_at=0 OR expires_at>?)",
    )
      .bind(family.id, now)
      .first<{ code_hash: string; generation: string }>();
    if (
      !invitation ||
      b.invitationVersion !==
        (await invitationVersion(env, family.id, invitation.code_hash, invitation.generation))
    ) {
      throw new WorkspaceError(409, "familyCodeChanged");
    }
    expectedGeneration = invitation.generation;
    expectedHash = invitation.code_hash;
  }
  // Legacy rows share an empty generation, so also guard the hash on a stamped decision.
  if (b.action === "revoke") {
    const result = await env.DB.prepare(
      `DELETE FROM places_family_codes WHERE family_id=? AND (? IS NULL OR (generation=? AND code_hash=?)) AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?) AND ${currentSessionSQL}`,
    )
      .bind(
        family.id,
        expectedGeneration,
        expectedGeneration,
        expectedHash,
        family.id,
        account,
        ...sessionArgs,
      )
      .run();
    if (!result.meta.changes && b.invitationVersion) {
      throw new WorkspaceError(409, "familyCodeChanged");
    }

    return null;
  }
  if (!b.member) {
    throw new WorkspaceError(422, "invalidFamilyAction");
  }
  if (b.action === "code-reject") {
    const result = await env.DB.prepare(
      `DELETE FROM places_family_requests WHERE account_id=? AND family_id=? AND EXISTS(SELECT 1 FROM places_family_codes c WHERE c.family_id=places_family_requests.family_id AND c.code_hash=places_family_requests.code_hash AND (? IS NULL OR (c.generation=? AND c.code_hash=?))) AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?) AND ${currentSessionSQL}`,
    )
      .bind(
        b.member,
        family.id,
        expectedGeneration,
        expectedGeneration,
        expectedHash,
        family.id,
        account,
        ...sessionArgs,
      )
      .run();
    if (!result.meta.changes) {
      throw new WorkspaceError(409, "familyCodeChanged");
    }

    return Response.json({ ok: true });
  }
  if (b.action === "code-approve") {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO places_family_members(family_id,account_id,joined_at) SELECT r.family_id,r.account_id,? FROM places_family_requests r JOIN places_family_codes c ON c.family_id=r.family_id AND c.code_hash=r.code_hash JOIN places_families f ON f.id=r.family_id WHERE r.account_id=? AND r.family_id=? AND (c.expires_at=0 OR c.expires_at>?) AND f.owner_id=? AND (? IS NULL OR (c.generation=? AND c.code_hash=?)) AND (SELECT COUNT(*) FROM places_family_members WHERE family_id=r.family_id)<10 AND NOT EXISTS(SELECT 1 FROM places_family_members WHERE account_id=r.account_id AND family_id=r.family_id) AND (SELECT COUNT(*) FROM places_family_members WHERE account_id=r.account_id)<20 AND ${currentSessionSQL}`,
      ).bind(
        now,
        b.member,
        family.id,
        now,
        account,
        expectedGeneration,
        expectedGeneration,
        expectedHash,
        ...sessionArgs,
      ),
      env.DB.prepare("DELETE FROM places_family_codes WHERE family_id=? AND changes()=1").bind(
        family.id,
      ),
    ]);
    if (!results[0].meta.changes) {
      const limits = await env.DB.prepare(`SELECT
        (SELECT count(*) FROM places_family_members WHERE family_id=r.family_id) >= 10 AS familyFull,
        (SELECT count(*) FROM places_family_members WHERE account_id=r.account_id) >= 20 AS accountFull
        FROM places_family_requests r JOIN places_family_codes c ON c.family_id=r.family_id AND c.code_hash=r.code_hash
        JOIN places_families f ON f.id=r.family_id WHERE r.family_id=? AND r.account_id=? AND f.owner_id=?
        AND (c.expires_at=0 OR c.expires_at>?) AND (? IS NULL OR (c.generation=? AND c.code_hash=?))`)
        .bind(
          family.id,
          b.member,
          account,
          now,
          expectedGeneration,
          expectedGeneration,
          expectedHash,
        )
        .first<{ familyFull: number; accountFull: number }>();
      if (limits?.familyFull) {
        throw new WorkspaceError(409, "familyFull");
      }
      if (limits?.accountFull) {
        throw new WorkspaceError(409, "familyGroupLimit");
      }
      throw new WorkspaceError(409, "familyCodeChanged");
    }

    return Response.json({ ok: true });
  }
  throw new WorkspaceError(422, "invalidFamilyAction");
}
