import { canonicalGeometry, ROUTE_BYTES, type RouteGeometry } from "../../shared/routes";
import { workspaceHeaders } from "../../shared/families";
import { getGeometry, putGeometry } from "./route-store";
import { ApiError } from "./http";

export async function loadGeometry(
  workspace: string,
  id: string,
  isCurrent = () => true,
): Promise<RouteGeometry> {
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const cached = await getGeometry(workspace, id);
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if (cached) {
    return JSON.parse(cached.canonical);
  }
  if (workspace === "guest" || !navigator.onLine) {
    throw new Error("geometryUnavailable");
  }

  return geometrySlot(() => downloadGeometry(workspace, id, isCurrent), isCurrent);
}

let activeDownloads = 0;
const waitingDownloads: (() => void)[] = [];

async function geometrySlot<T>(action: () => Promise<T>, isCurrent: () => boolean): Promise<T> {
  if (activeDownloads >= 3) {
    await new Promise<void>((resolve) => waitingDownloads.push(resolve));
  } else {
    activeDownloads++;
  }
  try {
    if (!isCurrent()) {
      throw new Error("accountChanged");
    }

    return await action();
  } finally {
    const next = waitingDownloads.shift();
    if (next) {
      next();
    } else {
      activeDownloads--;
    }
  }
}

async function downloadGeometry(
  workspace: string,
  id: string,
  isCurrent: () => boolean,
): Promise<RouteGeometry> {
  const response = await fetch(`/api/v1/geometry/${id}`, {
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: workspaceHeaders(workspace),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    void response.body?.cancel();
    throw new ApiError(response.status, "geometryUnavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("geometryUnavailable");
  }
  const buffer = new Uint8Array(ROUTE_BYTES);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!isCurrent()) {
        throw new Error("accountChanged");
      }
      if (done) {
        break;
      }
      if (offset + value.length > ROUTE_BYTES) {
        throw new Error("invalidGeometry");
      }
      buffer.set(value, offset);
      offset += value.length;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const input = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset)),
  );
  const validated = await canonicalGeometry(input);
  if (validated.id !== id) {
    throw new Error("invalidGeometry");
  }
  await putGeometry(workspace, validated.geometry, isCurrent);

  return validated.geometry;
}

export async function uploadGeometry(workspace: string, id: string, isCurrent = () => true) {
  const geometry = await loadGeometry(workspace, id, isCurrent);
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  const response = await fetch(`/api/v1/geometry/${id}`, {
    method: "PUT",
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    headers: { ...workspaceHeaders(workspace), "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify(geometry),
  });
  if (!isCurrent()) {
    throw new Error("accountChanged");
  }
  if (!response.ok) {
    void response.body?.cancel();
    throw new ApiError(response.status, "geometryUnavailable");
  }
}
