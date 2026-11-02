import { z } from "zod";
import { readJSON, RequestError } from "./http";
import {
  authorizedWorkspace,
  currentSessionSQL,
  currentSessionArgs,
  requireOrigin,
  WorkspaceError,
} from "./workspace";
import { starters } from "../shared/model";
import type { Environment } from "./types";
import {
  handleFamilyCode,
  pendingRequest,
  checkedPending,
  invitationVersion,
} from "./family-codes";

const actionSchema = z
  .object({
    action: z.enum([
      "create",
      "rename",
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
    invitationVersion: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    code: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
  })
  .strict();

async function details(env: Environment, account: string, id: string) {
  return env.DB.prepare(
    "SELECT f.id,f.owner_id AS ownerId FROM places_families f JOIN places_family_members m ON m.family_id=f.id WHERE m.account_id=? AND f.id=?",
  )
    .bind(account, id)
    .first<{ id: string; ownerId: string }>();
}

async function state(
  env: Environment,
  identity: { account: string; sessionHash: string },
  preferred: string | null = null,
) {
  const now = Date.now();
  const { account } = identity;
  const [rows, members, requests, invitations, pending] = (await env.DB.batch([
    env.DB.prepare(
      "SELECT f.id,f.name,f.owner_id AS ownerId FROM places_families f JOIN places_family_members m ON m.family_id=f.id WHERE m.account_id=? ORDER BY f.created_at,f.id LIMIT 20",
    ).bind(account),
    env.DB.prepare(
      "SELECT m.family_id AS familyId,m.account_id AS id,COALESCE(a.display_name,(SELECT MIN(label) FROM places_identities i WHERE i.account_id=m.account_id),'Member') AS label FROM places_family_members m JOIN places_accounts a ON a.id=m.account_id WHERE m.family_id IN (SELECT family_id FROM places_family_members WHERE account_id=?) ORDER BY m.joined_at,m.account_id",
    ).bind(account),
    env.DB.prepare(
      "SELECT r.family_id AS familyId,r.account_id AS id,COALESCE(a.display_name,(SELECT MIN(label) FROM places_identities i WHERE i.account_id=r.account_id),'Member') AS label FROM places_family_requests r JOIN places_accounts a ON a.id=r.account_id JOIN places_family_codes c ON c.family_id=r.family_id AND c.code_hash=r.code_hash JOIN places_families f ON f.id=r.family_id WHERE f.owner_id=? AND (c.expires_at=0 OR c.expires_at>?) AND r.family_id IN (SELECT family_id FROM places_family_members WHERE account_id=?) ORDER BY r.created_at,r.account_id",
    ).bind(account, now, account),
    env.DB.prepare(
      "SELECT c.family_id AS familyId,c.code_hash AS hash,c.generation FROM places_family_codes c JOIN places_families f ON f.id=c.family_id WHERE f.owner_id=? AND (c.expires_at=0 OR c.expires_at>?)",
    ).bind(account, now),
    pendingRequest(env, identity),
  ])) as [
    D1Result<{ id: string; name: string; ownerId: string }>,
    D1Result<{ familyId: string; id: string; label: string }>,
    D1Result<{ familyId: string; id: string; label: string }>,
    D1Result<{ familyId: string; hash: string; generation: string }>,
    D1Result<{ expiresAt: number | null }>,
  ];
  const checkedRequest = checkedPending(pending.results[0]);
  const versions = new Map(
    await Promise.all(
      invitations.results.map(
        async (c) =>
          [c.familyId, await invitationVersion(env, c.familyId, c.hash, c.generation)] as const,
      ),
    ),
  );

  const membersByGroup = Map.groupBy(members.results, (m) => m.familyId);
  const requestsByGroup = Map.groupBy(requests.results, (r) => r.familyId);
  const families = rows.results.map((group) => ({
    ...group,
    ...(group.ownerId === account ? { invitationVersion: versions.get(group.id) ?? null } : {}),
    members: (membersByGroup.get(group.id) ?? []).map(({ id, label }) => ({ id, label })),
    requests: (requestsByGroup.get(group.id) ?? [])
      .slice(0, 5)
      .map(({ id, label }) => ({ id, label })),
  }));

  return {
    familyId: families.some((f) => f.id === preferred) ? preferred : undefined,
    families,
    pendingRequest: checkedRequest,
  };
}

export async function handleFamilies(request: Request, env: Environment) {
  try {
    if (request.headers.has("X-Places-Family")) {
      throw new WorkspaceError(400, "invalidFamilyAction");
    }
    const identity = await authorizedWorkspace(request, env);
    const { account } = identity;
    const sessionArgs = currentSessionArgs(identity);
    if (request.method === "GET") {
      return Response.json(await state(env, identity));
    }
    if (request.method !== "POST") {
      throw new WorkspaceError(405, "methodNotAllowed");
    }
    requireOrigin(request, env);
    const body = actionSchema.safeParse(await readJSON(request, 2048));
    if (!body.success) {
      throw new WorkspaceError(422, "invalidFamilyAction");
    }
    const b = body.data;
    const now = Date.now();
    if (!["create", "code-request"].includes(b.action) && !b.familyId) {
      throw new WorkspaceError(422, "invalidFamilyAction");
    }
    const family = b.familyId ? await details(env, account, b.familyId) : null;
    let responseFamilyId = family?.id ?? null;
    const codeResponse = await handleFamilyCode(b, request, env, identity, family);
    if (codeResponse) {
      return codeResponse;
    }
    if (b.action === "create") {
      if (!b.name) {
        throw new WorkspaceError(422, "invalidFamilyAction");
      }
      const id = crypto.randomUUID();
      responseFamilyId = id;
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO places_accounts(id,created_at) SELECT ?,? WHERE (SELECT COUNT(*) FROM places_family_members WHERE account_id=?)<20 AND ${currentSessionSQL}`,
        ).bind(id, now, account, ...sessionArgs),
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
      if (!results[0].meta.changes) {
        throw new WorkspaceError(409, "familyGroupLimit");
      }
    } else {
      if (!family) {
        throw new WorkspaceError(403, "familyAccessEnded");
      }
      if (b.action === "leave") {
        if (family.ownerId === account) {
          throw new WorkspaceError(409, "familyTransferFirst");
        }
        const result = await env.DB.prepare(
          `DELETE FROM places_family_members WHERE family_id=? AND account_id=? AND NOT EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?) AND ${currentSessionSQL}`,
        )
          .bind(family.id, account, family.id, account, ...sessionArgs)
          .run();
        if (!result.meta.changes && (await details(env, account, family.id))?.ownerId === account) {
          throw new WorkspaceError(409, "familyTransferFirst");
        }
      } else {
        if (family.ownerId !== account) {
          throw new WorkspaceError(403, "familyOwnerOnly");
        }
        if (b.action === "rename") {
          if (!b.name) {
            throw new WorkspaceError(422, "invalidFamilyAction");
          }
          const result = await env.DB.prepare(
            `UPDATE places_families SET name=? WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM places_family_members WHERE family_id=? AND account_id=?) AND ${currentSessionSQL}`,
          )
            .bind(b.name, family.id, account, family.id, account, ...sessionArgs)
            .run();
          if (!result.meta.changes) {
            throw new WorkspaceError(403, "familyOwnerOnly");
          }
        }
        if (b.action === "remove") {
          if (!b.member || b.member === account) {
            throw new WorkspaceError(422, "invalidFamilyAction");
          }
          const result = await env.DB.prepare(
            `DELETE FROM places_family_members WHERE family_id=? AND account_id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=? AND owner_id<>?) AND ${currentSessionSQL}`,
          )
            .bind(family.id, b.member, family.id, account, b.member, ...sessionArgs)
            .run();
          if (
            !result.meta.changes &&
            (await details(env, account, family.id))?.ownerId !== account
          ) {
            throw new WorkspaceError(403, "familyOwnerOnly");
          }
        }
        if (b.action === "transfer") {
          if (!b.member || b.member === account) {
            throw new WorkspaceError(422, "invalidFamilyAction");
          }
          const result = await env.DB.prepare(
            `UPDATE places_families SET owner_id=? WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM places_family_members WHERE family_id=? AND account_id=?) AND ${currentSessionSQL}`,
          )
            .bind(b.member, family.id, account, family.id, b.member, ...sessionArgs)
            .run();
          if (!result.meta.changes) {
            throw new WorkspaceError(422, "invalidFamilyAction");
          }
        }
        if (b.action === "delete") {
          const result = await env.DB.prepare(
            `DELETE FROM places_accounts WHERE id=? AND EXISTS(SELECT 1 FROM places_families WHERE id=? AND owner_id=?) AND ${currentSessionSQL}`,
          )
            .bind(family.id, family.id, account, ...sessionArgs)
            .run();
          if (
            !result.meta.changes &&
            (await env.DB.prepare("SELECT 1 FROM places_families WHERE id=?")
              .bind(family.id)
              .first())
          ) {
            throw new WorkspaceError(403, "familyOwnerOnly");
          }
        }
      }
    }

    return Response.json(await state(env, identity, responseFamilyId));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof WorkspaceError
            ? error.message
            : error instanceof RequestError
              ? "invalidFamilyAction"
              : "serviceUnavailable",
      },
      {
        status:
          error instanceof WorkspaceError || error instanceof RequestError ? error.status : 503,
      },
    );
  }
}
