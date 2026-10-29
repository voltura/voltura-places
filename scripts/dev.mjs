import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
const children = [];
const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { stdio: "inherit" });
    p.once("exit", (code) => (code ? reject(new Error(`Command exited ${code}`)) : resolve()));
  });
await run(["node_modules/wrangler/bin/wrangler.js", "types"]);
await run(["node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local"]);
await run(["scripts/build.mjs"]);
const p = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    "5174",
    "--inspector-port",
    "0",
  ],
  // This pinned Wrangler release omits its optional explorer UI bundle.
  { stdio: "inherit", env: { ...process.env, X_LOCAL_EXPLORER: "false" } },
);
children.push(p);
const stop = () => children.forEach((c) => c.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
p.on("exit", (code) => {
  stop();
  process.exitCode = code ?? 1;
});
