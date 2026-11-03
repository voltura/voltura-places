import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const { Minimatch, match } = require("minimatch");
const { globSync } = require("glob");
const { getManifest } = require("workbox-build");

test("Workbox glob discovery retains wildcard files with patched minimatch", async () => {
  const directory = new URL("../", import.meta.url);
  expect(globSync("tests/*.test.ts", { cwd: directory })).toContain(
    join("tests", "dependency-security.test.ts"),
  );
  expect(
    globSync("**/*.{ts,json}", {
      cwd: new URL("./", import.meta.url),
      ignore: ["browser/**", "dependency-security.test.ts"],
    }),
  ).toContain("library.test.ts");
  const manifest = await getManifest({
    globDirectory: fileURLToPath(new URL("./", import.meta.url)),
    globPatterns: ["**/*.{ts,json}"],
    globIgnores: ["browser/**", "dependency-security.test.ts"],
  });
  const urls = manifest.manifestEntries.map((entry: { url: string }) => entry.url);
  expect(urls).toContain("library.test.ts");
  expect(urls).not.toContain("dependency-security.test.ts");
  expect(urls.some((url: string) => url.startsWith("browser/"))).toBe(false);
  expect(manifest.warnings).toEqual([]);
});

test("every installed minimatch is pinned to the reviewed security release", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const entries = Object.entries(lock.packages).filter(([path]) =>
    path.endsWith("node_modules/minimatch"),
  );
  expect(entries.length).toBeGreaterThan(0);
  for (const [, entry] of entries) {
    expect((entry as { version: string }).version).toBe("11.0.1");
  }
});

test("glob preprocessing bounds amplification and preserves normal matching", () => {
  const pattern = Array(10).fill("**/../a/b").join("/");
  const malicious = new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 });
  expect(malicious.set).toHaveLength(64);

  const ordinary = new Minimatch("**/../a/b/**/../c/d", { optimizationLevel: 2 });
  expect(ordinary.match("../a/b/../c/d")).toBe(true);
  expect(ordinary.match("x/a/b/y/c/d")).toBe(true);
  expect(match(["app.js", "app.css", "nested/page.js"], "**/*.js")).toEqual([
    "app.js",
    "nested/page.js",
  ]);
});

test("large pattern sets skip quadratic deduplication without changing matches", () => {
  const pattern = new Minimatch("{x,*}/{0..999}", { optimizationLevel: 2 });
  expect(pattern.set).toHaveLength(2000);
  expect(pattern.match("x/5")).toBe(true);
  expect(pattern.match("y/999")).toBe(true);
  expect(pattern.match(".y/5")).toBe(false);
});
