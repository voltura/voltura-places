import { readdir, readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function assertDestination(path) {
  if (
    typeof path !== "string" ||
    !/^places\/(?:index\.html|sv\/index\.html|assets\/(?:site\.[a-f0-9]{16}\.css|app-(?:en|sv)\.[a-f0-9]{16}\.png|icon\.svg)|mail\/relay\.php)$/.test(
      path,
    )
  )
    throw new Error("Destination outside isolated Places allowlist.");
  return path;
}
export async function promoManifest() {
  const entries = [];
  const base = resolve(".artifacts/promo");
  async function collect(dir = "") {
    for (const e of await readdir(resolve(base, dir), { withFileTypes: true })) {
      const relative = dir ? `${dir}/${e.name}` : e.name;
      const full = resolve(base, relative),
        s = await lstat(full);
      if (s.isSymbolicLink()) throw new Error("Linked promo path");
      if (s.isDirectory()) await collect(relative);
      else {
        const path = assertDestination(`places/${relative}`),
          bytes = await readFile(full);
        entries.push({ path, source: full, sha256: digest(bytes), size: bytes.length });
      }
    }
  }
  await collect();
  if (entries.length !== 6)
    throw new Error("Expected two promo pages, two screenshots, one stylesheet and one icon.");
  return entries.sort(
    (a, b) =>
      Number(a.path.endsWith("index.html")) - Number(b.path.endsWith("index.html")) ||
      a.path.localeCompare(b.path),
  );
}
