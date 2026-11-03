import "fake-indexeddb/auto";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  saveEntity,
  setDraft,
  getDraft,
  clearDraft,
  readWorkspace,
  copyPlaceToWorkspace,
  reconcileAccount,
  mergeSnapshot,
  prepareMutation,
  resolveConflict,
  changeWorkspace,
  devicePlacePlan,
  deleteEntity,
  acknowledge,
  removeAccountWorkspaces,
  removeWorkspace,
  saveVisit,
  importBackup,
  exportBackup,
  finishDevicePlaceTransfer,
  reconcileDevicePlaces,
} from "../src/client/foundation/library";
import {
  clearPhotos,
  getPhoto,
  makeStoredPhoto,
  putPhotos,
} from "../src/client/foundation/photo-store";
import { synchronize } from "../src/client/foundation/sync";
import { preparePhoto, uploadPhoto } from "../src/client/foundation/photos";
import { starters, type Entity } from "../src/shared/model";

const place = (id: string = crypto.randomUUID()): Extract<Entity, { kind: "place" }> => ({
  id,
  kind: "place",
  value: {
    name: "Synthetic fixture",
    categoryId: "other",
    latitude: 0,
    longitude: 0,
    accuracy: null,
    capturedAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  },
});

beforeEach(() => vi.stubGlobal("window", new EventTarget()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("an aborted initial transaction read retains the record and draft without a stray rejection", async () => {
  const key = crypto.randomUUID();
  const original = place();
  await saveEntity(key, original);
  await setDraft(key, { id: original.id, name: "Recovery draft" });
  const get = IDBObjectStore.prototype.get;
  let abort = true;
  vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
    this: IDBObjectStore,
    query,
  ) {
    const request = get.call(this, query);
    if (abort && this.name === "workspaces" && query === key) {
      abort = false;
      queueMicrotask(() => this.transaction.abort());
    }

    return request;
  });
  await expect(
    saveEntity(
      key,
      { ...original, value: { ...original.value, name: "Uncommitted" } },
      original,
      true,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(
    (await readWorkspace(key)).records.find((record) => record.id === original.id)?.value,
  ).toEqual(original.value);
  expect(await getDraft(key)).toMatchObject({ id: original.id, name: "Recovery draft" });
});

test.each(["draft", "photos"] as const)(
  "an aborted %s cleanup preserves recoverable data",
  async (kind) => {
    const key = crypto.randomUUID();
    const id = crypto.randomUUID();
    if (kind === "draft") {
      await setDraft(key, { id, name: "Recovery draft" });
      const get = IDBObjectStore.prototype.get;
      let abort = true;
      vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
        this: IDBObjectStore,
        query,
      ) {
        const request = get.call(this, query);
        if (abort && this.name === "drafts" && query === key) {
          abort = false;
          queueMicrotask(() => this.transaction.abort());
        }

        return request;
      });
      await expect(clearDraft(key, id)).rejects.toMatchObject({ name: "AbortError" });
      expect(await getDraft(key)).toMatchObject({ id, name: "Recovery draft" });
    } else {
      const jpeg = await readFile("tests/fixtures/photo.jpg");
      await putPhotos([await makeStoredPhoto(key, id, new Blob([jpeg], { type: "image/jpeg" }))]);
      const remove = IDBObjectStore.prototype.delete;
      let abort = true;
      vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
        this: IDBObjectStore,
        ...args
      ) {
        const request = remove.apply(this, args);
        if (abort && this.name === "photos") {
          abort = false;
          queueMicrotask(() => this.transaction.abort());
        }

        return request;
      });
      await expect(clearPhotos(key)).rejects.toMatchObject({ name: "AbortError" });
      expect((await getPhoto(key, id))?.blob.size).toBe(jpeg.byteLength);
    }
  },
);

