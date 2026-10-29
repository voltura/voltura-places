import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
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
      AUTH_SECRET: "isolated-integration-fixture-places-not-production",
      ACCOUNTS_ENABLED: "true",
      SITES_NATIVE_AUTH: "true",
    },
  }),
);
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
try {
  const db = await mf.getD1Database("DB");
  for (const file of ["0000_accounts.sql", "0001_library.sql"])
    for (const statement of (await readFile(`drizzle/${file}`, "utf8"))
      .split("--> statement-breakpoint")
      .filter((s) => s.trim()))
      await db.prepare(statement).run();
  const request = async (path, { body, cookie, account, headers = {}, method } = {}) =>
    mf.dispatchFetch(origin + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json", Origin: origin }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(account ? { "X-Places-Account": account } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const login = async (subject) => {
    const response = await request("/api/account/connect", {
      body: { provider: "chatgpt" },
      headers: {
        "oai-authenticated-user-id": subject,
        "oai-authenticated-user-email": `${subject}@example.invalid`,
      },
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    return {
      account: data.account.id,
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  };
  const a = await login("fixture-a"),
    b = await login("fixture-b");
  check(a.account !== b.account, "Accounts are isolated");
  check((await request("/api/v1/sync")).status === 401, "Anonymous data is rejected");
  check(
    (await request("/api/v1/sync", { ...a, account: b.account })).status === 409,
    "Caller-supplied account ownership is rejected",
  );
  const entity = {
    id: crypto.randomUUID(),
    kind: "place",
    value: {
      name: "Synthetic trailhead",
      latitude: 59,
      longitude: 18,
      categoryId: "other",
      accuracy: 5,
      capturedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  const mutation = {
    version: 1,
    mutationId: crypto.randomUUID(),
    baseRevision: 0,
    deleted: false,
    entity,
  };
  let response = await request("/api/v1/sync", { ...a, body: mutation });
  let result = await response.json();
  check(response.status === 200 && result.record.revision === 1, "New record committed");
  response = await request("/api/v1/sync", { ...a, body: mutation });
  check(
    response.status === 200 && (await response.json()).record.revision === 1,
    "Lost-response retry returns the same revision",
  );
  response = await request("/api/v1/sync", { ...a, body: { ...mutation, deleted: true } });
  check(response.status === 422, "Same mutation ID cannot change its body");
  response = await request("/api/v1/sync", { ...b });
  check((await response.json()).records.length === 0, "Other accounts cannot read records");
  response = await request("/api/v1/sync", {
    ...a,
    body: { ...mutation, mutationId: crypto.randomUUID() },
    headers: { Origin: "https://evil.invalid" },
  });
  check(response.status === 403, "Cross-origin writes rejected");
  const edits = ["A", "B"].map((name) => ({
    ...mutation,
    mutationId: crypto.randomUUID(),
    baseRevision: 1,
    entity: { ...entity, value: { ...entity.value, name } },
  }));
  const racing = await Promise.all(edits.map((body) => request("/api/v1/sync", { ...a, body })));
  check(
    racing
      .map((r) => r.status)
      .sort()
      .join(",") === "200,409",
    "Concurrent edits have one CAS winner and a preserved conflict",
  );
  response = await request("/api/v1/sync", {
    ...a,
    body: { ...mutation, mutationId: crypto.randomUUID(), baseRevision: 2, deleted: true },
  });
  check(
    response.status === 200 && (await response.json()).record.deleted,
    "Deletion creates a tombstone",
  );
  response = await request("/api/v1/sync", {
    ...a,
    body: { ...mutation, mutationId: crypto.randomUUID(), baseRevision: 1 },
  });
  result = await response.json();
  check(
    response.status === 409 && result.record.deleted,
    "A stale offline writer cannot resurrect a deletion",
  );
  const second = {
    ...mutation,
    entity: { ...entity, id: crypto.randomUUID() },
    mutationId: crypto.randomUUID(),
  };
  const duplicate = await Promise.all([
    request("/api/v1/sync", { ...a, body: second }),
    request("/api/v1/sync", { ...a, body: second }),
  ]);
  check(
    duplicate.every((r) => r.status === 200),
    "Simultaneous identical retries are idempotent",
  );
  response = await request("/api/v1/sync", {
    ...a,
    body: {
      ...mutation,
      mutationId: crypto.randomUUID(),
      entity: { ...entity, value: { ...entity.value, latitude: 91 } },
    },
  });
  check(response.status === 422, "Coordinate validation is enforced server-side");
  response = await request("/api/account", { ...a, method: "DELETE", body: { confirm: "wrong" } });
  check(response.status === 400, "Account deletion requires its confirmation token");
  response = await request("/api/account", {
    ...a,
    method: "DELETE",
    body: { confirm: "delete-places-account" },
  });
  check(response.status === 200, "Account deletion completed");
  check(
    (
      await db
        .prepare("SELECT count(*) AS n FROM places_records WHERE account_id=?")
        .bind(a.account)
        .first()
    ).n === 0,
    "Account deletion cascades data",
  );
  check((await request("/api/v1/sync", a)).status === 401, "Deleted sessions cannot read data");
  for (let start = 0; start < 251; start += 25) {
    const batch = [];
    for (let i = start; i < Math.min(start + 25, 251); i++)
      batch.push(
        db
          .prepare(
            "INSERT INTO places_records(account_id,id,kind,value,revision,deleted,last_mutation) VALUES(?,?,?,?,1,0,?)",
          )
          .bind(
            b.account,
            `page-${String(i).padStart(4, "0")}`,
            "place",
            JSON.stringify(entity.value),
            crypto.randomUUID(),
          ),
      );
    await db.batch(batch);
  }
  const firstPage = await (await request("/api/v1/sync", b)).json();
  check(
    firstPage.records.length === 250 && !!firstPage.nextCursor,
    "Sync reads are bounded and expose the next cursor",
  );
  const finalPage = await (
    await request(`/api/v1/sync?after=${encodeURIComponent(firstPage.nextCursor)}`, b)
  ).json();
  check(
    finalPage.records.length === 1 && finalPage.nextCursor === null,
    "Paged reads preserve the final record",
  );
  console.log(
    `Passed ${checks} real workerd/D1 authorization, CAS, retry and recovery checks. No production data or emails used.`,
  );
} finally {
  await mf.dispose();
}
