import { afterEach, expect, test, vi } from "vitest";
import { Buffer } from "node:buffer";
import { createWorker } from "../src/server/index";
import type { Environment } from "../src/server/types";

afterEach(() => vi.restoreAllMocks());

const bytes = Uint8Array.from({ length: 1024 }, (_, index) => index % 256);
const worker = createWorker(
  {
    "/assets/fixture.bin": ["application/octet-stream", Buffer.from(bytes).toString("base64")],
    "/index.html": [
      "text/html; charset=utf-8",
      Buffer.from('<script src="/app.js"></script>').toString("base64"),
    ],
  },
  "asset-fixture",
);

test("embedded assets retain every binary byte and their cache/security headers", async () => {
  const response = await worker.fetch(
    new Request("https://fixture.invalid/assets/fixture.bin"),
    {} as Environment,
  );
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

test("HEAD returns asset headers without decoding or allocating its binary payload", async () => {
  const request = new Request("https://fixture.invalid/assets/fixture.bin", { method: "HEAD" });
  const decode = vi.spyOn(Buffer, "from");
  const legacyDecode = vi.spyOn(globalThis, "atob");
  const response = await worker.fetch(request, {} as Environment);
  expect(decode).not.toHaveBeenCalled();
  expect(legacyDecode).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
  expect((await response.arrayBuffer()).byteLength).toBe(0);
  expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
});

test("revalidating assets skips payload decoding and handles weak, strong, list and wildcard validators", async () => {
  const url = "https://fixture.invalid/assets/fixture.bin";
  const response = await worker.fetch(new Request(url), {} as Environment);
  const tag = response.headers.get("ETag")!;
  expect(tag).toMatch(/^W\//);
  for (const validator of [tag, tag.slice(2), '"other", ' + tag, "*"]) {
    const cached = await worker.fetch(
      new Request(url, { headers: { "If-None-Match": validator } }),
      {} as Environment,
    );
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    expect(cached.headers.get("ETag")).toBe(tag);
  }
  const stale = await worker.fetch(
    new Request(url, { headers: { "If-None-Match": '"stale"' } }),
    {} as Environment,
  );
  expect(stale.status).toBe(200);
});

test("health, unavailable sync and unknown routes return the appropriate method, status and headers", async () => {
  const origin = "https://fixture.invalid";
  const env = {} as Environment;
  const health = await worker.fetch(new Request(origin + "/api/health", { method: "DELETE" }), env);
  expect(health.status).toBe(405);
  expect(health.headers.get("Allow")).toBe("GET, HEAD");
  const head = await worker.fetch(new Request(origin + "/api/health", { method: "HEAD" }), env);
  expect(await head.text()).toBe("");
  const unavailable = await worker.fetch(new Request(origin + "/api/v1/sync"), env);
  expect(unavailable.status).toBe(503);
  expect(unavailable.headers.get("X-Content-Type-Options")).toBe("nosniff");
  const missing = await worker.fetch(new Request(origin + "/api/unknown"), env);
  expect(missing.status).toBe(404);
});

test("HTML issues fresh CSP nonces for Cloudflare injection without allowing arbitrary inline scripts or reusing validators", async () => {
  const policies: string[] = [];
  for (const method of ["GET", "GET", "HEAD"]) {
    const response = await worker.fetch(
      new Request("https://fixture.invalid/", {
        method,
        headers: { "If-None-Match": "*" },
      }),
      {} as Environment,
    );
    expect(response.status).toBe(200);
    const policy = response.headers.get("Content-Security-Policy")!;
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{24}'/);
    expect(policy).not.toContain("unsafe-inline");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.has("ETag")).toBe(false);
    policies.push(policy);
    expect(await response.text()).toBe(method === "HEAD" ? "" : '<script src="/app.js"></script>');
  }
  expect(new Set(policies).size).toBe(3);
  const api = await worker.fetch(
    new Request("https://fixture.invalid/api/health"),
    {} as Environment,
  );
  expect(api.headers.get("Content-Security-Policy")).not.toContain("nonce-");
});