test("a cancelled editor save retains both the original record and its draft", async () => {
  const key = crypto.randomUUID();
  const original = place();
  await saveEntity(key, original);
  await setDraft(key, { id: original.id, name: "Unsaved draft" });
  let current = true;
  const pending = saveEntity(
    key,
    { ...original, value: { ...original.value, name: "Late save" } },
    original,
    true,
    () => current,
  );
  current = false;
  await expect(pending).rejects.toThrow("accountChanged");
  expect(
    (await readWorkspace(key)).records.find(
      (r): r is Extract<typeof r, { kind: "place" | "category" }> =>
        r.kind !== "visit" && r.id === original.id,
    )?.value.name,
  ).toBe("Synthetic fixture");
  expect(await getDraft(key)).toMatchObject({ id: original.id, name: "Unsaved draft" });
});

test("a cancelled conflict choice does not create a Keep both copy", async () => {
  const key = crypto.randomUUID();
  const original = place();
  await saveEntity(key, original);
  await mergeSnapshot(key, [
    {
      ...original,
      value: { ...original.value, name: "Cloud fixture" },
      revision: 2,
      deleted: false,
    },
  ]);
  const before = await readWorkspace(key);
  await expect(resolveConflict(key, original.id, "both", () => false)).rejects.toThrow(
    "accountChanged",
  );
  expect(await readWorkspace(key)).toEqual(before);
});

test("a copy cancelled while its destination write is pending rolls back that write", async () => {
  const from = crypto.randomUUID();
  const to = crypto.randomUUID();
  const original = place();
  await saveEntity(from, original);
  let current = true;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    const result = put.call(this, value, key);
    if (this.name === "workspaces" && value?.key === to) {
      current = false;
    }

    return result;
  });
  await expect(copyPlaceToWorkspace(from, to, original.id, () => current)).rejects.toThrow(
    "accountChanged",
  );
  expect((await readWorkspace(to)).records.filter((r) => r.kind === "place")).toHaveLength(0);
});

test("an idle mutation check and identical pull do not rewrite or broadcast the workspace", async () => {
  const key = crypto.randomUUID();
  const original = place();
  const remote = { ...original, revision: 1, deleted: false };
  await reconcileAccount(key, [remote], false);
  const before = await readWorkspace(key);
  const changed = vi.fn();
  window.addEventListener("places-library", changed);
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  await expect(prepareMutation(key)).resolves.toBeUndefined();
  await mergeSnapshot(key, [remote]);
  expect(put).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(await readWorkspace(key)).toEqual(before);
});

test.each(["destination", "guest"])(
  "device copying cancelled during the %s write rolls back records and receipts together",
  async (cancelAt) => {
    const key = crypto.randomUUID();
    await changeWorkspace("guest", (workspace) => {
      workspace.records = starters.map((entity) => ({
        ...entity,
        revision: 0,
        generation: 0,
        dirty: false,
        deleted: false,
      }));
      workspace.deviceAccounts = [];
    });
    await saveEntity("guest", place());
    const guest = await readWorkspace("guest");
    const before = await readWorkspace(key);
    let current = true;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      id,
    ) {
      const request = put.call(this, value, id);
      if (this.name === "workspaces" && value?.key === (cancelAt === "guest" ? "guest" : key)) {
        current = false;
      }

      return request;
    });
    await expect(reconcileDevicePlaces(key, [], "copy", () => current)).rejects.toThrow(
      "accountChanged",
    );
    expect(await readWorkspace(key)).toEqual(before);
    expect(await readWorkspace("guest")).toEqual(guest);
  },
);

test.each([undefined, null])(
  "optional photoId %s retains its JSON meaning when a retry converges",
  async (photoId) => {
    const key = crypto.randomUUID();
    const original = place();
    await reconcileAccount(key, [], false);
    await saveEntity(key, { ...original, value: { ...original.value, photoId } });
    const flight = (await prepareMutation(key))!;
    await acknowledge(
      key,
      flight.mutation.mutationId,
      { ...original, revision: 1, deleted: false },
      true,
    );
    const stored = (await readWorkspace(key)).records.find((record) => record.id === original.id)!;
    // Undefined is omitted on the wire. Explicit null is a real photo removal.
    expect(Boolean(stored.conflict)).toBe(photoId === null);
    expect(stored.dirty).toBe(photoId === null);
  },
);

