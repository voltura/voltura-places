import { afterEach, expect, test, vi } from "vitest";
import { Buffer } from "node:buffer";
import { createWorker } from "../src/server/index";
import type { Environment } from "../src/server/types";

afterEach(() => vi.restoreAllMocks());

const bytes = Uint8Array.from({ length: 1024 }, (_, index) => index % 256);
const worker = createWorker(
  {
    "/assets/fixture.bin": ["application/octet-stream", Buffer.from(bytes).toString("base64")],
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
