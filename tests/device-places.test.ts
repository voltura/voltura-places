import "fake-indexeddb/auto";
import { beforeEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  changeWorkspace,
  deleteEntity,
  devicePlacePlan,
  readWorkspace,
  reconcileDevicePlaces,
  finishDevicePlaceTransfer,
  prepareMutation,
  acknowledge,
  getDraft,
  setDraft,
  removeWorkspace,
  saveEntity,
} from "../src/client/foundation/library";
import { getPhoto, makeStoredPhoto, putPhotos } from "../src/client/foundation/photo-store";
import type { Entity, RecordState } from "../src/shared/model";

const account = "normal-account";
const place = (id: string = crypto.randomUUID()): Extract<Entity, { kind: "place" }> => ({
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
  (await readWorkspace(key)).records.filter(
    (r): r is Extract<typeof r, { kind: "place" }> => r.kind === "place" && !r.deleted,
  );
async function confirmWrites(key: string) {
  for (let i = 0; i < 6000; i++) {
    const flight = await prepareMutation(key);
    if (!flight) return;
    await acknowledge(
      key,
      flight.mutation.mutationId,
      {
        ...flight.mutation.entity,
        deleted: flight.mutation.deleted,
        revision: flight.mutation.baseRevision + 1,
      },
      false,
    );
  }
  throw new Error("Unexpected pending writes");
}
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
  expect((await devicePlacePlan(account)).needed).toBe(true);
  expect(await finishDevicePlaceTransfer(account)).toBe(0);
  await confirmWrites(account);
  expect(await finishDevicePlaceTransfer(account)).toBe(1);
  expect(await live("guest")).toHaveLength(0);
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

test("a different account automatically takes new guest places without a storage choice", async () => {
  const other = crypto.randomUUID();
  await saveEntity("guest", place());
  expect((await devicePlacePlan(other)).ask).toBe(false);
  expect(await reconcileDevicePlaces(other, [], "auto")).toBe(1);
  expect(await live(other)).toHaveLength(1);
  expect(await live("guest")).toHaveLength(1);
  expect((await devicePlacePlan(other)).needed).toBe(true);
  expect(await reconcileDevicePlaces(account, [], "auto")).toBe(0);
  expect(await live(account)).toHaveLength(0);
  await confirmWrites(other);
  expect(await finishDevicePlaceTransfer(other)).toBe(1);
  await saveEntity("guest", place());
  expect((await devicePlacePlan(other)).ask).toBe(false);
  expect(await reconcileDevicePlaces(other, [], "auto")).toBe(1);
  expect(await live(other)).toHaveLength(2);
});

test("ownership persists after cloud save and prevents imports into another account", async () => {
  const other = crypto.randomUUID();
  await saveEntity("guest", place());
  expect(await reconcileDevicePlaces(other, [], "copy")).toBe(1);
  expect(await live(other)).toHaveLength(1);
  expect((await devicePlacePlan(other)).needed).toBe(true);
  expect((await devicePlacePlan(account)).pending).toBe(0);
  await confirmWrites(other);
  expect(await finishDevicePlaceTransfer(other)).toBe(1);
  expect((await devicePlacePlan(other)).needed).toBe(false);
  expect(await reconcileDevicePlaces(account, [], "auto")).toBe(0);
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
  expect((await devicePlacePlan(account)).pending).toBe(1);
  expect(await reconcileDevicePlaces(account, [], "auto")).toBe(0);
  expect((await readWorkspace(account)).guestPlaces?.[source.id]).toBe(source.id);
  expect(await finishDevicePlaceTransfer(account)).toBe(1);
  expect((await devicePlacePlan(account)).pending).toBe(0);
  expect(await live(account)).toHaveLength(0);
});

test("cloud failure, account cache loss and a delayed retry retain one account's ownership", async () => {
  const source = place();
  await saveEntity("guest", source);
  await reconcileDevicePlaces(account, [], "auto");
  const records = (await readWorkspace(account)).records;
  await removeWorkspace(account);
  const other = crypto.randomUUID();
  expect(await reconcileDevicePlaces(other, [], "auto")).toBe(0);
  expect(await live("guest")).toHaveLength(1);
  expect(await live(other)).toHaveLength(0);
  expect(
    await reconcileDevicePlaces(
      account,
      records.map((r) => ({ ...r, revision: 1 })),
      "auto",
    ),
  ).toBe(0);
  expect(await finishDevicePlaceTransfer(account)).toBe(1);
  expect(await live(account)).toHaveLength(1);
});

test("cloud confirmation clears only matching guest sources and drafts atomically", async () => {
  const source = place();
  await saveEntity("guest", source);
  await setDraft("guest", { id: source.id, name: "Unfinished edit" });
  await reconcileDevicePlaces(account, [], "auto");
  await confirmWrites(account);
  await expect(finishDevicePlaceTransfer(account, () => false)).rejects.toThrow("accountChanged");
  expect(await live("guest")).toHaveLength(1);
  expect(await getDraft("guest")).toBeDefined();
  expect(await finishDevicePlaceTransfer(account)).toBe(1);
  expect(await getDraft("guest")).toBeUndefined();
  expect(await finishDevicePlaceTransfer(account)).toBe(0);
});

test("a guest edit received during transfer is retained rather than erased", async () => {
  const source = place();
  await saveEntity("guest", source);
  await reconcileDevicePlaces(account, [], "auto");
  await saveEntity("guest", { ...source, value: { ...source.value, name: "Newer guest edit" } });
  await confirmWrites(account);
  expect(await finishDevicePlaceTransfer(account)).toBe(0);
  expect((await live("guest"))[0].value.name).toBe("Newer guest edit");
});

test("a family workspace cannot receive or finalize a guest transfer", async () => {
  await saveEntity("guest", place());
  const key = `family:normal-account:${crypto.randomUUID()}`;
  await expect(reconcileDevicePlaces(key, [], "auto")).rejects.toThrow("invalidImport");
  await expect(finishDevicePlaceTransfer(key)).rejects.toThrow("invalidImport");
  expect(await live("guest")).toHaveLength(1);
});

test("concurrent account openings can claim each guest place only once", async () => {
  const other = crypto.randomUUID();
  const source = place("constructor");
  await saveEntity("guest", source);
  const added = await Promise.all([
    reconcileDevicePlaces(account, [], "auto"),
    reconcileDevicePlaces(other, [], "auto"),
  ]);
  expect(added.reduce((a, b) => a + b, 0)).toBe(1);
  expect((await live(account)).length + (await live(other)).length).toBe(1);
  const owner = (await readWorkspace("guest")).deviceTransfers![source.id].account;
  await confirmWrites(owner);
  expect(await finishDevicePlaceTransfer(owner)).toBe(1);
});

test("cancellation after the cleanup write restores guest records and their draft", async () => {
  const source = place();
  await saveEntity("guest", source);
  await setDraft("guest", { id: source.id });
  await reconcileDevicePlaces(account, [], "auto");
  await confirmWrites(account);
  const before = await readWorkspace("guest");
  let current = true;
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    const request = put.call(this, value, key);
    if (this.name === "workspaces" && value.key === "guest") current = false;
    return request;
  });
  await expect(finishDevicePlaceTransfer(account, () => current)).rejects.toThrow("accountChanged");
  spy.mockRestore();
  expect(await readWorkspace("guest")).toEqual(before);
  expect(await getDraft("guest")).toEqual({ id: source.id });
});
