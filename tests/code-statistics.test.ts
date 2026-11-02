import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { collectStatistics, physicalLines } from "../scripts/code-statistics.mjs";

test("physical line counts handle empty files, final newlines and Windows line endings", () => {
  for (const [text, lines] of [
    ["", 0],
    ["one", 1],
    ["one\n", 1],
    ["one\r\n\r\n", 2],
    ["one\ntwo", 2],
  ] as const) {
    expect(physicalLines(text)).toBe(lines);
  }
});

test("inventory excludes untracked files, dependencies, assets and lockfiles from source totals", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "places-statistics-"));

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, windowsHide: true, stdio: "pipe" });

  try {
    git("init", "-b", "main");
    await mkdir(join(cwd, "src", "client"), { recursive: true });
    await mkdir(join(cwd, "tests"));
    await writeFile(join(cwd, "src", "client", "app.ts"), "// comment\r\n\r\nexport {};\r\n");
    await writeFile(join(cwd, "tests", "app.test.ts"), "test();\n");
    await writeFile(join(cwd, "README.md"), "documentation\n");
    await writeFile(join(cwd, "image.svg"), "<svg/>\n");
    await writeFile(join(cwd, "package-lock.json"), "{}\n");
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { check: "tsc" }, dependencies: { react: "1" } }),
    );
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "fixture",
    );
    await writeFile(join(cwd, "secret.js"), "must not count\n");
    const stats = await collectStatistics(cwd);
    expect(stats.files).toBe(2);
    expect(stats.lines).toBe(4);
    expect(stats.areas.client).toEqual({ files: 1, lines: 3 });
    expect(stats.areas.tests).toEqual({ files: 1, lines: 1 });
    expect(stats.assets).toBe(1);
    expect(stats.documents).toBe(1);
    expect(stats.commands).toBe(1);
    expect(stats.dependencies).toBe(1);
    expect(stats.dirty).toBe(true);
    await rm(join(cwd, "src", "client", "app.ts"));
    const afterDeletion = await collectStatistics(cwd);
    expect(afterDeletion.files).toBe(1);
    expect(afterDeletion.lines).toBe(1);
    expect(afterDeletion.areas.client).toBeUndefined();
  } finally {
    if (
      !resolve(cwd).startsWith(resolve(tmpdir()) + sep) ||
      !basename(cwd).startsWith("places-statistics-")
    ) {
      throw Error("Unsafe fixture cleanup");
    }
    await rm(cwd, { recursive: true, force: true });
  }
});
