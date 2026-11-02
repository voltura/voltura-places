import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { en, sv } from "../src/client/foundation/i18n";

test("promo installation instructions stay aligned with the app's owner-reviewed guidance", async () => {
  const content = JSON.parse(await readFile("site/content.json", "utf8"));
  for (const [language, messages] of Object.entries({ en, sv })) {
    expect(content[language].iosSteps).toEqual([
      messages.installShare,
      messages.installExpandShare,
      messages.installHomeScreen,
      messages.installConfirm,
    ]);
    expect(content[language].android).toBe(messages.installAndroid);
  }
});
