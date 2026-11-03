import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { canonicalGeometry, acceptedRouteFix, type RouteGeometry } from "../src/shared/routes";
import { routeSchema, type Entity } from "../src/shared/model";
import { putGeometry, getGeometry } from "../src/client/foundation/route-store";
import {
  startRouteRecording,
  readRouteDraft,
  draftGeometry,
  type RecordingState,
} from "../src/client/foundation/route-recording";
import { prepareRecordedRoute, saveRecordedRoute } from "../src/client/foundation/route-save";
import {
  readWorkspace,
  saveEntity,
  importBackup,
  copyPlaceToWorkspace,
  deleteEntity,
  changeWorkspace,
} from "../src/client/foundation/library";
import { exportWithPhotos } from "../src/client/foundation/photo-backup";
import { saveRouteSnapshot } from "../src/client/foundation/route-sharing";
import { visitStatuses } from "../src/shared/visits";
import { entityLimits } from "../src/shared/limits";
import { livePlaces, selectPlaces } from "../src/client/foundation/library-selectors";

const geometry: RouteGeometry = {
  version: 1,
  segments: [
    [
      [0, 179.999, 1000, 4],
      [0, -179.999, 2000, 5],
    ],
    [[20, 20, 9000, 4]],
  ],
};
let held = false;
const locks = {
  request: async (
    _name: string,
    _options: unknown,
    action: (lock: object | null) => Promise<unknown>,
  ) => {
    if (held) {
      return action(null);
    }
    held = true;
    try {
      return await action({});
    } finally {
      held = false;
    }
  },
};
beforeEach(() => {
  held = false;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { locks, onLine: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function route(workspace: string): Promise<Extract<Entity, { kind: "route" }>> {
  const stored = await putGeometry(workspace, geometry);

  return {
    id: crypto.randomUUID(),
    kind: "route",
    value: routeSchema.parse({
      name: "Island walk",
      categoryId: "other",
      capturedAt: "2026-11-03T00:00:00.000Z",
      updatedAt: "2026-11-03T00:00:00.000Z",
      startedAt: "2026-11-03T00:00:00.000Z",
      stoppedAt: "2026-11-03T00:01:00.000Z",
      duration: 60000,
      geometryId: stored.id,
      ...stored.summary,
    }),
  };
}

test("canonical segmented geometry hashes consistently and never measures across gaps", async () => {
  const value = await canonicalGeometry(geometry);
  expect(value.id).toMatch(/^[a-f0-9]{64}$/);
  expect((await canonicalGeometry({ segments: geometry.segments, version: 1 })).id).toBe(value.id);
  expect(value.summary.distance).toBeGreaterThan(220);
  expect(value.summary.distance).toBeLessThan(225);
  expect(value.summary.pointCount).toBe(3);
  await expect(
    canonicalGeometry({ version: 1, segments: [Array(10001).fill([0, 0, 1, 1])] }),
  ).rejects.toThrow();
  await expect(canonicalGeometry({ version: 1, segments: [[[0, 0, 1, 1]]] })).rejects.toThrow();
  await expect(
    canonicalGeometry({
      version: 1,
      segments: [
        [
          [91, 0, 1, 1],
          [0, 0, 1, 1],
        ],
      ],
    }),
  ).rejects.toThrow();
});

function fix(timestamp = 10000, accuracy = 10): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude: 1,
      longitude: 2,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    toJSON: () => ({}),
  };
}

test("route fixes enforce WGS84, accuracy, age and five-second future tolerance", () => {
  expect(acceptedRouteFix(fix(), 10, 20000)).not.toBeNull();
  expect(acceptedRouteFix(fix(), 5, 20000)).toBeNull();
  expect(acceptedRouteFix(fix(25000), 10, 20000)).not.toBeNull();
  expect(acceptedRouteFix(fix(25001), 10, 20000)).toBeNull();
  expect(acceptedRouteFix(fix(10000, 101), 10, 10000)).toBeNull();
  expect(acceptedRouteFix(fix(10000, NaN), 10, 10000)).toBeNull();
});

test("recording samples, closes hidden/error segments, excludes stale callbacks and retains monotonic elapsed time", async () => {
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", document);
  let now = 100000;
  let elapsed = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const success: PositionCallback[] = [];
  const failure: PositionErrorCallback[] = [];
  const clearWatch = vi.fn();
  const release = vi.fn(async () => {});
  vi.stubGlobal("navigator", {
    locks,
    geolocation: {
      watchPosition: (s: PositionCallback, e: PositionErrorCallback) => {
        success.push(s);
        failure.push(e);

        return success.length;
      },
      clearWatch,
    },
    wakeLock: { request: async () => ({ release }) },
  });
  const workspace = crypto.randomUUID();
  let state: RecordingState | undefined;
  const capture = await startRouteRecording(
    workspace,
    5,
    () => true,
    (next) => {
      state = next;
    },
  );
  try {
    await expect(
      startRouteRecording(
        workspace,
        5,
        () => true,
        () => {},
      ),
    ).rejects.toThrow("syncBusy");
    success[0](fix(now));
    await vi.waitFor(() => expect(state?.draft.count).toBe(1));
    success[0](fix(now));
    elapsed += 5000;
    now += 5000;
    success[0](fix(now));
    await vi.waitFor(() => expect(state?.draft.count).toBe(2));
    document.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(clearWatch).toHaveBeenCalled();
    elapsed += 20000;
    now += 20000;
    success[0](fix(now));
    document.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    success[1](fix(now));
    await vi.waitFor(() => expect(state?.draft.count).toBe(3));
    failure[1]({ code: 2 } as GeolocationPositionError);
    elapsed += 5000;
    now -= 50000;
    success[1](fix(now));
    await vi.waitFor(() => expect(state?.draft.count).toBe(4));
    const draft = await capture.stop();
    expect(draft.elapsed).toBe(30000);
    expect((await draftGeometry(draft)).segments.map((s) => s.length)).toEqual([2, 1, 1]);
    expect(release).toHaveBeenCalled();
    const entity = await prepareRecordedRoute(draft);
    expect(entity.value.categoryId).toBe("route");
    expect(Date.parse(entity.value.stoppedAt) - Date.parse(entity.value.startedAt)).toBe(30000);
    const resumed = await startRouteRecording(
      workspace,
      5,
      () => true,
      () => {},
    );
    await expect(saveRecordedRoute(workspace, entity, () => true)).rejects.toThrow("syncBusy");
    elapsed += 1000;
    const updated = await resumed.stop();
    await expect(saveRecordedRoute(workspace, entity, () => true)).rejects.toThrow("placeChanged");
    const finalEntity = await prepareRecordedRoute(updated);
    await saveRecordedRoute(workspace, finalEntity, () => true);
    await saveRecordedRoute(workspace, finalEntity, () => true);
    expect(livePlaces(await readWorkspace(workspace))).toHaveLength(1);
    expect(visitStatuses((await readWorkspace(workspace)).records, workspace).get(entity.id)).toBe(
      "visited",
    );
    expect(await readRouteDraft(workspace)).toBeUndefined();
  } finally {
    await capture.stop();
  }
});

test("poor accuracy survives retry and a stalled watch restarts automatically", async () => {
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);

  let tick: () => void = () => {};

  vi.spyOn(globalThis, "setInterval").mockImplementation((callback) => {
    tick = callback as () => void;

    return 1 as unknown as ReturnType<typeof setInterval>;
  });
  vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  const success: PositionCallback[] = [];
  const clearWatch = vi.fn();
  vi.stubGlobal("navigator", {
    locks,
    geolocation: {
      watchPosition: (callback: PositionCallback) => {
        success.push(callback);

        return success.length;
      },
      clearWatch,
    },
  });
  let state: RecordingState | undefined;
  const capture = await startRouteRecording(
    crypto.randomUUID(),
    10,
    () => true,
    (next) => {
      state = next;
    },
  );
  try {
    success[0](fix(Date.now(), 187));
    expect(state?.location).toBe("accuracy");
    capture.retry();
    expect(state?.location).toBe("accuracy");
    expect(state?.accuracy).toBe(187);
    now = 31000;
    tick();
    expect(success).toHaveLength(3);
    expect(clearWatch).toHaveBeenCalledTimes(2);
    expect(state?.accuracy).toBe(187);
    success[1](fix(Date.now()));
    expect(state?.draft.count).toBe(0);
    success[2](fix(Date.now()));
    await vi.waitFor(() => expect(state?.draft.count).toBe(1));
    expect(state?.location).toBe("recording");
  } finally {
    await capture.stop();
  }
});

