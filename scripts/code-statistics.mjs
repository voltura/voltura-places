import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".php", ".sql"]);

export const physicalLines = (text) =>
  text ? text.split(/\r\n|\n|\r/).length - Number(/[\r\n]$/.test(text)) : 0;

export function sourceArea(path) {
  if (path.startsWith("tests/")) {
    return "tests";
  }
  if (path.startsWith("src/client/")) {
    return "client";
  }
  if (path.startsWith("src/shared/")) {
    return "shared";
  }
  if (/^(src\/server|worker|drizzle|mail-relay)\//.test(path)) {
    return "server";
  }
  if (path.startsWith("site/")) {
    return "promo";
  }

  return "tooling";
}

export async function collectStatistics(cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });

  const deleted = new Set(git("ls-files", "--deleted", "-z").split("\0"));
  const files = git("ls-files", "-z")
    .split("\0")
    .filter((path) => path && !deleted.has(path));
  /** @type {Record<string, {files: number, lines: number}>} */
  const areas = {};
  /** @type {Record<string, {files: number, lines: number}>} */
  const languages = {};
  let assets = 0;
  let documents = 0;
  for (const path of files) {
    const extension = extname(path).toLowerCase();
    if (extension === ".md") {
      documents++;
    }
    if ([".png", ".svg", ".jpg", ".webp", ".ico"].includes(extension)) {
      assets++;
    }
    if (!sourceExtensions.has(extension)) {
      continue;
    }
    let text;
    try {
      text = await readFile(resolve(cwd, path), "utf8");
    } catch (error) {
      // Renames/deletions remain in the Git index until staged. Local builds
      // count the present tracked source rather than failing on its former path.
      if (error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const lines = physicalLines(text);
    for (const [collection, key] of [
      [areas, sourceArea(path)],
      [languages, extension],
    ]) {
      collection[key] ??= { files: 0, lines: 0 };
      collection[key].files++;
      collection[key].lines += lines;
    }
  }
  const pkg = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8"));

  return {
    areas,
    languages,
    assets,
    documents,
    files: Object.values(areas).reduce((n, a) => n + a.files, 0),
    lines: Object.values(areas).reduce((n, a) => n + a.lines, 0),
    commands: Object.keys(pkg.scripts).length,
    dependencies: Object.keys(pkg.dependencies ?? {}).length,
    devDependencies: Object.keys(pkg.devDependencies ?? {}).length,
    revision: git("rev-parse", "HEAD").trim(),
    date: git("show", "-s", "--format=%cs", "HEAD").trim(),
    dirty: Boolean(git("status", "--porcelain").trim()),
  };
}
