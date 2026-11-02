import { expect, test } from "vitest";
import { readJSON, readBytes, hasCanonicalOrigin } from "../src/server/http";

const request = (body: BodyInit, type = "application/json") =>
  new Request("https://places.test/api/v1/sync", {
    method: "POST",
    headers: { "Content-Type": type },
    body,
  });

test("JSON media types are case insensitive but suffix lookalikes are rejected", async () => {
  await expect(readJSON(request("{}", "Application/JSON; charset=utf-8"), 100)).resolves.toEqual(
    {},
  );
  await expect(readJSON(request("{}", "application/json-invalid"), 100)).rejects.toMatchObject({
    status: 415,
  });
});
test.each(["null", "[]", "42", '"text"', "true", "{"])(
  "non-object or malformed JSON returns a client error: %s",
  async (body) => {
    await expect(readJSON(request(body), 100)).rejects.toMatchObject({ status: 400 });
  },
);
test("invalid UTF-8 never silently changes a submitted name", async () => {
  const bytes = new Uint8Array([
    ...new TextEncoder().encode('{"name":"'),
    0xc3,
    0x28,
    ...new TextEncoder().encode('"}'),
  ]);
  await expect(readJSON(request(bytes), 100)).rejects.toMatchObject({ status: 400 });
});
test("oversized bodies retain the size error instead of becoming a parse error", async () => {
  await expect(readJSON(request('{"data":"oversized"}'), 5)).rejects.toMatchObject({ status: 413 });
});

function streamed(chunks: Uint8Array[], cancel = () => {}) {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
    cancel,
  });

  return { body: stream } as Request;
}

test("bounded byte reads return exact bytes across arbitrarily fragmented bodies and release the reader", async () => {
  const input = streamed([new Uint8Array([1]), new Uint8Array([2, 3]), new Uint8Array([4])]);
  expect(await readBytes(input, 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(input.body!.locked).toBe(false);
});

test("fragmented upload bodies preserve every byte while the buffer grows", async () => {
  const bytes = Uint8Array.from({ length: 20000 }, (_, index) => index % 251);
  const input = streamed([
    bytes.subarray(0, 300),
    bytes.subarray(300, 8300),
    bytes.subarray(8300, 19300),
    bytes.subarray(19300),
  ]);
  expect(await readBytes(input, bytes.length)).toEqual(bytes);
  expect(input.body!.locked).toBe(false);
});

test("oversized streams are cancelled and unlocked even if cancellation rejects", async () => {
  let cancelled = false;
  const input = streamed([new Uint8Array(4), new Uint8Array(4)], () => {
    cancelled = true;
    throw new Error("transport closed");
  });
  await expect(readBytes(input, 5)).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toBe(true);
  expect(input.body!.locked).toBe(false);
});

test("JSON counts UTF-8 bytes rather than characters, including split code points", async () => {
  const bytes = new TextEncoder().encode('{"name":"ö"}');
  const input = streamed([...bytes].map((byte) => new Uint8Array([byte])));
  Object.defineProperty(input, "headers", {
    value: new Headers({ "content-type": "application/json" }),
  });
  await expect(readJSON(input, bytes.length)).resolves.toEqual({ name: "ö" });
  await expect(readJSON(request('{"name":"ö"}'), bytes.length - 1)).rejects.toMatchObject({
    status: 413,
  });
});

test("stream transport failures and absent bodies are client errors", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("disconnected"));
    },
  });
  await expect(readBytes({ body: stream } as Request, 10)).rejects.toMatchObject({ status: 400 });
  expect(stream.locked).toBe(false);
  await expect(readBytes({ body: null } as Request, 10, 422)).rejects.toMatchObject({
    status: 422,
  });
});

test.each([
  ["https://places.test", "https://places.test", "same-origin", true],
  ["https://places.test", "https://evil.test", "same-origin", false],
  ["https://evil.test", "https://places.test", "same-origin", false],
  ["https://places.test", "https://places.test", "cross-site", false],
])(
  "write origin policy checks header, destination and fetch metadata",
  (url, origin, site, expected) => {
    expect(
      hasCanonicalOrigin(
        new Request(url as string, {
          headers: { Origin: origin as string, "Sec-Fetch-Site": site as string },
        }),
        "https://places.test",
      ),
    ).toBe(expected);
  },
);
