import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve("src");
const layers = {
  shared: new Set(["shared"]),
  server: new Set(["server", "shared"]),
  "client/foundation": new Set(["client/foundation", "shared"]),
  "client/ui": new Set(["client/ui"]),
  "client/features": new Set(["client/features", "client/foundation", "client/ui", "shared"]),
  "client/app": new Set([
    "client/app",
    "client/features",
    "client/foundation",
    "client/ui",
    "shared",
  ]),
};

const layerOf = (path) => Object.keys(layers).find((layer) => path.startsWith(`${layer}/`));

async function* sources(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      yield* sources(path);
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      yield path;
    }
  }
}

const violations = [];
const entryPoints = [];
for await (const file of sources(root)) {
  if (!file.endsWith(".d.ts")) {
    entryPoints.push(file);
  }
}
// The production build parser understands comments, TS, re-exports and dynamic imports.
// Type-only imports are erased; this guard enforces runtime dependencies.
await build({
  entryPoints,
  outdir: ".artifacts/architecture-check",
  bundle: true,
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "places-runtime-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, ({ path: target, importer }) => {
          if (!importer) {
            return;
          }
          const name = relative(root, importer).replaceAll("\\", "/");
          const layer = layerOf(name);
          if (layer) {
            if (target.startsWith(".")) {
              const path = relative(root, resolve(dirname(importer), target)).replaceAll("\\", "/");
              if (!layers[layer].has(layerOf(path))) {
                violations.push(`${name} -> ${target}`);
              }
            } else if (
              (layer === "shared" || layer === "client/foundation") &&
              /^react(?:-dom)?(?:\/|$)/.test(target)
            ) {
              violations.push(`${name} -> ${target} (presentation dependency)`);
            }
          }

          return { path: target, external: true };
        });
      },
    },
  ],
});
if (violations.length) {
  throw new Error(`Architecture boundary violations:\n${violations.join("\n")}`);
}
console.log(`Runtime architecture boundaries checked in ${entryPoints.length} source files.`);
