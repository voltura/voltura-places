import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  changeWorkspace,
  deleteEntity,
  devicePlacePlan,
  readWorkspace,
  reconcileDevicePlaces,
  removeWorkspace,
  saveEntity,
} from "../src/client/foundation/library";
import { getPhoto, makeStoredPhoto, putPhotos } from "../src/client/foundation/photo-store";
import type { Entity, RecordState } from "../src/shared/model";

const account = "normal-account";
const place = (id = crypto.randomUUID()): Extract<Entity, { kind: "place" }> => ({
  id,
  kind: "place",
  value: {
    name: id,
    categoryId: "other",
    latitude: 0,
    longitude: 0,
    accuracy: null,
    capturedAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:00:00.000Z",
  },
});
const live = async (key: string) =>
  (await readWorkspace(key)).records.filter((r) => r.kind === "place" && !r.deleted);
beforeEach(async () => {
  vi.stubGlobal("window", new EventTarget());
  await removeWorkspace(account);
  await removeWorkspace("guest");
  await changeWorkspace("guest", (w) => {
    w.deviceAccounts = [account];
  });
});

test("automatic copying preserves cloud collisions, originals and repeated sign-in", async () => {
  const source = place();
  await saveEntity("guest", source);
  const cloud = {
    ...source,
    value: { ...source.value, name: "Cloud place" },
    deleted: false,
    revision: 4,
  } as RecordState;
  expect(await reconcileDevicePlaces(account, [cloud], "auto")).toBe(1);
  expect(await live(account)).toHaveLength(2);
  expect(await live("guest")).toHaveLength(1);
  expect(await reconcileDevicePlaces(account, [], "auto")).toBe(0);
  expect(await live(account)).toHaveLength(2);
  expect((await devicePlacePlan(account)).needed).toBe(false);
});

test("new signed-out places copy on return without overwriting account edits or restoring deletions", async () => {
  await saveEntity("guest", place());
  await reconcileDevicePlaces(account, [], "auto");
  const copied = (await live(account))[0];
  await saveEntity(account, {
    ...copied,
    value: { ...copied.value, name: "Account edit" },
  } as Entity);
  expect(await reconcileDevicePlaces(account, [], "auto")).toBe(0);
  expect((await live(account))[0].value.name).toBe("Account edit");
  await deleteEntity(account, copied.id);
  await saveEntity("guest", place());
  expect(await reconcileDevicePlaces(account, [], "auto")).toBe(1);
  expect(await live(account)).toHaveLength(1);
  expect((await readWorkspace(account)).records.find((r) => r.id === copied.id)?.deleted).toBe(
    true,
  );
});

test("a different account requires consent and skipping keeps all guest places private", async () => {
  const other = crypto.randomUUID();
  await saveEntity("guest", place());
  expect((await devicePlacePlan(other)).ask).toBe(true);
  await expect(reconcileDevicePlaces(other, [], "auto")).rejects.toThrow("accountChoiceRequired");
  expect((await readWorkspace(other)).reconciled).toBe(false);
  await reconcileDevicePlaces(other, [], "skip");
  expect(await live(other)).toHaveLength(0);
  expect(await live("guest")).toHaveLength(1);
  expect((await devicePlacePlan(other)).needed).toBe(false);
  await saveEntity("guest", place());
  expect((await devicePlacePlan(other)).ask).toBe(false);
  expect(await reconcileDevicePlaces(other, [], "auto")).toBe(1);
  expect(await live(other)).toHaveLength(1);
});

test("explicit approval copies into a different account and remembers that account", async () => {
  const other = crypto.randomUUID();
  await saveEntity("guest", place());
  expect(await reconcileDevicePlaces(other, [], "copy")).toBe(1);
  expect(await live(other)).toHaveLength(1);
  expect((await devicePlacePlan(other)).needed).toBe(false);
  expect((await devicePlacePlan(account)).ask).toBe(true);
});

test("cancelled and over-capacity transfers commit neither account records nor transfer receipts", async () => {
  await saveEntity("guest", place());
  await expect(reconcileDevicePlaces(account, [], "auto", () => false)).rejects.toThrow(
    "accountChanged",
  );
  expect((await readWorkspace(account)).reconciled).toBe(false);
  const full = Array.from({ length: 5000 }, () => ({
    ...place(),
    revision: 1,
    deleted: false,
  })) as RecordState[];
  await expect(reconcileDevicePlaces(account, full, "auto")).rejects.toThrow("libraryLimit");
  expect((await readWorkspace(account)).guestPlaces).toBeUndefined();
  expect((await devicePlacePlan(account)).pending).toBe(1);
});

test("legacy identical copies and stable cloud tombstones survive missing local account cache", async () => {
  const source = place();
  await saveEntity("guest", source);
  const cloud = { ...source, revision: 3, deleted: false } as RecordState;
  expect(await reconcileDevicePlaces(account, [cloud], "auto")).toBe(0);
  await saveEntity("guest", place());
  await reconcileDevicePlaces(account, [], "auto");
  const records = (await readWorkspace(account)).records;
  await removeWorkspace(account);
  expect(
    await reconcileDevicePlaces(
      account,
      records.map((r) => ({ ...r, deleted: true })),
      "auto",
    ),
  ).toBe(0);
  expect(await live(account)).toHaveLength(0);
});

test("photos and categories copy with the place and are retained in the guest library", async () => {
  const photoId = crypto.randomUUID();
  await putPhotos([
    await makeStoredPhoto("guest", photoId, new Blob([await readFile("tests/fixtures/photo.jpg")])),
  ]);
  await saveEntity("guest", {
    id: "custom",
    kind: "category",
    value: { name: "Custom", color: "blue" },
  });
  const source = place();
  await saveEntity("guest", {
    ...source,
    value: { ...source.value, photoId, categoryId: "custom" },
  } as Entity);
  await reconcileDevicePlaces(account, [], "auto");
  expect(await getPhoto(account, photoId)).toBeDefined();
  expect(await getPhoto("guest", photoId)).toBeDefined();
  const copied = (await live(account))[0];
  expect(copied.kind === "place" && copied.value.categoryId).toBe("custom");
});

test("legacy copies with account edits or tombstones are adopted without adding the originals again", async () => {
  const source = place();
  await saveEntity("guest", source);
  await changeWorkspace(account, (w) => {
    w.reconciled = true;
    w.records.push({
      ...source,
      value: { ...source.value, name: "Edited in account" },
      revision: 2,
      generation: 0,
      dirty: false,
      deleted: true,
    });
  });
  expect((await devicePlacePlan(account)).pending).toBe(0);
  expect(await reconcileDevicePlaces(account, [], "auto")).toBe(0);
  expect((await readWorkspace(account)).guestPlaces?.[source.id]).toBe(source.id);
  expect((await devicePlacePlan(account)).pending).toBe(0);
  expect(await live(account)).toHaveLength(0);
});
