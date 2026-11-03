import { api, ApiError } from "./http";
import { accountIdSchema, accountStateSchema, type AccountState } from "./account-contract";

const empty: AccountState = { enabled: false, providers: {}, account: null };
let identityRevision = 0;
let memoryPending: string | undefined;
let pendingWriteFailed = false;
let ignoredPending: string | undefined;
let hiddenAccountId: string | undefined;
const signingOut = new Map<string, Promise<void>>();

function accountCache() {
  try {
    return localStorage.getItem("places-account");
  } catch {
    return null;
  }
}

function pendingLogout() {
  if (pendingWriteFailed) {
    return memoryPending;
  }
  try {
    const saved = localStorage.getItem("places-pending-logout");
    if (saved !== ignoredPending) {
      ignoredPending = undefined;
    }
    memoryPending =
      saved && saved !== ignoredPending && accountIdSchema.safeParse(saved).success
        ? saved
        : undefined;
  } catch {}

  return memoryPending;
}

function clearPending(expected: string) {
  if (memoryPending === expected) {
    memoryPending = undefined;
    pendingWriteFailed = false;
  }
  try {
    if (localStorage.getItem("places-pending-logout") === expected) {
      localStorage.removeItem("places-pending-logout");
    }
  } catch {
    ignoredPending = expected;
  }
}

function completeLogout(id: string) {
  const pending = signingOut.get(id);
  if (pending) {
    return pending;
  }
  const request = api("/api/account/sign-out", {}, id)
    .then(() => clearPending(id))
    .catch((error) => {
      if (!(error instanceof ApiError && error.status === 409)) {
        throw error;
      }
      clearPending(id);
    })
    .finally(() => signingOut.delete(id));
  signingOut.set(id, request);

  return request;
}

export function cachedAccount(): AccountState {
  try {
    if (pendingLogout()) {
      return empty;
    }

    const saved = accountCache();
    if (!saved) {
      return empty;
    }
    const state = accountStateSchema.parse(JSON.parse(saved));

    return state.account?.id && state.account.id === hiddenAccountId ? empty : state;
  } catch {
    return empty;
  }
}

export async function currentAccount(): Promise<AccountState> {
  const revision = ++identityRevision;
  const pending = pendingLogout();
  if (pending) {
    try {
      await completeLogout(pending);
    } catch {
      // Public provider discovery must remain usable while a private logout retries.
      const config = await api<Record<string, unknown>>("/api/account/config");

      return accountStateSchema.parse({ ...config, account: null });
    }
  }
  const previous = accountCache();
  const result = accountStateSchema.parse(await api("/api/account"));
  const serialized = JSON.stringify(result);
  const latest = accountCache();
  if (
    revision !== identityRevision ||
    pendingLogout() ||
    (previous !== latest && latest !== serialized)
  ) {
    throw new Error("accountChanged");
  }
  try {
    if (latest !== serialized) {
      localStorage.setItem("places-account", serialized);
    }
    hiddenAccountId = undefined;
  } catch {}

  return result;
}

export async function finishPendingLogout() {
  const pending = pendingLogout();
  if (pending) {
    // Finish before creating any new provider proof or session for the same account.
    await completeLogout(pending);
  }
}

export async function signOutLocally(accountId?: string) {
  identityRevision++;
  if (!accountId || !accountIdSchema.safeParse(accountId).success) {
    return;
  }
  memoryPending = accountId;
  ignoredPending = undefined;
  hiddenAccountId = accountId;
  // Hide the account workspace immediately, even when logout cannot reach the server.
  try {
    localStorage.setItem("places-pending-logout", accountId);
    pendingWriteFailed = false;
  } catch {
    pendingWriteFailed = true;
  }
  try {
    localStorage.removeItem("places-account");
  } catch {}
  try {
    await completeLogout(accountId);
  } catch {}
}
