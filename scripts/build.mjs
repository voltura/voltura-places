import { build as viteBuild } from "vite";
import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile, cp, rm, realpath, lstat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = await realpath(fileURLToPath(new URL("../", import.meta.url)));
if ((await realpath(process.cwd())) !== root) {
  throw new Error("Run from the Places checkout.");
}
// Vite empties its client output, so reject linked parents before any build writes.
for (const relative of [
  ".artifacts",
  ".artifacts/client",
  "public",
  "public/startup-images",
  "dist",
]) {
  const path = resolve(root, relative);
  try {
    if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path) {
      throw new Error(`Unexpected Places directory: ${relative}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}
await mkdir("public", { recursive: true });
const { generateBranding } = await import("./branding.mjs");
await generateBranding();
await viteBuild();
// Sites packages the whole dist tree, including files no longer present in this revision.
const output = resolve(root, "dist");
const previous = await lstat(output).catch((error) => {
  if (error.code !== "ENOENT") {
    throw error;
  }
});
if (previous) {
  if (!previous.isDirectory() || (await realpath(output)) !== output) {
    throw new Error("Unexpected Places build output path");
  }
  await rm(output, { recursive: true });
}
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const assets = {};

async function collect(dir = "") {
  const files = await readdir(resolve(".artifacts/client", dir), { withFileTypes: true });
  files.sort((a, b) => (a.name < b.name ? -1 : Number(a.name > b.name)));
  for (const e of files) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await collect(path);
    } else if (e.isFile()) {
      const bytes = await readFile(resolve(".artifacts/client", path));
      assets[`/${path}`] = [
        types[extname(path)] ?? "application/octet-stream",
        bytes.toString("base64"),
      ];
    } else {
      throw new Error("Linked assets are not supported");
    }
  }
}

await collect();
let revision = "development";
try {
  revision = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {}
const serializedAssets = JSON.stringify(assets);
const contentHash = createHash("sha256").update(serializedAssets).digest("hex").slice(0, 12);
const packageVersion = JSON.parse(await readFile("package.json", "utf8")).version;
const version = `${packageVersion}-${revision}-${contentHash}`;
await build({
  stdin: {
    contents: `import {createWorker} from './src/server/index.ts';export default createWorker(${serializedAssets},${JSON.stringify(version)});`,
    resolveDir: root,
  },
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*"],
  target: "es2022",
  minify: true,
  legalComments: "eof",
});
await writeFile(
  "dist/server/wrangler.json",
  JSON.stringify(
    {
      name: "voltura-places",
      main: "index.js",
      compatibility_date: "2026-10-29",
      compatibility_flags: ["nodejs_compat"],
    },
    null,
    2,
  ),
);
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
await writeFile(
  ".artifacts/build.json",
  JSON.stringify({ version, revision, assets: Object.keys(assets).length }, null, 2),
);
await import("./build-promo.mjs");
console.log(
  `Built ${version}; ${Object.keys(assets).length} embedded assets. Sites artifact: dist/server/index.js`,
);
