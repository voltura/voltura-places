import { entityLimits, syncLimits } from "../shared/limits";
import { visitEntity } from "../shared/visits";
import { idSchema, mutationSchema, recordSchema, type RecordState } from "../shared/model";
import { readJSON, RequestError, privateJSON as json, hasCanonicalOrigin } from "./http";
import { authorizedWorkspace, WorkspaceError, membershipSQL, membershipArgs } from "./workspace";
import { digest } from "../shared/digest";
import type { Environment } from "./types";

type Row = {
  id: string;
  kind: "place" | "category" | "visit";
  value: string;
  revision: number;
  deleted: number;
};

// Normal SQLite inserts allocate positive rowids. The two global maxima bound the
// combined history cheaply in small databases. Count only this workspace once
// the database could hold a full snapshot. The guard runs inside the INSERT.
const snapshotRoomSQL = `CASE WHEN
  coalesce((SELECT max(rowid) FROM places_records),0) + coalesce((SELECT max(rowid) FROM places_visits),0) < ${syncLimits.snapshotRecords}
  AND coalesce((SELECT min(rowid) FROM places_records),1)>0 AND coalesce((SELECT min(rowid) FROM places_visits),1)>0
  THEN 1 ELSE ((SELECT count(*) FROM places_records WHERE account_id=?) +
    (SELECT count(*) FROM places_visits WHERE account_id=?)) < ${syncLimits.snapshotRecords} END`;

const decode = (r: Row): RecordState =>
  recordSchema.parse({
    id: r.id,
    kind: r.kind,
    value: JSON.parse(r.value),
    revision: r.revision,
    deleted: !!r.deleted,
  });

