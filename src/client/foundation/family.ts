import {
  familySchema,
  familyStateSchema,
  workspaceIdentity,
  type Family,
} from "../../shared/families";
import { api } from "./sync";
export type FamilyCache = {
  families: Family[];
  inactive: Family[];
};
const empty = (): FamilyCache => ({ families: [], inactive: [] });
export function cachedFamily(account?: string): FamilyCache {
  if (!account) return empty();
  try {
    const value = JSON.parse(localStorage.getItem(`places-family:${account}`) ?? "null");
    if (Array.isArray(value.families)) {
      const families = value.families.map((f: unknown) => familySchema.parse(f)) as Family[],
        inactive = (value.inactive ?? []).map((f: unknown) => familySchema.parse(f)) as Family[];
      return {
        families,
        inactive,
      };
    }
    const family = familySchema.nullable().parse(value.family);
    return {
      families: family && value.active === true ? [family] : [],
      inactive: family && value.active !== true ? [family] : [],
    };
  } catch {
    return empty();
  }
}
export function storeFamilies(account: string, families: Family[]) {
  const previous = cachedFamily(account),
    ids = new Set(families.map((f) => f.id));
  const inactive = [...previous.families, ...previous.inactive].filter((f) => !ids.has(f.id));
  const unique = [...new Map(inactive.map((f) => [f.id, f])).values()];
  const value: FamilyCache = {
    families,
    inactive: unique,
  };
  try {
    localStorage.setItem(`places-family:${account}`, JSON.stringify(value));
  } catch {}
  return value;
}
export async function fetchFamily(account: string) {
  const response = familyStateSchema.parse(await api("/api/family", undefined, account));
  return response.families;
}
export function initialWorkspace(account?: string) {
  if (!account) return "guest";
  try {
    const key = localStorage.getItem(`places-workspace:${account}`);
    if (
      key &&
      workspaceIdentity(key).account === account &&
      [...cachedFamily(account).families, ...cachedFamily(account).inactive].some(
        (f) => f.id === workspaceIdentity(key).family,
      )
    )
      return key;
  } catch {}
  return account;
}
