import { expect, test } from "vitest";
import { readJSON } from "../src/server/accounts.js";

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
