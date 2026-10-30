import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import {
  acknowledge,
  changeWorkspace,
  deleteEntity,
  exportBackup,
  importBackup,
  mergeSnapshot,
  prepareMutation,
  readWorkspace,
  reconcileAccount,
  resolveConflict,
  saveEntity,
  setDraft,
  getDraft,
} from "../src/client/foundation/library";
import { fetchSnapshot, synchronize } from "../src/client/foundation/sync";
import { type Entity } from "../src/shared/model";

beforeEach(() => vi.stubGlobal("window", new EventTarget()));
const place = (id: string = crypto.randomUUID(), name = "Recovery fixture"): Entity => ({
  id,
  kind: "place",
  value: {
    name,
    categoryId: "other",
    latitude: 1,
    longitude: 2,
    accuracy: null,
    capturedAt: "2026-10-30T10:00:00.000Z",
    updatedAt: "2026-10-30T10:00:00.000Z",
  },
});
const category = (id: string): Entity => ({
  id,
  kind: "category",
  value: { name: "Category", color: "green" },
});

test("merge imports preserve a deleted place's tombstone and recover under a new identity", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await saveEntity(key, p);
  const backup = exportBackup(await readWorkspace(key));
  await deleteEntity(key, p.id);
  await importBackup(key, backup);
  const records = (await readWorkspace(key)).records;
  expect(records.find((r) => r.id === p.id)?.deleted).toBe(true);
  expect(records.filter((r) => r.kind === "place" && !r.deleted)).toHaveLength(1);
});

test("merge imports preserve a deleted category and remap its recovered places", async () => {
  const key = crypto.randomUUID(),
    c = category(crypto.randomUUID()),
    p = place();
  if (p.kind !== "place") throw new Error();
  p.value.categoryId = c.id;
  await saveEntity(key, c);
  await saveEntity(key, p);
  const backup = exportBackup(await readWorkspace(key));
  await deleteEntity(key, c.id);
  await deleteEntity(key, p.id);
  await importBackup(key, backup);
  const records = (await readWorkspace(key)).records;
  expect(records.find((r) => r.id === c.id)?.deleted).toBe(true);
  const recovered = records.find((r) => r.kind === "place" && !r.deleted)!;
  expect(recovered.kind === "place" && recovered.value.categoryId).not.toBe(c.id);
});

test.each([false, true])(
  "import remaps cross-kind identities including tombstones (replace=%s)",
  async (replace) => {
    for (const deleted of [false, true]) {
      const source = crypto.randomUUID(),
        target = crypto.randomUUID(),
        p = place();
      await saveEntity(source, p);
      await saveEntity(target, category(p.id));
      if (deleted) await deleteEntity(target, p.id);
      await importBackup(target, exportBackup(await readWorkspace(source)), replace);
      const records = (await readWorkspace(target)).records;
      expect(records.find((r) => r.id === p.id)?.kind).toBe("category");
      expect(records.filter((r) => r.kind === "place" && !r.deleted)).toHaveLength(1);
    }
  },
);

test("unchanged category imports preserve local conflicts and do not queue writes", async () => {
  const key = crypto.randomUUID();
  await reconcileAccount(key, [], false);
  const before = await readWorkspace(key);
  await importBackup(key, exportBackup(before));
  expect((await readWorkspace(key)).records).toEqual(before.records);
});

test("editing or deleting a conflicted record retains the cloud recovery version", async () => {
  for (const remove of [false, true]) {
    const key = crypto.randomUUID(),
      p = place();
    await reconcileAccount(key, [{ ...p, revision: 1, deleted: false }], false);
    await saveEntity(key, place(p.id, "Device edit"));
    const cloud = { ...place(p.id, "Cloud edit"), revision: 2, deleted: false };
    await mergeSnapshot(key, [cloud]);
    if (remove) await deleteEntity(key, p.id);
    else await saveEntity(key, place(p.id, "Later device edit"));
    expect((await readWorkspace(key)).records.find((r) => r.id === p.id)?.conflict).toEqual(cloud);
    expect(await prepareMutation(key)).toBeUndefined();
  }
});

test("stale snapshots cannot roll a clean record or its conflict backwards", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [{ ...p, revision: 3, deleted: false }], false);
  await mergeSnapshot(key, [{ ...place(p.id, "Stale"), revision: 2, deleted: false }]);
  expect((await readWorkspace(key)).records.find((r) => r.id === p.id)?.value.name).toBe(
    p.value.name,
  );
  await saveEntity(key, place(p.id, "Device"));
  await mergeSnapshot(key, [{ ...place(p.id, "Newest cloud"), revision: 5, deleted: false }]);
  await mergeSnapshot(key, [{ ...place(p.id, "Old cloud"), revision: 4, deleted: false }]);
  expect((await readWorkspace(key)).records.find((r) => r.id === p.id)?.conflict?.revision).toBe(5);
});

test("identical writes converge regardless of JSON property insertion order", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, p);
  const flight = (await prepareMutation(key))!;
  const reversed = Object.fromEntries(Object.entries(p.value).reverse()) as typeof p.value;
  await acknowledge(
    key,
    flight.mutation.mutationId,
    { ...p, value: reversed, revision: 1, deleted: false } as never,
    true,
  );
  expect((await readWorkspace(key)).records.find((r) => r.id === p.id)).toMatchObject({
    dirty: false,
  });
});