test("a photo upload cancelled during its local acknowledgement leaves it retryable", async () => {
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
  await putPhotos([
    await makeStoredPhoto(key, id, new Blob([await readFile("tests/fixtures/photo.jpg")])),
  ]);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
  let current = true;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    const result = put.call(this, value, key);
    if (this.name === "photos" && value.uploaded) {
      current = false;
    }

    return result;
  });
  await expect(uploadPhoto(key, id, () => current)).rejects.toThrow("accountChanged");
  expect((await getPhoto(key, id))?.uploaded).toBe(false);
});

test("photo preparation cancelled while decoding stops before canvas processing", async () => {
  let current = true;
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 1280;
      naturalHeight = 960;
      onload = () => {};
      set src(_url: string) {
        current = false;
        this.onload();
      }
    },
  );
  const createElement = vi.fn(() => {
    throw new Error("Unexpected canvas work");
  });
  vi.stubGlobal("document", { createElement });
  await expect(
    preparePhoto(
      new File(["synthetic"], "fixture.jpg", { type: "image/jpeg" }),
      crypto.randomUUID(),
      () => current,
    ),
  ).rejects.toThrow("accountChanged");
  expect(createElement).not.toHaveBeenCalled();
});

test("an unavailable photo does not block downloading other referenced photos", async () => {
  const key = crypto.randomUUID();
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  const records = [a, b].map((id) => {
    const p = place();

    return { ...p, value: { ...p.value, photoId: id }, revision: 1, deleted: false };
  });
  await reconcileAccount(key, records, false);
  vi.stubGlobal("navigator", { onLine: true });
  const jpeg = await readFile("tests/fixtures/photo.jpg");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
    String(url).includes("/photos/")
      ? String(url).endsWith(a)
        ? new Response(null, { status: 503 })
        : new Response(jpeg)
      : Response.json({ version: 1, accountId: key, records }),
  );
  const statuses: string[] = [];
  await synchronize(key, (s) => statuses.push(s));
  expect(await getPhoto(key, a)).toBeUndefined();
  expect((await getPhoto(key, b))?.uploaded).toBe(true);
  expect(statuses.at(-1)).toBe("syncPhotoUnavailable");
});

test("a pull checks cached photo identities without reading every image blob", async () => {
  const key = crypto.randomUUID();
  const photoId = crypto.randomUUID();
  const original = place();
  const records = [
    { ...original, value: { ...original.value, photoId }, revision: 1, deleted: false },
  ];
  await reconcileAccount(key, records, false);
  await putPhotos([
    await makeStoredPhoto(key, photoId, new Blob([await readFile("tests/fixtures/photo.jpg")])),
  ]);
  vi.stubGlobal("navigator", { onLine: true });
  const network = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ version: 1, accountId: key, records }));
  const get = IDBObjectStore.prototype.get;
  let imageReads = 0;
  vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
    this: IDBObjectStore,
    key,
  ) {
    if (this.name === "photos") {
      imageReads++;
    }

    return get.call(this, key);
  });
  const statuses: string[] = [];
  await synchronize(key, (status) => statuses.push(status));
  expect(imageReads).toBe(0);
  expect(network).toHaveBeenCalledTimes(1);
  expect(statuses.at(-1)).toBe("synced");
});

test("sync status includes a local edit arriving while photo downloads finish", async () => {
  const key = crypto.randomUUID();
  const photoId = crypto.randomUUID();
  const original = place();
  const records = [
    { ...original, value: { ...original.value, photoId }, revision: 1, deleted: false },
  ];
  await reconcileAccount(key, records, false);
  const jpeg = await readFile("tests/fixtures/photo.jpg");
  vi.stubGlobal("navigator", { onLine: true });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).includes("/photos/")) {
      await saveEntity(key, place());

      return new Response(jpeg);
    }

    return Response.json({ version: 1, accountId: key, records });
  });
  const statuses: string[] = [];
  await synchronize(key, (status) => statuses.push(status));
  expect(statuses.at(-1)).toBe("savedPending");
});

test("explicit device account history avoids reading all cached libraries", async () => {
  const key = crypto.randomUUID();
  await changeWorkspace("guest", (workspace) => {
    workspace.deviceAccounts = [key];
  });
  const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
  await devicePlacePlan(key);
  expect(getAll).not.toHaveBeenCalled();
});

