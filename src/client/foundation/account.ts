import { api, ApiError } from "./http";
import { accountStateSchema, type AccountState } from "./account-contract";

const empty: AccountState = { enabled: false, providers: {}, account: null };
let identityRevision = 0;
let memoryPending: string | undefined;

function pendingLogout() {
  if (memoryPending) {
    return memoryPending;
  }
  try {
    return localStorage.getItem("places-pending-logout");
  } catch {
    return null;
  }
}

function clearPending(expected: string) {
  if (memoryPending === expected) {
    memoryPending = undefined;
  }
  try {
    if (localStorage.getItem("places-pending-logout") === expected) {
      localStorage.removeItem("places-pending-logout");
    }
  } catch {}
}

export function cachedAccount(): AccountState {
  try {
    if (pendingLogout()) {
      return empty;
    }

    return accountStateSchema.parse(JSON.parse(localStorage.getItem("places-account") ?? "null"));
  } catch {
    return empty;
  }
}

export async function currentAccount(): Promise<AccountState> {
  const revision = ++identityRevision;
  const pending = pendingLogout();
  if (pending) {
    try {
      await api("/api/account/sign-out", {}, pending);
      clearPending(pending);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        clearPending(pending);
      } else {
        return { ...empty, providers: cachedAccount().providers };
      }
    }
  }
  const result = accountStateSchema.parse(await api("/api/account"));
  if (revision !== identityRevision) {
    throw new Error("accountChanged");
  }
  try {
    localStorage.setItem("places-account", JSON.stringify(result));
  } catch {}

  return result;
}

export async function signOutLocally(accountId?: string) {
  identityRevision++;
  if (accountId) {
    memoryPending = accountId;
  }
  // Hide the account workspace immediately, even when logout cannot reach the server.
  try {
    localStorage.removeItem("places-account");
    if (accountId) {
      localStorage.setItem("places-pending-logout", accountId);
    }
  } catch {}
  try {
    await api("/api/account/sign-out", {}, accountId);
    if (accountId) {
      clearPending(accountId);
    }
  } catch (error) {
    if (accountId && error instanceof ApiError && error.status === 409) {
      clearPending(accountId);
    }
  }
}
