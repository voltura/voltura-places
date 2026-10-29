import { mutationSchema, recordSchema, type RecordState } from "../shared/model";
import { sessionFor, readJSON } from "./accounts.js";
import { digest } from "./auth.js";
import type { Environment } from "./types";

type Row = {
  id: string;
  kind: "place" | "category";
  value: string;
  revision: number;
  deleted: number;
};
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
const decode = (r: Row): RecordState =>
  recordSchema.parse({
    id: r.id,
    kind: r.kind,
    value: JSON.parse(r.value),
    revision: r.revision,
    deleted: !!r.deleted,
  });
export async function handleSync(request: Request, env: Environment) {
  const session = (await sessionFor(request, env, env.DB)) as { account_id: string } | null;
  if (!session) return json({ error: "signInAgain" }, 401);
  const account = session.account_id;
  const present = (record: RecordState) => {
    if (request.headers.get("X-Places-Photos") !== "1" && record.kind === "place") {
      const value = { ...record.value };
      delete value.photoId;
      return { ...record, value };
    }
    return record;
  };
  if (request.headers.get("X-Places-Account") !== account)
    return json({ error: "accountChanged" }, 409);
  if (request.method === "GET") {
    const after = new URL(request.url).searchParams.get("after") ?? "";
    if (after.length > 80) return json({ error: "invalidCursor", accountId: account }, 400);
    const rows = await env.DB.prepare(
      "SELECT id,kind,value,revision,deleted FROM places_records WHERE account_id = ? AND id > ? ORDER BY id LIMIT 251",
    )
      .bind(account, after)
      .all<Row>();
    const records = rows.results.slice(0, 250);
    return json({
      version: 1,
      accountId: account,
      records: records.map((r) => present(decode(r))),
      nextCursor: rows.results.length > 250 ? records.at(-1)!.id : null,
    });
  }
  if (request.method !== "POST") return json({ error: "methodNotAllowed" }, 405);
  if (
    request.headers.get("Origin") !== env.AUTH_ORIGIN ||
    new URL(request.url).origin !== env.AUTH_ORIGIN ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    return json({ error: "invalidOrigin" }, 403);
  const parsed = mutationSchema.safeParse(await readJSON(request, 8192));
  if (!parsed.success) return json({ error: "invalidMutation", accountId: account }, 422);
  const body = parsed.data,
    hash = await digest(JSON.stringify(body)),
    e = body.entity;
  if (e.id === "other" && (e.kind !== "category" || body.deleted))
    return json({ error: "invalidMutation", accountId: account }, 422);
  const receipt = await env.DB.prepare(
    "SELECT body_hash,record FROM places_receipts WHERE account_id = ? AND mutation_id = ?",
  )
    .bind(account, body.mutationId)
    .first<{ body_hash: string; record: string }>();
  if (receipt) {
    if (receipt.body_hash !== hash) return json({ error: "invalidRetry", accountId: account }, 422);
    return json({
      accountId: account,
      record: present(recordSchema.parse(JSON.parse(receipt.record))),
    });
  }
  if (e.kind === "place" && e.value.photoId === undefined) {
    const old = await env.DB.prepare(
      "SELECT value FROM places_records WHERE account_id=? AND id=? AND kind='place'",
    )
      .bind(account, e.id)
      .first<{ value: string }>();
    const photoId = old ? JSON.parse(old.value).photoId : undefined;
    if (photoId !== undefined) e.value.photoId = photoId;
  }
  if (
    e.kind === "place" &&
    e.value.photoId &&
    !body.deleted &&
    !(await env.DB.prepare("SELECT id FROM places_photos WHERE account_id=? AND id=?")
      .bind(account, e.value.photoId)
      .first())
  )
    return json({ error: "photoUnavailable", accountId: account }, 422);
  const value = JSON.stringify(e.value),
    revision = body.baseRevision + 1;
  const resultRecord = { ...e, revision, deleted: body.deleted };
  const capacity = e.kind === "place" ? 5000 : 200;
  // Both statements run in one D1 transaction. Only the winning CAS can write a receipt.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO places_records(account_id,id,kind,value,revision,deleted,last_mutation)
      SELECT ?,?,?,?,?,?,? WHERE ?=0 AND NOT EXISTS(SELECT 1 FROM places_receipts WHERE account_id=? AND mutation_id=?)
      AND (SELECT count(*) FROM places_records WHERE account_id=? AND kind=? AND deleted=0) < ?
      ON CONFLICT(account_id,id) DO NOTHING`).bind(
      account,
      e.id,
      e.kind,
      value,
      revision,
      Number(body.deleted),
      body.mutationId,
      body.baseRevision,
      account,
      body.mutationId,
      account,
      e.kind,
      capacity,
    ),
    env.DB.prepare(`UPDATE places_records SET value=?,revision=?,deleted=?,last_mutation=? WHERE account_id=? AND id=? AND kind=? AND revision=?
      AND NOT EXISTS(SELECT 1 FROM places_receipts WHERE account_id=? AND mutation_id=?)
      AND (?=1 OR deleted=0 OR (SELECT count(*) FROM places_records WHERE account_id=? AND kind=? AND deleted=0) < ?)`).bind(
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
      account,
      e.kind,
      capacity,
    ),
    env.DB.prepare(`INSERT OR IGNORE INTO places_receipts(account_id,mutation_id,body_hash,record) SELECT ?,?,?,?
      WHERE EXISTS(SELECT 1 FROM places_records WHERE account_id=? AND id=? AND last_mutation=?)`).bind(
      account,
      body.mutationId,
      hash,
      JSON.stringify(resultRecord),
      account,
      e.id,
      body.mutationId,
    ),
  ]);
  const accepted = await env.DB.prepare(
    "SELECT body_hash,record FROM places_receipts WHERE account_id=? AND mutation_id=?",
  )
    .bind(account, body.mutationId)
    .first<{ body_hash: string; record: string }>();
  if (accepted) {
    if (accepted.body_hash !== hash)
      return json({ error: "invalidRetry", accountId: account }, 422);
    return json({
      accountId: account,
      record: present(recordSchema.parse(JSON.parse(accepted.record))),
    });
  }
  const current = await env.DB.prepare(
    "SELECT id,kind,value,revision,deleted FROM places_records WHERE account_id=? AND id=?",
  )
    .bind(account, e.id)
    .first<Row>();
  if (!current) return json({ error: "libraryLimit", accountId: account }, 413);
  return json({ accountId: account, record: present(decode(current)) }, 409);
}
