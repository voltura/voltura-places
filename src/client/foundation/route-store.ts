import type { DBSchema } from "idb";
import { abortTransaction, localDatabase } from "./database";
import { canonicalGeometry, ROUTE_QUOTA, type RouteGeometry } from "../../shared/routes";
import { workspaceIdentity } from "../../shared/families";

export type StoredGeometry = {
  workspace: string;
  id: string;
  canonical: string;
  bytes: number;
};
interface RouteDB extends DBSchema {
  geometry: { key: [string, string]; value: StoredGeometry; indexes: { workspace: string } };
}
const database = localDatabase<RouteDB>("voltura-places-routes", 1, (db) => {
  db.createObjectStore("geometry", { keyPath: ["workspace", "id"] }).createIndex(
    "workspace",
    "workspace",
  );
});

export async function getGeometry(workspace: string, id: string) {
  return (await database()).get("geometry", [workspace, id]);
}

export async function geometryUsage(workspace: string) {
  const db = await database();
  let total = 0;
  let cursor = await db.transaction("geometry").store.index("workspace").openCursor(workspace);
  while (cursor) {
    total += cursor.value.bytes;
    cursor = await cursor.continue();
  }

  return total;
}

export async function putGeometry(workspace: string, input: RouteGeometry, isCurrent = () => true) {
  const validated = await canonicalGeometry(input);
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const db = await database();
  const tx = db.transaction("geometry", "readwrite");
  try {
    const previous = await tx.store.get([workspace, validated.id]);
    if (!previous) {
      let total = validated.bytes;
      let cursor = await tx.store.index("workspace").openCursor(workspace);
      while (cursor) {
        total += cursor.value.bytes;
        cursor = await cursor.continue();
      }
      if (total > ROUTE_QUOTA) {
        throw new Error("routeQuota");
      }
      await tx.store.add({
        workspace,
        id: validated.id,
        canonical: validated.canonical,
        bytes: validated.bytes,
      });
    }
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }

  return validated;
}

export async function clearGeometry(workspace: string, account = false) {
  const db = await database();
  const tx = db.transaction("geometry", "readwrite");
  try {
    await tx.store.delete(IDBKeyRange.bound([workspace], [workspace, []]));
    if (account) {
      const prefix = `family:${workspace}:`;
      for (const key of await tx.store.getAllKeys(
        IDBKeyRange.bound([prefix], [prefix + "\uffff"]),
      )) {
        if (workspaceIdentity(key[0]).account === workspace) {
          await tx.store.delete(key);
        }
      }
    }
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
}
