import { z } from "zod";
import { readJSON } from "./accounts.js";
import { digest } from "./auth.js";
import { authorizedWorkspace, requireOrigin, WorkspaceError } from "./workspace";
import { starters } from "../shared/model";
import type { Environment } from "./types";
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
async function details(env: Environment, account: string) {
  const family = await env.DB.prepare(
    "SELECT f.id,f.name,f.owner_id AS ownerId FROM places_families f JOIN places_family_members m ON m.family_id=f.id WHERE m.account_id=?",
  )
    .bind(account)
    .first<{ id: string; name: string; ownerId: string }>();
  if (!family) return null;
  const members = await env.DB.prepare(
    "SELECT m.account_id AS id, COALESCE((SELECT MIN(label) FROM places_identities i WHERE i.account_id=m.account_id),'Member') AS label FROM places_family_members m WHERE m.family_id=? ORDER BY m.joined_at,m.account_id",
  )
    .bind(family.id)
    .all<{ id: string; label: string }>();
  return { ...family, members: members.results };
}
export async function handleFamilies(request: Request, env: Environment) {
  try {
    if (request.headers.has("X-Places-Family"))
      throw new WorkspaceError(400, "invalidFamilyAction");
    const { account } = await authorizedWorkspace(request, env);
    if (request.method === "GET") return Response.json({ family: await details(env, account) });
    if (request.method !== "POST") throw new WorkspaceError(405, "methodNotAllowed");
    requireOrigin(request, env);
    const body = z
      .object({
        action: z.enum([
          "create",
          "invite",
          "revoke",
          "preview",
          "join",
          "remove",
          "leave",
          "transfer",
          "delete",
        ]),
        name: z.string().trim().min(1).max(80).optional(),
        token: tokenSchema.optional(),
        member: z.string().max(80).optional(),
      })
      .strict()
      .safeParse(await readJSON(request, 2048));
    if (!body.success) throw new WorkspaceError(422, "invalidFamilyAction");
    const b = body.data,
      now = Date.now();
    let family = await details(env, account);
    if (b.action === "create") {
      if (family || !b.name) throw new WorkspaceError(409, "familyAlreadyJoined");
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO places_accounts(id,created_at) SELECT ?,? WHERE NOT EXISTS(SELECT 1 FROM places_family_members WHERE account_id=?)",
        ).bind(id, now, account),
        env.DB.prepare(
          "INSERT INTO places_families(id,name,owner_id,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM places_accounts WHERE id=?)",
        ).bind(id, b.name, account, now, id),
        env.DB.prepare(
          "INSERT INTO places_family_members(family_id,account_id,joined_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM places_families WHERE id=?)",
        ).bind(id, account, now, id),
        ...starters.map((e) =>
          env.DB.prepare(
            "INSERT INTO places_records(account_id,id,kind,value,revision,deleted,last_mutation) SELECT ?,?,?,?,1,0,? WHERE EXISTS(SELECT 1 FROM places_families WHERE id=?)",
          ).bind(id, e.id, e.kind, JSON.stringify(e.value), crypto.randomUUID(), id),
        ),
      ]);
    } else if (b.action === "preview" || b.action === "join") {
      if (!b.token) throw new WorkspaceError(422, "invalidFamilyInvite");
      const hash = await digest(b.token);
      const invitation = await env.DB.prepare(
        "SELECT f.id,f.name,i.used_by FROM places_family_invites i JOIN places_families f ON f.id=i.family_id WHERE i.token_hash=? AND i.expires_at>? AND (i.used_by IS NULL OR i.used_by=?)",
      )
        .bind(hash, now, account)
        .first<{ id: string; name: string; used_by: string | null }>();
      if (!invitation) throw new WorkspaceError(410, "invalidFamilyInvite");
      if (b.action === "preview")
        return Response.json({ invitation: { id: invitation.id, name: invitation.name } });
      if (family && family.id !== invitation.id)
        throw new WorkspaceError(409, "familyAlreadyJoined");
      if (family?.id === invitation.id) return Response.json({ family });
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO places_family_members(family_id,account_id,joined_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM places_family_invites WHERE token_hash=? AND expires_at>? AND used_by IS NULL) AND (SELECT COUNT(*) FROM places_family_members WHERE family_id=?)<10",
        ).bind(invitation.id, account, now, hash, now, invitation.id),
        env.DB.prepare(
          "UPDATE places_family_invites SET used_by=? WHERE token_hash=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM places_family_members WHERE family_id=? AND account_id=?)",
        ).bind(account, hash, invitation.id, account),
      ]);
      const joined = await details(env, account);
      if (joined?.id !== invitation.id) {
        const remaining = await env.DB.prepare(
          "SELECT 1 FROM places_family_invites WHERE token_hash=? AND expires_at>? AND used_by IS NULL",
        )
          .bind(hash, now)
          .first();
        throw new WorkspaceError(
          remaining ? 409 : 410,
          remaining ? "familyFull" : "invalidFamilyInvite",
        );
      }
    } else {
      if (!family) throw new WorkspaceError(403, "familyAccessEnded");
      if (b.action === "leave") {
        if (family.ownerId === account) throw new WorkspaceError(409, "familyTransferFirst");
        await env.DB.prepare(
          "DELETE FROM places_family_members WHERE family_id=? AND account_id=? AND NOT EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?)",
        )
          .bind(family.id, account, family.id, account)
          .run();
      } else {
        if (family.ownerId !== account) throw new WorkspaceError(403, "familyOwnerOnly");
        if (b.action === "invite") {
          const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
          const expiresAt = now + 7 * 86400000;
          await env.DB.prepare(
            "INSERT INTO places_family_invites(family_id,token_hash,expires_at,used_by) SELECT ?,?,?,NULL WHERE EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?) ON CONFLICT(family_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,used_by=NULL",
          )
            .bind(family.id, await digest(raw), expiresAt, family.id, account)
            .run();
          return Response.json({ token: raw, expiresAt });
        }
        if (b.action === "revoke")
          await env.DB.prepare(
            "DELETE FROM places_family_invites WHERE family_id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?)",
          )
            .bind(family.id, family.id, account)
            .run();
        if (b.action === "remove") {
          if (!b.member || b.member === account)
            throw new WorkspaceError(422, "invalidFamilyAction");
          await env.DB.prepare(
            "DELETE FROM places_family_members WHERE family_id=? AND account_id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=? AND owner_id<>?)",
          )
            .bind(family.id, b.member, family.id, account, b.member)
            .run();
        }
        if (b.action === "transfer") {
          if (!b.member || !family.members.some((m) => m.id === b.member))
            throw new WorkspaceError(422, "invalidFamilyAction");
          await env.DB.prepare(
            "UPDATE places_families SET owner_id=? WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM places_family_members WHERE family_id=? AND account_id=?)",
          )
            .bind(b.member, family.id, account, family.id, b.member)
            .run();
        }
        if (b.action === "delete")
          await env.DB.prepare(
            "DELETE FROM places_accounts WHERE id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?)",
          )
            .bind(family.id, family.id, account)
            .run();
      }
    }
    return Response.json({ family: await details(env, account) });
  } catch (error) {
    return Response.json(
      { error: error instanceof WorkspaceError ? error.message : "serviceUnavailable" },
      { status: error instanceof WorkspaceError ? error.status : 503 },
    );
  }
}