test("snapshot rejects repeated IDs before a caller can merge ambiguous pages", async () => {
  const key = crypto.randomUUID(),
    p = { ...place(), revision: 1, deleted: false };
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ version: 1, accountId: key, records: [p, p] }));
  try {
    await expect(fetchSnapshot(key)).rejects.toThrow("invalidResponse");
  } finally {
    network.mockRestore();
  }
});

test("a mismatched mutation kind cannot overwrite the local record", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, p);
  vi.stubGlobal("navigator", { onLine: true });
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ accountId: key, record: { ...category(p.id), revision: 1, deleted: false } }),
    );
  try {
    await synchronize(key, () => {});
    expect((await readWorkspace(key)).records.find((r) => r.id === p.id)?.kind).toBe("place");
    expect((await readWorkspace(key)).flight).toBeDefined();
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("Keep both creates a sendable copy without copying the original conflict metadata", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [{ ...p, revision: 1, deleted: false }], false);
  await saveEntity(key, place(p.id, "Device"));
  await mergeSnapshot(key, [{ ...place(p.id, "Cloud"), revision: 2, deleted: false }]);
  await resolveConflict(key, p.id, "both");
  const copy = (await readWorkspace(key)).records.find((r) => r.kind === "place" && r.id !== p.id)!;
  expect(copy).toMatchObject({ revision: 0, dirty: true });
  expect(copy.conflict).toBeUndefined();
  expect((await prepareMutation(key))?.mutation.entity.id).toBe(copy.id);
});

test("acknowledging a newer device edit clears the already accepted flight conflict", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, p);
  const flight = (await prepareMutation(key))!;
  const remote = { ...p, revision: 1, deleted: false };
  await mergeSnapshot(key, [remote]);
  await saveEntity(key, place(p.id, "Newer device edit"));
  await acknowledge(key, flight.mutation.mutationId, remote);
  const local = (await readWorkspace(key)).records.find((r) => r.id === p.id)!;
  expect(local).toMatchObject({ revision: 1, dirty: true });
  expect(local.conflict).toBeUndefined();
});

test("a failed sync from a discarded account does not update the visible account status", async () => {
  const key = crypto.randomUUID();
  await reconcileAccount(key, [], false);
  await saveEntity(key, place());
  vi.stubGlobal("navigator", { onLine: true });
  let current = true;
  const statuses: string[] = [];
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    current = false;
    throw new Error("network failure");
  });
  try {
    await synchronize(
      key,
      (status) => statuses.push(status),
      () => current,
    );
    expect(statuses).toEqual(["syncing"]);
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("late acknowledgements retain a newer cloud conflict and an already chosen cloud version", async () => {
  for (const resolve of [false, true]) {
    const key = crypto.randomUUID(),
      p = place();
    await reconcileAccount(key, [], false);
    await saveEntity(key, p);
    const flight = (await prepareMutation(key))!;
    const newer = { ...place(p.id, "New cloud version"), revision: 2, deleted: false };
    await mergeSnapshot(key, [newer]);
    if (resolve) await resolveConflict(key, p.id, "cloud");
    await acknowledge(key, flight.mutation.mutationId, { ...p, revision: 1, deleted: false });
    const local = (await readWorkspace(key)).records.find((r) => r.id === p.id)!;
    if (resolve) expect(local).toMatchObject({ revision: 2, value: { name: "New cloud version" } });
    else {
      expect(local.conflict).toEqual(newer);
      await mergeSnapshot(key, [newer]);
      const retained = (await readWorkspace(key)).records.find((r) => r.id === p.id)!;
      expect(retained.value.name).toBe(p.value.name);
      expect(retained.conflict).toEqual(newer);
    }
  }
});

test("invalid local writes never become durable records or pending mutations", async () => {
  const key = crypto.randomUUID(),
    p = place();
  const before = await readWorkspace(key);
  if (p.kind !== "place") throw new Error();
  await expect(saveEntity(key, { ...p, value: { ...p.value, latitude: 91 } })).rejects.toThrow();
  expect(await readWorkspace(key)).toEqual(before);
});

test("snapshot kind collisions roll back all records instead of corrupting local entity types", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await changeWorkspace(key, (w) => {
    w.reconciled = true;
  });
  await saveEntity(key, p);
  const before = await readWorkspace(key);
  await expect(
    mergeSnapshot(key, [
      { ...place(), revision: 1, deleted: false },
      { ...category(p.id), revision: 5, deleted: false },
    ]),
  ).rejects.toThrow("invalidResponse");
  expect(await readWorkspace(key)).toEqual(before);
});

test("a full cloud category library opens without adding presets beyond capacity", async () => {
  const key = crypto.randomUUID();
  const cloud = Array.from({ length: 200 }, (_, i) => ({
    ...category(i ? `cloud-category-${i}` : "other"),
    revision: 1,
    deleted: false,
  }));
  await reconcileAccount(key, cloud, false);
  expect(
    (await readWorkspace(key)).records.filter((r) => r.kind === "category" && !r.deleted),
  ).toHaveLength(200);
  expect((await readWorkspace(key)).reconciled).toBe(true);
});