test("device copying retains the first matching cloud tombstone when identity and value match different records", async () => {
  const key = crypto.randomUUID();
  const source = place();
  await changeWorkspace("guest", (workspace) => {
    workspace.records = [
      ...starters.map((category) => ({
        ...category,
        revision: 0,
        generation: 0,
        dirty: false,
        deleted: false,
      })),
      { ...source, revision: 0, generation: 1, dirty: true, deleted: false },
    ];
    workspace.deviceAccounts = [];
  });
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([key, source.id])),
  );
  const copyId =
    "guest-" + [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, "0")).join("");
  const first = { ...source, id: "earlier-value-match", revision: 1, deleted: true };
  const identity = {
    ...source,
    id: copyId,
    value: { ...source.value, name: "Later identity match" },
    revision: 2,
    deleted: true,
  };
  expect(await reconcileDevicePlaces(key, [first, identity], "copy")).toBe(0);
  const workspace = await readWorkspace(key);
  expect(workspace.guestPlaces?.[source.id]).toBe(first.id);
  expect(
    workspace.records.filter((record) => record.kind === "place" && !record.deleted),
  ).toHaveLength(0);
});

test("a maximum-size device library copies atomically and retrying does not duplicate places", async () => {
  const key = crypto.randomUUID();
  await changeWorkspace("guest", (workspace) => {
    workspace.records = [
      ...starters.map((category) => ({
        ...category,
        revision: 0,
        generation: 0,
        dirty: false,
        deleted: false,
      })),
      ...Array.from({ length: 5000 }, (_, i) => {
        const original = place(`bulk-device-${i}`);

        return {
          ...original,
          value: { ...original.value, name: `Synthetic ${i}` },
          revision: 0,
          generation: 1,
          dirty: true,
          deleted: false,
        };
      }),
    ];
    workspace.deviceAccounts = [];
  });
  expect(await reconcileDevicePlaces(key, [], "copy")).toBe(5000);
  const copied = await readWorkspace(key);
  const places = copied.records.filter((record) => record.kind === "place");
  expect(places).toHaveLength(5000);
  expect(new Set(places.map((record) => record.id)).size).toBe(5000);
  expect(
    places.every(
      (record) =>
        record.dirty && !record.deleted && record.generation === 1 && record.revision === 0,
    ),
  ).toBe(true);
  expect(await reconcileDevicePlaces(key, [], "copy")).toBe(0);
  expect((await readWorkspace(key)).records).toEqual(copied.records);
});

test("bulk category deletion retains the exact flight and newer place generations", async () => {
  const key = crypto.randomUUID();
  const places = Array.from({ length: 5000 }, () => {
    const original = place();

    return { ...original, value: { ...original.value, categoryId: "outdoors" } };
  });
  await changeWorkspace(key, (workspace) => {
    workspace.reconciled = true;
    workspace.records.push(
      ...places.map((p) => ({ ...p, revision: 0, generation: 1, dirty: true, deleted: false })),
    );
  });
  const flight = (await prepareMutation(key))!;
  await deleteEntity(key, "outdoors");
  const after = await readWorkspace(key);
  expect(after.flight).toEqual(flight);
  expect(
    after.records.filter(
      (r) => r.kind === "place" && r.value.categoryId === "other" && r.dirty && r.generation === 2,
    ),
  ).toHaveLength(5000);
  expect(after.records.find((r) => r.id === "outdoors")?.deleted).toBe(true);
  await acknowledge(key, flight.mutation.mutationId, {
    ...flight.mutation.entity,
    revision: 1,
    deleted: false,
  });
  const acknowledged = (await readWorkspace(key)).records.find(
    (r) => r.id === flight.mutation.entity.id,
  )!;
  expect(acknowledged).toMatchObject({
    revision: 1,
    generation: 2,
    dirty: true,
    value: { categoryId: "other" },
  });
});

