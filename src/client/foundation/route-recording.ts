import { geometryUsage } from "./route-store";
import { workspaceIdentity } from "../../shared/families";
import type { DBSchema } from "idb";
import { abortTransaction, localDatabase } from "./database";
import {
  acceptedRouteFix,
  ROUTE_POINTS,
  ROUTE_BYTES,
  ROUTE_QUOTA,
  type RoutePoint,
  type RouteGeometry,
} from "../../shared/routes";

export type RouteDraft = {
  workspace: string;
  id: string;
  interval: 5 | 10 | 30;
  startedAt: number;
  elapsed: number;
  checkpointAt: number;
  count: number;
  bytes?: number;
  segment: number;
  lastTimestamp: number | null;
  recording?: boolean;
};
interface RecordingDB extends DBSchema {
  drafts: { key: string; value: RouteDraft };
  points: {
    key: [string, number];
    value: { id: string; sequence: number; segment: number; point: RoutePoint };
  };
}
const database = localDatabase<RecordingDB>("voltura-places-recordings", 1, (db) => {
  db.createObjectStore("drafts", { keyPath: "workspace" });
  db.createObjectStore("points", { keyPath: ["id", "sequence"] });
});

export async function readRouteDraft(workspace: string) {
  return (await database()).get("drafts", workspace);
}

export async function draftGeometry(draft: Pick<RouteDraft, "id">): Promise<RouteGeometry> {
  const rows = await (
    await database()
  ).getAll("points", IDBKeyRange.bound([draft.id], [draft.id, []]));
  const segments: RoutePoint[][] = [];
  let segment = -1;
  for (const row of rows) {
    if (row.segment !== segment) {
      segments.push([]);
      segment = row.segment;
    }
    segments.at(-1)!.push(row.point);
  }

  return { version: 1, segments };
}

export async function withRecordingIdle<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new Error("syncBusy");
  }

  return navigator.locks.request("places-route-recording", { ifAvailable: true }, async (lock) => {
    if (!lock) {
      throw new Error("syncBusy");
    }

    return action();
  });
}

export async function discardRouteDraft(workspace: string, id: string) {
  return withRecordingIdle(() => deleteRouteDraft(workspace, id));
}

async function deleteRouteDraft(workspace: string, id: string) {
  const db = await database();
  const tx = db.transaction(["drafts", "points"], "readwrite");
  try {
    if ((await tx.objectStore("drafts").get(workspace))?.id === id) {
      await tx.objectStore("drafts").delete(workspace);
    }
    await tx.objectStore("points").delete(IDBKeyRange.bound([id], [id, []]));
    await tx.done;
  } catch (error) {
    await abortTransaction(tx);
    throw error;
  }
}

export async function clearRouteRecordings(workspace: string, account = false) {
  const db = await database();
  for (const draft of await db.getAll("drafts")) {
    if (
      draft.workspace === workspace ||
      (account && workspaceIdentity(draft.workspace).account === workspace)
    ) {
      await deleteRouteDraft(draft.workspace, draft.id);
    }
  }
}

export type RecordingState = {
  draft: RouteDraft;
  active: boolean;
  location: "waiting" | "accuracy" | "stale" | "denied" | "unavailable" | "paused" | "recording";
  accuracy?: number;
  error?: "storageFailure" | "routeLimit" | "locationUnavailable";
};

