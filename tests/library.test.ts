import "fake-indexeddb/auto";
import { beforeAll, describe, expect, test, vi } from "vitest";
import {
  acknowledge,
  deleteEntity,
  exportBackup,
  importBackup,
  mergeSnapshot,
  prepareMutation,
  readWorkspace,
  reconcileAccount,
  resolveConflict,
  saveEntity,
} from "../src/client/foundation/library";
import {
  mapURL,
  parseShare,
  shareURL,
  starters,
  validateBackup,
  type Entity,
} from "../src/shared/model";
beforeAll(() => {
  vi.stubGlobal("window", new EventTarget());
});
const makePlace = (id: string = crypto.randomUUID(), name = "Trailhead"): Entity => ({
  id,
  kind: "place",
  value: {
    name,
    latitude: 59.3293,
    longitude: 18.0686,
    accuracy: 5,
    categoryId: "outdoors",
    capturedAt: "2026-10-29T10:00:00.000Z",
    updatedAt: "2026-10-29T10:00:00.000Z",
  },
});
describe("durable library boundaries", () => {
  test("save survives reload, and a flight survives response loss without changing its ID/body", async () => {
    const key = crypto.randomUUID();
    await reconcileAccount(key, [], false);
    const e = makePlace();
    await saveEntity(key, e);
    const first = await prepareMutation(key),
      retry = await prepareMutation(key);
    expect(retry).toEqual(first);
    expect((await readWorkspace(key)).records.find((r) => r.id === e.id)?.dirty).toBe(true);
    await acknowledge(key, first!.mutation.mutationId, { ...e, revision: 1, deleted: false });
    expect((await readWorkspace(key)).records.find((r) => r.id === e.id)?.dirty).toBe(false);
  });
  test("edits during a request survive its acknowledgement and use the accepted revision", async () => {
    const key = crypto.randomUUID();
    await reconcileAccount(key, [], false);
    const e = makePlace();
    await saveEntity(key, e);
    const flight = await prepareMutation(key);
    const next = makePlace(e.id, "New name");
    await saveEntity(key, next);
    await acknowledge(key, flight!.mutation.mutationId, { ...e, revision: 1, deleted: false });
    const saved = (await readWorkspace(key)).records.find((r) => r.id === e.id)!;
    expect(saved.value.name).toBe("New name");
    expect(saved.dirty).toBe(true);
    expect((await prepareMutation(key))?.mutation.baseRevision).toBe(1);
  });
  test("category deletion moves places without deleting them", async () => {
    const key = crypto.randomUUID(),
      e = makePlace();
    await saveEntity(key, e);
    await deleteEntity(key, "outdoors");
    const w = await readWorkspace(key);
    const r = w.records.find((r) => r.id === e.id)!;
    expect(r.deleted).toBe(false);
    expect(r.kind === "place" && r.value.categoryId).toBe("other");
    expect(w.records.find((r) => r.id === "outdoors")?.deleted).toBe(true);
  });
  test("malformed import cannot change the existing workspace", async () => {
    const key = crypto.randomUUID(),
      e = makePlace();
    await saveEntity(key, e);
    const before = await readWorkspace(key);
    await expect(importBackup(key, { version: 99 }, true)).rejects.toThrow();
    expect(await readWorkspace(key)).toEqual(before);
  });
  test("backup round trip and conflicting merge keep both copies", async () => {
    const key = crypto.randomUUID(),
      e = makePlace();
    await saveEntity(key, e);
    const backup = exportBackup(await readWorkspace(key));
    expect(validateBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
    backup.places[0].value.name = "Imported name";
    await importBackup(key, backup);
    expect(
      (await readWorkspace(key)).records
        .filter((r) => r.kind === "place" && !r.deleted)
        .map((r) => r.value.name)
        .sort(),
    ).toEqual(["Imported name", "Trailhead"]);
  });
  test("same-record conflicts preserve both versions and Keep both creates a fresh ID", async () => {
    const key = crypto.randomUUID(),
      e = makePlace();
    await reconcileAccount(key, [{ ...e, revision: 1, deleted: false }], false);
    await saveEntity(key, makePlace(e.id, "Device edit"));
    await mergeSnapshot(key, [{ ...makePlace(e.id, "Cloud edit"), revision: 2, deleted: false }]);
    let w = await readWorkspace(key);
    expect(w.records.find((r) => r.id === e.id)?.conflict?.value.name).toBe("Cloud edit");
    await resolveConflict(key, e.id, "both");
    w = await readWorkspace(key);
    expect(
      w.records
        .filter((r) => r.kind === "place" && !r.deleted)
        .map((r) => r.value.name)
        .sort(),
    ).toEqual(["Cloud edit", "Device edit"]);
  });
  test("cloud deletion cannot silently resurrect a dirty stale device copy", async () => {
    const key = crypto.randomUUID(),
      e = makePlace();
    await reconcileAccount(key, [{ ...e, revision: 1, deleted: false }], false);
    await saveEntity(key, makePlace(e.id, "Offline edit"));
    await mergeSnapshot(key, [{ ...e, revision: 2, deleted: true }]);
    expect((await readWorkspace(key)).records.find((r) => r.id === e.id)?.conflict?.deleted).toBe(
      true,
    );
    await resolveConflict(key, e.id, "cloud");
    expect((await readWorkspace(key)).records.find((r) => r.id === e.id)?.deleted).toBe(true);
  });
  test("account workspaces never share pending operations", async () => {
    const a = crypto.randomUUID(),
      b = crypto.randomUUID();
    await reconcileAccount(a, [], false);
    await reconcileAccount(b, [], false);
    await saveEntity(a, makePlace());
    expect(await prepareMutation(b)).toBeUndefined();
    expect(await prepareMutation(a)).toBeDefined();
  });
  test("share snapshots preserve Unicode and reject malformed coordinates", () => {
    const e = makePlace();
    if (e.kind !== "place") throw new Error();
    const link = shareURL(
      { ...e.value, name: "Gläntan 🌲" },
      "Friluftsliv",
      "https://places.voltura.se",
    );
    expect(parseShare(new URL(link).hash)?.name).toBe("Gläntan 🌲");
    expect(parseShare("#place=bad")).toBeNull();
    expect(mapURL("google", e.value)).toContain("59.3293%2C18.0686");
  });
  test("invalid coordinates, duplicate identifiers and broken category references fail before import", () => {
    const base = {
      format: "voltura-places",
      version: 1,
      exportedAt: new Date().toISOString(),
      categories: starters.map((e) => ({ id: e.id, value: e.value })),
      places: [],
    };
    expect(() => validateBackup({ ...base, categories: [] })).toThrow();
    const e = makePlace();
    expect(() =>
      validateBackup({ ...base, places: [{ id: e.id, value: { ...e.value, latitude: 91 } }] }),
    ).toThrow();
  });
});