test("a read immediately after a queued edit observes that draft", async () => {
  const key = crypto.randomUUID();
  const pending = setDraft(key, { id: "new-draft" });
  expect(await getDraft(key)).toEqual({ id: "new-draft" });
  await pending;
});

test("failure deleting any account draft rolls back all account record removals", async () => {
  const key = crypto.randomUUID();
  const group = `family:${key}:${crypto.randomUUID()}`;
  const original = place();
  await saveEntity(key, original);
  await saveEntity(group, original);
  await setDraft(group, { id: original.id });
  const remove = IDBObjectStore.prototype.delete;
  const spy = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
    this: IDBObjectStore,
    query,
  ) {
    const request = remove.call(this, query);
    if (this.name === "drafts") {
      queueMicrotask(() => this.transaction.abort());
    }

    return request;
  });
  await expect(removeAccountWorkspaces(key)).rejects.toMatchObject({ name: "AbortError" });
  spy.mockRestore();
  expect((await readWorkspace(key)).records.some((r) => r.id === original.id)).toBe(true);
  expect((await readWorkspace(group)).records.some((r) => r.id === original.id)).toBe(true);
  expect(await getDraft(group)).toMatchObject({ id: original.id });
});

test("a stale group details action cannot save personal status for a deleted place", async () => {
  const owner = crypto.randomUUID();
  const key = `family:${owner}:${crypto.randomUUID()}`;
  const original = place();
  await saveEntity(key, original);
  await deleteEntity(key, original.id);
  await expect(saveVisit(key, original.id, "want")).rejects.toThrow("placeChanged");
  expect((await readWorkspace(owner)).records.some((r) => r.kind === "visit")).toBe(false);
});

test("reselecting a personal status does not queue a new mutation or rewrite the private library", async () => {
  const owner = crypto.randomUUID();
  const key = `family:${owner}:${crypto.randomUUID()}`;
  const original = place();
  await saveEntity(key, original, undefined, false, () => true, "want");
  const before = (await readWorkspace(owner)).records;
  const updated: string[] = [];
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (this.name === "workspaces") {
      updated.push(value.key);
    }

    return put.call(this, value, key);
  });
  await saveVisit(key, original.id, "want");
  await saveEntity(
    key,
    { ...original, value: { ...original.value, name: "Updated" } },
    undefined,
    false,
    () => true,
    "want",
  );
  expect(updated).toEqual([key]);
  expect((await readWorkspace(owner)).records).toEqual(before);
});

test("an edited copy source cannot commit the earlier value to another library", async () => {
  const from = crypto.randomUUID();
  const to = crypto.randomUUID();
  const original = place();
  await saveEntity(from, original);
  const get = IDBObjectStore.prototype.get;
  let sourceReads = 0;
  vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
    this: IDBObjectStore,
    query,
  ) {
    if (this.name === "workspaces" && query === from && ++sourceReads === 2) {
      return get.call(this, "missing-source");
    }

    return get.call(this, query);
  });
  await expect(copyPlaceToWorkspace(from, to, original.id)).rejects.toThrow("placeChanged");
  expect((await readWorkspace(to)).records.some((r) => r.kind === "place")).toBe(false);
});

test("guest status edits during a transfer survive cleanup and retain the changed choice", async () => {
  await removeWorkspace("guest");
  const key = crypto.randomUUID();
  const original = place();
  await saveEntity("guest", original, undefined, false, () => true, "want");
  await reconcileDevicePlaces(key, [], "auto");
  await saveVisit("guest", original.id, "visited");
  expect(await reconcileDevicePlaces(key, [], "auto")).toBe(1);
  expect(
    (await readWorkspace(key)).records
      .filter((r) => r.kind === "visit")
      .map((r) => r.value.status)
      .sort(),
  ).toEqual(["visited", "want"]);
  let flight;
  while ((flight = await prepareMutation(key))) {
    await acknowledge(key, flight.mutation.mutationId, {
      ...flight.mutation.entity,
      revision: flight.mutation.baseRevision + 1,
      deleted: flight.mutation.deleted,
    });
  }
  expect(await finishDevicePlaceTransfer(key)).toBe(1);
  expect((await readWorkspace("guest")).records.some((r) => r.kind === "visit")).toBe(false);
});

