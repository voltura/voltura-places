import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { captureValidatedSource } from "./validated-source.mjs";
import { dirname, resolve } from "node:path";
import { connectSftp } from "./sftp-connection.mjs";
import {
  assertDestination,
  digest,
  promoManifest,
  rollbackPayload,
  verifyPromoPayload,
} from "./promo-manifest.mjs";

const wait = () => new Promise((r) => setTimeout(r, 1100));

let client;
try {
  const args = process.argv.slice(2);
  const skipHttps = args.length === 1 && args[0] === "--skip-https-verification";
  const rollbackId = args[0] === "--rollback" ? args[1] : null;
  if (
    !(
      args.length === 0 ||
      skipHttps ||
      (args.length === 1 && args[0] === "--dry-run") ||
      (args.length === 2 && rollbackId && /^[0-9TZ-]+$/.test(rollbackId))
    )
  ) {
    throw new Error(
      "Usage: publish:promo [--dry-run | --skip-https-verification | --rollback <backup-id>]",
    );
  }
  const source = args[0] === "--dry-run" ? null : captureValidatedSource();

  const assertSource = () => source?.assertCurrent();

  if (!rollbackId) {
    execFileSync(process.execPath, ["scripts/format.mjs", "--check"], {
      stdio: "inherit",
      windowsHide: true,
    });
    await import("./build-promo.mjs");
  }
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
    assertSource();
    client = await connectSftp({ allowFirstUse: false });

    const safe = async (path) => {
      assertDestination(path);
      let current = "";
      for (const part of path.split("/")) {
        current = current ? `${current}/${part}` : part;
        const exists = await client.exists(current);
        if (exists === "l") {
          throw new Error("Linked remote destination");
        }
        if (exists && exists !== (current === path ? "-" : "d")) {
          throw new Error("Unexpected remote path type");
        }
      }
    };

    if (rollbackId) {
      const folder = resolve(".artifacts/backups", rollbackId);
      const record = JSON.parse(await readFile(`${folder}/journal.json`, "utf8"));
      const restore = [];
      for (const item of record.files.filter((f) => f.attempted).reverse()) {
        await safe(item.path);
        const current = (await client.exists(item.path)) ? await client.get(item.path) : null;
        const { changed, bytes } = rollbackPayload(item, current);
        if (changed) {
          restore.push({ item, bytes });
        }
      }
      for (const { item, bytes } of restore) {
        assertSource();
        await safe(item.path);
        const current = (await client.exists(item.path)) ? await client.get(item.path) : null;
        if (!rollbackPayload(item, current).changed) {
          continue;
        }
        if (bytes) {
          await atomic(item.path, bytes, item.sha256, safe);
        } else {
          await client.delete(item.path);
        }
      }
      console.log("Restored owned Places files.");
    } else {
      const id = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
      const folder = resolve(".artifacts/backups", id);
      await mkdir(dirname(folder), { recursive: true });
      await mkdir(folder);
      const record = {
        id,
        commit: source.sha,
        files: [],
      };

      const journal = async () => {
        await writeFile(`${folder}/journal.tmp`, JSON.stringify(record, null, 2));
        await rename(`${folder}/journal.tmp`, `${folder}/journal.json`);
      };

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
      assertSource();
      await ensureDir("places");
      await ensureDir("places/assets");
      await ensureDir("places/sv");
      // Confirm the server's atomic overwrite extension using exclusively owned paths.
      const probe = `places/assets/.places-probe-${crypto.randomUUID()}`;
      const replacement = probe + "-replacement";
      const probes = new Set();
      try {
        for (const path of [probe, replacement]) {
          await client.put(Buffer.from(path === probe ? "a" : "b"), path, {
            writeStreamOptions: { flags: "wx" },
          });
          probes.add(path);
        }
        await client.posixRename(replacement, probe);
        probes.delete(replacement);
      } finally {
        for (const path of probes) {
          if (await client.exists(path)) {
            await client.delete(path);
          }
        }
      }
      for (const entry of record.files) {
        assertSource();
        if (entry.previousHash === entry.sha256) {
          continue;
        }
        const bytes = await readFile(entry.source);
        if (digest(bytes) !== entry.sha256) {
          throw new Error("Source changed after manifest");
        }
        entry.attempted = true;
        await journal();
        await atomic(entry.path, bytes, entry.previousHash, safe);
      }
      if (!skipHttps) {
        for (const entry of manifest) {
          await wait();
          await verifyPromoPayload(entry);
        }
      }
      assertSource();
      record.verified = !skipHttps;
      await journal();
      console.log(
        `Published https://voltura.se/places/\n${skipHttps ? "HTTPS checks skipped." : "Places payloads verified."} Backup: ${id}`,
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
  if (!/^places(?:\/assets|\/sv)?$/.test(path)) {
    throw new Error("Invalid directory");
  }
  if (!(await client.exists(path))) {
    await client.mkdir(path);
  }
}

async function atomic(path, bytes, expectedHash, safe) {
  await safe(path);
  assertDestination(path);
  const temporary = `${path}.places-deploy-${crypto.randomUUID()}`;
  let staged = false;
  try {
    await client.put(bytes, temporary, { writeStreamOptions: { flags: "wx" } });
    staged = true;
    if (digest(await client.get(temporary)) !== digest(bytes)) {
      throw new Error("Staged hash mismatch");
    }
    await safe(path);
    const currentHash = (await client.exists(path)) ? digest(await client.get(path)) : null;
    if (currentHash !== expectedHash) {
      throw new Error("Remote Places payload changed during publication.");
    }
    await client.posixRename(temporary, path);
    staged = false;
    if (digest(await client.get(path)) !== digest(bytes)) {
      throw new Error("Published hash mismatch");
    }
  } finally {
    if (staged && (await client.exists(temporary))) {
      await client.delete(temporary);
    }
  }
}
