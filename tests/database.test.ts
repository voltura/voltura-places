import "fake-indexeddb/auto";
import { forceCloseDatabase } from "fake-indexeddb";
import { openDB, unwrap, type DBSchema } from "idb";
import { expect, test, vi } from "vitest";
import { localDatabase } from "../src/client/foundation/database";

interface TestDB extends DBSchema {
  values: { key: string; value: string };
}

test("concurrent and repeated operations share one database connection", async () => {
  const name = crypto.randomUUID();
  const database = localDatabase<TestDB>(name, 1, (db) => db.createObjectStore("values"));
  const opened = vi.spyOn(IDBFactory.prototype, "open");
  try {
    const [first, second] = await Promise.all([database(), database()]);
    expect(second).toBe(first);
    await first.put("values", "retained", "key");
    expect(await (await database()).get("values", "key")).toBe("retained");
    expect(opened).toHaveBeenCalledTimes(1);
    first.close();
  } finally {
    opened.mockRestore();
  }
});

test("a failed open can retry instead of retaining a rejected promise", async () => {
  const database = localDatabase<TestDB>(crypto.randomUUID(), 1, (db) =>
    db.createObjectStore("values"),
  );
  const opened = vi.spyOn(IDBFactory.prototype, "open").mockImplementationOnce(() => {
    throw new DOMException("Storage unavailable", "UnknownError");
  });
  try {
    expect(() => database()).toThrow("Storage unavailable");
    const db = await database();
    await db.put("values", "recovered", "key");
    expect(await db.get("values", "key")).toBe("recovered");
    db.close();
  } finally {
    opened.mockRestore();
  }
});

test("a browser-terminated connection reopens without losing saved data", async () => {
  const database = localDatabase<TestDB>(crypto.randomUUID(), 1, (db) =>
    db.createObjectStore("values"),
  );
  const first = await database();
  await first.put("values", "saved", "key");
  forceCloseDatabase(unwrap(first) as unknown as Parameters<typeof forceCloseDatabase>[0]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const next = await database();
  expect(next).not.toBe(first);
  expect(await next.get("values", "key")).toBe("saved");
  next.close();
});

test("an asynchronously rejected open is retried on the next operation", async () => {
  const newerName = crypto.randomUUID();
  (await openDB(newerName, 2)).close();
  const database = localDatabase<TestDB>(crypto.randomUUID(), 1, (db) =>
    db.createObjectStore("values"),
  );
  const original = IDBFactory.prototype.open;
  const opened = vi.spyOn(IDBFactory.prototype, "open").mockImplementationOnce(function (
    this: IDBFactory,
  ) {
    return original.call(this, newerName, 1);
  });
  try {
    await expect(database()).rejects.toMatchObject({ name: "VersionError" });
    const db = await database();
    await db.put("values", "recovered", "key");
    expect(await db.get("values", "key")).toBe("recovered");
    db.close();
  } finally {
    opened.mockRestore();
  }
});

test("a cached connection releases an upgrade requested by another tab", async () => {
  const name = crypto.randomUUID();
  const database = localDatabase<TestDB>(name, 1, (db) => db.createObjectStore("values"));
  await (await database()).put("values", "saved", "key");
  const upgraded = await openDB(name, 2, {
    upgrade(db) {
      db.createObjectStore("new-store");
    },
  });
  expect(await upgraded.get("values", "key")).toBe("saved");
  expect(upgraded.objectStoreNames.contains("new-store")).toBe(true);
  upgraded.close();
});
