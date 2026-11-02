import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { digest, hex } from "../src/shared/digest";
import { visitEntity } from "../src/shared/visits";

test.each(["", "abc", "Övrigt — 森", JSON.stringify([null, "fixture"])])(
  "UTF-8 identities retain their SHA-256 representation: %s",
  async (value) => {
    expect(await digest(value)).toBe(createHash("sha256").update(value, "utf8").digest("hex"));
  },
);

test("hex preserves leading zeros and byte boundaries", () => {
  expect(hex(new Uint8Array([0, 1, 15, 16, 127, 128, 255]).buffer)).toBe("00010f107f80ff");
});

test("canonical personal-status identities retain the existing private/group namespace", async () => {
  const entity = await visitEntity("guest", "fixture", "visited");
  expect(entity.id).toBe(
    "visit-" +
      createHash("sha256")
        .update(JSON.stringify([null, "fixture"]))
        .digest("hex"),
  );
});
