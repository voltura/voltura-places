import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { openDB } from "idb";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import {
  changeWorkspace,
  copyPlaceToWorkspace,
  deleteEntity,
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
import { mutationSchema, type Entity, type RecordState } from "../src/shared/model";
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
  const { workspace: after } = await copyPlaceToWorkspace(source, target, original.id);
  expect(livePlaces(after)[0].value.categoryId).toBe("matching");
});

test("repeated and concurrent group copies retain one independently editable destination", async () => {
  const source = familyKey(crypto.randomUUID(), crypto.randomUUID());
  const target = familyKey(crypto.randomUUID(), crypto.randomUUID());
  const original = place();
  await saveEntity(source, original);
  const results = await Promise.all([
    copyPlaceToWorkspace(source, target, original.id),
    copyPlaceToWorkspace(source, target, original.id),
  ]);
  expect(results.map((result) => result.copied).sort()).toEqual([false, true]);
  const copied = livePlaces(await readWorkspace(target))[0];
  if (copied.kind !== "place") {
    throw new Error("Expected a place");
  }
  await saveEntity(target, { ...copied, value: { ...copied.value, name: "Destination edit" } });
  await saveEntity(source, {
    ...original,
    value: { ...original.value, name: "Source edit", photoId: crypto.randomUUID() },
  });
  const before = await readWorkspace(target);
  expect((await copyPlaceToWorkspace(source, target, original.id)).copied).toBe(false);
  expect(await readWorkspace(target)).toEqual(before);
  expect(livePlaces(before)).toHaveLength(1);
  expect(livePlaces(before)[0].value.name).toBe("Destination edit");
});

test("group copies converge through sync across members and devices without sharing private partitions", async () => {
  const group = crypto.randomUUID();
  const first = familyKey(crypto.randomUUID(), group);
  const second = familyKey(crypto.randomUUID(), group);
  const targetGroup = crypto.randomUUID();
  const firstTarget = familyKey(crypto.randomUUID(), targetGroup);
  const secondTarget = familyKey(crypto.randomUUID(), targetGroup);
  const original = place();
  const category: Entity = {
    id: crypto.randomUUID(),
    kind: "category",
    value: { name: "Lookouts", names: { sv: "Utsikter" }, color: "blue", icon: "binoculars" },
  };
  original.value.categoryId = category.id;
  await saveEntity(first, category);
  await saveEntity(second, category);
  await saveEntity(first, original);
  await saveEntity(second, original);
  vi.useFakeTimers({ toFake: ["Date"] });
  let a;
  let b;
  try {
    vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
    a = await copyPlaceToWorkspace(first, firstTarget, original.id);
    vi.setSystemTime(new Date("2026-11-03T11:00:00Z"));
    b = await copyPlaceToWorkspace(second, secondTarget, original.id);
  } finally {
    vi.useRealTimers();
  }
  expect(livePlaces(a.workspace)[0].id).toBe(livePlaces(b.workspace)[0].id);
  expect(livePlaces(a.workspace)[0].value).toEqual(livePlaces(b.workspace)[0].value);
  expect(livePlaces(a.workspace)[0].value.updatedAt).toBe(original.value.updatedAt);
  expect(livePlaces(a.workspace)[0].id).not.toBe(original.id);
  const cloud = new Map<string, RecordState>();
  let conflicts = 0;
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const accountId = familyKey(
        headers.get("X-Places-Account")!,
        headers.get("X-Places-Family")!,
      );
      if (init?.method === "POST") {
        const mutation = mutationSchema.parse(JSON.parse(init.body as string));
        const previous = cloud.get(mutation.entity.id);
        if (previous && previous.revision !== mutation.baseRevision) {
          conflicts++;

          return Response.json({ accountId, record: previous }, { status: 409 });
        }
        const record = {
          ...mutation.entity,
          deleted: mutation.deleted,
          revision: mutation.baseRevision + 1,
        };
        cloud.set(record.id, record);

        return Response.json({ accountId, record });
      }

      return Response.json({ version: 1, accountId, records: [...cloud.values()] });
    }),
  );
  for (const key of [firstTarget, secondTarget, firstTarget]) {
    const statuses: string[] = [];
    await synchronize(key, (status) => statuses.push(status));
    expect(statuses.at(-1)).toBe("synced");
    const workspace = await readWorkspace(key);
    expect(livePlaces(workspace)).toHaveLength(1);
    expect(workspace.records.some((record) => record.dirty || record.conflict)).toBe(false);
  }
  expect(conflicts).toBe(2);
  expect(cloud.size).toBe(2);
  const privateSource = crypto.randomUUID();
  await saveEntity(privateSource, original);
  const privateCopy = await copyPlaceToWorkspace(privateSource, crypto.randomUUID(), original.id);
  expect(livePlaces(privateCopy.workspace)[0].id).not.toBe(livePlaces(a.workspace)[0].id);
});

