import {
  familySchema,
  familyStateSchema,
  workspaceIdentity,
  type Family,
} from "../../shared/families";
import { api } from "./http";

export type FamilyCache = {
  families: Family[];
  inactive: Family[];
};

const empty = (): FamilyCache => ({ families: [], inactive: [] });

const savedFamilies = new WeakMap<FamilyCache, { active: string; encoded: string }>();

function archivedFamily({ id, name }: Family): Family {
  return { id, name, ownerId: "", members: [], requests: [] };
}

function readGroups(input: unknown, seen: Set<string>): Family[] {
  const groups: Family[] = [];
  if (Array.isArray(input)) {
    for (const candidate of input) {
      const parsed = familySchema.safeParse(candidate);
      if (parsed.success && !seen.has(parsed.data.id)) {
        seen.add(parsed.data.id);
        groups.push(parsed.data);
      }
    }
  }

  return groups;
}

function decodeFamily(raw: string | null): FamilyCache {
  try {
    if (!raw) {
      return empty();
    }
    const value = JSON.parse(raw);
    if (Array.isArray(value.families)) {
      const seen = new Set<string>();
      const families = readGroups(value.families, seen);
      const inactive = readGroups(value.inactive, seen).map(archivedFamily);

      return {
        families,
        inactive,
      };
    }
    const family = familySchema.nullable().parse(value.family);

    return {
      families: family && value.active === true ? [family] : [],
      inactive: family && value.active !== true ? [archivedFamily(family)] : [],
    };
  } catch {
    return empty();
  }
}

export function cachedFamily(account?: string): FamilyCache {
  try {
    return account ? decodeFamily(localStorage.getItem(`places-family:${account}`)) : empty();
  } catch {
    return empty();
  }
}

export function storeFamilies(
  account: string,
  families: Family[],
  previous = cachedFamily(account),
) {
  const serialized = JSON.stringify(families);
  const saved = savedFamilies.get(previous);
  const key = `places-family:${account}`;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {}
  if (saved?.active === serialized && saved.encoded === raw) {
    return previous;
  }
  const disk = raw && raw !== saved?.encoded ? decodeFamily(raw) : empty();
  const ids = new Set(families.map((f) => f.id));
  const inactive = [
    ...previous.inactive,
    ...disk.inactive,
    ...disk.families,
    ...previous.families,
  ].filter((f) => !ids.has(f.id));
  const unique = [...new Map(inactive.map((f) => [f.id, f])).values()].map(archivedFamily);
  const value: FamilyCache = {
    families,
    inactive: unique,
  };
  try {
    const encoded = JSON.stringify(value);
    if (raw !== encoded) {
      localStorage.setItem(key, encoded);
    }
    savedFamilies.set(value, { active: serialized, encoded });
  } catch {}

  return value;
}

export async function fetchFamily(account: string) {
  const response = familyStateSchema.parse(await api("/api/family", undefined, account));

  return response.families;
}

export function initialWorkspace(account?: string) {
  if (!account) {
    return "guest";
  }
  try {
    const key = localStorage.getItem(`places-workspace:${account}`);
    if (key) {
      const identity = workspaceIdentity(key);
      if (identity.family && identity.account === account) {
        const cache = cachedFamily(account);
        if (
          [cache.families, cache.inactive].some((groups) =>
            groups.some((f) => f.id === identity.family),
          )
        ) {
          return key;
        }
      }
    }
  } catch {}

  return account;
}
