import { hasCanonicalOrigin } from "./http";
import { sessionFor, accountConfiguration } from "./accounts";
import { familyKey } from "../shared/families";
import type { Environment } from "./types";

export const currentSessionSQL =
  "EXISTS(SELECT 1 FROM places_sessions WHERE token_hash=? AND account_id=? AND expires_at>unixepoch('subsec')*1000)";

export const currentSessionArgs = (identity: { account: string; sessionHash: string }) => [
  identity.sessionHash,
  identity.account,
];

export const membershipSQL = `((? IS NULL OR EXISTS(SELECT 1 FROM places_family_members WHERE family_id=? AND account_id=?)) AND ${currentSessionSQL})`;

export const membershipArgs = (identity: {
  family: string | null;
  account: string;
  sessionHash: string;
}) => [identity.family, identity.family, identity.account, ...currentSessionArgs(identity)];

export class WorkspaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function authorizedWorkspace(request: Request, env: Environment) {
  if (!accountConfiguration(env, request).enabled) {
    throw new WorkspaceError(503, "serviceUnavailable");
  }
  const family = request.headers.get("X-Places-Family");
  const session = await sessionFor(request, env, env.DB, family);
  if (!session) {
    throw new WorkspaceError(401, "signInAgain");
  }
  if (request.headers.get("X-Places-Account") !== session.account_id) {
    throw new WorkspaceError(409, "accountChanged");
  }
  if (family !== null && !session.is_member) {
    throw new WorkspaceError(403, "familyAccessEnded");
  }

  return {
    account: session.account_id,
    sessionHash: session.token_hash,
    storage: family ?? session.account_id,
    key: family ? familyKey(session.account_id, family) : session.account_id,
    family,
  };
}

export function requireOrigin(request: Request, env: Environment) {
  if (!hasCanonicalOrigin(request, env.AUTH_ORIGIN)) {
    throw new WorkspaceError(403, "invalidOrigin");
  }
}
