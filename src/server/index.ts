import { handleAccounts } from "./accounts";
import { Buffer } from "node:buffer";
import { handleSync } from "./sync";
import { handleFamilies } from "./families";
import { handlePhoto } from "./photos";
import { handleStatistics } from "./statistics";
import type { Environment } from "./types";

export type AssetMap = Record<string, [string, string]>;
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function createWorker(assets: AssetMap, version: string) {
  return {
    async fetch(request: Request, env: Environment): Promise<Response> {
      const url = new URL(request.url);
      try {
        if (url.pathname === "/api/health") {
          const headers = { "Cache-Control": "no-store", ...security };
          if (!["GET", "HEAD"].includes(request.method)) {
            return new Response(null, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
          }
          if (request.method === "HEAD") {
            return new Response(null, {
              headers: { ...headers, "Content-Type": "application/json" },
            });
          }

          return Response.json({ ok: true, product: "voltura-places", version }, { headers });
        }
        if (url.pathname.startsWith("/api/")) {
          let response: Response;
          if (["/api/v1/activity", "/api/v1/statistics"].includes(url.pathname)) {
            response = await handleStatistics(request, env);
          } else if (url.pathname === "/api/family") {
            response = await handleFamilies(request, env);
          } else if (url.pathname.startsWith("/api/v1/photos/")) {
            response = await handlePhoto(request, env);
          } else if (url.pathname === "/api/v1/sync") {
            response = await handleSync(request, env);
          } else if (
            url.pathname === "/api/account" ||
            url.pathname.startsWith("/api/account/") ||
            url.pathname.startsWith("/api/auth/")
          ) {
            response = await handleAccounts(request, env);
          } else {
            response = Response.json({ error: "notFound" }, { status: 404 });
          }
          const headers = new Headers(response.headers);
          for (const [k, v] of Object.entries(security)) {
            headers.set(k, v);
          }
          headers.set("Cache-Control", "private, no-store");

          return new Response(response.body, { status: response.status, headers });
        }
        if (!["GET", "HEAD"].includes(request.method)) {
          return new Response(null, { status: 405, headers: { ...security, Allow: "GET, HEAD" } });
        }
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const asset = assets[path];
        if (!asset) {
          return new Response("Not found", { status: 404, headers: security });
        }
        const [type, data] = asset;

        const etag = `W/"${version}:${encodeURIComponent(path)}"`;
        const headers = {
          ...security,
          "Content-Type": type,
          ETag: etag,
          "Cache-Control": path.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache, max-age=0, must-revalidate",
          ...(path === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
        };
        const validators = request.headers
          .get("If-None-Match")
          ?.split(",")
          .map((tag) => tag.trim());
        if (validators?.some((tag) => tag === "*" || tag === etag || tag === etag.slice(2))) {
          return new Response(null, { status: 304, headers });
        }

        return new Response(request.method === "HEAD" ? null : Buffer.from(data, "base64"), {
          headers,
        });
      } catch {
        return Response.json(
          { error: "serviceUnavailable" },
          { status: 503, headers: { ...security, "Cache-Control": "private, no-store" } },
        );
      }
    },
  };
}
