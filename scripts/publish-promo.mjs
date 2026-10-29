import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { connectSftp } from "./sftp-connection.mjs";
import { assertDestination, digest, promoManifest } from "./promo-manifest.mjs";
const protectedPaths = [
  "index.php",
  ".htaccess",
  "robots.txt",
  "web.config",
  "air/index.html",
  "air/app/index.html",
  "a/index.php",
  "s/index.php",
  "d/index.php",
];
const routes = ["/air/", "/air/app/", "/a/", "/s/", "/d/", "/fortnox/"];
const wait = () => new Promise((r) => setTimeout(r, 1100));
let client;
try {
  const args = process.argv.slice(2),
    manifest = await promoManifest();
  if (args[0] === "--dry-run") {
    console.log(
      JSON.stringify(
        {
          destination: "ssh.voltura.se:./places/",
          files: manifest.map(({ source, ...e }) => e),
          protectedPaths,
          routes,
        },
        null,
        2,
      ),
    );
  } else {
    const rollbackId = args[0] === "--rollback" ? args[1] : null;
    if (args.length && !rollbackId)
      throw new Error("Usage: publish:promo [--dry-run | --rollback <backup-id>]");
    const git = (a) => execFileSync("git", a, { encoding: "utf8", windowsHide: true }).trim();
    if (git(["branch", "--show-current"]) !== "main" || git(["status", "--porcelain"]))
      throw new Error("Require clean reviewed main.");
    client = await connectSftp({ allowFirstUse: false });
    if (!(await client.exists("air")) || !(await client.exists("index.php")))
      throw new Error("Unexpected remote website root.");
    if (!/Voltura/.test((await client.get("index.php")).toString()))
      throw new Error("Remote homepage does not identify Voltura.");
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
    const baseline = async () => {
      const result = {};
      for (const path of protectedPaths) {
        const exists = await client.exists(path);
        result[path] = exists === "-" ? digest(await client.get(path)) : String(exists);
      }
      return result;
    };
    const routeState = async () => {
      const result = {};
      for (const path of routes) {
        await wait();
        const response = await fetch(`https://voltura.se${path}`, {
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
        });
        result[path] = { status: response.status, location: response.headers.get("location") };
        await response.body?.cancel();
      }
      return result;
    };
    if (rollbackId) {
      if (!/^[0-9TZ-]+$/.test(rollbackId)) throw new Error("Invalid backup ID");
      const folder = resolve(".artifacts/backups", rollbackId),
        record = JSON.parse(await readFile(`${folder}/journal.json`, "utf8"));
      for (const item of record.files.filter((f) => f.attempted).reverse()) {
        await safe(item.path);
        const current = (await client.exists(item.path)) ? await client.get(item.path) : null;
        if (current && digest(current) !== item.sha256 && digest(current) !== item.previousHash)
          throw new Error("Rollback would overwrite unrelated content.");
        if (item.previous) {
          await atomic(item.path, Buffer.from(item.previous, "base64"));
        } else if (current) await client.delete(item.path);
      }
      if (JSON.stringify(await baseline()) !== JSON.stringify(record.protectedBefore))
        throw new Error("Protected file mismatch after rollback");
      console.log("Restored owned Places files. Inspect both products.");
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
        protectedBefore: await baseline(),
        routesBefore: await routeState(),
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
      if (JSON.stringify(await baseline()) !== JSON.stringify(record.protectedBefore))
        throw new Error("Protected Air/root file changed.");
      if (JSON.stringify(await routeState()) !== JSON.stringify(record.routesBefore))
        throw new Error("Protected route response changed.");
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
      console.log(
        `Published https://voltura.se/places/\nAir/root baselines unchanged. Backup: ${id}`,
      );
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
