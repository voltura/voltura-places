import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { openDB } from "idb";
import {
  acknowledge,
  changeWorkspace,
  clearDraft,
  copyPlaceToWorkspace,
  deferCapacityFlight,
  getDraft,
  importBackup,
  mergeSnapshot,
  prepareMutation,
  readWorkspace,
  reconcileAccount,
  removeWorkspace,
  saveEntity,
  setDraft,
  deleteEntity,
} from "../src/client/foundation/library";
import { getPhoto, makeStoredPhoto, putPhotos } from "../src/client/foundation/photo-store";
import { exportWithPhotos } from "../src/client/foundation/photo-backup";
import { synchronize } from "../src/client/foundation/sync";
import { longitudeArcStart, wrapLongitude } from "../src/client/foundation/map-coordinates";
import { jpegDimensions } from "../src/shared/photos";
import { storeFamilies } from "../src/client/foundation/family";
import type { Entity } from "../src/shared/model";
const place = (
  id = crypto.randomUUID(),
  name = "Audit fixture",
): Extract<Entity, { kind: "place" }> => ({
  id,
  kind: "place",
  value: {
    name,
    categoryId: "other",
    latitude: 0,
    longitude: 0,
    accuracy: null,
    capturedAt: "2026-10-30T10:00:00Z",
    updatedAt: "2026-10-30T10:00:00Z",
  },
});
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
test.each([false, true])(
  "a restored original editor base preserves newer remote data (deleted=%s)",
  async (deleted) => {
    const key = crypto.randomUUID(),
      p = place();
    await reconcileAccount(key, [{ ...p, revision: 1, deleted: false }], false);
    const draftBase = structuredClone(p);
    await mergeSnapshot(key, [
      { ...p, value: { ...p.value, name: "New cloud" }, revision: 2, deleted },
    ]);
    await saveEntity(key, { ...p, value: { ...p.value, name: "Draft edit" } }, draftBase);
    expect((await readWorkspace(key)).records.find((r) => r.id === p.id)?.conflict).toMatchObject({
      revision: 2,
      deleted,
      value: { name: "New cloud" },
    });
  },
);
test("legacy drafts with an unknown base do not silently overwrite a clean cloud record", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [{ ...p, revision: 2, deleted: false }], false);
  await saveEntity(key, { ...p, value: { ...p.value, name: "Legacy draft" } }, null);
  expect((await readWorkspace(key)).records.find((r) => r.id === p.id)?.conflict?.revision).toBe(2);
});
test("discarding one editor preserves another place's draft", async () => {
  const key = crypto.randomUUID();
  await setDraft(key, { id: "second", name: "Keep" });
  await clearDraft(key, "first");
  expect(await getDraft(key)).toMatchObject({ id: "second" });
  await clearDraft(key, "second");
  expect(await getDraft(key)).toBeUndefined();
});
test("snapshot writes recheck cancellation after database opening and cannot recreate removed data", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [], false);
  let active = true;
  const original = IDBFactory.prototype.open;
  let gate = true;
  const spy = vi.spyOn(IDBFactory.prototype, "open").mockImplementation(function (
    this: IDBFactory,
    name,
    version,
  ) {
    const request = original.call(this, name, version);
    if (gate && name === "voltura-places") {
      gate = false;
      const add = request.addEventListener.bind(request);
      request.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (!listener) return;
        if (type !== "success") return add(type, listener, options);
        add(
          type,
          (event) => {
            void (async () => {
              active = false;
              await removeWorkspace(key);
              if (typeof listener === "function") listener.call(request, event);
              else listener.handleEvent(event);
            })();
          },
          options,
        );
      }) as typeof request.addEventListener;
    }
    return request;
  });
  await expect(
    mergeSnapshot(key, [{ ...p, revision: 1, deleted: false }], () => active),
  ).rejects.toThrow("accountChanged");
  spy.mockRestore();
  const db = await openDB("voltura-places", 1);
  expect(await db.get("workspaces", key)).toBeUndefined();
  db.close();
});
test("a full cloud permits freeing deletions before retrying the exact rejected body", async () => {
  const key = crypto.randomUUID(),
    existing = place(),
    next = place();
  await reconcileAccount(key, [{ ...existing, revision: 1, deleted: false }], false);
  await saveEntity(key, next);
  let full = true;
  const bodies: { mutationId: string; entity: Entity; deleted: boolean }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return Response.json({ version: 1, accountId: key, records: [] });
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    if (body.deleted) full = false;
    if (full) return Response.json({ accountId: key, error: "libraryLimit" }, { status: 413 });
    return Response.json({
      accountId: key,
      record: { ...body.entity, revision: body.baseRevision + 1, deleted: body.deleted },
    });
  });
  await synchronize(key, () => {});
  await deleteEntity(key, existing.id);
  await synchronize(key, () => {});
  expect(bodies.map((b) => b.entity.id)).toEqual([next.id, next.id, existing.id, next.id]);
  expect(bodies[0]).toEqual(bodies[3]);
  expect((await readWorkspace(key)).records.some((r) => r.dirty)).toBe(false);
});
test("deferred flights survive storage reads and keep their request identity", async () => {
  const key = crypto.randomUUID(),
    p = place(),
    other = place();
  await reconcileAccount(key, [{ ...other, revision: 1, deleted: false }], false);
  await saveEntity(key, p);
  const first = (await prepareMutation(key))!;
  await deleteEntity(key, other.id);
  await deferCapacityFlight(key, first.mutation.mutationId);
  const deletion = (await prepareMutation(key))!;
  await acknowledge(key, deletion.mutation.mutationId, { ...other, revision: 2, deleted: true });
  expect(await prepareMutation(key)).toEqual(first);
});
test("identical pull values converge without dropping a newer dirty value", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, p);
  await mergeSnapshot(key, [{ ...p, revision: 1, deleted: false }]);
  let r = (await readWorkspace(key)).records.find((r) => r.id === p.id)!;
  expect(r.dirty).toBe(false);
  expect(r.conflict).toBeUndefined();
  await saveEntity(key, { ...p, value: { ...p.value, name: "Newer device" } });
  await mergeSnapshot(key, [{ ...p, revision: 1, deleted: false }]);
  r = (await readWorkspace(key)).records.find((r) => r.id === p.id)!;
  expect(r.dirty).toBe(true);
  expect(r.value.name).toBe("Newer device");
});
test("online group copying fetches an uncached cloud image and reuses an equal category name", async () => {
  const from = crypto.randomUUID(),
    to = `family:${from}:${crypto.randomUUID()}`,
    p = place(),
    photoId = crypto.randomUUID(),
    jpeg = await readFile("tests/fixtures/photo.jpg");
  await saveEntity(from, { ...p, value: { ...p.value, photoId, categoryId: "parking" } });
  await changeWorkspace(to, (w) => {
    w.records.find((r) => r.id === "parking")!.value = { name: "Parking", color: "blue" };
  });
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(jpeg));
  await copyPlaceToWorkspace(from, to, p.id);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await getPhoto(to, photoId)).toBeDefined();
  expect(
    (await readWorkspace(to)).records.filter(
      (r) => r.kind === "category" && r.value.name === "Parking",
    ),
  ).toHaveLength(1);
});
test("photo collision import is repeatable without duplicate places or images", async () => {
  const from = crypto.randomUUID(),
    to = crypto.randomUUID(),
    photoId = crypto.randomUUID(),
    p = place(),
    jpeg = await readFile("tests/fixtures/photo.jpg");
  await putPhotos([await makeStoredPhoto(from, photoId, new Blob([jpeg]))]);
  const different = new Uint8Array(jpeg);
  different[10] ^= 1;
  await putPhotos([await makeStoredPhoto(to, photoId, new Blob([different]))]);
  await saveEntity(from, { ...p, value: { ...p.value, photoId } });
  const b = await exportWithPhotos(await readWorkspace(from));
  await importBackup(to, b);
  await importBackup(to, b);
  expect((await readWorkspace(to)).records.filter((r) => r.kind === "place")).toHaveLength(1);
});
test("a capacity-rejected photo import stores neither places nor photo bytes", async () => {
  const from = crypto.randomUUID(),
    to = crypto.randomUUID(),
    photoId = crypto.randomUUID(),
    p = place();
  await putPhotos([
    await makeStoredPhoto(from, photoId, new Blob([await readFile("tests/fixtures/photo.jpg")])),
  ]);
  await saveEntity(from, {
    id: "incoming",
    kind: "category",
    value: { name: "Incoming", color: "blue" },
  });
  await saveEntity(from, { ...p, value: { ...p.value, photoId, categoryId: "incoming" } });
  const b = await exportWithPhotos(await readWorkspace(from));
  await changeWorkspace(to, (w) => {
    w.records = Array.from({ length: 200 }, (_, i) => ({
      id: i ? `cat-${i}` : "other",
      kind: "category",
      value: { name: i ? `Category ${i}` : "Other", color: "slate" },
      revision: 0,
      generation: 0,
      dirty: false,
      deleted: false,
    }));
  });
  await expect(importBackup(to, b)).rejects.toThrow("libraryLimit");
  expect(await getPhoto(to, photoId)).toBeUndefined();
  expect((await readWorkspace(to)).records.filter((r) => r.kind === "place")).toHaveLength(0);
});
test("SOF-only fake JPEGs and truncated real scans fail validation", async () => {
  const bytes = new Uint8Array(22);
  bytes.set([255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 1]);
  bytes[20] = 255;
  bytes[21] = 217;
  expect(() => jpegDimensions(bytes)).toThrow("invalidPhoto");
  const real = new Uint8Array(await readFile("tests/fixtures/photo.jpg"));
  expect(jpegDimensions(real)).toBeDefined();
  expect(() => jpegDimensions(real.slice(0, -10))).toThrow();
});
test("storage denial retains archived group metadata supplied by composition", () => {
  vi.stubGlobal("localStorage", {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
  });
  const group = {
    id: crypto.randomUUID(),
    name: "Retained group",
    ownerId: "account",
    members: [],
    requests: [],
  };
  expect(storeFamilies("account", [], { families: [group], inactive: [] }).inactive).toEqual([
    group,
  ]);
});
test("date-line bounds choose a small shared arc while ordinary coordinates stay unchanged", () => {
  const start = longitudeArcStart([-179.99, 179.99]);
  expect(Math.abs(wrapLongitude(-179.99, start) - wrapLongitude(179.99, start))).toBeCloseTo(0.02);
  const ordinary = longitudeArcStart([-20, 0, 20]);
  expect([-20, 0, 20].map((v) => wrapLongitude(v, ordinary))).toEqual([-20, 0, 20]);
});

