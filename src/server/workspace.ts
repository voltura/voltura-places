import { sessionFor } from "./accounts.js";
import { familyKey } from "../shared/families";
import type { Environment } from "./types";
export const membershipSQL =
  "(? IS NULL OR EXISTS(SELECT 1 FROM places_family_members WHERE family_id=? AND account_id=?))";
export const membershipArgs = (identity: { family: string | null; account: string }) => [
  identity.family,
  identity.family,
  identity.account,
];
export class WorkspaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authorizedWorkspace(request: Request, env: Environment) {
  const session = (await sessionFor(request, env, env.DB)) as { account_id: string } | null;
  if (!session) throw new WorkspaceError(401, "signInAgain");
  if (request.headers.get("X-Places-Account") !== session.account_id)
    throw new WorkspaceError(409, "accountChanged");
  const family = request.headers.get("X-Places-Family");
  if (
    family &&
    !(await env.DB.prepare("SELECT 1 FROM places_family_members WHERE family_id=? AND account_id=?")
      .bind(family, session.account_id)
      .first())
  )
    throw new WorkspaceError(403, "familyAccessEnded");
  return {
    account: session.account_id,
    storage: family ?? session.account_id,
    key: family ? familyKey(session.account_id, family) : session.account_id,
    family,
  };
}
export function requireOrigin(request: Request, env: Environment) {
  if (
    request.headers.get("Origin") !== env.AUTH_ORIGIN ||
    new URL(request.url).origin !== env.AUTH_ORIGIN ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    throw new WorkspaceError(403, "invalidOrigin");
}
