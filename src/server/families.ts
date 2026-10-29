import { z } from "zod";
import { readJSON } from "./accounts.js";
import { authorizedWorkspace, requireOrigin, WorkspaceError } from "./workspace";
import { starters } from "../shared/model";
import type { Environment } from "./types";
import { handleFamilyCode, codeRequests, pendingRequest } from "./family-codes";
async function details(env: Environment, account: string, id: string) {
  const family = await env.DB.prepare(
    "SELECT f.id,f.name,f.owner_id AS ownerId FROM places_families f JOIN places_family_members m ON m.family_id=f.id WHERE m.account_id=? AND f.id=?",
  )
    .bind(account, id)
    .first<{ id: string; name: string; ownerId: string }>();
  if (!family) return null;
  const members = await env.DB.prepare(
    "SELECT m.account_id AS id, COALESCE((SELECT MIN(label) FROM places_identities i WHERE i.account_id=m.account_id),'Member') AS label FROM places_family_members m WHERE m.family_id=? ORDER BY m.joined_at,m.account_id",
  )
    .bind(family.id)
    .all<{ id: string; label: string }>();
  return {
    ...family,
    members: members.results,
    requests: family.ownerId === account ? await codeRequests(env, family.id) : [],
  };
}
async function allDetails(env: Environment, account: string) {
  const rows = await env.DB.prepare(
    "SELECT f.id,f.name,f.owner_id AS ownerId FROM places_families f JOIN places_family_members m ON m.family_id=f.id WHERE m.account_id=? ORDER BY f.created_at,f.id LIMIT 20",
  )
    .bind(account)
    .all<{ id: string; name: string; ownerId: string }>();
  if (!rows.results.length) return [];
  const [members, requests] = await Promise.all([
    env.DB.prepare(
      "SELECT m.family_id AS familyId,m.account_id AS id,COALESCE((SELECT MIN(label) FROM places_identities i WHERE i.account_id=m.account_id),'Member') AS label FROM places_family_members m WHERE m.family_id IN (SELECT family_id FROM places_family_members WHERE account_id=?) ORDER BY m.joined_at,m.account_id",
    )
      .bind(account)
      .all<{ familyId: string; id: string; label: string }>(),
    env.DB.prepare(
      "SELECT r.family_id AS familyId,r.account_id AS id,COALESCE((SELECT MIN(label) FROM places_identities i WHERE i.account_id=r.account_id),'Member') AS label FROM places_family_requests r JOIN places_family_codes c ON c.family_id=r.family_id AND c.code_hash=r.code_hash JOIN places_families f ON f.id=r.family_id WHERE f.owner_id=? AND c.expires_at>? AND r.family_id IN (SELECT family_id FROM places_family_members WHERE account_id=?) ORDER BY r.created_at,r.account_id",
    )
      .bind(account, Date.now(), account)
      .all<{ familyId: string; id: string; label: string }>(),
  ]);
  return rows.results.map((group) => ({
    ...group,
    members: members.results
      .filter((m) => m.familyId === group.id)
      .map(({ id, label }) => ({ id, label })),
    requests: requests.results
      .filter((r) => r.familyId === group.id)
      .slice(0, 5)
      .map(({ id, label }) => ({ id, label })),
  }));
}
async function state(env: Environment, account: string, preferred: string | null = null) {
  const families = await allDetails(env, account);
  return {
    familyId: families.some((f) => f.id === preferred) ? preferred : undefined,
    families,
    pendingRequest: await pendingRequest(env, account),
  };
}
export async function handleFamilies(request: Request, env: Environment) {
  try {
    if (request.headers.has("X-Places-Family"))
      throw new WorkspaceError(400, "invalidFamilyAction");
    const { account } = await authorizedWorkspace(request, env);
    if (request.method === "GET") return Response.json(await state(env, account));
    if (request.method !== "POST") throw new WorkspaceError(405, "methodNotAllowed");
    requireOrigin(request, env);
    const body = z
      .object({
        action: z.enum([
          "create",
          "revoke",
          "remove",
          "leave",
          "transfer",
          "delete",
          "code-create",
          "code-request",
          "code-approve",
          "code-reject",
        ]),
        name: z.string().trim().min(1).max(80).optional(),
        member: z.string().max(80).optional(),
        familyId: z.string().uuid().optional(),
        code: z
          .string()
          .regex(/^\d{4}$/)
          .optional(),
      })
      .strict()
      .safeParse(await readJSON(request, 2048));
    if (!body.success) throw new WorkspaceError(422, "invalidFamilyAction");
    const b = body.data,
      now = Date.now();
    if (!["create", "code-request"].includes(b.action) && !b.familyId)
      throw new WorkspaceError(422, "invalidFamilyAction");
    const family = b.familyId ? await details(env, account, b.familyId) : null;
    let responseFamilyId = family?.id ?? null;
    const codeResponse = await handleFamilyCode(b, request, env, account, family);
    if (codeResponse) return codeResponse;
    if (b.action === "create") {
      if (!b.name) throw new WorkspaceError(422, "invalidFamilyAction");
      if ((await allDetails(env, account)).length >= 20)
        throw new WorkspaceError(409, "familyGroupLimit");
      const id = crypto.randomUUID();
      responseFamilyId = id;
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO places_accounts(id,created_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM places_family_members WHERE account_id=?)<20",
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
      if (!(await details(env, account, id))) throw new WorkspaceError(409, "familyGroupLimit");
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
        if (b.action === "revoke") {
          await env.DB.prepare(
            "DELETE FROM places_family_codes WHERE family_id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?)",
          )
            .bind(family.id, family.id, account)
            .run();
        }
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
    return Response.json(await state(env, account, responseFamilyId));
  } catch (error) {
    return Response.json(
      { error: error instanceof WorkspaceError ? error.message : "serviceUnavailable" },
      { status: error instanceof WorkspaceError ? error.status : 503 },
    );
  }
}
