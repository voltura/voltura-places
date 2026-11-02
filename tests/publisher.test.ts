import { test, expect } from "vitest";
import {
  assertDestination,
  digest,
  promoManifest,
  verifyPromoPayload,
  rollbackPayload,
} from "../scripts/promo-manifest.mjs";

test("public verification respects bounded throttling and still verifies the final bytes", async () => {
  const entry = { path: "places/sv/stats.html", sha256: digest("expected") };
  const delays: number[] = [];

  const pause = async (ms: number) => {
    delays.push(ms);
  };

  const responses = [
    new Response(null, { status: 429, headers: { "Retry-After": "5" } }),
    new Response(null, { status: 503 }),
    new Response("expected"),
  ];
  await verifyPromoPayload(
    entry,
    async (url, options) => {
      expect(url).toBe("https://voltura.se/places/sv/stats.html");
      expect(options?.redirect).toBe("error");

      return responses.shift()!;
    },
    pause,
  );
  expect(delays).toEqual([5000, 4000]);
  await expect(
    verifyPromoPayload(
      entry,
      async () => new Response(null, { status: 429, headers: { "Retry-After": "120" } }),
      pause,
    ),
  ).rejects.toThrow("later retry");
  await expect(
    verifyPromoPayload(entry, async () => new Response("different"), pause),
  ).rejects.toThrow("hash mismatch");
  let attempts = 0;
  await expect(
    verifyPromoPayload(
      entry,
      async () => {
        attempts++;

        return new Response(null, { status: 429 });
      },
      pause,
    ),
  ).rejects.toThrow("429");
  expect(attempts).toBe(4);
});

test("promo destination allowlist excludes Air, root configuration, traversal and secrets", () => {
  for (const path of [
    "air/app/index.html",
    "index.php",
    ".htaccess",
    "places/../air/index.html",
    "places/.htaccess",
    "places/config.php",
    "places/mail/relay.php",
    "places/assets/../../index.php",
    "/places/index.html",
    "places\\index.html",
    "places/assets/social-fr.0123456789abcdef.png",
    "places/assets/social-sv.png",
    "places/assets/desktop-fr.0123456789abcdef.png",
    "places/assets/desktop-en.png",
    "places/sv/../stats.html",
    "places/fr/stats.html",
    "air/stats.html",
    "places/stats.php",
    "places/assets/usage.js",
    "places/assets/other.0123456789abcdef.js",
  ]) {
    expect(() => assertDestination(path)).toThrow();
  }
  expect(assertDestination("places/index.html")).toBe("places/index.html");
  expect(assertDestination("places/stats.html")).toBe("places/stats.html");
  expect(assertDestination("places/assets/usage.0123456789abcdef.js")).toContain("places/assets/");
  expect(assertDestination("places/sv/stats.html")).toBe("places/sv/stats.html");
  expect(assertDestination("places/assets/site.0123456789abcdef.css")).toContain("places/assets/");
  expect(assertDestination("places/assets/social-sv.0123456789abcdef.png")).toContain(
    "places/assets/",
  );
  for (const language of ["en", "sv"]) {
    expect(assertDestination(`places/assets/desktop-${language}.0123456789abcdef.png`)).toContain(
      "places/assets/",
    );
  }
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
    ) {
      throw Error("Unsafe fixture cleanup");
    }
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rollback preserves empty files, later deletions and already-restored content", () => {
  const empty = Buffer.alloc(0);
  const replacement = Buffer.from("release");
  const item = { previous: "", previousHash: digest(empty), sha256: digest(replacement) };
  expect(rollbackPayload(item, replacement)).toEqual({ changed: true, bytes: empty });
  expect(rollbackPayload(item, empty).changed).toBe(false);
  expect(() => rollbackPayload(item, null)).toThrow("unrelated");
  expect(() => rollbackPayload({ ...item, previous: null }, replacement)).toThrow("hash");
  expect(rollbackPayload({ ...item, previous: null, previousHash: null }, replacement)).toEqual({
    changed: true,
    bytes: null,
  });
});

test("promo manifests reject duplicated logical assets and files with incorrect cache keys", async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const base = await mkdtemp(join(tmpdir(), "places-promo-manifest-"));
  try {
    const assets = join(base, "assets");
    await mkdir(assets);
    const wrong = join(assets, "site.0000000000000000.css");
    await writeFile(wrong, "a");
    await expect(promoManifest(base)).rejects.toThrow("mismatch");
    await rm(wrong);
    for (const value of ["a", "b"]) {
      await writeFile(join(assets, `site.${digest(value).slice(0, 16)}.css`), value);
    }
    await expect(promoManifest(base)).rejects.toThrow("Duplicate");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
