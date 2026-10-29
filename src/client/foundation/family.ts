import {
  familySchema,
  familyStateSchema,
  workspaceIdentity,
  type Family,
} from "../../shared/families";
import { api } from "./sync";
export type FamilyCache = { family: Family | null; active: boolean };
export function cachedFamily(account?: string): FamilyCache {
  if (!account) return { family: null, active: false };
  try {
    const value = JSON.parse(localStorage.getItem(`places-family:${account}`) ?? "null");
    return { family: familySchema.nullable().parse(value.family), active: value.active === true };
  } catch {
    return { family: null, active: false };
  }
}
export function storeFamily(account: string, family: Family | null) {
  const value = { family: family ?? cachedFamily(account).family, active: !!family };
  try {
    localStorage.setItem(`places-family:${account}`, JSON.stringify(value));
  } catch {}
  return value;
}
export async function fetchFamily(account: string) {
  const response = familyStateSchema.parse(await api("/api/family", undefined, account));
  return { family: response.family ?? cachedFamily(account).family, active: !!response.family };
}
export function initialWorkspace(account?: string) {
  if (!account) return "guest";
  try {
    const key = localStorage.getItem(`places-workspace:${account}`);
    if (
      key &&
      workspaceIdentity(key).account === account &&
      workspaceIdentity(key).family === cachedFamily(account).family?.id
    )
      return key;
  } catch {}
  return account;
}
export function familyInvitation() {
  const token = /^#family=([A-Za-z0-9_-]{43})$/.exec(location.hash)?.[1];
  if (token) return token;
  try {
    const saved = sessionStorage.getItem("places-family-invite");
    return saved && /^[A-Za-z0-9_-]{43}$/.test(saved) ? saved : null;
  } catch {
    return null;
  }
}
export function rememberInvitation(token: string | null) {
  try {
    if (token) sessionStorage.setItem("places-family-invite", token);
    else sessionStorage.removeItem("places-family-invite");
  } catch {}
}