test("geometry and metadata remain partitioned; copies have geometry but no private status", async () => {
  const source = crypto.randomUUID();
  const target = crypto.randomUUID();
  const item = await route(source);
  await saveEntity(source, item, undefined, false, () => true, "visited");
  expect(await getGeometry(target, item.value.geometryId)).toBeUndefined();
  const result = await copyPlaceToWorkspace(source, target, item.id);
  expect(result.copied).toBe(true);
  expect(livePlaces(result.workspace)[0].kind).toBe("route");
  expect(await getGeometry(target, item.value.geometryId)).toBeDefined();
  expect(visitStatuses(result.workspace.records, target).size).toBe(0);
  expect((await copyPlaceToWorkspace(source, target, item.id)).copied).toBe(false);
});

test("a fetched route snapshot saves offline, retries without duplicates and honors cancellation", async () => {
  const source = crypto.randomUUID();
  const destination = crypto.randomUUID();
  const item = await route(source);
  const snapshot = {
    version: 1 as const,
    route: item.value,
    geometry,
    category: { name: "Trail", color: "green" as const },
  };
  const id = crypto.randomUUID();
  const fetch = vi.fn(() => {
    throw new Error("Offline");
  });
  vi.stubGlobal("fetch", fetch);
  await saveRouteSnapshot(destination, id, snapshot, () => true);
  await saveRouteSnapshot(destination, id, snapshot, () => true);
  const stored = await readWorkspace(destination);
  expect(livePlaces(stored)).toHaveLength(1);
  expect(visitStatuses(stored.records, destination).size).toBe(0);
  expect(await getGeometry(destination, item.value.geometryId)).toBeDefined();
  expect(fetch).not.toHaveBeenCalled();
  const cancelled = crypto.randomUUID();
  await expect(saveRouteSnapshot(cancelled, id, snapshot, () => false)).rejects.toThrow();
  expect(livePlaces(await readWorkspace(cancelled))).toHaveLength(0);
});

