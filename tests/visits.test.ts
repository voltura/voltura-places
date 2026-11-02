import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import { familyKey } from "../src/shared/families";
import { visitEntity, visitStatuses } from "../src/shared/visits";
import {
  parseShare,
  shareURL,
  placeSchema,
  validateBackup,
  type Entity,
} from "../src/shared/model";
import {
  changeWorkspace,
  copyPlaceToWorkspace,
  exportBackup,
  importBackup,
  readWorkspace,
  reconcileDevicePlaces,
  removeWorkspace,
  saveEntity,
  saveVisit,
  setDraft,
  getDraft,
} from "../src/client/foundation/library";
import { exportWithPhotos } from "../src/client/foundation/photo-backup";

beforeEach(() => vi.stubGlobal("window", new EventTarget()));
const place = (): Extract<Entity, { kind: "place" }> => ({
  id: crypto.randomUUID(),
  kind: "place",
  value: {
    name: "Test clearing",
    description: "Quiet spot\nBring a picnic.",
    categoryId: "other",
    latitude: 1,
    longitude: 2,
    accuracy: null,
    capturedAt: "2026-11-02T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
  },
});

test("GPS saves atomically store the creator's status privately for a group", async () => {
  const owner = crypto.randomUUID(),
    group = crypto.randomUUID(),
    key = familyKey(owner, group),
    p = place();
  await saveEntity(key, p, undefined, false, () => true, "visited");
  const shared = await readWorkspace(key),
    personal = await readWorkspace(owner);
  expect(shared.records.some((r) => r.kind === "visit")).toBe(false);
  expect(visitStatuses(personal.records, key).get(p.id)).toBe("visited");
  expect(visitStatuses(personal.records, familyKey(owner, crypto.randomUUID())).size).toBe(0);
  expect(visitStatuses((await readWorkspace(crypto.randomUUID())).records, key).size).toBe(0);
  expect(shared.records.find((r) => r.id === p.id)?.value).toMatchObject({
    description: p.value.description,
  });
});

test("private status failure rolls back the group save and retains its draft", async () => {
  const owner = crypto.randomUUID(),
    key = familyKey(owner, crypto.randomUUID()),
    p = place();
  await setDraft(key, { id: p.id, name: "Unsaved draft" });
  await changeWorkspace(owner, (w) => {
    w.importLease = { token: "busy", expiresAt: Date.now() + 60000 };
  });
  await expect(saveEntity(key, p, undefined, true, () => true, "visited")).rejects.toThrow(
    "syncBusy",
  );
  expect((await readWorkspace(key)).records.some((r) => r.id === p.id)).toBe(false);
  expect(await getDraft(key)).toMatchObject({ id: p.id });
});

test("cancellation rolls back both the shared place and personal status", async () => {
  const owner = crypto.randomUUID(),
    key = familyKey(owner, crypto.randomUUID()),
    p = place();
  let current = true;
  const original = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    ...args
  ) {
    const result = original.call(this, value, ...args);
    if (this.name === "workspaces" && value.key === owner) current = false;
    return result;
  });
  try {
    await expect(saveEntity(key, p, undefined, false, () => current, "visited")).rejects.toThrow(
      "accountChanged",
    );
  } finally {
    spy.mockRestore();
  }
  expect((await readWorkspace(key)).records.some((r) => r.id === p.id)).toBe(false);
  expect(visitStatuses((await readWorkspace(owner)).records, key).size).toBe(0);
});

test("statuses are stable personal records, and clearing status survives another save", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await saveEntity(key, p);
  await saveVisit(key, p.id, "want");
  await saveVisit(key, p.id, "visited");
  await saveVisit(key, p.id, "none");
  await saveEntity(key, { ...p, value: { ...p.value, name: "New name" } });
  const w = await readWorkspace(key);
  expect(w.records.filter((r) => r.kind === "visit")).toHaveLength(1);
  expect(visitStatuses(w.records, key).get(p.id)).toBe("none");
});

