import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { updateRelay } from "../scripts/publish-relay-fix.mjs";

test("the PHP mail relay rejects a replay at the final allowed second without sending mail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "places-relay-"));
  const secret = "a".repeat(64);
  const body = JSON.stringify({
    recipient: "fixture@example.invalid",
    code: "123456",
    timestamp: 1000060,
    nonce: "01234567-89ab-4def-a123-456789abcdef",
  });
  const harness = join(dir, "fixture.php");
  const config = join(dir, "config.php");
  try {
    await writeFile(
      config,
      "<?php return ['stateDirectory'=>__DIR__,'secret'=>str_repeat('a',64)];",
    );
    await writeFile(
      harness,
      `<?php
namespace VolturaPlacesMail;
function time(){static $calls=0;return (int)getenv(++$calls===1 ? 'FIXTURE_NOW' : 'FIXTURE_LOCKED_NOW');}
function file_get_contents($path,...$args){return $path==='php://input' ? getenv('FIXTURE_BODY') : \\file_get_contents($path,...$args);}
function mail(...$args){return true;}
function http_response_code($status){echo $status." ";}
$_SERVER['REQUEST_METHOD']='POST';
$_SERVER['HTTP_X_VOLTURA_SIGNATURE']=getenv('FIXTURE_SIGNATURE');
require getenv('FIXTURE_RELAY');`,
    );

    const run = (now, locked = now) =>
      execFileSync("php", [harness], {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          VOLTURA_MAIL_CONFIG: config,
          FIXTURE_RELAY: resolve("mail-relay/relay.php"),
          FIXTURE_BODY: body,
          FIXTURE_SIGNATURE: createHmac("sha256", secret).update(body).digest("hex"),
          FIXTURE_NOW: String(now),
          FIXTURE_LOCKED_NOW: String(locked),
        },
      }).trim();

    assert.equal(run(1000000), '200 {"ok":true}');
    assert.equal(run(1000120, 1000121), '400 {"ok":false}');
    assert.equal(run(1000120), '409 {"ok":false}');
    assert.equal(JSON.parse(await readFile(join(dir, "mail-state.json"), "utf8")).sent.length, 1);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("one-time updater checks exact prior bytes, rejects links, stages atomically and skips repeat publication", async () => {
  const dir = await mkdtemp(join(tmpdir(), "places-relay-publish-"));
  const root = "/customers/a/b/voltura.se/httpd.www";
  const config = root.replace("/httpd.www", "/httpd.private/voltura-places/mail-config.php");
  const source = { sha: "fixture", assertCurrent() {} };
  const target = "places/mail/relay.php";
  const current = await readFile("mail-relay/relay.php", "utf8");
  const preimage = current
    .replace("$time >= $now - 120", "$time > $now - 120")
    .replace(
      "if (abs($now - $input['timestamp']) > 60) {\n    flock($file, LOCK_UN);\n    fclose($file);\n    finish(400);\n}\n",
      "",
    );
  assert.equal(
    execFileSync("git", ["hash-object", "--stdin"], { input: preimage, encoding: "utf8" }).trim(),
    "c28481fd53c7d03d6a8fe33576580e9a880f0676",
  );
  const original = Buffer.from(preimage.replace("/private/voltura/places-mail-config.php", config));
  const files = new Map([[target, original]]);
  let linked = false;
  let mutations = 0;
  const client = {
    cwd: async () => root,
    exists: async (path) =>
      path === "places"
        ? "d"
        : path === "places/mail"
          ? linked
            ? "l"
            : "d"
          : files.has(path)
            ? "-"
            : false,
    stat: async (path) => ({ size: files.get(path).length }),
    get: async (path) => files.get(path),
    put: async (bytes, path, options) => {
      assert.match(path, /^places\/mail\/\.places-relay-[0-9a-f-]+\.php$/);
      assert.equal(options.writeStreamOptions.flags, "wx");
      assert.equal(files.has(path), false);
      files.set(path, bytes);
      mutations++;
    },
    posixRename: async (from, to) => {
      assert.equal(to, target);
      files.set(to, files.get(from));
      files.delete(from);
      mutations++;
    },
    delete: async (path) => files.delete(path),
  };
  try {
    linked = true;
    await assert.rejects(updateRelay(client, source, dir), /regular file/);
    linked = false;
    files.set(target, Buffer.from("unrelated"));
    await assert.rejects(updateRelay(client, source, dir), /unrecognized/);
    files.set(target, Buffer.from(original.toString("utf8").replace("\n", "\r\n")));
    await assert.rejects(updateRelay(client, source, dir), /unrecognized/);
    files.set(target, Buffer.from(preimage));
    await assert.rejects(updateRelay(client, source, dir), /unrecognized/);
    assert.equal(mutations, 0);
    files.set(target, original);
    await updateRelay(client, source, dir);
    assert.equal(mutations, 2);
    const [backup] = await readdir(dir);
    assert.deepEqual(await readFile(join(dir, backup, "relay.php")), original);
    const journal = JSON.parse(await readFile(join(dir, backup, "journal.json"), "utf8"));
    assert.equal(journal.source, source.sha);
    assert.equal(journal.path, target);
    assert.equal(journal.previous, createHash("sha256").update(original).digest("hex"));
    assert.equal(journal.replacement, createHash("sha256").update(files.get(target)).digest("hex"));
    assert.deepEqual(
      files.get(target),
      Buffer.from(
        (await readFile("mail-relay/relay.php", "utf8")).replace(
          "/private/voltura/places-mail-config.php",
          config,
        ),
      ),
    );
    await updateRelay(client, source, dir);
    assert.equal(mutations, 2);
    const windowsOriginal = Buffer.from(original.toString("utf8").replaceAll("\n", "\r\n"));
    files.set(target, windowsOriginal);
    await updateRelay(client, source, dir);
    assert.equal(mutations, 4);
    const entries = await readdir(dir);
    const second = entries.find((entry) => entry !== backup);
    assert.deepEqual(await readFile(join(dir, second, "relay.php")), windowsOriginal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
