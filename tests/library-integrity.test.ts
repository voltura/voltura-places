import "fake-indexeddb/auto";
import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  saveEntity,
  setDraft,
  getDraft,
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
  reconcileDevicePlaces,
} from "../src/client/foundation/library";
import { getPhoto, makeStoredPhoto, putPhotos } from "../src/client/foundation/photo-store";
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

test("a cancelled editor save retains both the original record and its draft", async () => {
  const key = crypto.randomUUID(),
    original = place();
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
  const key = crypto.randomUUID(),
    original = place();
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
  const from = crypto.randomUUID(),
    to = crypto.randomUUID(),
    original = place();
  await saveEntity(from, original);
  let current = true;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    const result = put.call(this, value, key);
    if (this.name === "workspaces" && value?.key === to) current = false;
    return result;
  });
  await expect(copyPlaceToWorkspace(from, to, original.id, () => current)).rejects.toThrow(
    "accountChanged",
  );
  expect((await readWorkspace(to)).records.filter((r) => r.kind === "place")).toHaveLength(0);
});

test("an idle mutation check and identical pull do not rewrite or broadcast the workspace", async () => {
  const key = crypto.randomUUID(),
    original = place();
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
    const guest = await readWorkspace("guest"),
      before = await readWorkspace(key);
    let current = true;
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      id,
    ) {
      const request = put.call(this, value, id);
      if (this.name === "workspaces" && value?.key === (cancelAt === "guest" ? "guest" : key))
        current = false;
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
    const key = crypto.randomUUID(),
      original = place();
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
  const key = crypto.randomUUID(),
    id = crypto.randomUUID();
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
    if (this.name === "photos" && value.uploaded) current = false;
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
      async decode() {
        current = false;
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
  const key = crypto.randomUUID(),
    a = crypto.randomUUID(),
    b = crypto.randomUUID();
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
  expect(statuses.at(-1)).toBe("actionRequired");
});

test("a pull checks cached photo identities without reading every image blob", async () => {
  const key = crypto.randomUUID(),
    photoId = crypto.randomUUID(),
    original = place();
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
    if (this.name === "photos") imageReads++;
    return get.call(this, key);
  });
  const statuses: string[] = [];
  await synchronize(key, (status) => statuses.push(status));
  expect(imageReads).toBe(0);
  expect(network).toHaveBeenCalledTimes(1);
  expect(statuses.at(-1)).toBe("synced");
});

test("sync status includes a local edit arriving while photo downloads finish", async () => {
  const key = crypto.randomUUID(),
    photoId = crypto.randomUUID(),
    original = place();
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
  expect(statuses.at(-1)).toBe("pending");
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
  const key = crypto.randomUUID(),
    source = place();
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