test("an active import reservation prevents another tab consuming its validated capacity", async () => {
  const key = crypto.randomUUID();
  await changeWorkspace(key, (w) => {
    w.importLease = { token: "active", expiresAt: Date.now() + 300000 };
  });
  await expect(saveEntity(key, place())).rejects.toThrow("syncBusy");
  await changeWorkspace(
    key,
    (w) => {
      w.importLease!.expiresAt = 0;
    },
    undefined,
    () => true,
    "active",
  );
  await expect(saveEntity(key, place())).resolves.toBeDefined();
});

test("deleting the capacity-rejected new place drains its original flight without resurrection", async () => {
  const key = crypto.randomUUID(),
    p = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, p);
  const first = (await prepareMutation(key))!;
  await deleteEntity(key, p.id);
  await deferCapacityFlight(key, first.mutation.mutationId);
  const deletion = (await prepareMutation(key))!;
  expect(deletion.mutation.deleted).toBe(true);
  const tombstone = { ...p, revision: 1, deleted: true };
  await acknowledge(key, deletion.mutation.mutationId, tombstone);
  expect((await prepareMutation(key))?.mutation).toEqual(first.mutation);
  await acknowledge(key, first.mutation.mutationId, tombstone, true);
  const r = (await readWorkspace(key)).records.find((r) => r.id === p.id)!;
  expect(r.deleted).toBe(true);
  expect(r.conflict).toBeUndefined();
  expect(await prepareMutation(key)).toBeUndefined();
});