test("later copies reuse renamed copied categories and preserve their deletion markers", async () => {
  const source = crypto.randomUUID();
  const target = crypto.randomUUID();
  const category: Entity = {
    id: crypto.randomUUID(),
    kind: "category",
    value: { name: "Lookouts", color: "blue" },
  };
  await saveEntity(source, category);
  const originals = Array.from({ length: 3 }, (_, index) => {
    const original = place();
    original.value.name += index;
    original.value.categoryId = category.id;

    return original;
  });
  for (const original of originals) {
    await saveEntity(source, original);
  }
  const first = await copyPlaceToWorkspace(source, target, originals[0].id);
  const categoryId = livePlaces(first.workspace)[0].value.categoryId;
  await saveEntity(target, {
    ...category,
    id: categoryId,
    value: { name: "Renamed", color: "rose" },
  });
  const second = await copyPlaceToWorkspace(source, target, originals[1].id);
  expect(livePlaces(second.workspace).map((record) => record.value.categoryId)).toEqual([
    categoryId,
    categoryId,
  ]);
  expect(second.workspace.records.find((record) => record.id === categoryId)?.value).toEqual({
    name: "Renamed",
    color: "rose",
  });
  await deleteEntity(target, categoryId);
  const third = await copyPlaceToWorkspace(source, target, originals[2].id);
  expect(livePlaces(third.workspace).map((record) => record.value.categoryId)).toEqual([
    "other",
    "other",
    "other",
  ]);
  expect(third.workspace.records.find((record) => record.id === categoryId)?.deleted).toBe(true);
});

test("unchanged legacy copies are recognized without merging distinct posts at the same position", async () => {
  const source = crypto.randomUUID();
  const target = crypto.randomUUID();
  const original = place();
  await saveEntity(source, original);
  const legacy = {
    ...original,
    id: crypto.randomUUID(),
    value: { ...original.value, categoryId: "parking", updatedAt: "2026-11-02T00:00:00Z" },
  };
  await saveEntity(target, legacy);
  const before = await readWorkspace(target);
  expect((await copyPlaceToWorkspace(source, target, original.id)).copied).toBe(false);
  expect(await readWorkspace(target)).toEqual(before);
  const different = {
    ...original,
    id: crypto.randomUUID(),
    value: {
      ...original.value,
      capturedAt: "2026-11-03T00:00:00Z",
    },
  };
  await saveEntity(source, different);
  expect((await copyPlaceToWorkspace(source, target, different.id)).copied).toBe(true);
  expect(livePlaces(await readWorkspace(target))).toHaveLength(2);
});

test("a repeated group copy respects tombstones, cancellation and full destination capacity", async () => {
  const source = crypto.randomUUID();
  const target = crypto.randomUUID();
  const original = place();
  await saveEntity(source, original);
  const first = await copyPlaceToWorkspace(source, target, original.id);
  const before = await readWorkspace(target);
  await expect(copyPlaceToWorkspace(source, target, original.id, () => false)).rejects.toThrow(
    "accountChanged",
  );
  expect(await readWorkspace(target)).toEqual(before);
  const limit = entityLimits.place;
  try {
    Object.defineProperty(entityLimits, "place", { value: 1 });
    expect((await copyPlaceToWorkspace(source, target, original.id)).copied).toBe(false);
  } finally {
    Object.defineProperty(entityLimits, "place", { value: limit });
  }
  await deleteEntity(target, livePlaces(first.workspace)[0].id);
  const deleted = await readWorkspace(target);
  await expect(copyPlaceToWorkspace(source, target, original.id)).rejects.toThrow("placeChanged");
  expect(await readWorkspace(target)).toEqual(deleted);
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

test.each(["forbidden", "network", "throttled", "unavailable"] as const)(
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

          const status = failure === "forbidden" ? 403 : failure === "throttled" ? 429 : 503;

          return new Response(null, { status });
        }

        return Response.json({ version: 1, accountId: key, records: originals });
      }),
    );
    const statuses: string[] = [];
    await synchronize(key, (s) => statuses.push(s));
    expect(downloads).toBe(failure === "unavailable" ? 2 : 1);
    expect(statuses.at(-1)).toBe(failure === "forbidden" ? "syncAccessDenied" : "retryRefresh");
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
