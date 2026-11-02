import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { openDB } from "idb";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  changeWorkspace,
  copyPlaceToWorkspace,
  exportBackup,
  finishDevicePlaceTransfer,
  importBackup,
  readWorkspace,
  reconcileDevicePlaces,
  removeAccountWorkspaces,
  removeWorkspace,
  saveEntity,
} from "../src/client/foundation/library";
import { getPhoto } from "../src/client/foundation/photo-store";
import { sameValue, valueKey } from "../src/client/foundation/library-records";
import { livePlaces, selectPlaces } from "../src/client/foundation/library-selectors";
import { synchronize } from "../src/client/foundation/sync";
import { entityLimits } from "../src/shared/limits";
import { familyKey } from "../src/shared/families";
import type { Entity } from "../src/shared/model";
import { visitStatuses } from "../src/shared/visits";

beforeEach(() => vi.stubGlobal("window", new EventTarget()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const place = (id = crypto.randomUUID()): Extract<Entity, { kind: "place" }> => ({
  id,
  kind: "place",
  value: {
    name: "Trailhead",
    categoryId: "other",
    latitude: 0,
    longitude: 0,
    accuracy: null,
    capturedAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  },
});

test("group photo import reserves private status capacity before writing any attachment", async () => {
  const source = crypto.randomUUID();
  const owner = crypto.randomUUID();
  const group = familyKey(owner, crypto.randomUUID());
  const original = place();
  const photoId = crypto.randomUUID();
  original.value.photoId = photoId;
  await saveEntity(source, original, undefined, false, () => true, "visited");
  const backup = exportBackup(await readWorkspace(source), [
    {
      id: photoId,
      data:
        "data:image/jpeg;base64," + (await readFile("tests/fixtures/photo.jpg")).toString("base64"),
    },
  ]);
  await changeWorkspace(owner, (w) => {
    w.importLease = { token: "in-progress", expiresAt: Date.now() + 60000 };
  });
  await expect(importBackup(group, backup)).rejects.toThrow("syncBusy");
  expect(await getPhoto(group, photoId)).toBeUndefined();
  const db = await openDB("voltura-places", 1);
  await db.delete("workspaces", owner);
  db.close();
  const limit = entityLimits.visit;
  try {
    Object.defineProperty(entityLimits, "visit", { value: 0 });
    await expect(importBackup(group, backup)).rejects.toThrow("libraryLimit");
    expect(await getPhoto(group, photoId)).toBeUndefined();
  } finally {
    Object.defineProperty(entityLimits, "visit", { value: limit });
  }
  await importBackup(group, backup);
  expect((await readWorkspace(group)).importLease).toBeUndefined();
  const personal = await readWorkspace(owner);
  expect(personal.importLease).toBeUndefined();
  expect(visitStatuses(personal.records, group).get(original.id)).toBe("visited");
});

test("an unchanged private status in a replacement backup is not dirtied again", async () => {
  const key = crypto.randomUUID();
  const original = place();
  await saveEntity(key, original, undefined, false, () => true, "visited");
  const before = await readWorkspace(key);
  await importBackup(key, exportBackup(before), true);
  expect((await readWorkspace(key)).records.find((r) => r.kind === "visit")).toEqual(
    before.records.find((r) => r.kind === "visit"),
  );
});

test("group copying prefers the matching localized category when two candidates share a fallback name", async () => {
  const source = crypto.randomUUID();
  const target = familyKey(source, crypto.randomUUID());
  const original = place();
  const category: Entity = {
    id: "source-cat",
    kind: "category",
    value: { name: "Hike", names: { sv: "Vandring" }, color: "green" },
  };
  await saveEntity(source, category);
  await saveEntity(source, { ...original, value: { ...original.value, categoryId: category.id } });
  await saveEntity(target, {
    ...category,
    id: "alternative",
    value: { ...category.value, names: { sv: "Annat" } },
  });
  await saveEntity(target, { ...category, id: "matching" });
  const after = await copyPlaceToWorkspace(source, target, original.id);
  expect(livePlaces(after)[0].value.categoryId).toBe("matching");
});

test("reading an old preset revision cannot recreate a concurrently removed private workspace", async () => {
  const key = crypto.randomUUID();
  await changeWorkspace(key, (w) => {
    w.presetRevision = 1;
    w.records = w.records.filter((r) => r.id !== "mushrooms");
  });
  const get = IDBObjectStore.prototype.get;
  const spy = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
    this: IDBObjectStore,
    query,
  ) {
    if (this.name === "workspaces" && this.transaction.mode === "readwrite" && query === key) {
      this.delete(key);
    }

    return get.call(this, query);
  });
  await readWorkspace(key);
  spy.mockRestore();
  const db = await openDB("voltura-places", 1);
  expect(await db.get("workspaces", key)).toBeUndefined();
  db.close();
});

