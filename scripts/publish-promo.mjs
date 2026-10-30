import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { connectSftp } from "./sftp-connection.mjs";
import { assertDestination, digest, promoManifest } from "./promo-manifest.mjs";
const wait = () => new Promise((r) => setTimeout(r, 1100));
let client;
try {
  const args = process.argv.slice(2);
  const rollbackId = args[0] === "--rollback" ? args[1] : null;
  if (!rollbackId) await import("./build-promo.mjs");
  const manifest = rollbackId ? [] : await promoManifest();
  if (args[0] === "--dry-run") {
    console.log(
      JSON.stringify(
        {
          destination: "ssh.voltura.se:./places/",
          files: manifest.map(({ source, ...e }) => e),
          scope: "places/",
        },
        null,
        2,
      ),
    );
  } else {
    if (args.length && !rollbackId)
      throw new Error("Usage: publish:promo [--dry-run | --rollback <backup-id>]");
    const git = (a) => execFileSync("git", a, { encoding: "utf8", windowsHide: true }).trim();
    if (git(["branch", "--show-current"]) !== "main" || git(["status", "--porcelain"]))
      throw new Error("Require clean reviewed main.");
    client = await connectSftp({ allowFirstUse: false });
    const safe = async (path) => {
      assertDestination(path);
      let current = "";
      for (const part of path.split("/")) {
        current = current ? `${current}/${part}` : part;
        const exists = await client.exists(current);
        if (exists === "l") throw new Error("Linked remote destination");
        if (exists && exists !== (current === path ? "-" : "d"))
          throw new Error("Unexpected remote path type");
      }
    };
    if (rollbackId) {
      if (!/^[0-9TZ-]+$/.test(rollbackId)) throw new Error("Invalid backup ID");
      const folder = resolve(".artifacts/backups", rollbackId),
        record = JSON.parse(await readFile(`${folder}/journal.json`, "utf8"));
      const restore = [];
      for (const item of record.files.filter((f) => f.attempted).reverse()) {
        await safe(item.path);
        const current = (await client.exists(item.path)) ? await client.get(item.path) : null;
        if (current && digest(current) !== item.sha256 && digest(current) !== item.previousHash)
          throw new Error("Rollback would overwrite unrelated content.");
        const bytes = item.previous ? Buffer.from(item.previous, "base64") : null;
        if (bytes && digest(bytes) !== item.previousHash)
          throw new Error("Backup hash mismatch; no rollback files written.");
        restore.push({ path: item.path, bytes, exists: Boolean(current) });
      }
      for (const item of restore) {
        if (item.bytes) await atomic(item.path, item.bytes);
        else if (item.exists) await client.delete(item.path);
      }
      console.log("Restored owned Places files.");
    } else {
      const id = new Date()
          .toISOString()
          .replaceAll(":", "-")
          .replace(/\.\d{3}/, ""),
        folder = resolve(".artifacts/backups", id);
      await mkdir(folder, { recursive: true });
      const record = {
        id,
        commit: git(["rev-parse", "HEAD"]),
        files: [],
      };
      const journal = () => writeFile(`${folder}/journal.json`, JSON.stringify(record, null, 2));
      await journal();
      for (const entry of manifest) {
        await safe(entry.path);
        const previous = (await client.exists(entry.path)) ? await client.get(entry.path) : null;
        record.files.push({
          ...entry,
          previous: previous?.toString("base64") ?? null,
          previousHash: previous ? digest(previous) : null,
          attempted: false,
        });
      }
      await journal();
      await ensureDir("places");
      await ensureDir("places/assets");
      await ensureDir("places/sv");
      // Confirm the server's atomic overwrite extension using exclusively owned paths.
      const probe = `places/assets/.places-probe-${crypto.randomUUID()}`,
        replacement = probe + "-replacement";
      await client.put(Buffer.from("a"), probe, { writeStreamOptions: { flags: "wx" } });
      await client.put(Buffer.from("b"), replacement, { writeStreamOptions: { flags: "wx" } });
      await client.posixRename(replacement, probe);
      await client.delete(probe);
      for (const entry of record.files) {
        const bytes = await readFile(entry.source);
        if (digest(bytes) !== entry.sha256) throw new Error("Source changed after manifest");
        entry.attempted = true;
        await journal();
        await atomic(entry.path, bytes);
      }
      for (const entry of manifest) {
        await wait();
        const response = await fetch(`https://voltura.se/${entry.path}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== entry.sha256)
          throw new Error("HTTPS payload verification failed.");
      }
      record.verified = true;
      await journal();
      console.log(`Published https://voltura.se/places/\nPlaces payloads verified. Backup: ${id}`);
    }
  }
} catch (error) {
  console.error(
    `Places promo publication failed: ${error.message}. Retain .artifacts/backups and inspect current state before rollback.`,
  );
  process.exitCode = 1;
} finally {
  await client?.end();
}
async function ensureDir(path) {
  if (!/^places(?:\/assets|\/sv)?$/.test(path)) throw new Error("Invalid directory");
  if (!(await client.exists(path))) await client.mkdir(path);
}
async function atomic(path, bytes) {
  assertDestination(path);
  const temporary = `${path}.places-deploy-${crypto.randomUUID()}`;
  try {
    await client.put(bytes, temporary, { writeStreamOptions: { flags: "wx" } });
    if (digest(await client.get(temporary)) !== digest(bytes))
      throw new Error("Staged hash mismatch");
    await client.posixRename(temporary, path);
    if (digest(await client.get(path)) !== digest(bytes))
      throw new Error("Published hash mismatch");
  } finally {
    if (await client.exists(temporary)) await client.delete(temporary);
  }
}
