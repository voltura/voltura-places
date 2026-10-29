import { z } from "zod";
import { api, type AccountState } from "./sync";
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
export function cachedAccount(): AccountState {
  try {
    if (localStorage.getItem("places-pending-logout")) return empty;
    return stateSchema.parse(JSON.parse(localStorage.getItem("places-account") ?? "null"));
  } catch {
    return empty;
  }
}
export async function currentAccount(): Promise<AccountState> {
  const pending = localStorage.getItem("places-pending-logout");
  if (pending) {
    try {
      await api("/api/account/sign-out", {}, pending);
      localStorage.removeItem("places-pending-logout");
    } catch {
      return { ...empty, providers: cachedAccount().providers };
    }
  }
  const result = stateSchema.parse(await api("/api/account"));
  try {
    localStorage.setItem("places-account", JSON.stringify(result));
  } catch {}
  return result;
}
export async function signOutLocally(accountId?: string) {
  // Hide the account workspace immediately, even when logout cannot reach the server.
  try {
    localStorage.removeItem("places-account");
    if (accountId) localStorage.setItem("places-pending-logout", accountId);
  } catch {}
  try {
    await api("/api/account/sign-out", {}, accountId);
    localStorage.removeItem("places-pending-logout");
  } catch {}
}
