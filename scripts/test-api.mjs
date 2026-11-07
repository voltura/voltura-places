import { Miniflare, convertV4MiniflareOptions, Response as WorkerResponse } from "miniflare";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

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
      LANTMATERIET_CLIENT_ID: "map-search-fixture",
      LANTMATERIET_CLIENT_SECRET: "map-search-fixture",
    },
    outboundService: (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/oauth2/token" && url.hostname === "apimanager.lantmateriet.se") {
        return WorkerResponse.json({
          access_token: "fixture-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url.pathname.endsWith("/kriterier") && url.hostname === "api.lantmateriet.se") {
        return WorkerResponse.json({ type: "FeatureCollection", features: [] });
      }

      return new WorkerResponse(null, { status: 502 });
    },
  }),
);
let checks = 0;

const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};

try {
  const html = await readFile(".artifacts/client/index.html", "utf8");
  const mainPath = html.match(/<script[^>]*src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1];
  assert.ok(mainPath);
  const asset = await mf.dispatchFetch(origin + mainPath);
  check(asset.status === 200, "The runtime serves the embedded main script");
  check(
    Buffer.from(await asset.arrayBuffer()).equals(await readFile(".artifacts/client" + mainPath)),
    "Native decoding preserves the exact validated asset bytes",
  );
  const head = await mf.dispatchFetch(origin + mainPath, { method: "HEAD" });
  check(
    head.status === 200 &&
      (await head.arrayBuffer()).byteLength === 0 &&
      head.headers.get("Content-Type") === asset.headers.get("Content-Type"),
    "HEAD retains asset headers with no binary body",
  );
  const db = await mf.getD1Database("DB");
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const { tag } of journal.entries) {
    const file = tag + ".sql";
    if (file === "0010_runtime_maintenance.sql") {
      await db
        .prepare(
          "INSERT INTO places_family_codes(family_id,code_hash,expires_at) VALUES('migration-family','legacy-fixture-hash',0)",
        )
        .run();
    }
    if (file === "0005_multiple_groups.sql") {
      await db.batch([
        db.prepare(
          "INSERT INTO places_accounts(id,created_at) VALUES('migration-owner',1),('migration-family',1)",
        ),
        db.prepare(
          "INSERT INTO places_families(id,name,owner_id,created_at) VALUES('migration-family','Existing group','migration-owner',1)",
        ),
        db.prepare(
          "INSERT INTO places_family_members(family_id,account_id,joined_at) VALUES('migration-family','migration-owner',1)",
        ),
      ]);
    }
    for (const statement of (await readFile(`drizzle/${file}`, "utf8"))
      .split("--> statement-breakpoint")
      .filter((s) => s.trim())) {
      await db.prepare(statement).run();
    }
  }
  const mapSearch = await mf.dispatchFetch(origin + "/api/v1/map-search", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "Slåboda" }),
  });
  check(
    mapSearch.ok && Array.isArray((await mapSearch.json()).results),
    "The built Worker can query the map provider using D1 and runtime fetch",
  );
  for (const sql of [
    "SELECT count(*) FROM places_records WHERE account_id='index-fixture' AND kind='place' AND deleted=0",
    "SELECT count(*) FROM places_records WHERE account_id='index-fixture' AND kind='category' AND deleted=0",
    "SELECT count(*) FROM places_records WHERE kind='place' AND deleted=0",
    "SELECT count(*) FROM places_visits WHERE account_id='index-fixture' AND deleted=0",
  ]) {
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    check(
      plan.results.some((row) => row.detail.includes("COVERING INDEX")),
      "Record counts use a covering index instead of scanning deletion history",
    );
  }
  check(
    (await db
      .prepare(
        "SELECT generation FROM places_family_codes WHERE family_id='migration-family' AND code_hash='legacy-fixture-hash'",
      )
      .first("generation")) === "",
    "Existing invitations retain their legacy version through the schema migration",
  );
  const photoCapacityPlan = await db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT COUNT(*) < 1000 AND COALESCE(SUM(bytes),0)+100<=52428800 FROM places_photos WHERE account_id='index-fixture'",
    )
    .all();
  check(
    photoCapacityPlan.results.some((row) =>
      row.detail.includes("COVERING INDEX places_photos_capacity"),
    ),
    "Photo capacity is decided by a single covering-index scan",
  );
  check(
    !!(await db
      .prepare(
        "SELECT 1 FROM places_family_members WHERE family_id='migration-family' AND account_id='migration-owner'",
      )
      .first()),
    "Multiple-group migration preserves existing memberships",
  );

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

  const a = await login("fixture-a");
  const b = await login("fixture-b");
  check(a.account !== b.account, "Accounts are isolated");
  const photoId = crypto.randomUUID();
  const jpeg = await readFile("tests/fixtures/photo.jpg");

  const photoRequest = (identity, body = jpeg, extra = {}) =>
    mf.dispatchFetch(origin + `/api/v1/photos/${photoId}`, {
      method: "PUT",
      body,
      headers: {
        Origin: origin,
        Cookie: identity.cookie,
        "X-Places-Account": identity.account,
        "Content-Type": "image/jpeg",
        ...extra,
      },
    });

  check(
    (await request(`/api/v1/photos/${photoId}`)).status === 401,
    "Photos require authentication",
  );
  check(
    (await photoRequest(a, jpeg, { Origin: "https://evil.invalid" })).status === 403,
    "Photo uploads reject foreign origins",
  );
  check(
    (await photoRequest(a, new Uint8Array(262145))).status === 413,
    "Photo uploads are bounded",
  );
  check((await photoRequest(a, new Uint8Array(20))).status === 422, "Invalid JPEG is rejected");
  const fakeJpeg = new Uint8Array(22);
  fakeJpeg.set([255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 1]);
  fakeJpeg[20] = 255;
  fakeJpeg[21] = 217;
  check(
    (await photoRequest(a, fakeJpeg)).status === 422,
    "SOF-only fake JPEG uploads are rejected",
  );
  check((await photoRequest(a)).status === 200, "Photo upload persists in D1");
  check(
    (await photoRequest(a, jpeg, { "Content-Type": "Image/JPEG; fixture=yes" })).status === 200,
    "JPEG media types are case insensitive and accept parameters",
  );
  check(
    (await request(`/api/v1/photos/extra/${photoId}`, a)).status === 400,
    "Nested paths cannot alias a saved photo",
  );
  const portablePhotoId = "019a0000-0000-7000-8000-000000000001";
  check(
    (
      await mf.dispatchFetch(origin + `/api/v1/photos/${portablePhotoId}`, {
        method: "PUT",
        body: jpeg,
        headers: {
          Origin: origin,
          Cookie: a.cookie,
          "X-Places-Account": a.account,
          "Content-Type": "image/jpeg",
        },
      })
    ).status === 200,
    "All UUID versions accepted by backups can synchronize photos",
  );
  check((await photoRequest(a)).status === 200, "Photo upload retries are idempotent");
  const changed = Buffer.from(jpeg);
  changed[10] ^= 1;
  check((await photoRequest(a, changed)).status === 409, "Immutable photos cannot be overwritten");
  const photoResponse = await request(`/api/v1/photos/${photoId}`, a);
  check(
    photoResponse.status === 200 && photoResponse.headers.get("Cache-Control").includes("no-store"),
    "Photo responses stay private",
  );
  assert.deepEqual(Buffer.from(await photoResponse.arrayBuffer()), jpeg);
  check(
    (await request(`/api/v1/photos/${photoId}`, b)).status === 404,
    "Other accounts cannot read photos",
  );
  check(
    (await request(`/api/v1/photos/${photoId}`, { ...a, account: b.account })).status === 409,
    "Photo account switching is guarded",
  );
  check((await request("/api/v1/sync")).status === 401, "Anonymous data is rejected");
  check(
    (await request("/api/v1/sync", { ...a, account: b.account })).status === 409,
    "Caller-supplied account ownership is rejected",
  );
  // Use an isolated account so catalog checks cannot change existing fixture counts.
  const appearanceAccount = await login("appearance-catalog");
  const appearanceCategory = {
    id: crypto.randomUUID(),
    kind: "category",
    value: {
      name: "Synthetic category",
      names: { en: "Synthetic category", sv: "Syntetisk kategori" },
      color: "cyan",
      icon: "none",
    },
  };
  const appearanceMutation = {
    version: 1,
    mutationId: crypto.randomUUID(),
    baseRevision: 0,
    deleted: false,
    entity: appearanceCategory,
  };
  const appearanceWrite = await request("/api/v1/sync", {
    ...appearanceAccount,
    body: appearanceMutation,
  });
  check(appearanceWrite.status === 200, "Expanded category appearance is accepted by the server");
  const appearanceSnapshot = await (await request("/api/v1/sync", appearanceAccount)).json();
  assert.deepEqual(
    appearanceSnapshot.records.find((r) => r.id === appearanceCategory.id)?.value,
    appearanceCategory.value,
  );
  check(true, "Expanded category appearance survives sync pull");
  for (const invalid of [
    { color: "unknown" },
    { icon: "unknown" },
    { names: {} },
    { names: { en: "" } },
    { names: { de: "Name" } },
    { names: { sv: "x".repeat(61) } },
  ]) {
    const rejected = await request("/api/v1/sync", {
      ...appearanceAccount,
      body: {
        ...appearanceMutation,
        mutationId: crypto.randomUUID(),
        entity: {
          ...appearanceCategory,
          id: crypto.randomUUID(),
          value: { ...appearanceCategory.value, ...invalid },
        },
      },
    });
    check(rejected.status === 422, "Unknown category appearance is rejected by the server");
  }
  check(
    (await request("/api/v1/sync", { ...appearanceAccount, account: b.account })).status === 409,
    "Expanded appearance cannot bypass account ownership",
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
  // Independent family identities exercise the same real authorization/CAS/photo path.
  const c = await login("fixture-c");
  let defaultGroup;
  const groupTargets = new Map();

  const familyCall = async (who, body) => {
    const targeted = body && !["create", "code-request"].includes(body.action);
    const scoped = targeted
      ? { ...body, familyId: body.familyId ?? groupTargets.get(who.account) ?? defaultGroup }
      : body;
    const response = await request("/api/family", { ...who, body: scoped });
    if (response.ok && body?.action === "create") {
      groupTargets.set(who.account, (await response.clone().json()).familyId);
    }
    if (response.ok && body?.action === "code-approve") {
      groupTargets.set(body.member, scoped.familyId);
    }

    return response;
  };

  check((await request("/api/family")).status === 401, "Family membership requires sign-in");
  check(
    (await familyCall(a, { action: "create", name: "Mushroom family" })).status === 200,
    "Create family",
  );
  const family = (await (await familyCall(a)).json()).families[0];
  defaultGroup = family.id;

  const familyAuth = (who) => ({
    ...who,
    headers: { "X-Places-Family": family.id, "X-Places-Photos": "1" },
  });

  const joinGroup = async (who, owner = a, id = family.id) => {
    await db
      .prepare("DELETE FROM places_family_code_limits WHERE key IN (?,?)")
      .bind(`create:account:${owner.account}`, `join:account:${who.account}`)
      .run();
    const generated = await familyCall(owner, { action: "code-create", familyId: id });
    assert.equal(generated.status, 200, await generated.clone().text());
    const generatedData = await generated.json();
    const code = generatedData.code;
    const ownerGroup = (await (await familyCall(owner)).json()).families.find((f) => f.id === id);
    check(
      /^[a-f0-9]{64}$/.test(generatedData.version) &&
        ownerGroup.invitationVersion === generatedData.version,
      "Owner sees an opaque active invitation version",
    );
    const requested = await familyCall(who, { action: "code-request", code });
    assert.equal(requested.status, 200, await requested.clone().text());
    const approved = await familyCall(owner, {
      action: "code-approve",
      familyId: id,
      member: who.account,
    });
    assert.equal(approved.status, 200, await approved.clone().text());
    const ownerAfter = (await (await familyCall(owner)).json()).families.find((f) => f.id === id);
    const memberAfter = (await (await familyCall(who)).json()).families.find((f) => f.id === id);
    check(
      ownerAfter.invitationVersion === null && !Object.hasOwn(memberAfter, "invitationVersion"),
      "Consumption clears the owner version and members receive no invitation metadata",
    );

    return approved;
  };

  check(
    (await request("/api/v1/sync", familyAuth(b))).status === 403,
    "Knowing group ID grants no access",
  );
  await joinGroup(b);
  check(
    (await (await familyCall(b)).json()).families[0].id === family.id,
    "Code request and owner approval add membership",
  );
  const familyPhoto = await photoRequest(a, jpeg, { "X-Places-Family": family.id });
  check(familyPhoto.status === 200, "Family photos use shared storage");
  const sharedEntity = {
    ...entity,
    id: crypto.randomUUID(),
    value: { ...entity.value, name: "Shared mushroom spot", photoId },
  };
  const sharedMutation = { ...mutation, mutationId: crypto.randomUUID(), entity: sharedEntity };
  response = await request("/api/v1/sync", { ...familyAuth(a), body: sharedMutation });
  check(response.status === 200, "Family place commits with its photo");

  // Personal metadata uses each member's own account, never the group storage identity.
  const makeVisit = (status) => {
    const id =
      "visit-" +
      createHash("sha256")
        .update(JSON.stringify([family.id, sharedEntity.id]))
        .digest("hex");

    return {
      version: 1,
      mutationId: crypto.randomUUID(),
      baseRevision: 0,
      deleted: false,
      entity: {
        id,
        kind: "visit",
        value: {
          placeId: sharedEntity.id,
          libraryId: family.id,
          status,
          updatedAt: new Date().toISOString(),
        },
      },
    };
  };

  const aVisit = makeVisit("visited");
  const bVisit = makeVisit("want");
  check(
    (await request("/api/v1/sync", { ...a, body: aVisit })).status === 200,
    "A group member saves a private visit status",
  );
  check(
    (await request("/api/v1/sync", { ...b, body: bVisit })).status === 200,
    "Another member independently saves a different status for the same place",
  );
  check(
    (await request("/api/v1/sync", { ...a, body: aVisit })).status === 200,
    "Personal status retries retain their exact receipt",
  );
  const privateA = await (await request("/api/v1/sync", a)).json();
  const privateB = await (await request("/api/v1/sync", b)).json();
  check(
    privateA.records.find((r) => r.id === aVisit.entity.id).value.status === "visited",
    "The first member reads only their own status",
  );
  check(
    privateB.records.find((r) => r.id === bVisit.entity.id).value.status === "want",
    "The second member reads only their own status",
  );
  const groupVisits = await (await request("/api/v1/sync", familyAuth(b))).json();
  check(
    groupVisits.records.every((r) => r.kind !== "visit"),
    "Group snapshots contain no personal statuses",
  );
  check(
    (
      await request("/api/v1/sync", {
        ...familyAuth(a),
        body: { ...aVisit, mutationId: crypto.randomUUID() },
      })
    ).status === 422,
    "Even group owners cannot write personal status into shared storage",
  );
  check(
    (await request("/api/v1/sync", { ...a, account: b.account, body: aVisit })).status === 409,
    "A personal status cannot target a different account",
  );
  const changedRetry = {
    ...aVisit,
    entity: { ...aVisit.entity, value: { ...aVisit.entity.value, status: "want" } },
  };
  check(
    (await request("/api/v1/sync", { ...a, body: changedRetry })).status === 422,
    "Changed personal retry bodies are rejected",
  );
  const staleVisit = { ...changedRetry, mutationId: crypto.randomUUID() };
  check(
    (await request("/api/v1/sync", { ...a, body: staleVisit })).status === 409,
    "Concurrent personal edits retain CAS conflicts",
  );
  for (const value of [
    { ...aVisit.entity.value, status: "other" },
    { ...aVisit.entity.value, libraryId: "invalid" },
  ]) {
    check(
      (
        await request("/api/v1/sync", {
          ...a,
          body: { ...aVisit, mutationId: crypto.randomUUID(), entity: { ...aVisit.entity, value } },
        })
      ).status === 422,
      "Invalid personal references or statuses are rejected",
    );
  }
  check(
    (
      await request("/api/v1/sync", {
        ...a,
        body: {
          ...aVisit,
          mutationId: crypto.randomUUID(),
          entity: { ...aVisit.entity, id: crypto.randomUUID() },
        },
      })
    ).status === 422,
    "Personal IDs are canonical and cannot duplicate the same reference",
  );

  const sharedSnapshot = await (await request("/api/v1/sync", familyAuth(b))).json();
  check(
    sharedSnapshot.accountId === `family:${b.account}:${family.id}` &&
      sharedSnapshot.records.some((r) => r.id === sharedEntity.id),
    "Other member receives account-partitioned shared snapshot",
  );
  check(
    !sharedSnapshot.records.some((r) => r.id === entity.id),
    "Private records are not exposed to family",
  );
  const sharedImage = await request(`/api/v1/photos/${photoId}`, familyAuth(b));
  check(
    sharedImage.status === 200 && Buffer.from(await sharedImage.arrayBuffer()).equals(jpeg),
    "Other member can retrieve shared photo",
  );
  check(
    (await request(`/api/v1/photos/${photoId}`, familyAuth(c))).status === 403,
    "Non-member cannot retrieve shared photos",
  );
  const editsShared = [a, b].map((who, i) =>
    request("/api/v1/sync", {
      ...familyAuth(who),
      body: {
        ...sharedMutation,
        mutationId: crypto.randomUUID(),
        baseRevision: 1,
        entity: { ...sharedEntity, value: { ...sharedEntity.value, name: `Shared edit ${i}` } },
      },
    }),
  );
  const sharedRace = await Promise.all(editsShared);
  check(
    sharedRace
      .map((r) => r.status)
      .sort()
      .join(",") === "200,409",
    "Concurrent family edits preserve conflicts",
  );
  check(
    (await familyCall(b, { action: "code-create" })).status === 403,
    "Members cannot create owner invitations",
  );
  check(
    (
      await request("/api/account", {
        ...a,
        method: "DELETE",
        body: { confirm: "delete-places-account" },
      })
    ).status === 409,
    "Owner account deletion requires ownership resolution",
  );
  check((await familyCall(b, { action: "leave" })).status === 200, "Member can leave");
  check(
    (await request("/api/v1/sync", familyAuth(b))).status === 403,
    "Leaving revokes cloud reads",
  );
  check(
    (await request(`/api/v1/photos/${photoId}`, familyAuth(b))).status === 403,
    "Leaving revokes photo reads",
  );
  check(
    (
      await request("/api/v1/sync", {
        ...familyAuth(b),
        body: { ...sharedMutation, mutationId: crypto.randomUUID(), baseRevision: 2 },
      })
    ).status === 403,
    "Leaving revokes cloud writes",
  );
  await joinGroup(b);
  check(
    (await familyCall(b, { action: "remove", member: a.account })).status === 403,
    "Members cannot remove the owner",
  );
  check(
    (await familyCall(c, { action: "remove", member: b.account, familyId: family.id })).status ===
      403,
    "Outsiders cannot remove participants",
  );
  check(
    (await familyCall(a, { action: "remove", member: a.account })).status === 422,
    "Owner cannot remove themselves",
  );
  await familyCall(a, { action: "remove", member: b.account });
  check(
    (await request("/api/v1/sync", familyAuth(b))).status === 403,
    "Owner removal revokes member access",
  );
  check(
    (await request(`/api/v1/photos/${photoId}`, familyAuth(b))).status === 403,
    "Removed members cannot read shared photos",
  );
  check(
    (
      await request("/api/v1/sync", {
        ...familyAuth(b),
        body: { ...sharedMutation, mutationId: crypto.randomUUID(), baseRevision: 2 },
      })
    ).status === 403,
    "Removed members cannot write shared records",
  );
  const capped = (await (await familyCall(a, { action: "code-create" })).json()).code;
  await familyCall(c, { action: "code-request", code: capped });
  const filler = [];
  for (let i = 0; i < 9; i++) {
    const id = crypto.randomUUID();
    filler.push(id);
    await db.batch([
      db.prepare("INSERT INTO places_accounts(id,created_at) VALUES(?,?)").bind(id, Date.now()),
      db
        .prepare("INSERT INTO places_family_members(family_id,account_id,joined_at) VALUES(?,?,?)")
        .bind(family.id, id, Date.now()),
    ]);
  }
  const fullApproval = await familyCall(a, { action: "code-approve", member: c.account });
  check(
    fullApproval.status === 409 && (await fullApproval.json()).error === "familyFull",
    "Full groups report capacity without incorrectly blaming a rotated code",
  );
  for (const id of filler) {
    await db.prepare("DELETE FROM places_accounts WHERE id=?").bind(id).run();
  }
  check(
    (await familyCall(a, { action: "code-approve", member: c.account })).status === 200,
    "Full-family refusal does not consume invitation",
  );
  await familyCall(a, { action: "transfer", member: c.account });
  check(
    (await familyCall(a, { action: "rename", name: "Former owner rename" })).status === 403,
    "Transferring ownership revokes rename permission",
  );
  check(
    (await familyCall(a, { action: "code-create" })).status === 403,
    "Transferred owner privileges are revoked",
  );
  check(
    (await familyCall(a, { action: "leave" })).status === 200,
    "Previous owner can leave after transfer",
  );
  check(
    (await familyCall(c, { action: "delete" })).status === 200,
    "Current owner can delete family",
  );
  check(
    (
      await db
        .prepare("SELECT count(*) AS n FROM places_records WHERE account_id=?")
        .bind(family.id)
        .first()
    ).n === 0 &&
      (
        await db
          .prepare("SELECT count(*) AS n FROM places_photos WHERE account_id=?")
          .bind(family.id)
          .first()
      ).n === 0,
    "Family deletion cascades only shared records/photos",
  );
  check(
    (await request(`/api/v1/photos/${photoId}`, a)).status === 200,
    "Family deletion preserves private photos",
  );
  response = await request("/api/account", { ...a, method: "DELETE", body: { confirm: "wrong" } });
  check(response.status === 400, "Account deletion requires its confirmation token");
  const photoEntity = { ...entity, id: crypto.randomUUID(), value: { ...entity.value, photoId } };
  const photoMutation = { ...mutation, mutationId: crypto.randomUUID(), entity: photoEntity };
  response = await request("/api/v1/sync", {
    ...a,
    body: photoMutation,
    headers: { "X-Places-Photos": "1" },
  });
  check(
    response.status === 200 && (await response.json()).record.value.photoId === photoId,
    "Photo references sync after upload",
  );
  const legacy = await (await request("/api/v1/sync", a)).json();
  check(
    !legacy.records.find((r) => r.id === photoEntity.id).value.photoId,
    "Old clients receive compatible records",
  );
  response = await request("/api/v1/sync", {
    ...a,
    body: {
      ...photoMutation,
      mutationId: crypto.randomUUID(),
      baseRevision: 1,
      entity: { ...photoEntity, value: entity.value },
    },
  });
  check(response.status === 200, "Old clients can edit photo records");
  const modern = await (
    await request("/api/v1/sync", { ...a, headers: { "X-Places-Photos": "1" } })
  ).json();
  check(
    modern.records.find((r) => r.id === photoEntity.id).value.photoId === photoId,
    "Old clients preserve attached photos",
  );
  response = await request("/api/v1/sync", {
    ...a,
    body: {
      ...photoMutation,
      mutationId: crypto.randomUUID(),
      entity: {
        ...photoEntity,
        id: crypto.randomUUID(),
        value: { ...photoEntity.value, photoId: crypto.randomUUID() },
      },
    },
  });
  check(response.status === 422, "Missing photo references are rejected");
  response = await request("/api/account", {
    ...a,
    method: "DELETE",
    body: { confirm: "delete-places-account" },
  });
  check(response.status === 200, "Account deletion completed");
  check(
    (
      await db
        .prepare("SELECT count(*) AS n FROM places_photos WHERE account_id=?")
        .bind(a.account)
        .first()
    ).n === 0,
    "Account deletion removes photos",
  );
  check(
    (
      await db
        .prepare("SELECT count(*) AS n FROM places_records WHERE account_id=?")
        .bind(a.account)
        .first()
    ).n === 0,
    "Account deletion cascades data",
  );
  check(
    (
      await db
        .prepare("SELECT count(*) AS n FROM places_visits WHERE account_id=?")
        .bind(a.account)
        .first()
    ).n === 0,
    "Account deletion cascades personal visit statuses",
  );
  check((await request("/api/v1/sync", a)).status === 401, "Deleted sessions cannot read data");
  for (let start = 0; start < 251; start += 25) {
    const batch = [];
    for (let i = start; i < Math.min(start + 25, 251); i++) {
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
    }
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
    finalPage.records.length === 2 &&
      finalPage.nextCursor === null &&
      finalPage.records.some((r) => r.kind === "visit" && r.value.status === "want"),
    "Paged reads preserve ordinary records and personal statuses across the boundary",
  );
  const codeOwner = await login("code-owner");
  const codeGuest = await login("code-guest");
  const codeOther = await login("code-other");
  await familyCall(codeOwner, { action: "create", name: "Code family" });
  const codeFamily = (await (await familyCall(codeOwner)).json()).families[0];

  const generateCode = async () => {
    const result = await familyCall(codeOwner, { action: "code-create" });
    check(result.status === 200, "Owner can generate a short code");
    const data = await result.json();
    check(/^\d{4}$/.test(data.code) && data.expiresAt === 0, "Four-digit codes have no time limit");

    return data.code;
  };

  const code = await generateCode();
  check(
    (await familyCall(codeGuest, { action: "code-create" })).status === 403,
    "Only the owner generates codes",
  );
  check(
    (await familyCall(codeGuest, { action: "code-request", code })).status === 200,
    "Entering a code creates a request",
  );
  await db
    .prepare("UPDATE places_family_requests SET created_at=created_at-? WHERE account_id=?")
    .bind(7 * 86400000, codeGuest.account)
    .run();
  const pendingState = await (await familyCall(codeGuest)).json();
  check(
    pendingState.families.length === 0 && pendingState.pendingRequest.expiresAt === 0,
    "A week-old request stays pending without granting membership or revealing family details",
  );
  check(
    (await request("/api/v1/sync", { ...codeGuest, headers: { "X-Places-Family": codeFamily.id } }))
      .status === 403,
    "Pending requests cannot read locations",
  );
  check(
    (await (await familyCall(codeOwner)).json()).families[0].requests[0].id === codeGuest.account,
    "Owner can verify the requesting identity",
  );
  check(
    (await familyCall(codeOther, { action: "code-approve", member: codeGuest.account })).status ===
      403,
    "A different account cannot approve requests",
  );
  check(
    (await familyCall(codeOwner, { action: "code-approve", member: codeGuest.account })).status ===
      200,
    "Explicit owner approval grants access",
  );
  check(
    (await (await familyCall(codeGuest)).json()).families[0].id === codeFamily.id,
    "Approved recipient sees shared library in their existing app session",
  );
  check(
    (await familyCall(codeOther, { action: "code-request", code })).status === 410,
    "Approved code is consumed",
  );
  const oldCode = await generateCode();
  const newCode = await generateCode();
  check(
    (await familyCall(codeOther, { action: "code-request", code: oldCode })).status === 410,
    "Rotation invalidates old codes",
  );
  check(
    (await familyCall(codeOther, { action: "code-request", code: newCode })).status === 200,
    "Fresh code supports a new request",
  );
  await familyCall(codeOwner, { action: "code-reject", member: codeOther.account });
  check(
    (await (await familyCall(codeOther)).json()).pendingRequest === null,
    "Declining clears the request without granting access",
  );
  await familyCall(codeOther, { action: "code-request", code: newCode });
  await familyCall(codeOwner, { action: "revoke" });
  check(
    (await familyCall(codeOwner, { action: "code-approve", member: codeOther.account })).status ===
      409,
    "Cancellation prevents later approval",
  );
  const expiringCode = await generateCode();
  const expiryGuest = await login("expiry-code-guest");
  await familyCall(expiryGuest, { action: "code-request", code: expiringCode });
  await db
    .prepare("UPDATE places_family_codes SET expires_at=1 WHERE family_id=?")
    .bind(codeFamily.id)
    .run();
  check(
    (await familyCall(codeOwner, { action: "code-approve", member: expiryGuest.account }))
      .status === 409,
    "Expired requests cannot be approved",
  );
  const limitedGuest = await login("limited-code-guest");
  check(
    (await familyCall(limitedGuest, { action: "code-request" })).status === 422,
    "Missing codes do not consume a guess",
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    check(
      (await familyCall(limitedGuest, { action: "code-request", code: expiringCode })).status ===
        410,
      "Invalid attempts are bounded",
    );
  }
  check(
    (await familyCall(limitedGuest, { action: "code-request", code: expiringCode })).status === 429,
    "Sixth code attempt is blocked",
  );
  // Reset only the disposable test owner's creation counter for contention tests.
  await db
    .prepare("DELETE FROM places_family_code_limits WHERE key=?")
    .bind(`create:account:${codeOwner.account}`)
    .run();
  const raceCode = await generateCode();
  const racers = [await login("code-racer-a"), await login("code-racer-b")];
  for (const who of racers) {
    await familyCall(who, { action: "code-request", code: raceCode });
  }
  const approvals = await Promise.all(
    racers.map((who) => familyCall(codeOwner, { action: "code-approve", member: who.account })),
  );
  check(
    approvals
      .map((r) => r.status)
      .sort()
      .join(",") === "200,409",
    "Concurrent approvals consume a code once",
  );
  check(
    (await (await familyCall(codeOwner)).json()).families[0].members.length === 3,
    "Only one racing request gets access",
  );
  const anotherGroupState = await (
    await familyCall(codeOwner, { action: "create", name: "Mother's group" })
  ).json();
  const anotherGroup = anotherGroupState.families.find((f) => f.id === anotherGroupState.familyId);
  check(
    anotherGroup.id !== codeFamily.id && anotherGroupState.families.length === 2,
    "An account can own multiple independent groups",
  );
  await joinGroup(codeGuest, codeOwner, anotherGroup.id);
  for (const name of [undefined, "", "   ", "x".repeat(81)]) {
    check(
      (await familyCall(codeOwner, { action: "rename", familyId: anotherGroup.id, name }))
        .status === 422,
      "Group rename rejects missing, blank and oversized names",
    );
  }
  check(
    (await familyCall(codeGuest, { action: "rename", familyId: anotherGroup.id, name: "Denied" }))
      .status === 403,
    "Members cannot rename a group",
  );
  const renameOutsider = await login("rename-outsider");
  check(
    (
      await familyCall(renameOutsider, {
        action: "rename",
        familyId: anotherGroup.id,
        name: "Denied",
      })
    ).status === 403,
    "Nonmembers cannot rename a group",
  );
  const renamedResponse = await familyCall(codeOwner, {
    action: "rename",
    familyId: anotherGroup.id,
    name: "  Renamed group åäö  ",
  });
  const renamedState = await renamedResponse.json();
  const renamedGroup = renamedState.families.find((group) => group.id === anotherGroup.id);
  check(
    renamedResponse.status === 200 &&
      renamedGroup.name === "Renamed group åäö" &&
      renamedGroup.ownerId === anotherGroup.ownerId &&
      renamedGroup.members.length === 2 &&
      renamedState.families.find((group) => group.id === codeFamily.id).name === codeFamily.name,
    "Owner rename trims names and preserves group identity, ownership, membership and other groups",
  );
  check(
    (await (await familyCall(codeGuest)).json()).families.find(
      (group) => group.id === anotherGroup.id,
    ).name === "Renamed group åäö",
    "Members receive the renamed group from the server",
  );
  check(
    (await (await familyCall(codeGuest)).json()).families.length === 2,
    "All memberships are listed independently",
  );
  check(
    (await familyCall(codeGuest, { action: "delete", familyId: anotherGroup.id })).status === 403,
    "Administration is authorized for the selected group",
  );
  const groupEntity = {
    ...entity,
    id: crypto.randomUUID(),
    value: { ...entity.value, name: "Only in first group", photoId: null },
  };
  await request("/api/v1/sync", {
    ...codeOwner,
    headers: { "X-Places-Family": codeFamily.id },
    body: {
      version: 1,
      mutationId: crypto.randomUUID(),
      baseRevision: 0,
      deleted: false,
      entity: groupEntity,
    },
  });
  const otherRecords = await (
    await request("/api/v1/sync", { ...codeGuest, headers: { "X-Places-Family": anotherGroup.id } })
  ).json();
  check(
    !otherRecords.records.some((r) => r.id === groupEntity.id),
    "Places never leak between groups with overlapping members",
  );
  await familyCall(codeGuest, { action: "leave", familyId: codeFamily.id });
  check(
    (await request("/api/v1/sync", { ...codeGuest, headers: { "X-Places-Family": codeFamily.id } }))
      .status === 403,
    "Leaving one group revokes only its access",
  );
  check(
    (
      await request("/api/v1/sync", {
        ...codeGuest,
        headers: { "X-Places-Family": anotherGroup.id },
      })
    ).status === 200,
    "Other group membership survives leaving a group",
  );
  const maximumMember = await login("twenty-group-member");
  for (let i = 0; i < 20; i++) {
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO places_accounts(id,created_at) VALUES(?,?)").bind(id, Date.now()),
      db
        .prepare("INSERT INTO places_families(id,name,owner_id,created_at) VALUES(?,?,?,?)")
        .bind(id, `Fixture ${i}`, maximumMember.account, Date.now()),
      db
        .prepare("INSERT INTO places_family_members(family_id,account_id,joined_at) VALUES(?,?,?)")
        .bind(id, maximumMember.account, Date.now()),
    ]);
  }
  check(
    (await familyCall(maximumMember, { action: "create", name: "One too many" })).status === 409,
    "The twenty-group limit is enforced",
  );
  const recovery = await login("recovery-regressions");
  for (const path of ["/api/v1/sync", "/api/family"]) {
    for (const [body, type, expected] of [
      ["{", "application/json", 400],
      ["null", "application/json", 400],
      ["{}", "text/plain", 415],
      [JSON.stringify({ padding: "x".repeat(9000) }), "application/json", 413],
    ]) {
      const invalid = await mf.dispatchFetch(origin + path, {
        method: "POST",
        body,
        headers: {
          Origin: origin,
          Cookie: recovery.cookie,
          "X-Places-Account": recovery.account,
          "Content-Type": type,
        },
      });
      check(invalid.status === expected, `${path} returns ${expected} for invalid request input`);
    }
  }
  // A deletion must still be sendable when the live category library is full.
  await db.batch(
    Array.from({ length: 200 }, (_, i) =>
      db
        .prepare(
          "INSERT INTO places_records(account_id,id,kind,value,revision,deleted,last_mutation) VALUES(?,?,'category',?,1,0,?)",
        )
        .bind(
          recovery.account,
          `capacity-${i}`,
          JSON.stringify({ name: `Category ${i}`, color: "green" }),
          crypto.randomUUID(),
        ),
    ),
  );
  const unseenDeletion = {
    ...mutation,
    mutationId: crypto.randomUUID(),
    deleted: true,
    entity: {
      id: "never-uploaded",
      kind: "category",
      value: { name: "Removed offline", color: "green" },
    },
  };
  const deletionResponse = await request("/api/v1/sync", { ...recovery, body: unseenDeletion });
  check(
    deletionResponse.status === 200 && (await deletionResponse.json()).record.deleted,
    "Full libraries accept new deletion markers without consuming live capacity",
  );
  check(
    (await request("/api/v1/sync", { ...recovery, body: unseenDeletion })).status === 200,
    "Deletion markers at capacity retain idempotent receipts",
  );
  const overCapacity = { ...unseenDeletion, mutationId: crypto.randomUUID(), deleted: false };
  check(
    (await request("/api/v1/sync", { ...recovery, body: overCapacity })).status === 409,
    "Deletion support does not allow resurrection over live capacity",
  );
  const restoreAtCapacity = await request("/api/v1/sync", {
    ...recovery,
    body: { ...overCapacity, baseRevision: 1 },
  });
  check(
    restoreAtCapacity.status === 413 && (await restoreAtCapacity.json()).error === "libraryLimit",
    "Restoring the current tombstone at capacity defers a write without manufacturing a conflict",
  );
  const missingEdit = await request("/api/v1/sync", {
    ...recovery,
    body: {
      ...overCapacity,
      baseRevision: 7,
      entity: { ...overCapacity.entity, id: "absent-at-revision" },
    },
  });
  check(
    missingEdit.status === 422,
    "A nonzero revision for an absent record is not a capacity failure",
  );
  await db.prepare("DELETE FROM places_family_code_limits").run();
  const retryGroupResponse = await familyCall(recovery, {
    action: "create",
    name: "Invitation retry fixture",
  });
  const retryGroup = (await retryGroupResponse.json()).familyId;
  const retryCodeResponse = await familyCall(recovery, {
    action: "code-create",
    familyId: retryGroup,
  });
  check(retryCodeResponse.status === 200, "Retry fixture invitation is created");
  const retryCode = (await retryCodeResponse.json()).code;
  const applicants = [];
  for (let i = 0; i < 5; i++) {
    const applicant = await login(`pending-slot-${i}`);
    applicants.push(applicant);
    check(
      (await familyCall(applicant, { action: "code-request", code: retryCode })).status === 200,
      "Each available pending invitation slot accepts one account",
    );
  }
  check(
    (await familyCall(applicants[0], { action: "code-request", code: retryCode })).status === 200,
    "An existing applicant can retry when all pending slots are occupied",
  );
  const sixthApplicant = await login("pending-slot-extra");
  check(
    (await familyCall(sixthApplicant, { action: "code-request", code: retryCode })).status === 410,
    "Retry support does not exceed the five-applicant capacity",
  );
  const emptyFamilySnapshot = await (
    await request("/api/v1/sync", { ...recovery, headers: { "X-Places-Family": "" } })
  ).json();
  check(
    emptyFamilySnapshot.accountId === recovery.account && emptyFamilySnapshot.records.length > 0,
    "An empty optional group header reads the signed-in private library",
  );
  const emptyFamilyDeletion = {
    ...unseenDeletion,
    mutationId: crypto.randomUUID(),
    entity: { ...unseenDeletion.entity, id: "empty-family-deletion" },
  };
  check(
    (
      await request("/api/v1/sync", {
        ...recovery,
        headers: { "X-Places-Family": "" },
        body: emptyFamilyDeletion,
      })
    ).status === 200,
    "An empty optional group header cannot redirect private writes to an empty storage account",
  );
  check(
    (await request("/api/v1/sync?after=%00", recovery)).status === 400,
    "Malformed cursors cannot silently select an unrelated range",
  );
  // One applicant who has exhausted their own allowance cannot spend a shared IP's remaining guesses.
  const rateAccount = await login("rate-account-boundary");
  const ratePeer = await login("rate-peer-boundary");
  const ip = "192.0.2.99";
  const ipKey = "join:ip:" + createHash("sha256").update(ip).digest("hex");

  const limitedRequest = (who) =>
    request("/api/family", {
      ...who,
      headers: { "CF-Connecting-IP": ip },
      body: { action: "code-request", code: "9999" },
    });

  await db.batch([
    db
      .prepare("INSERT OR REPLACE INTO places_family_code_limits VALUES(?,5,?)")
      .bind("join:account:" + rateAccount.account, Date.now() + 60000),
    db
      .prepare("INSERT OR REPLACE INTO places_family_code_limits VALUES(?,19,?)")
      .bind(ipKey, Date.now() + 60000),
  ]);
  check(
    (await limitedRequest(rateAccount)).status === 429,
    "Exhausted account allowance rejects the request",
  );
  check(
    (await db
      .prepare("SELECT attempts FROM places_family_code_limits WHERE key=?")
      .bind(ipKey)
      .first("attempts")) === 19,
    "Denied account does not consume a shared IP guess",
  );
  check(
    (await limitedRequest(ratePeer)).status !== 429,
    "Another account can use the remaining shared IP attempt",
  );
  const blockedPeer = await login("rate-blocked-peer");
  check(
    (await limitedRequest(blockedPeer)).status === 429,
    "Exhausted shared IP rejects the request",
  );
  check(
    !(await db
      .prepare("SELECT 1 FROM places_family_code_limits WHERE key=?")
      .bind("join:account:" + blockedPeer.account)
      .first()),
    "Denied IP does not consume the account allowance",
  );

  const versionOwner = await login("version-owner");
  const versionGuest = await login("version-guest");
  const displayEndpoint = "/api/account/display-name";

  const setName = (who, displayName, headers = {}) =>
    request(displayEndpoint, { ...who, body: { displayName }, headers });

  check(
    (await (await request("/api/account", versionGuest)).json()).account.displayName === null,
    "Existing accounts have no display-name default",
  );
  check((await setName({}, "Anonymous")).status === 401, "Setting a name requires sign-in");
  check(
    (await setName({ ...versionGuest, account: versionOwner.account }, "Wrong user")).status ===
      409,
    "A changed session account cannot be renamed",
  );
  check(
    (await setName({ ...versionGuest, account: undefined }, "Absent expected account")).status ===
      409,
    "An expected account is required to rename",
  );
  check(
    (await setName(versionGuest, "Foreign", { Origin: "https://external.invalid" })).status === 403,
    "Cross-origin renaming is denied",
  );
  check(
    (await setName(versionGuest, "Scoped", { "X-Places-Family": crypto.randomUUID() })).status ===
      400,
    "A family header cannot redirect an account edit",
  );
  check(
    (
      await request(displayEndpoint, {
        ...versionGuest,
        body: { displayName: "Impersonation", accountId: versionOwner.account },
      })
    ).status === 422,
    "A body cannot target a different account",
  );
  const name = "Hiking " + String.fromCodePoint(0x1f392) + " " + String.fromCodePoint(0xc5);
  const nameResponse = await setName(versionGuest, "  " + name.normalize("NFD") + " ");
  const named = (await nameResponse.json()).account;
  check(
    nameResponse.ok &&
      named.displayName === name &&
      named.id === versionGuest.account &&
      named.methods[0].label === "version-guest@example.invalid",
    "Names normalize and trim independently of private verified identity labels",
  );
  for (const invalid of ["line\nbreak", "\u202eReversed", "a".repeat(61), false, {}]) {
    check(
      (await setName(versionGuest, invalid)).status === 422,
      "Invalid name leaves the account unchanged",
    );
  }
  check(
    (await (await request("/api/account", versionGuest)).json()).account.displayName === name,
    "Own account discovery retains the chosen name",
  );
  const versionId = (
    await (await familyCall(versionOwner, { action: "create", name: "Version test" })).json()
  ).familyId;
  const invite = await (
    await familyCall(versionOwner, { action: "code-create", familyId: versionId })
  ).json();
  await familyCall(versionGuest, { action: "code-request", code: invite.code });
  const joinedAtBeforeRetry = await db
    .prepare("SELECT created_at FROM places_family_requests WHERE account_id=?")
    .bind(versionGuest.account)
    .first("created_at");
  await familyCall(versionGuest, { action: "code-request", code: invite.code });
  check(
    (await db
      .prepare("SELECT created_at FROM places_family_requests WHERE account_id=?")
      .bind(versionGuest.account)
      .first("created_at")) === joinedAtBeforeRetry,
    "Retrying the same pending request retains its position in the owner queue",
  );
  const pendingNames = await (await familyCall(versionOwner)).json();
  check(
    pendingNames.families[0].requests[0].label === name &&
      !JSON.stringify(pendingNames).includes("version-guest@example.invalid"),
    "The owner sees the applicant's chosen label without their verified email",
  );
  const hidden = await (await familyCall(ratePeer)).json();
  check(
    !JSON.stringify(hidden).includes(name),
    "An unrelated account cannot see another group's applicant name",
  );
  await db
    .prepare("UPDATE places_family_codes SET generation=? WHERE family_id=?")
    .bind(crypto.randomUUID(), versionId)
    .run();
  for (const action of ["code-approve", "code-reject", "revoke"]) {
    const stale = await familyCall(versionOwner, {
      action,
      familyId: versionId,
      member: versionGuest.account,
      invitationVersion: invite.version,
    });
    check(
      stale.status === 409 && (await stale.json()).error === "familyCodeChanged",
      action + " cannot act on a replacement invitation with the same digits",
    );
  }
  const versionState = await (await familyCall(versionOwner)).json();
  check(
    versionState.families[0].requests.length === 1 &&
      versionState.families[0].invitationVersion !== invite.version,
    "Stale decisions preserve the new request and membership",
  );
  check(
    (
      await familyCall(versionOwner, {
        action: "code-approve",
        familyId: versionId,
        member: versionGuest.account,
        invitationVersion: versionState.families[0].invitationVersion,
      })
    ).ok,
    "Current invitation decision commits",
  );

  const groupMembers = async () =>
    (await (await familyCall(versionOwner)).json()).families[0].members;

  check(
    (await groupMembers()).find((m) => m.id === versionGuest.account).label === name,
    "Group membership uses the chosen name",
  );
  check(
    (await setName(versionOwner, name)).ok &&
      (await groupMembers()).filter((m) => m.label === name).length === 2,
    "Non-unique names retain distinct stable membership identities",
  );
  check(
    (await setName(versionGuest, "   ")).ok &&
      (await groupMembers()).find((m) => m.id === versionGuest.account).label ===
        "version-guest@example.invalid",
    "Clearing the name restores the existing membership label",
  );
  check((await setName(versionOwner, null)).ok, "Explicit null clears a display name");
  const renameResults = await Promise.all(
    ["First fixture", "Second fixture"].map(async (displayName) => [
      displayName,
      (await (await setName(versionGuest, displayName)).json()).account.displayName,
    ]),
  );
  check(
    renameResults.every(([sent, received]) => sent === received),
    "Concurrent profile writes acknowledge the name saved in their own transaction",
  );
  const history = await login("history-boundary");
  const archived = JSON.stringify({ name: "Archived", color: "green" });
  await db
    .prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<199998)
    INSERT INTO places_records(account_id,id,kind,value,revision,deleted,last_mutation) SELECT ?,printf('history-%d',n),'category',?,1,1,'seed' FROM seq`)
    .bind(history.account, archived)
    .run();
  await db
    .prepare(
      "INSERT INTO places_visits(account_id,id,kind,value,revision,deleted,last_mutation) VALUES(?,?,'visit',?,1,1,'seed')",
    )
    .bind(
      history.account,
      "visit-" + "0".repeat(64),
      JSON.stringify({
        placeId: "old",
        libraryId: null,
        status: "none",
        updatedAt: new Date().toISOString(),
      }),
    )
    .run();
  const historyWrites = ["final-one", "final-two"].map((id) => ({
    ...unseenDeletion,
    mutationId: crypto.randomUUID(),
    entity: { ...unseenDeletion.entity, id },
  }));
  const finalSlots = await Promise.all(
    historyWrites.map((body) => request("/api/v1/sync", { ...history, body })),
  );
  check(
    finalSlots.filter((r) => r.status === 200).length === 1,
    "Concurrent creations cannot exceed the remaining combined snapshot slot",
  );
  const blocked = finalSlots.find((r) => r.status === 413);
  check(
    blocked && (await blocked.json()).error === "snapshotLimit",
    "Full deletion history has a distinct non-deferrable limit",
  );
  const winner = historyWrites[finalSlots.findIndex((r) => r.ok)];
  check(
    (await request("/api/v1/sync", { ...history, body: winner })).ok,
    "History capacity permits exact receipt replay",
  );
  check(
    (
      await request("/api/v1/sync", {
        ...history,
        body: { ...winner, mutationId: crypto.randomUUID(), baseRevision: 1, deleted: false },
      })
    ).ok,
    "Existing identities remain editable when snapshot history is full",
  );
  const rosterOwner = await login("roster-signout-race");
  const rosterGroup = await (
    await familyCall(rosterOwner, { action: "create", name: "Race fixture" })
  ).json();
  await db
    .prepare(
      "CREATE TRIGGER fixture_signout_after_rename AFTER UPDATE OF name ON places_families BEGIN DELETE FROM places_sessions WHERE account_id=NEW.owner_id; END",
    )
    .run();
  const staleRoster = await familyCall(rosterOwner, {
    action: "rename",
    familyId: rosterGroup.familyId,
    name: "Updated fixture",
  });
  check(
    staleRoster.status === 401 && !(await staleRoster.json()).families,
    "Group responses do not disclose the roster after session revocation",
  );
  console.log(
    `Passed ${checks} real workerd/D1 authorization, CAS, retry and recovery checks. No production data or emails used.`,
  );
} finally {
  await mf.dispose();
}
