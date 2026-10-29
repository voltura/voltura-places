import { handleAccounts } from "./accounts.js";
import { handleSync } from "./sync";
import type { Environment } from "./types";
export type AssetMap = Record<string, [string, string]>;
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
export function createWorker(assets: AssetMap, version: string) {
  return {
    async fetch(request: Request, env: Environment): Promise<Response> {
      const url = new URL(request.url);
      try {
        if (url.pathname === "/api/health")
          return Response.json(
            { ok: true, product: "voltura-places", version },
            { headers: { "Cache-Control": "no-store", ...security } },
          );
        if (url.pathname.startsWith("/api/")) {
          let response: Response;
          if (url.pathname === "/api/v1/sync") {
            if (env.ACCOUNTS_ENABLED !== "true" || !env.DB)
              return Response.json(
                { error: "serviceUnavailable" },
                { status: 503, headers: { "Cache-Control": "no-store" } },
              );
            response = await handleSync(request, env);
          } else
            response =
              (await handleAccounts(request, env)) ??
              Response.json({ error: "serviceUnavailable" }, { status: 503 });
          const headers = new Headers(response.headers);
          for (const [k, v] of Object.entries(security)) headers.set(k, v);
          headers.set("Cache-Control", "private, no-store");
          return new Response(response.body, { status: response.status, headers });
        }
        if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const asset = assets[path];
        if (!asset) return new Response("Not found", { status: 404, headers: security });
        const [type, data] = asset;
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        return new Response(request.method === "HEAD" ? null : bytes, {
          headers: {
            ...security,
            "Content-Type": type,
            "Cache-Control": path.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache, max-age=0, must-revalidate",
            ...(path === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
          },
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