test("v3 backups round-trip geometry/status and reject forged summaries before writing", async () => {
  const source = crypto.randomUUID();
  const item = await route(source);
  await saveEntity(source, item, undefined, false, () => true, "visited");
  const backup = await exportWithPhotos(await readWorkspace(source));
  expect(backup.version).toBe(3);
  const target = crypto.randomUUID();
  await importBackup(target, backup);
  expect(livePlaces(await readWorkspace(target))[0].value).toEqual(item.value);
  expect(visitStatuses((await readWorkspace(target)).records, target).get(item.id)).toBe("visited");
  const forged = structuredClone(backup);
  forged.routes![0].value.distance++;
  const rejected = crypto.randomUUID();
  await expect(importBackup(rejected, forged)).rejects.toThrow("invalidImport");
  expect(livePlaces(await readWorkspace(rejected))).toHaveLength(0);
  expect(await getGeometry(rejected, item.value.geometryId)).toBeUndefined();
});

test("routes share live capacity with places and category deletion reassigns them", async () => {
  const key = crypto.randomUUID();
  const item = await route(key);
  await saveEntity(key, {
    id: "walks",
    kind: "category",
    value: { name: "Walks", color: "green" },
  });
  item.value.categoryId = "walks";
  await saveEntity(key, item);
  const limit = entityLimits.place;
  try {
    Object.defineProperty(entityLimits, "place", { value: 1 });
    Object.defineProperty(entityLimits, "route", { value: 1 });
    await expect(saveEntity(key, { ...item, id: crypto.randomUUID() })).rejects.toThrow(
      "libraryLimit",
    );
  } finally {
    Object.defineProperty(entityLimits, "place", { value: limit });
    Object.defineProperty(entityLimits, "route", { value: limit });
  }
  await deleteEntity(key, "walks");
  expect(livePlaces(await readWorkspace(key))[0].value.categoryId).toBe("other");
  await expect(changeWorkspace(key, () => {}, { isCurrent: () => false })).rejects.toThrow(
    "accountChanged",
  );
});

test("content filters combine route kind, personal status, category and text", async () => {
  const key = crypto.randomUUID();
  const item = await route(key);
  await saveEntity(key, item, undefined, false, () => true, "visited");
  const workspace = await readWorkspace(key);
  const input = {
    places: livePlaces(workspace),
    categories: workspace.records.filter((r) => r.kind === "category"),
    visits: visitStatuses(workspace.records, key),
    search: "island",
    filter: "other",
    visitFilter: "routes",
    sort: "name",
    language: "en" as const,
    currentPosition: null,
  };
  expect(selectPlaces(input)).toHaveLength(1);
  expect(selectPlaces({ ...input, visitFilter: "places" })).toHaveLength(0);
  expect(selectPlaces({ ...input, visitFilter: "visited" })).toHaveLength(1);
  expect(selectPlaces({ ...input, search: "absent" })).toHaveLength(0);
});
