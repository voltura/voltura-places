import { build as viteBuild } from "vite";
import { build } from "esbuild";
import { mkdir, readFile, readdir, writeFile, cp, rm } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = process.cwd();
if (!root.endsWith("voltura-places")) throw new Error("Run from the Places checkout.");
await mkdir("public", { recursive: true });
const { generateBranding } = await import("./branding.mjs");
await generateBranding();
await viteBuild();
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
  for (const e of await readdir(resolve(".artifacts/client", dir), { withFileTypes: true })) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) await collect(path);
    else if (e.isFile()) {
      const bytes = await readFile(resolve(".artifacts/client", path));
      assets[`/${path}`] = [
        types[extname(path)] ?? "application/octet-stream",
        bytes.toString("base64"),
      ];
    } else throw new Error("Linked assets are not supported");
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
const contentHash = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 12);
const packageVersion = JSON.parse(await readFile("package.json", "utf8")).version;
const version = `${packageVersion}-${revision}-${contentHash}`;
await build({
  stdin: {
    contents: `import {createWorker} from './src/server/index.ts';export default createWorker(${JSON.stringify(assets)},${JSON.stringify(version)});`,
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
