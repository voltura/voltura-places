import { expect, test } from "vitest";
import { accountStateSchema } from "../src/client/foundation/account-contract";
import { displayNameSchema } from "../src/shared/display-name";

const base = { enabled: true, providers: {}, account: { id: "member", methods: [] } };
test("old account caches remain valid and account refresh accepts a normalized optional display name", () => {
  expect(accountStateSchema.parse(base)).toEqual(base);
  expect(
    accountStateSchema.parse({ ...base, account: { ...base.account, displayName: null } }).account
      ?.displayName,
  ).toBeNull();
  expect(
    accountStateSchema.parse({
      ...base,
      account: { ...base.account, displayName: "  A\u030ake  " },
    }).account?.displayName,
  ).toBe("Åke");
});
test("limits count Unicode code points after normalization, preserve legitimate joiners and allow clearing", () => {
  expect(displayNameSchema.parse("🪴".repeat(60))).toHaveLength(120);
  expect(displayNameSchema.safeParse("🪴".repeat(61)).success).toBe(false);
  expect(displayNameSchema.parse("👩‍💻")).toBe("👩‍💻");
  expect(displayNameSchema.parse("محمد")).toBe("محمد");
  expect(displayNameSchema.parse(" \t ")).toBeNull();
  for (const invalid of [
    "a\nb",
    "a\x00b",
    "a\u202eb",
    "a\u2067b",
    "a\u2028b",
    "a\ud800b",
    "a\u061cb",
    "a\u200fb",
    "\u200b",
    "\u200d \ufe0f",
  ]) {
    expect(displayNameSchema.safeParse(invalid).success).toBe(false);
  }
});
