import { z } from "zod";
import { api, ApiError, type AccountState } from "./sync";
const stateSchema = z.object({
  enabled: z.boolean(),
  providers: z.object({
    google: z.boolean().optional(),
    email: z.boolean().optional(),
    chatgpt: z.boolean().optional(),
  }),
  account: z
    .object({
      id: z.string(),
      methods: z.array(z.object({ provider: z.string(), label: z.string() })),
    })
    .nullable(),
});
const empty: AccountState = { enabled: false, providers: {}, account: null };
let identityRevision = 0;
function clearPending(expected: string) {
  if (localStorage.getItem("places-pending-logout") === expected)
    localStorage.removeItem("places-pending-logout");
}
export function cachedAccount(): AccountState {
  try {
    if (localStorage.getItem("places-pending-logout")) return empty;
    return stateSchema.parse(JSON.parse(localStorage.getItem("places-account") ?? "null"));
  } catch {
    return empty;
  }
}
export async function currentAccount(): Promise<AccountState> {
  const revision = ++identityRevision;
  const pending = localStorage.getItem("places-pending-logout");
  if (pending) {
    try {
      await api("/api/account/sign-out", {}, pending);
      clearPending(pending);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) clearPending(pending);
      else return { ...empty, providers: cachedAccount().providers };
    }
  }
  const result = stateSchema.parse(await api("/api/account"));
  if (revision !== identityRevision) throw new Error("accountChanged");
  try {
    localStorage.setItem("places-account", JSON.stringify(result));
  } catch {}
  return result;
}
export async function signOutLocally(accountId?: string) {
  identityRevision++;
  // Hide the account workspace immediately, even when logout cannot reach the server.
  try {
    localStorage.removeItem("places-account");
    if (accountId) localStorage.setItem("places-pending-logout", accountId);
  } catch {}
  try {
    await api("/api/account/sign-out", {}, accountId);
    if (accountId) clearPending(accountId);
  } catch (error) {
    if (accountId && error instanceof ApiError && error.status === 409) clearPending(accountId);
  }
}
