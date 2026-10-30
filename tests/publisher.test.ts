import { test, expect } from "vitest";
import { assertDestination } from "../scripts/promo-manifest.mjs";
test("promo destination allowlist excludes Air, root configuration, traversal and secrets", () => {
  for (const path of [
    "air/app/index.html",
    "index.php",
    ".htaccess",
    "places/../air/index.html",
    "places/.htaccess",
    "places/config.php",
    "places/assets/../../index.php",
    "/places/index.html",
    "places\\index.html",
    "places/assets/social-fr.0123456789abcdef.png",
    "places/assets/social-sv.png",
    "places/assets/desktop-fr.0123456789abcdef.png",
    "places/assets/desktop-en.png",
  ])
    expect(() => assertDestination(path)).toThrow();
  expect(assertDestination("places/index.html")).toBe("places/index.html");
  expect(assertDestination("places/assets/site.0123456789abcdef.css")).toContain("places/assets/");
  expect(assertDestination("places/assets/social-sv.0123456789abcdef.png")).toContain(
    "places/assets/",
  );
  for (const language of ["en", "sv"])
    expect(assertDestination(`places/assets/desktop-${language}.0123456789abcdef.png`)).toContain(
      "places/assets/",
    );
});