test("sharing preserves Unicode descriptions but never a personal status", async () => {
  const p = place();
  p.value.description = "Återvänd hit 🌲\n".repeat(40);
  const incoming = parseShare(
    new URL(shareURL(p.value, "Outdoors", "https://example.invalid")).hash,
  );
  expect(incoming?.description).toBe(p.value.description.trim());
  expect(incoming).not.toHaveProperty("status");
  expect(placeSchema.safeParse({ ...p.value, description: "x".repeat(1001) }).success).toBe(false);
});

test("private and group backup imports restore statuses for the importing person only", async () => {
  for (const group of [false, true]) {
    const source = crypto.randomUUID(),
      p = place();
    await saveEntity(source, p, undefined, false, () => true, "visited");
    const backup = exportBackup(await readWorkspace(source));
    const owner = crypto.randomUUID(),
      target = group ? familyKey(owner, crypto.randomUUID()) : owner;
    await importBackup(target, backup);
    expect(visitStatuses((await readWorkspace(owner)).records, target).get(p.id)).toBe("visited");
    const exported = await exportWithPhotos(await readWorkspace(target));
    expect(exported.visits).toEqual([{ placeId: p.id, status: "visited" }]);
    if (group)
      expect((await readWorkspace(target)).records.some((r) => r.kind === "visit")).toBe(false);
    await saveVisit(target, p.id, "want");
    await importBackup(target, backup);
    expect(visitStatuses((await readWorkspace(owner)).records, target).get(p.id)).toBe("want");
    await importBackup(target, backup, true);
    expect(visitStatuses((await readWorkspace(owner)).records, target).get(p.id)).toBe("visited");
  }
});

test("merge remaps incoming statuses with copied place identities and retains existing preferences", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await saveEntity(key, p, undefined, false, () => true, "visited");
  const backup = exportBackup(await readWorkspace(key));
  backup.places[0].value.name = "Imported clearing";
  backup.visits![0].status = "want";
  await importBackup(key, backup);
  const w = await readWorkspace(key),
    copies = w.records.filter((r) => r.kind === "place" && !r.deleted);
  expect(copies).toHaveLength(2);
  expect(visitStatuses(w.records, key).get(p.id)).toBe("visited");
  expect(visitStatuses(w.records, key).get(copies.find((r) => r.id !== p.id)!.id)).toBe("want");
  await importBackup(key, { ...backup, visits: undefined }, true);
  expect(visitStatuses((await readWorkspace(key)).records, key).get(p.id)).toBe("visited");
});

test("guest transfer carries personal status while group copies never inherit it", async () => {
  await removeWorkspace("guest");
  const p = place(),
    owner = crypto.randomUUID();
  await saveEntity("guest", p, undefined, false, () => true, "visited");
  await reconcileDevicePlaces(owner, [], "auto");
  const w = await readWorkspace(owner),
    copied = w.records.find((r) => r.kind === "place")!;
  expect(visitStatuses(w.records, owner).get(copied.id)).toBe("visited");
  const destination = familyKey(owner, crypto.randomUUID());
  await copyPlaceToWorkspace(owner, destination, copied.id);
  expect((await readWorkspace(destination)).records.some((r) => r.kind === "visit")).toBe(false);
  expect(visitStatuses((await readWorkspace(owner)).records, destination).size).toBe(0);
  await removeWorkspace("guest");
});

test("backup status references and direct group metadata writes are validated", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await saveEntity(key, p);
  const b = exportBackup(await readWorkspace(key));
  expect(() => validateBackup({ ...b, visits: [{ placeId: "absent", status: "want" }] })).toThrow();
  const group = familyKey(key, crypto.randomUUID()),
    entity = await visitEntity(group, p.id, "want");
  await expect(saveEntity(group, entity)).rejects.toThrow("invalidImport");
});
