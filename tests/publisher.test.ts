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

test("promo source guards reject a clean commit switch and edits made after validation", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve, sep, basename } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { captureValidatedSource } = await import("../scripts/validated-source.mjs");
  const cwd = await mkdtemp(join(tmpdir(), "places-publisher-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" });
  try {
    git("init", "-b", "main");
    git("config", "user.name", "Publisher fixture");
    git("config", "user.email", "publisher@example.invalid");
    await writeFile(join(cwd, "page.txt"), "reviewed");
    git("add", "page.txt");
    git("commit", "-m", "fixture");
    const source = captureValidatedSource(cwd);
    expect(() => source.assertCurrent()).not.toThrow();
    await writeFile(join(cwd, "page.txt"), "unreviewed");
    expect(() => source.assertCurrent()).toThrow("Source changed");
    git("add", "page.txt");
    git("commit", "-m", "other clean commit");
    expect(() => source.assertCurrent()).toThrow("Source changed");
    expect(captureValidatedSource(cwd).sha).not.toBe(source.sha);
  } finally {
    if (
      !resolve(cwd).startsWith(resolve(tmpdir()) + sep) ||
      !basename(cwd).startsWith("places-publisher-")
    )
      throw Error("Unsafe fixture cleanup");
    await rm(cwd, { recursive: true, force: true });
  }
});