export async function startRouteRecording(
  workspace: string,
  interval: 5 | 10 | 30,
  isCurrent: () => boolean,
  onChange: (state: RecordingState) => void,
  isCompleted: (draft: RouteDraft) => Promise<boolean> = async () => false,
) {
  // Fail closed without cross-tab mutual exclusion. No tab may steal an active watch.
  if (!navigator.locks?.request || !navigator.geolocation) {
    throw new Error("locationUnavailable");
  }
  let release!: () => void;
  let acquired!: (value: boolean) => void;
  const ready = new Promise<boolean>((resolve) => {
    acquired = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const lock = navigator.locks.request(
    "places-route-recording",
    { ifAvailable: true },
    async (value) => {
      acquired(!!value);
      if (value) {
        await held;
      }
    },
  );
  void lock.catch(() => acquired(false));
  if (!(await ready)) {
    throw new Error("syncBusy");
  }
  try {
    const allowance = Math.min(ROUTE_BYTES, ROUTE_QUOTA - (await geometryUsage(workspace)));
    if (allowance < 128) {
      throw new Error("routeQuota");
    }
    const db = await database();
    let draft = await db.get("drafts", workspace);
    if (draft && (await isCompleted(draft))) {
      await deleteRouteDraft(workspace, draft.id);
      draft = undefined;
    }
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }
    draft ??= {
      workspace,
      id: crypto.randomUUID(),
      interval,
      startedAt: Date.now(),
      elapsed: 0,
      checkpointAt: Date.now(),
      count: 0,
      segment: 0,
      lastTimestamp: null,
    };
    draft = {
      ...draft,
      recording: true,
      elapsed: draft.elapsed + Math.max(0, Date.now() - draft.checkpointAt),
      checkpointAt: Date.now(),
      segment: draft.segment + 1,
    };
    await db.put("drafts", draft);
    let current: RouteDraft = draft;
    let watch: number | undefined;
    let wake: WakeLockSentinel | undefined;
    let stopped = false;
    let generation = 0;
    let segment = current.segment;
    let lastSample = -Infinity;
    const initialElapsed = current.elapsed;
    const clock = performance.now();
    let pending = Promise.resolve();
    let location: RecordingState["location"] = "waiting";
    let accuracy: number | undefined;
    let permission: PermissionStatus | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let denialRetried = false;
    let requestedAt = performance.now();
    let lastResponseAt = requestedAt;

    const elapsed = () => Math.round(initialElapsed + Math.max(0, performance.now() - clock));

    const publish = (error?: RecordingState["error"]) =>
      onChange({
        draft: current,
        active: !stopped,
        location,
        accuracy,
        ...(error ? { error } : {}),
      });

    const clearWatch = () => {
      generation++;
      clearTimeout(retryTimer);
      if (watch !== undefined) {
        navigator.geolocation.clearWatch(watch);
        watch = undefined;
      }
      void wake?.release().catch(() => {});
      wake = undefined;
      segment++;
    };

    const persist = async (point?: RoutePoint) => {
      const tx = db.transaction(["drafts", "points"], "readwrite");
      try {
        const existing = await tx.objectStore("drafts").get(workspace);
        if (!isCurrent() || existing?.id !== current.id) {
          throw new Error("accountChanged");
        }
        const next = { ...current, elapsed: elapsed(), checkpointAt: Date.now(), segment };
        if (point) {
          next.bytes =
            (next.bytes ?? 32) + new TextEncoder().encode(JSON.stringify(point)).length + 4;
          if (next.count >= ROUTE_POINTS || next.bytes > allowance) {
            throw new Error("routeLimit");
          }
          if (next.lastTimestamp !== null && point[2] - next.lastTimestamp > next.interval * 2000) {
            next.segment = ++segment;
          }
          await tx
            .objectStore("points")
            .add({ id: next.id, sequence: next.count, segment: next.segment, point });
          next.count++;
          next.lastTimestamp = point[2];
        }
        await tx.objectStore("drafts").put(next);
        if (!isCurrent()) {
          throw new Error("accountChanged");
        }
        await tx.done;
        current = next;
      } catch (error) {
        await abortTransaction(tx);
        throw error;
      }
    };

    const stop = async (resumeOnReload = false) => {
      if (!stopped) {
        stopped = true;
        clearWatch();
        clearInterval(timer);
        permission?.removeEventListener("change", permissionChanged);
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("pagehide", pagehide);
        await pending;
        current = { ...current, recording: resumeOnReload };
        try {
          if (isCurrent()) {
            await persist();
          }
        } finally {
          release();
          await lock;
          publish();
        }
      }

      await lock;

      return current;
    };

    const queue = (point?: RoutePoint) => {
      pending = pending
        .then(async () => {
          if (!isCurrent()) {
            return;
          }
          await persist(point);
          publish();
          if (current.count === ROUTE_POINTS) {
            void stop().then(() => publish("routeLimit"));
          }
        })
        .catch((error) => {
          const reason =
            error instanceof Error && error.message === "routeLimit"
              ? "routeLimit"
              : "storageFailure";
          void stop().then(
            () => publish(reason),
            () => publish(reason),
          );
        });
    };

    const startWatch = () => {
      if (stopped || !isCurrent() || document.hidden || watch !== undefined) {
        return;
      }
      const expected = ++generation;
      lastSample = -Infinity;
      requestedAt = performance.now();
      try {
        watch = navigator.geolocation.watchPosition(
          (position) => {
            if (stopped || !isCurrent() || document.hidden || generation !== expected) {
              return;
            }
            const point = acceptedRouteFix(position, current.interval, Date.now());
            const now = performance.now();
            lastResponseAt = now;
            accuracy = Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : undefined;
            if (!point) {
              location = accuracy !== undefined && accuracy > 100 ? "accuracy" : "stale";
              publish();

              return;
            }
            location = "recording";
            if (now - lastSample < current.interval * 1000) {
              publish();

              return;
            }
            lastSample = now;
            queue(point);
          },
          (error) => {
            if (stopped || generation !== expected) {
              return;
            }
            segment++;
            location = error.code === 1 ? "denied" : "unavailable";
            publish();
            if (error.code === 1 && !denialRetried) {
              denialRetried = true;
              retryTimer = setTimeout(() => {
                if (!stopped && isCurrent() && !document.hidden && permission?.state !== "denied") {
                  clearWatch();
                  startWatch();
                }
              }, 1000);
            }
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
        );
      } catch {
        location = "unavailable";
        publish();
      }
      void navigator.wakeLock
        ?.request("screen")
        .then((sentinel) => {
          if (stopped || document.hidden || generation !== expected || !isCurrent()) {
            void sentinel.release().catch(() => {});
          } else {
            wake = sentinel;
          }
        })
        .catch(() => {});
    };

    const retry = () => {
      if (!stopped && isCurrent() && !document.hidden) {
        location = accuracy !== undefined && accuracy > 100 ? "accuracy" : "waiting";
        clearWatch();
        startWatch();
        publish();
      }
    };

    const visibility = () => {
      if (document.hidden) {
        location = "paused";
        clearWatch();
        queue();
      } else {
        location = "waiting";
        startWatch();
      }
    };

    const permissionChanged = () => {
      if (stopped || !isCurrent()) {
        return;
      }
      if (permission?.state === "granted") {
        location = "waiting";
        clearWatch();
        startWatch();
        publish();
      } else if (permission?.state === "denied") {
        location = "denied";
        clearWatch();
        publish();
      }
    };

    void navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (!stopped) {
          permission = status;
          status.addEventListener("change", permissionChanged);
        }
      })
      .catch(() => {});

    const pagehide = () => {
      void stop(true).catch(() => {});
    };

    const timer = setInterval(() => {
      if (!isCurrent()) {
        void stop().catch(() => {});
      } else {
        if (
          !document.hidden &&
          location !== "denied" &&
          performance.now() - Math.max(requestedAt, lastResponseAt) >= 30000
        ) {
          retry();
          if (location === "waiting") {
            location = "unavailable";
          }
        }
        queue();
      }
    }, 1000);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    startWatch();
    publish();

    return {
      stop,
      retry,
    };
  } catch (error) {
    release();
    throw error;
  }
}
