import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("usage API: origins, validation, private data, cache, deduplication and expiry", async () => {
  const origin = "http://127.0.0.1:5174";
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "dist/server/index.js",
      compatibilityDate: "2026-10-29",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      bindings: {
        AUTH_ORIGIN: origin,
        AUTH_SECRET: "isolated-statistics-fixture-not-production",
        ACCOUNTS_ENABLED: "true",
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    for (const { tag } of journal.entries) {
      for (const sql of (await readFile(`drizzle/${tag}.sql`, "utf8"))
        .split("--> statement-breakpoint")
        .filter((s) => s.trim())) {
        await db.prepare(sql).run();
      }
    }

    const get = (headers = {}) => mf.dispatchFetch(`${origin}/api/v1/statistics`, { headers });

    const post = (body, headers = {}) =>
      mf.dispatchFetch(`${origin}/api/v1/activity`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json", ...headers },
        body,
      });

    const initial = await (await get()).json();
    for (const key of [
      "activeNow",
      "activeToday",
      "active30Days",
      "registeredAccounts",
      "cloudPlaces",
      "averagePersonalPlaces",
    ]) {
      assert.equal(initial[key], 0, key);
    }
    assert.equal(initial.version, 1);
    assert.ok(initial.activityStartedAt > 0);
    for (const promo of ["https://voltura.se", "http://127.0.0.1:5175"]) {
      assert.equal(
        (await get({ Origin: promo })).headers.get("Access-Control-Allow-Origin"),
        promo,
      );
    }
    assert.equal((await get({ Origin: "https://example.invalid" })).status, 403);
    assert.equal((await post("{}", { Origin: "https://voltura.se" })).status, 403);
    assert.equal((await post("{}", { Origin: "" })).status, 403);
    assert.equal((await post("{}", { "Sec-Fetch-Site": "cross-site" })).status, 403);
    assert.equal((await post("{}", { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await post("{")).status, 400);
    assert.equal((await post("[]")).status, 400);
    assert.equal((await post(JSON.stringify({ browserId: "a".repeat(200) }))).status, 413);
    assert.equal((await post('{"browserId":"bad"}')).status, 422);
    const browserId = crypto.randomUUID();
    assert.equal((await post(JSON.stringify({ browserId, accountId: "private" }))).status, 422);
    assert.equal((await post(JSON.stringify({ browserId }))).status, 200);
    const first = await db.prepare("SELECT * FROM places_activity").first();
    assert.match(first.browser_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(first.browser_hash, browserId);
    await post(JSON.stringify({ browserId: browserId.toUpperCase() }));
    assert.equal((await db.prepare("SELECT count(*) AS n FROM places_activity").first()).n, 1);
    assert.equal(
      (await db.prepare("SELECT last_seen FROM places_activity").first()).last_seen,
      first.last_seen,
    );
    await db.batch([
      db.prepare(
        "INSERT INTO places_accounts(id,created_at) VALUES('person',1),('empty-person',1),('group',1)",
      ),
      db.prepare(
        "INSERT INTO places_families(id,name,owner_id,created_at) VALUES('group','Private group','person',1)",
      ),
      db.prepare(
        "INSERT INTO places_family_members(family_id,account_id,joined_at) VALUES('group','person',1),('group','empty-person',1)",
      ),
      db.prepare(`INSERT INTO places_records(account_id,id,kind,value,revision,deleted,last_mutation) VALUES
        ('person','personal','place','private location',1,0,'m'),
        ('person','deleted','place','private location',1,1,'m'),
        ('person','category','category','private name',1,0,'m'),
        ('group','shared','place','private location',1,0,'m')`),
    ]);
    const now = Date.now();
    const day = 86_400_000;
    for (const [id, seen] of [
      ["expired", now - 32 * day],
      ["month", now - 29 * day],
      ["yesterday", now - day],
      ["old", now - 31 * day],
    ]) {
      await db
        .prepare("INSERT INTO places_activity(browser_hash,last_seen) VALUES(?,?)")
        .bind(id, seen)
        .run();
    }
    // Warm cache is unchanged until its 60-second validity expires.
    assert.deepEqual(await (await get()).json(), initial);
    await db.prepare("UPDATE places_statistics SET generated_at=0").run();
    const responses = await Promise.all([get(), get(), get()]);
    const result = await responses[0].json();
    assert.equal(result.activeNow, 1);
    assert.equal(result.activeToday, 1);
    assert.equal(result.active30Days, 3);
    assert.equal(result.registeredAccounts, 2);
    assert.equal(result.cloudPlaces, 2);
    assert.equal(result.averagePersonalPlaces, 0.5);
    for (const response of responses.slice(1)) {
      assert.deepEqual(await response.json(), result);
    }
    assert.deepEqual(
      Object.keys(result).sort(),
      [
        "version",
        "generatedAt",
        "activityStartedAt",
        "activeNow",
        "activeToday",
        "active30Days",
        "registeredAccounts",
        "cloudPlaces",
        "averagePersonalPlaces",
      ].sort(),
    );
    await post(JSON.stringify({ browserId }));
    assert.equal(
      await db.prepare("SELECT * FROM places_activity WHERE browser_hash='expired'").first(),
      null,
    );
    await db
      .prepare("UPDATE places_activity SET last_seen=? WHERE browser_hash=?")
      .bind(now - 120_000, first.browser_hash)
      .run();
    await post(JSON.stringify({ browserId }));
    assert.ok(
      (
        await db
          .prepare("SELECT last_seen FROM places_activity WHERE browser_hash=?")
          .bind(first.browser_hash)
          .first()
      ).last_seen >
        now - 60_000,
    );
    await db.batch([
      db.prepare("DELETE FROM places_accounts WHERE id='group'"),
      db.prepare("DELETE FROM places_accounts WHERE id='person'"),
      db.prepare("UPDATE places_statistics SET generated_at=0"),
    ]);
    const deleted = await (await get()).json();
    assert.equal(deleted.registeredAccounts, 1);
    assert.equal(deleted.cloudPlaces, 0);
    assert.equal(deleted.averagePersonalPlaces, 0);
    assert.equal((await mf.dispatchFetch(`${origin}/api/v1/activity`)).status, 405);
    assert.equal(
      (await mf.dispatchFetch(`${origin}/api/v1/statistics`, { method: "POST" })).status,
      405,
    );
  } finally {
    await mf.dispose();
  }
});
