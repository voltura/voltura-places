import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Use Node.js 24 LTS.");
await mkdir(".artifacts", { recursive: true });
const run = (file, args) => {
  const r = spawnSync(file, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && file.endsWith(".cmd"),
  });
  if (r.error || r.status !== 0) process.exit(r.status ?? 1);
};
run(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "types"]);
run(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
]);
console.log("Local database ready. Run npm run dev. No remote resources were changed.");
