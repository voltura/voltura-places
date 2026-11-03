import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

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
      AUTH_SECRET: "isolated-route-integration-fixture-not-production",
      ACCOUNTS_ENABLED: "true",
      SITES_NATIVE_AUTH: "true",
    },
  }),
);
let checks = 0;

const check = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};

const hash = (value) => createHash("sha256").update(value).digest("hex");

try {
  const db = await mf.getD1Database("DB");
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const { tag } of journal.entries) {
    if (tag === "0012_routes") {
      await db
        .prepare("INSERT INTO places_accounts(id,created_at) VALUES('migration-route',1)")
        .run();
      await db
        .prepare(
          "INSERT INTO places_records(rowid,account_id,id,kind,value,revision,deleted,last_mutation) VALUES(1234,'migration-route','retained','category','{}',4,1,'old')",
        )
        .run();
      await db
        .prepare("INSERT INTO places_receipts VALUES('migration-route','old','hash','{}')")
        .run();
    }
    for (const sql of (await readFile(`drizzle/${tag}.sql`, "utf8"))
      .split("--> statement-breakpoint")
      .filter((s) => s.trim())) {
      await db.prepare(sql).run();
    }
  }
  check(
    await db
      .prepare(
        "SELECT rowid,revision,deleted,last_mutation FROM places_records WHERE account_id='migration-route'",
      )
      .first(),
    { rowid: 1234, revision: 4, deleted: 1, last_mutation: "old" },
    "migration preserves rowids and CAS metadata",
  );
  check(
    (
      await db
        .prepare("SELECT count(*) n FROM places_receipts WHERE account_id='migration-route'")
        .first()
    ).n,
    1,
    "migration preserves receipts",
  );

  const req = (path, who, method = "GET", body, headers = {}) =>
    mf.dispatchFetch(origin + path, {
      method,
      headers: {
        Origin: origin,
        ...(who ? { Cookie: who.cookie, "X-Places-Account": who.account } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const login = async (name) => {
    const response = await req(
      "/api/account/connect",
      null,
      "POST",
      { provider: "chatgpt" },
      {
        "oai-authenticated-user-id": name,
        "oai-authenticated-user-email": `${name}@example.invalid`,
      },
    );
    check(response.status, 200, "login");

    return {
      account: (await response.json()).account.id,
      cookie: response.headers
        .getSetCookie()
        .map((s) => s.split(";")[0])
        .join("; "),
    };
  };

  const a = await login("route-a");
  const b = await login("route-b");
  const geometry = { version: 1, segments: [[[1, 2, 1000, 5]], [[1, 2, 10000, 5]]] };
  const geometryId = hash(JSON.stringify(geometry));
  const path = `/api/v1/geometry/${geometryId}`;
  check((await req(path)).status, 401, "geometry requires session");
  check(
    (await req(path, a, "PUT", geometry, { Origin: "https://bad.invalid" })).status,
    403,
    "geometry requires origin",
  );
  check((await req(path, a, "PUT", geometry)).status, 200, "geometry upload");
  check((await req(path, a, "PUT", geometry)).status, 200, "geometry upload idempotent");
  check((await req(path, b)).status, 404, "geometry account isolation");
  check(
    (await req(path, a)).headers.get("Cache-Control"),
    "private, no-store",
    "geometry is not cached",
  );
  check(
    (await req(path, a, "PUT", { ...geometry, segments: [[[1, 3, 1000, 5]], [[1, 2, 10000, 5]]] }))
      .status,
    422,
    "hash forgery rejected",
  );
  check((await req(path, a, "PUT", "x".repeat(1048577))).status, 413, "geometry byte cap");
  const value = {
    name: "Route fixture",
    categoryId: "other",
    latitude: 1,
    longitude: 2,
    accuracy: 5,
    capturedAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    startedAt: "2026-11-03T00:00:00.000Z",
    stoppedAt: "2026-11-03T00:00:09.000Z",
    duration: 9000,
    distance: 0,
    pointCount: 2,
    bounds: { south: 1, north: 1, west: 2, east: 2 },
    geometryId,
  };
  const mutation = {
    version: 1,
    mutationId: crypto.randomUUID(),
    baseRevision: 0,
    deleted: false,
    entity: { id: "route-fixture", kind: "route", value },
  };
  const support = { "X-Places-Routes": "1", "X-Places-Photos": "1" };
  check(
    (await req("/api/v1/sync", a, "POST", mutation)).status,
    422,
    "legacy route mutations rejected",
  );
  check(
    (await req("/api/v1/sync", b, "POST", mutation, support)).status,
    422,
    "route needs own attachment",
  );
  check(
    (
      await req(
        "/api/v1/sync",
        a,
        "POST",
        { ...mutation, entity: { ...mutation.entity, value: { ...value, distance: 1 } } },
        support,
      )
    ).status,
    422,
    "summary forgery rejected",
  );
  check((await req("/api/v1/sync", a, "POST", mutation, support)).status, 200, "route mutation");
  check(
    (await req("/api/v1/sync", a, "POST", mutation, support)).status,
    200,
    "route receipt retry",
  );
  check(
    (await (await req("/api/v1/sync", a)).json()).records.some((r) => r.kind === "route"),
    false,
    "legacy snapshot excludes routes",
  );
  check(
    (await (await req("/api/v1/sync", a, "GET", undefined, support)).json()).records.some(
      (r) => r.kind === "route",
    ),
    true,
    "capable snapshot contains routes",
  );
  check(
    (await req("/api/v1/sync", a, "POST", "x".repeat(8193), support)).status,
    413,
    "ordinary mutation cap unchanged",
  );
  const sharePath = "/api/v1/route-shares/route-fixture";
  check((await req(sharePath, b, "POST", {})).status, 404, "share ownership");

  const create = async (who = a, headers = {}) => {
    const response = await req(sharePath, who, "POST", {}, headers);
    check(response.status, 200, "share creation");

    return (await response.json()).token;
  };

  const read = (token, who) =>
    req("/api/v1/route-share", who, "GET", undefined, { "X-Places-Route-Token": token });

  const token = await create();
  check(
    (await req("/api/v1/route-share", a)).status,
    404,
    "cookies do not authorize anonymous reads",
  );
  const publicRead = await read(token, b);
  check(publicRead.status, 200, "bearer works independent of session");
  const snapshot = await publicRead.json();
  check(
    Object.keys(snapshot).sort(),
    ["category", "geometry", "route", "version"],
    "snapshot excludes account and private status",
  );
  const replacement = await create();
  check((await read(token)).status, 404, "replacement revokes previous token");
  check((await read(replacement)).status, 200, "replacement reads");
  check(
    (
      await db
        .prepare("SELECT count(*) n FROM places_route_snapshots WHERE publisher=?")
        .bind(a.account)
        .first()
    ).n,
    1,
    "identical snapshots deduplicate",
  );
  check((await req(sharePath, a, "DELETE")).status, 200, "revoke");
  check((await read(replacement)).status, 404, "revoked bearer denied");
  const deletedToken = await create();
  await db
    .prepare("UPDATE places_records SET deleted=1 WHERE account_id=? AND id='route-fixture'")
    .bind(a.account)
    .run();
  check((await read(deletedToken)).status, 404, "source deletion blocks reads");
  await db
    .prepare("UPDATE places_records SET deleted=0 WHERE account_id=? AND id='route-fixture'")
    .bind(a.account)
    .run();
  const group = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO places_accounts(id,created_at) VALUES(?,1)").bind(group),
    db
      .prepare(
        "INSERT INTO places_families(id,name,owner_id,created_at) VALUES(?,'Route group',?,1)",
      )
      .bind(group, b.account),
    db
      .prepare(
        "INSERT INTO places_family_members(family_id,account_id,joined_at) VALUES(?,?,1),(?,?,1)",
      )
      .bind(group, a.account, group, b.account),
    db
      .prepare(
        "INSERT INTO places_geometry SELECT ?,id,bytes,data,summary FROM places_geometry WHERE account_id=?",
      )
      .bind(group, a.account),
    db
      .prepare(
        "INSERT INTO places_records SELECT ?,id,kind,value,revision,deleted,last_mutation FROM places_records WHERE account_id=?",
      )
      .bind(group, a.account),
  ]);
  const groupToken = await create(a, { "X-Places-Family": group });
  await db
    .prepare("DELETE FROM places_family_members WHERE family_id=? AND account_id=?")
    .bind(group, a.account)
    .run();
  check((await read(groupToken)).status, 404, "membership loss blocks read");
  await db.prepare("INSERT INTO places_family_members VALUES(?,?,1)").bind(group, a.account).run();
  check(
    (await req(sharePath, b, "DELETE", undefined, { "X-Places-Family": group })).status,
    200,
    "owner may revoke other publisher",
  );
  check((await read(groupToken)).status, 404, "owner revocation removes bearer");
  await db
    .prepare("DELETE FROM places_route_share_attempts WHERE publisher=?")
    .bind(a.account)
    .run();
  await db
    .prepare(
      "INSERT INTO places_records SELECT account_id,'route-copy',kind,value,revision,deleted,last_mutation FROM places_records WHERE account_id=? AND id='route-fixture'",
    )
    .bind(a.account)
    .run();
  const sameSnapshotToken = await create();
  const copiedShare = await req("/api/v1/route-shares/route-copy", a, "POST", {});
  check(copiedShare.status, 200, "second route snapshot link");
  const copiedToken = (await copiedShare.json()).token;
  check(
    (
      await db
        .prepare("SELECT count(*) n FROM places_route_snapshots WHERE publisher=?")
        .bind(a.account)
        .first()
    ).n,
    1,
    "two links share snapshot bytes",
  );
  await req(sharePath, a, "DELETE");
  check((await read(sameSnapshotToken)).status, 404, "one reference revoked");
  check((await read(copiedToken)).status, 200, "other snapshot reference survives revocation");
  const jpeg = await readFile("tests/fixtures/photo.jpg");
  const photoId = crypto.randomUUID();
  await mf.dispatchFetch(origin + `/api/v1/photos/${photoId}`, {
    method: "PUT",
    body: jpeg,
    headers: {
      Origin: origin,
      Cookie: a.cookie,
      "X-Places-Account": a.account,
      "Content-Type": "image/jpeg",
    },
  });
  await db
    .prepare("UPDATE places_records SET value=? WHERE account_id=? AND id='route-fixture'")
    .bind(JSON.stringify({ ...value, photoId }), a.account)
    .run();
  const photoToken = await create();
  check(
    (await (await read(photoToken)).json()).photo,
    "data:image/jpeg;base64," + jpeg.toString("base64"),
    "snapshot includes authorized JPEG",
  );
  await db
    .prepare(
      "WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<25) INSERT INTO places_geometry(account_id,id,bytes,data,summary) SELECT ?,printf('%064x',n),1048576,'{}','{}' FROM numbers",
    )
    .bind(b.account)
    .run();
  check(
    (await req(path, b, "PUT", geometry)).status,
    413,
    "workspace geometry quota includes retained attachments",
  );
  const ordinary = {
    name: "Capacity fixture",
    categoryId: "other",
    latitude: 0,
    longitude: 0,
    accuracy: null,
    capturedAt: value.capturedAt,
    updatedAt: value.updatedAt,
  };
  await db
    .prepare(
      "WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<4998) INSERT INTO places_records(account_id,id,kind,value,revision,deleted,last_mutation) SELECT ?,printf('p-%05d',n),'place',?,1,0,'fixture' FROM numbers",
    )
    .bind(a.account, JSON.stringify(ordinary))
    .run();
  check(
    (
      await req(
        "/api/v1/sync",
        a,
        "POST",
        {
          ...mutation,
          mutationId: crypto.randomUUID(),
          entity: { ...mutation.entity, id: "capacity-route" },
        },
        support,
      )
    ).status,
    413,
    "combined live places and routes enforce 5000",
  );
  await db
    .prepare(
      "WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<300) INSERT INTO places_records(account_id,id,kind,value,revision,deleted,last_mutation) SELECT ?,printf('p-%05d-route',n),'route',?,1,1,'fixture' FROM numbers",
    )
    .bind(a.account, JSON.stringify(value))
    .run();
  let cursor = "";
  let legacyCount = 0;
  do {
    const response = await req(`/api/v1/sync${cursor ? `?after=${cursor}` : ""}`, a);
    const page = await response.json();
    check(
      page.records.every((r) => r.kind !== "route" && r.id > cursor),
      true,
      "legacy SQL pagination skips interleaved routes",
    );
    legacyCount += page.records.length;
    cursor = page.nextCursor;
  } while (cursor);
  check(legacyCount, 4998, "legacy pagination reaches every ordinary record");
  await db
    .prepare("DELETE FROM places_route_share_attempts WHERE publisher=?")
    .bind(a.account)
    .run();
  let limited = false;
  for (let i = 0; i < 12; i++) {
    if ((await req(sharePath, a, "POST", {})).status === 429) {
      limited = true;
      break;
    }
  }
  check(limited, true, "ten attempts per rolling hour");
  check((await read(copiedToken)).status, 200, "active token before account deletion");
  await db.prepare("DELETE FROM places_family_members WHERE account_id=?").bind(a.account).run();
  await db.prepare("DELETE FROM places_accounts WHERE id=?").bind(a.account).run();
  check((await read(copiedToken)).status, 404, "account deletion blocks reads");
  console.log(`${checks} route API/migration checks passed.`);
} finally {
  await mf.dispose();
}
