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
  ])
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
  const familyCall = (who, body) => request("/api/family", { ...who, body });
  check((await request("/api/family")).status === 401, "Family membership requires sign-in");
  check(
    (await familyCall(a, { action: "create", name: "Mushroom family" })).status === 200,
    "Create family",
  );
  const family = (await (await familyCall(a)).json()).family;
  const familyAuth = (who) => ({
    ...who,
    headers: { "X-Places-Family": family.id, "X-Places-Photos": "1" },
  });
  const invite = async () => (await (await familyCall(a, { action: "invite" })).json()).token;
  const oldInvite = await invite(),
    link = await invite();
  check(
    (await familyCall(b, { action: "preview", token: oldInvite })).status === 410,
    "New invitation invalidates previous link",
  );
  check(
    (await request("/api/v1/sync", familyAuth(b))).status === 403,
    "Knowing family ID grants no access",
  );
  check(
    (await familyCall(b, { action: "preview", token: link })).status === 200,
    "Invitation can be reviewed before joining",
  );
  check(
    (await familyCall(b, { action: "join", token: link })).status === 200,
    "Explicit acceptance adds member",
  );
  check(
    (await familyCall(b, { action: "join", token: link })).status === 200,
    "Lost-response join retries are safe",
  );
  check(
    (await familyCall(c, { action: "join", token: link })).status === 410,
    "Invitations are single-use",
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
    (await familyCall(b, { action: "invite" })).status === 403,
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
  await familyCall(b, { action: "join", token: await invite() });
  await familyCall(a, { action: "remove", member: b.account });
  check(
    (await request("/api/v1/sync", familyAuth(b))).status === 403,
    "Owner removal revokes member access",
  );
  const cancelled = await invite();
  await familyCall(a, { action: "revoke" });
  check(
    (await familyCall(c, { action: "join", token: cancelled })).status === 410,
    "Owner can cancel invitation",
  );
  const expired = await invite();
  await db
    .prepare("UPDATE places_family_invites SET expires_at=0 WHERE family_id=?")
    .bind(family.id)
    .run();
  check(
    (await familyCall(c, { action: "join", token: expired })).status === 410,
    "Expired invitations cannot join",
  );
  const capped = await invite();
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
    (await familyCall(c, { action: "join", token: capped })).status === 409,
    "Family member limit is enforced",
  );
  for (const id of filler)
    await db.prepare("DELETE FROM places_accounts WHERE id=?").bind(id).run();
  check(
    (await familyCall(c, { action: "join", token: capped })).status === 200,
    "Full-family refusal does not consume invitation",
  );
  await familyCall(a, { action: "transfer", member: c.account });
  check(
    (await familyCall(a, { action: "invite" })).status === 403,
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
  console.log(
    `Passed ${checks} real workerd/D1 authorization, CAS, retry and recovery checks. No production data or emails used.`,
  );
} finally {
  await mf.dispose();
}
