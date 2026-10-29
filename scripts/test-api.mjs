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
  for (const file of [
    "0000_accounts.sql",
    "0001_library.sql",
    "0002_photos.sql",
    "0003_families.sql",
    "0004_family_codes.sql",
    "0005_multiple_groups.sql",
    "0006_code_invitations_only.sql",
  ]) {
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
      .filter((s) => s.trim()))
      await db.prepare(statement).run();
  }
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
  const a = await login("fixture-a"),
    b = await login("fixture-b");
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
  check((await photoRequest(a)).status === 200, "Photo upload persists in D1");
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
    if (response.ok && body?.action === "create")
      groupTargets.set(who.account, (await response.clone().json()).familyId);
    if (response.ok && body?.action === "code-approve")
      groupTargets.set(body.member, scoped.familyId);
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
    const code = (await generated.json()).code;
    const requested = await familyCall(who, { action: "code-request", code });
    assert.equal(requested.status, 200, await requested.clone().text());
    const approved = await familyCall(owner, {
      action: "code-approve",
      familyId: id,
      member: who.account,
    });
    assert.equal(approved.status, 200, await approved.clone().text());
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
  await familyCall(a, { action: "remove", member: b.account });
  check(
    (await request("/api/v1/sync", familyAuth(b))).status === 403,
    "Owner removal revokes member access",
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
  check(
    (await familyCall(a, { action: "code-approve", member: c.account })).status === 409,
    "Family member limit is enforced",
  );
  for (const id of filler)
    await db.prepare("DELETE FROM places_accounts WHERE id=?").bind(id).run();
  check(
    (await familyCall(a, { action: "code-approve", member: c.account })).status === 200,
    "Full-family refusal does not consume invitation",
  );
  await familyCall(a, { action: "transfer", member: c.account });
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
  const codeOwner = await login("code-owner"),
    codeGuest = await login("code-guest"),
    codeOther = await login("code-other");
  await familyCall(codeOwner, { action: "create", name: "Code family" });
  const codeFamily = (await (await familyCall(codeOwner)).json()).families[0];
  const generateCode = async () => {
    const result = await familyCall(codeOwner, { action: "code-create" });
    check(result.status === 200, "Owner can generate a short code");
    const data = await result.json();
    check(
      /^\d{4}$/.test(data.code) &&
        data.expiresAt > Date.now() &&
        data.expiresAt <= Date.now() + 600000,
      "Four-digit codes expire within ten minutes",
    );
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
  const pendingState = await (await familyCall(codeGuest)).json();
  check(
    pendingState.families.length === 0 && pendingState.pendingRequest.expiresAt > Date.now(),
    "A request does not grant membership or reveal family details",
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
  const oldCode = await generateCode(),
    newCode = await generateCode();
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
    .prepare("UPDATE places_family_codes SET expires_at=0 WHERE family_id=?")
    .bind(codeFamily.id)
    .run();
  check(
    (await familyCall(codeOwner, { action: "code-approve", member: expiryGuest.account }))
      .status === 409,
    "Expired requests cannot be approved",
  );
  const limitedGuest = await login("limited-code-guest");
  for (let attempt = 0; attempt < 5; attempt++)
    check(
      (await familyCall(limitedGuest, { action: "code-request", code: expiringCode })).status ===
        410,
      "Invalid attempts are bounded",
    );
  check(
    (await familyCall(limitedGuest, { action: "code-request", code: expiringCode })).status === 429,
    "Sixth code attempt is blocked",
  );
  // Reset only the disposable test owner's creation counter for contention tests.
  await db
    .prepare("DELETE FROM places_family_code_limits WHERE key=?")
    .bind(`create:account:${codeOwner.account}`)
    .run();
  const raceCode = await generateCode(),
    racers = [await login("code-racer-a"), await login("code-racer-b")];
  for (const who of racers) await familyCall(who, { action: "code-request", code: raceCode });
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
  console.log(
    `Passed ${checks} real workerd/D1 authorization, CAS, retry and recovery checks. No production data or emails used.`,
  );
} finally {
  await mf.dispose();
}