test.each([false, true])(
  "saving an editor opened before a cloud change preserves both versions (deleted=%s)",
  async (deleted) => {
    const key = crypto.randomUUID(),
      original = place();
    await reconcileAccount(key, [{ ...original, revision: 1, deleted: false }], false);
    const remote = { ...place(original.id, "Changed elsewhere"), revision: 2, deleted };
    await mergeSnapshot(key, [remote]);
    await saveEntity(key, place(original.id, "My editor changes"), original);
    const record = (await readWorkspace(key)).records.find((r) => r.id === original.id)!;
    expect(record.value.name).toBe("My editor changes");
    expect(record.conflict).toEqual(remote);
    expect(await prepareMutation(key)).toBeUndefined();
  },
);

test("a stale editor cannot replace a newer unsynced edit from another tab", async () => {
  const key = crypto.randomUUID(),
    original = place();
  await saveEntity(key, original);
  await saveEntity(key, place(original.id, "Other tab's pending edit"));
  const before = await readWorkspace(key);
  await expect(saveEntity(key, place(original.id, "Stale editor"), original)).rejects.toThrow(
    "placeChanged",
  );
  expect(await readWorkspace(key)).toEqual(before);
});

test("editor save and matching draft removal commit atomically", async () => {
  const key = crypto.randomUUID(),
    original = place();
  await saveEntity(key, original);
  await setDraft(key, { id: original.id, name: "Draft" });
  const before = await readWorkspace(key);
  const remove = IDBObjectStore.prototype.delete;
  const failure = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    id,
  ) {
    if (this.name === "drafts") throw new DOMException("blocked", "QuotaExceededError");
    return remove.call(this, id);
  });
  try {
    await expect(saveEntity(key, place(original.id, "Edited"), original, true)).rejects.toThrow();
  } finally {
    failure.mockRestore();
  }
  expect(await readWorkspace(key)).toEqual(before);
  expect(await getDraft(key)).toMatchObject({ id: original.id });
  await saveEntity(key, place(original.id, "Edited"), original, true);
  expect(await getDraft(key)).toBeUndefined();
});

test("deleting a place removes only its matching draft", async () => {
  const key = crypto.randomUUID(),
    first = place(),
    second = place();
  await saveEntity(key, first);
  await saveEntity(key, second);
  await setDraft(key, { id: first.id, name: "Deleted draft" });
  await deleteEntity(key, first.id);
  expect(await getDraft(key)).toBeUndefined();
  await setDraft(key, { id: first.id, name: "Another editor's draft" });
  await deleteEntity(key, second.id);
  expect(await getDraft(key)).toMatchObject({ id: first.id });
});

test("a denied browser lock falls back to persisted-flight synchronization", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, p);
  vi.stubGlobal("navigator", {
    onLine: true,
    locks: { request: vi.fn().mockRejectedValue(new DOMException("denied", "SecurityError")) },
  });
  const records: unknown[] = [],
    statuses: string[] = [];
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)),
        record = { ...body.entity, revision: 1, deleted: false };
      records.push(record);
      return Response.json({ accountId: key, record });
    }
    return Response.json({ version: 1, accountId: key, records });
  });
  try {
    await synchronize(key, (status) => statuses.push(status));
    expect(statuses.at(-1)).toBe("synced");
    expect((await readWorkspace(key)).flight).toBeUndefined();
    expect((await readWorkspace(key)).records.find((r) => r.id === p.id)?.dirty).toBe(false);
  } finally {
    network.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("a discarded paginated pull stops before requesting the next page", async () => {
  const key = crypto.randomUUID();
  let current = true,
    calls = 0;
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    if (calls === 1) {
      current = false;
      return Response.json({
        version: 1,
        accountId: key,
        records: [{ ...place("page-a"), revision: 1, deleted: false }],
        nextCursor: "page-a",
      });
    }
    return Response.json({ version: 1, accountId: key, records: [] });
  });
  try {
    await expect(fetchSnapshot(key, () => current)).rejects.toThrow("accountChanged");
    expect(calls).toBe(1);
  } finally {
    network.mockRestore();
  }
});

test("older Keep both copies recover from foreign conflict metadata without altering the original", async () => {
  const key = crypto.randomUUID(),
    original = place(),
    copy = place();
  const cloud = { ...original, revision: 2, deleted: false };
  await changeWorkspace(key, (w) => {
    w.reconciled = true;
    w.records.push({ ...cloud, generation: 0, dirty: false });
    w.records.push({
      ...copy,
      revision: 0,
      deleted: false,
      generation: 1,
      dirty: true,
      conflict: cloud,
    });
  });
  const repaired = await readWorkspace(key);
  expect(repaired.records.find((r) => r.id === copy.id)?.conflict).toBeUndefined();
  expect(repaired.records.find((r) => r.id === original.id)?.value).toEqual(original.value);
  expect((await prepareMutation(key))?.mutation.entity.id).toBe(copy.id);
});