test("device transfer and source cleanup both honor an active guest import lease", async () => {
  await removeWorkspace("guest");
  const owner = crypto.randomUUID();
  const original = place();
  await saveEntity("guest", original);
  await changeWorkspace("guest", (w) => {
    w.importLease = { token: "import", expiresAt: Date.now() + 60000 };
  });
  await expect(reconcileDevicePlaces(owner, [], "auto")).rejects.toThrow("syncBusy");
  await expect(finishDevicePlaceTransfer(owner)).rejects.toThrow("syncBusy");
  expect((await readWorkspace(owner)).reconciled).toBe(false);
  expect(livePlaces(await readWorkspace("guest"))).toHaveLength(1);
  await removeWorkspace("guest");
});

test("sync waits for an active import reservation without reporting an account error", async () => {
  const key = crypto.randomUUID();
  await changeWorkspace(key, (w) => {
    w.reconciled = true;
    w.importLease = { token: "import", expiresAt: Date.now() + 60000 };
  });
  vi.stubGlobal("navigator", { onLine: true });
  const network = vi.spyOn(globalThis, "fetch");
  const states: string[] = [];
  await synchronize(key, (s) => states.push(s));
  expect(states.at(-1)).toBe("pending");
  expect(network).not.toHaveBeenCalled();
});

test.each(["forbidden", "network"] as const)(
  "an attachment %s failure stops the remaining snapshot downloads",
  async (failure) => {
    const key = crypto.randomUUID();
    const originals = Array.from({ length: 3 }, () => ({
      ...place(),
      revision: 1,
      deleted: false,
    }));
    for (const item of originals) {
      item.value.photoId = crypto.randomUUID();
    }
    await changeWorkspace(key, (w) => {
      w.reconciled = true;
    });
    vi.stubGlobal("navigator", { onLine: true });
    let downloads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/photos/")) {
          downloads++;
          if (failure === "network") {
            throw new TypeError("Network disconnected");
          }

          return Response.json({ error: "familyAccessEnded" }, { status: 403 });
        }

        return Response.json({ version: 1, accountId: key, records: originals });
      }),
    );
    const statuses: string[] = [];
    await synchronize(key, (s) => statuses.push(s));
    expect(downloads).toBe(1);
    expect(statuses.at(-1)).toBe(failure === "network" ? "retryRefresh" : "actionRequired");
  },
);

test("search matches normalized Swedish text and ignores pasted edge whitespace", async () => {
  const key = crypto.randomUUID();
  const original = place();
  await saveEntity(key, { ...original, value: { ...original.value, name: "A\u030Aland" } });
  const places = livePlaces(await readWorkspace(key));
  expect(
    selectPlaces({
      places,
      categories: [],
      visits: new Map(),
      search: " \u00C5land ",
      filter: "all",
      visitFilter: "all",
      sort: "name",
      language: "sv",
      currentPosition: null,
    }),
  ).toEqual(places);
});

test("schema record comparisons retain canonical JSON equality across nested translations and absent fields", () => {
  const variants: unknown[] = [
    { name: "A", names: { en: "A", sv: "B" } },
    { names: { sv: "B", en: "A" }, name: "A", optional: undefined },
    { name: "A", names: { en: "A", sv: "C" } },
    { name: "A", names: undefined },
    { name: "A", photoId: null },
    { name: "A" },
  ];
  for (const a of variants) {
    for (const b of variants) {
      expect(sameValue(a, b)).toBe(valueKey(a) === valueKey(b));
    }
  }
});

test("removing account data only enumerates its own family key range", async () => {
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  await saveEntity(familyKey(owner, crypto.randomUUID()), place());
  const kept = familyKey(other, crypto.randomUUID());
  await saveEntity(kept, place());
  const keys = vi.spyOn(IDBObjectStore.prototype, "getAllKeys");
  await removeAccountWorkspaces(owner);
  const workspaceQueries = keys.mock.calls.filter((_, i) =>
    ["workspaces", "drafts"].includes((keys.mock.contexts[i] as IDBObjectStore).name),
  );
  expect(workspaceQueries).toHaveLength(2);
  for (const [range] of workspaceQueries) {
    expect(range).toBeInstanceOf(IDBKeyRange);
    expect((range as IDBKeyRange).lower).toBe(`family:${owner}:`);
  }
  expect(livePlaces(await readWorkspace(kept))).toHaveLength(1);
});
