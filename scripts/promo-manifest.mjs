import { readdir, readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function assertDestination(path) {
  if (
    typeof path !== "string" ||
    !/^places\/(?:(?:index|stats)\.html|sv\/(?:index|stats)\.html|assets\/(?:site\.[a-f0-9]{16}\.css|usage\.[a-f0-9]{16}\.js|(?:app|desktop|social)-(?:en|sv)\.[a-f0-9]{16}\.png|icon\.svg))$/.test(
      path,
    )
  ) {
    throw new Error("Destination outside isolated Places allowlist.");
  }

  return path;
}

export async function promoManifest(base = resolve(".artifacts/promo")) {
  const entries = [];
  const slots = new Set();
  if (!(await lstat(base)).isDirectory()) {
    throw new Error("Invalid promo root");
  }

  async function collect(dir = "") {
    for (const e of await readdir(resolve(base, dir), { withFileTypes: true })) {
      const relative = dir ? `${dir}/${e.name}` : e.name;
      const full = resolve(base, relative);
      const s = await lstat(full);
      if (s.isSymbolicLink()) {
        throw new Error("Linked promo path");
      }
      if (s.isDirectory()) {
        await collect(relative);
      } else if (s.isFile()) {
        const path = assertDestination(`places/${relative}`);
        const bytes = await readFile(full);
        const slot = path.replace(/\.[a-f0-9]{16}\./, ".");
        if (slots.has(slot)) {
          throw new Error("Duplicate promo asset variant");
        }
        slots.add(slot);
        const hash = path.match(/\.([a-f0-9]{16})\./)?.[1];
        const sha256 = digest(bytes);
        if (hash && !sha256.startsWith(hash)) {
          throw new Error("Content-addressed promo asset mismatch");
        }
        entries.push({ path, source: full, sha256, size: bytes.length });
      } else {
        throw new Error("Unexpected promo file type");
      }
    }
  }

  await collect();
  if (entries.length !== 13) {
    throw new Error(
      "Expected two promo pages, two statistics pages, four screenshots, two social cards, one stylesheet, one usage script and one icon.",
    );
  }

  return entries.sort(
    (a, b) =>
      Number(a.path.endsWith("index.html")) - Number(b.path.endsWith("index.html")) ||
      a.path.localeCompare(b.path),
  );
}

export function rollbackPayload(item, current) {
  const currentHash = current === null ? null : digest(current);
  if (currentHash !== item.sha256 && currentHash !== item.previousHash) {
    throw new Error("Rollback would overwrite unrelated content.");
  }
  const bytes = typeof item.previous === "string" ? Buffer.from(item.previous, "base64") : null;
  if ((bytes === null ? null : digest(bytes)) !== item.previousHash) {
    throw new Error("Backup hash mismatch; no rollback files written.");
  }

  return { changed: currentHash !== item.previousHash, bytes };
}