test("retrying a handled guest transfer while waiting for the cloud is read only", async () => {
  await removeWorkspace("guest");
  const key = crypto.randomUUID();
  await saveEntity("guest", place());
  await reconcileDevicePlaces(key, [], "auto");
  const put = vi.spyOn(IDBObjectStore.prototype, "put");
  expect(await reconcileDevicePlaces(key, [], "auto")).toBe(0);
  expect(put).not.toHaveBeenCalled();
});

test("ordinary backup places without collisions or statuses require no remapped identities", async () => {
  const source = crypto.randomUUID();
  const target = crypto.randomUUID();
  await saveEntity(source, place());
  const backup = exportBackup(await readWorkspace(source));
  const random = vi.spyOn(crypto, "randomUUID");
  await importBackup(target, backup);
  expect(random).not.toHaveBeenCalled();
});

test("cloud conflict response already matching the latest device edit converges cleanly", async () => {
  const key = crypto.randomUUID();
  const original = place();
  const latest = { ...original, value: { ...original.value, name: "Independent matching edit" } };
  await reconcileAccount(key, [], false);
  await saveEntity(key, original);
  const flight = (await prepareMutation(key))!;
  await saveEntity(key, latest);
  await acknowledge(
    key,
    flight.mutation.mutationId,
    { ...latest, deleted: false, revision: 2 },
    true,
  );
  expect((await readWorkspace(key)).records.find((r) => r.id === original.id)).toMatchObject({
    dirty: false,
    revision: 2,
  });
  expect(await prepareMutation(key)).toBeUndefined();
});

test("observing a saved flight in a snapshot does not conflict with its newer local edit", async () => {
  const key = crypto.randomUUID();
  const original = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, original);
  const flight = (await prepareMutation(key))!;
  await saveEntity(key, { ...original, value: { ...original.value, name: "Later" } });
  const remote = { ...original, deleted: false, revision: 1 };
  await mergeSnapshot(key, [remote]);
  const r = (await readWorkspace(key)).records.find((r) => r.id === original.id)!;
  expect(r).toMatchObject({ dirty: true, revision: 1, value: { name: "Later" } });
  expect(r.conflict).toBeUndefined();
  expect((await prepareMutation(key))?.mutation).toEqual(flight.mutation);
});

test("sync repairs a locally acknowledged attachment missing upstream and retries the same flight", async () => {
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
  const original = place();
  original.value.photoId = id;
  await putPhotos([
    {
      ...(await makeStoredPhoto(key, id, new Blob([await readFile("tests/fixtures/photo.jpg")]))),
      uploaded: true,
    },
  ]);
  await reconcileAccount(key, [], false);
  await saveEntity(key, original);
  const bodies: string[] = [];
  const uploads: unknown[] = [];
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      if (init?.method === "PUT") {
        expect(init).toMatchObject({ mode: "same-origin", redirect: "error" });
        uploads.push(url);

        return Response.json({});
      }
      const record = { ...original, revision: 1, deleted: false };
      if (init?.method === "POST") {
        expect(init).toMatchObject({ mode: "same-origin", redirect: "error" });
        bodies.push(init.body);

        return bodies.length === 1
          ? Response.json({ accountId: key, error: "photoUnavailable" }, { status: 422 })
          : Response.json({ accountId: key, record });
      }

      return Response.json({ version: 1, accountId: key, records: [record] });
    }),
  );
  const statuses: string[] = [];
  await synchronize(key, (s) => statuses.push(s));
  expect(statuses.at(-1)).toBe("synced");
  expect(uploads).toEqual([`/api/v1/photos/${id}`]);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
});

test.each([
  { revision: 0, deleted: false },
  { revision: 1, deleted: true },
])("invalid success acknowledgement preserves its retryable flight %j", async (bad) => {
  const key = crypto.randomUUID();
  const p = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, p);
  const flight = (await prepareMutation(key))!;
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ accountId: key, record: { ...p, ...bad } })),
  );
  const statuses: string[] = [];
  await synchronize(key, (s) => statuses.push(s));
  expect(statuses.at(-1)).toBe("syncInvalidResponse");
  expect(await prepareMutation(key)).toEqual(flight);
});