export async function handleSync(request: Request, env: Environment) {
  let identity;
  try {
    identity = await authorizedWorkspace(request, env);
  } catch (error) {
    return json(
      { error: error instanceof WorkspaceError ? error.message : "serviceUnavailable" },
      error instanceof WorkspaceError ? error.status : 503,
    );
  }
  const account = identity.storage;

  const legacyPhotos = request.headers.get("X-Places-Photos") !== "1";

  const present = (record: RecordState) => {
    if (legacyPhotos && record.kind === "place" && record.value.photoId !== undefined) {
      const value = { ...record.value };
      delete value.photoId;

      return { ...record, value };
    }

    return record;
  };

  if (request.method === "GET") {
    const after = new URL(request.url).searchParams.get("after") ?? "";
    if (after && !idSchema.safeParse(after).success) {
      return json({ error: "invalidCursor", accountId: identity.key }, 400);
    }
    const rows = await env.DB.prepare(
      identity.family
        ? `SELECT id,kind,value,revision,deleted FROM places_records WHERE account_id = ? AND id > ? AND ${membershipSQL} ORDER BY id LIMIT ${syncLimits.pageSize + 1}`
        : `SELECT id,kind,value,revision,deleted FROM (SELECT id,kind,value,revision,deleted FROM places_records WHERE account_id=? UNION ALL SELECT id,kind,value,revision,deleted FROM places_visits WHERE account_id=?) WHERE id > ? AND ${membershipSQL} ORDER BY id LIMIT ${syncLimits.pageSize + 1}`,
    )
      .bind(
        ...(identity.family
          ? [account, after, ...membershipArgs(identity)]
          : [account, account, after, ...membershipArgs(identity)]),
      )
      .all<Row>();
    const records = rows.results.slice(0, syncLimits.pageSize);

    return json({
      version: 1,
      accountId: identity.key,
      records: records.map((r) => present(decode(r))),
      nextCursor: rows.results.length > syncLimits.pageSize ? records.at(-1)!.id : null,
    });
  }
  if (request.method !== "POST") {
    return json({ error: "methodNotAllowed" }, 405);
  }
  if (!hasCanonicalOrigin(request, env.AUTH_ORIGIN)) {
    return json({ error: "invalidOrigin" }, 403);
  }
  let input;
  try {
    input = await readJSON(request, 8192);
  } catch (error) {
    if (!(error instanceof RequestError)) {
      throw error;
    }

    return json({ error: "invalidMutation", accountId: identity.key }, error.status);
  }
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) {
    return json({ error: "invalidMutation", accountId: identity.key }, 422);
  }
  const body = parsed.data;
  const hash = await digest(JSON.stringify(body));
  const e = body.entity;
  if (e.kind === "visit") {
    const source = e.value.libraryId
      ? `family:${identity.account}:${e.value.libraryId}`
      : identity.account;
    if (
      identity.family ||
      e.id !== (await visitEntity(source, e.value.placeId, e.value.status)).id
    ) {
      return json({ error: "invalidMutation", accountId: identity.key }, 422);
    }
  } else if (e.id.startsWith("visit-")) {
    return json({ error: "invalidMutation", accountId: identity.key }, 422);
  }
  const table = e.kind === "visit" ? "places_visits" : "places_records";
  if (e.id === "other" && (e.kind !== "category" || body.deleted)) {
    return json({ error: "invalidMutation", accountId: identity.key }, 422);
  }
  const receipt = await env.DB.prepare(
    `SELECT body_hash,record FROM places_receipts WHERE account_id = ? AND mutation_id = ? AND ${membershipSQL}`,
  )
    .bind(account, body.mutationId, ...membershipArgs(identity))
    .first<{ body_hash: string; record: string }>();
  if (receipt) {
    if (receipt.body_hash !== hash) {
      return json({ error: "invalidRetry", accountId: identity.key }, 422);
    }

    return json({
      accountId: identity.key,
      record: present(recordSchema.parse(JSON.parse(receipt.record))),
    });
  }
  if (body.baseRevision > 0 && e.kind === "place" && e.value.photoId === undefined) {
    const old = await env.DB.prepare(
      "SELECT value FROM places_records WHERE account_id=? AND id=? AND kind='place'",
    )
      .bind(account, e.id)
      .first<{ value: string }>();
    const photoId = old ? JSON.parse(old.value).photoId : undefined;
    if (photoId !== undefined) {
      e.value.photoId = photoId;
    }
  }
  if (
    e.kind === "place" &&
    e.value.photoId &&
    !body.deleted &&
    !(await env.DB.prepare("SELECT id FROM places_photos WHERE account_id=? AND id=?")
      .bind(account, e.value.photoId)
      .first())
  ) {
    return json({ error: "photoUnavailable", accountId: identity.key }, 422);
  }
  const value = JSON.stringify(e.value);
  const revision = body.baseRevision + 1;
  const resultRecord = { ...e, revision, deleted: body.deleted };
  const capacity = entityLimits[e.kind];
  // visits.kind is constrained to 'visit' by the table. Omitting that redundant
  // predicate lets its existing (account_id,deleted) index cover the count.
  const liveCount =
    e.kind === "visit"
      ? "SELECT count(*) FROM places_visits WHERE account_id=? AND deleted=0"
      : "SELECT count(*) FROM places_records WHERE account_id=? AND kind=? AND deleted=0";
  const countArgs = e.kind === "visit" ? [account] : [account, e.kind];
  // Both statements run in one D1 transaction. Only the winning CAS can write a receipt.
  const write =
    body.baseRevision === 0
      ? env.DB.prepare(`INSERT INTO ${table}(account_id,id,kind,value,revision,deleted,last_mutation)
      SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM places_receipts WHERE account_id=? AND mutation_id=?)
      AND (?=1 OR (${liveCount}) < ?) AND ${membershipSQL} AND ${snapshotRoomSQL}
      ON CONFLICT(account_id,id) DO NOTHING`).bind(
          account,
          e.id,
          e.kind,
          value,
          revision,
          Number(body.deleted),
          body.mutationId,
          account,
          body.mutationId,
          Number(body.deleted),
          ...countArgs,
          capacity,
          ...membershipArgs(identity),
          account,
          account,
        )
      : env.DB.prepare(`UPDATE ${table} SET value=?,revision=?,deleted=?,last_mutation=? WHERE account_id=? AND id=? AND kind=? AND revision=?
      AND NOT EXISTS(SELECT 1 FROM places_receipts WHERE account_id=? AND mutation_id=?)
      AND (?=1 OR deleted=0 OR (${liveCount}) < ?) AND ${membershipSQL}`).bind(
          value,
          revision,
          Number(body.deleted),
          body.mutationId,
          account,
          e.id,
          e.kind,
          body.baseRevision,
          account,
          body.mutationId,
          Number(body.deleted),
          ...countArgs,
          capacity,
          ...membershipArgs(identity),
        );
  const saved = await env.DB.batch([
    write,
    env.DB.prepare(
      "INSERT INTO places_receipts(account_id,mutation_id,body_hash,record) SELECT ?,?,?,? WHERE changes()=1",
    ).bind(account, body.mutationId, hash, JSON.stringify(resultRecord)),
  ]);
  try {
    await authorizedWorkspace(request, env);
  } catch (error) {
    return json(
      { error: error instanceof WorkspaceError ? error.message : "serviceUnavailable" },
      error instanceof WorkspaceError ? error.status : 503,
    );
  }
  if (saved[1].meta.changes) {
    return json({ accountId: identity.key, record: present(resultRecord) });
  }
  const accepted = await env.DB.prepare(
    `SELECT body_hash,record FROM places_receipts WHERE account_id=? AND mutation_id=? AND ${membershipSQL}`,
  )
    .bind(account, body.mutationId, ...membershipArgs(identity))
    .first<{ body_hash: string; record: string }>();
  if (accepted) {
    if (accepted.body_hash !== hash) {
      return json({ error: "invalidRetry", accountId: identity.key }, 422);
    }

    return json({
      accountId: identity.key,
      record: present(recordSchema.parse(JSON.parse(accepted.record))),
    });
  }
  const current = await env.DB.prepare(
    `SELECT id,kind,value,revision,deleted FROM ${table} WHERE account_id=? AND id=? AND ${membershipSQL}`,
  )
    .bind(account, e.id, ...membershipArgs(identity))
    .first<Row>();
  if (!current && body.baseRevision > 0) {
    return json({ error: "invalidMutation", accountId: identity.key }, 422);
  }
  if (
    !current &&
    !(await env.DB.prepare(`SELECT ${snapshotRoomSQL} AS room`)
      .bind(account, account)
      .first<number>("room"))
  ) {
    return json({ error: "snapshotLimit", accountId: identity.key }, 413);
  }
  if (
    !current ||
    (current.deleted &&
      !body.deleted &&
      current.revision === body.baseRevision &&
      current.kind === e.kind)
  ) {
    return json({ error: "libraryLimit", accountId: identity.key }, 413);
  }

  return json({ accountId: identity.key, record: present(decode(current)) }, 409);
}
