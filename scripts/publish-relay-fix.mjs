import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectSftp } from "./sftp-connection.mjs";
import { captureValidatedSource } from "./validated-source.mjs";

const target = "places/mail/relay.php";
const fixedBlob = "6255518b0b36aeb3f1e325291ed0832c57aeedff";
const historicalBlobs = [
  "7f743ee2b0b9fd582ece6366235e7ac96602cafa",
  "c28481fd53c7d03d6a8fe33576580e9a880f0676",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const placeholder = "/private/voltura/places-mail-config.php";

function canonicalBlob(bytes, config) {
  const text = bytes.toString("utf8");
  const parts = text.split(config);
  if (parts.length !== 2 || !Buffer.from(text).equals(bytes)) {
    return null;
  }
  const lf = text.replaceAll("\r\n", "\n");
  if (text !== lf && text !== lf.replaceAll("\n", "\r\n")) {
    return null;
  }
  const canonical = Buffer.from(lf.replace(config, placeholder));

  return createHash("sha1")
    .update("blob " + canonical.length + "\0")
    .update(canonical)
    .digest("hex");
}

export async function updateRelay(client, source, backups) {
  const publicRoot = await client.cwd();
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*voltura\.se\/httpd\.www$/.test(publicRoot)) {
    throw new Error("Unexpected one.com document root.");
  }
  const config = publicRoot.replace(
    /\/httpd\.www$/,
    "/httpd.private/voltura-places/mail-config.php",
  );
  const local = await readFile(new URL("../mail-relay/relay.php", import.meta.url));
  if (
    execFileSync("git", ["hash-object", "--stdin"], {
      input: local,
      encoding: "utf8",
      windowsHide: true,
    }).trim() !== fixedBlob
  ) {
    throw new Error("Unexpected relay source bytes.");
  }
  const next = Buffer.from(
    local.toString("utf8").replace("/private/voltura/places-mail-config.php", config),
  );

  const checkDirectories = async () => {
    for (const [path, type] of [
      ["places", "d"],
      ["places/mail", "d"],
    ]) {
      if ((await client.exists(path)) !== type) {
        throw new Error(
          "Expected an existing Places relay with real directories and a regular file.",
        );
      }
    }
  };

  const readTarget = async () => {
    await checkDirectories();
    if ((await client.exists(target)) !== "-") {
      throw new Error("Expected a regular Places relay file.");
    }
    if ((await client.stat(target)).size > 32768) {
      throw new Error("Unexpected Places relay size.");
    }

    return client.get(target);
  };

  const previous = await readTarget();
  const previousBlob = canonicalBlob(previous, config);
  if (previousBlob === fixedBlob) {
    return "Relay already matches this repair.";
  }
  if (!historicalBlobs.includes(previousBlob)) {
    throw new Error("Refusing to replace an unrecognized Places relay.");
  }
  source.assertCurrent();
  const folder = resolve(backups, "relay-" + randomUUID());
  await mkdir(backups, { recursive: true });
  await mkdir(folder);
  await writeFile(resolve(folder, "relay.php"), previous, { flag: "wx" });
  await writeFile(
    resolve(folder, "journal.json"),
    JSON.stringify(
      { source: source.sha, path: target, previous: sha256(previous), replacement: sha256(next) },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log("Retained original relay and journal in " + folder);
  const temporary = "places/mail/.places-relay-" + randomUUID() + ".php";
  let staged = false;
  try {
    source.assertCurrent();
    if (!(await readTarget()).equals(previous)) {
      throw new Error("Relay changed before staging.");
    }
    await client.put(next, temporary, { writeStreamOptions: { flags: "wx" } });
    staged = true;
    if ((await client.exists(temporary)) !== "-" || !(await client.get(temporary)).equals(next)) {
      throw new Error("Relay stage differs from reviewed bytes.");
    }
    source.assertCurrent();
    if (!(await readTarget()).equals(previous)) {
      throw new Error("Relay changed before atomic promotion.");
    }
    await client.posixRename(temporary, target);
    staged = false;
    if (!(await readTarget()).equals(next)) {
      throw new Error("Promoted relay differs from the reviewed bytes. Retain its backup.");
    }
    source.assertCurrent();

    return "Updated the Places relay. Backup " + folder;
  } catch (error) {
    throw new Error(
      "Relay publication failed. Retained backup " +
        folder +
        ". " +
        (error instanceof Error ? error.message : "Unexpected publication failure."),
      { cause: error },
    );
  } finally {
    if (staged) {
      await checkDirectories();
      if (
        (await client.exists(temporary)) === "-" &&
        (await client.stat(temporary)).size === next.length &&
        (await client.get(temporary)).equals(next)
      ) {
        await client.delete(temporary);
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = captureValidatedSource();
  if (
    process.argv.length !== 4 ||
    process.argv[2] !== "--apply" ||
    process.argv[3] !== source.sha ||
    execFileSync("git", ["rev-parse", source.sha + ":mail-relay/relay.php"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim() !== fixedBlob
  ) {
    throw new Error(
      "Pass --apply and the exact validated clean-main release commit containing this repair.",
    );
  }
  const client = await connectSftp({ allowFirstUse: false });
  try {
    console.log(await updateRelay(client, source, resolve(".artifacts/backups")));
    const response = await fetch("https://voltura.se/places/mail/relay.php", {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 405 || (await response.text()).trim() !== '{"ok":false}') {
      throw new Error("Places relay HTTPS verification failed; retain the backup.");
    }
  } finally {
    await client.end();
  }
}