test("a successful response for a different place value cannot overwrite an exact flight", async () => {
  const key = crypto.randomUUID();
  const p = place();
  await reconcileAccount(key, [], false);
  await saveEntity(key, p);
  const flight = (await prepareMutation(key))!;
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        accountId: key,
        record: { ...p, value: { ...p.value, name: "unrelated" }, revision: 1, deleted: false },
      }),
    ),
  );
  await synchronize(key, () => {});
  expect(await prepareMutation(key)).toEqual(flight);
  expect((await readWorkspace(key)).records.find((r) => r.id === p.id)?.value).toEqual(p.value);
});

test("guest cleanup waits until both destination place and personal status are confirmed", async () => {
  await removeWorkspace("guest");
  const key = crypto.randomUUID();
  const p = place();
  await saveEntity("guest", p, undefined, false, () => true, "visited");
  await reconcileDevicePlaces(key, [], "auto");
  let flight = (await prepareMutation(key))!;
  expect(flight.mutation.entity.kind).toBe("place");
  await acknowledge(key, flight.mutation.mutationId, {
    ...flight.mutation.entity,
    revision: 1,
    deleted: false,
  });
  expect(await finishDevicePlaceTransfer(key)).toBe(0);
  flight = (await prepareMutation(key))!;
  expect(flight.mutation.entity.kind).toBe("visit");
  expect(await finishDevicePlaceTransfer(key)).toBe(0);
  await acknowledge(key, flight.mutation.mutationId, {
    ...flight.mutation.entity,
    revision: 1,
    deleted: false,
  });
  expect(await finishDevicePlaceTransfer(key)).toBe(1);
});

test("a full snapshot history defers the exact new-ID flight while later edits and tombstones sync", async () => {
  const key = crypto.randomUUID();
  const added = place();
  const editing = place();
  const deleting = place();
  const initial = [editing, deleting].map((p) => ({ ...p, revision: 1, deleted: false }));
  await reconcileAccount(key, initial, false);
  await saveEntity(key, added);
  const blocked = (await prepareMutation(key))!;
  await saveEntity(key, { ...editing, value: { ...editing.value, name: "Allowed edit" } });
  await deleteEntity(key, deleting.id);
  let full = true;
  const requests: string[] = [];
  const cloud = new Map(initial.map((r) => [r.id, r]));
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      if (init?.method !== "POST") {
        return Response.json({ version: 1, accountId: key, records: [...cloud.values()] });
      }
      requests.push(init.body);
      const m = JSON.parse(init.body);
      if (m.entity.id === added.id && full) {
        return Response.json({ accountId: key, error: "snapshotLimit" }, { status: 413 });
      }
      const record = { ...m.entity, revision: m.baseRevision + 1, deleted: m.deleted };
      cloud.set(record.id, record);

      return Response.json({ accountId: key, record });
    }),
  );
  const statuses: string[] = [];
  await synchronize(key, (status) => statuses.push(status));
  expect(statuses.at(-1)).toBe("syncHistoryFull");
  expect(cloud.get(editing.id)?.value.name).toBe("Allowed edit");
  expect(cloud.get(deleting.id)?.deleted).toBe(true);
  expect(requests).toHaveLength(3);
  expect((await readWorkspace(key)).deferredFlights?.[0]).toMatchObject({
    ...blocked,
    snapshotBlocked: true,
  });
  await saveEntity(key, { ...added, value: { ...added.value, name: "Edited while blocked" } });
  full = false;
  await synchronize(key, (status) => statuses.push(status));
  const retry = requests.filter(
    (body) => JSON.parse(body).mutationId === blocked.mutation.mutationId,
  );
  expect(retry).toEqual([JSON.stringify(blocked.mutation), JSON.stringify(blocked.mutation)]);
  expect(cloud.get(added.id)?.value.name).toBe("Edited while blocked");
  expect((await readWorkspace(key)).deferredFlights).toHaveLength(0);
  expect(statuses.at(-1)).toBe("synced");
});
