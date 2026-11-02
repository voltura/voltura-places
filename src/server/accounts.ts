import { digest } from "../shared/digest";
import type { Environment } from "./types";
import { privateJSON as json, readJSON, RequestError } from "./http";
import { z } from "zod";
import { displayNameSchema } from "../shared/display-name";
import { createAuth, sendSignInCode, usableMailRelay } from "./auth";

type Database = D1Database | D1DatabaseSession;
type Provider = "chatgpt" | "google" | "email";
type SessionRow = { account_id: string; created_at: number; token_hash: string; is_member: number };
type LinkTicket = SessionRow & { provider: string };

const emailAddress = z.email().max(254);

const lifetime = 30 * 86400000;

function fail(status: number, message: string): never {
  throw new RequestError(status, message);
}

const token = () => crypto.randomUUID() + crypto.randomUUID();

const cookieName = (env: Environment, name: string) =>
  `${env.AUTH_ORIGIN?.startsWith("https:") ? "__Host-" : ""}places-${name}`;

const cookie = (env: Environment, name: string, value: string, maxAge: number) =>
  `${cookieName(env, name)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.AUTH_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`;

const readCookie = (request: Request, env: Environment, name: string) =>
  (request.headers.get("Cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName(env, name)}=`))
    ?.split("=")
    .slice(1)
    .join("=") || "";

export function accountConfiguration(env: Environment, request?: Request) {
  const testers = (env.ACCOUNTS_TEST_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const testAccess =
    !testers.length ||
    (env.SITES_NATIVE_AUTH === "true" &&
      !!request?.headers.get("oai-authenticated-user-id") &&
      testers.includes((request?.headers.get("oai-authenticated-user-email") || "").toLowerCase()));
  const enabled =
    !!testAccess &&
    env.ACCOUNTS_ENABLED === "true" &&
    !!env.DB &&
    env.AUTH_SECRET?.length >= 32 &&
    !!env.AUTH_ORIGIN;

  return {
    enabled,
    providers: enabled
      ? {
          chatgpt: env.SITES_NATIVE_AUTH === "true",
          google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
          email: !!env.MAIL_RELAY_SECRET && usableMailRelay(env.MAIL_RELAY_URL),
        }
      : {},
  };
}

export async function sessionFor(
  request: Request,
  env: Environment,
  db: Database,
  family: string | null = null,
) {
  const raw = readCookie(request, env, "session");
  if (!raw || raw.length > 100) {
    return null;
  }

  return db
    .prepare(
      "SELECT account_id,created_at,token_hash, (? IS NULL OR EXISTS(SELECT 1 FROM places_family_members m WHERE m.family_id=? AND m.account_id=places_sessions.account_id)) AS is_member FROM places_sessions WHERE token_hash=? AND expires_at>?",
    )
    .bind(family, family, await digest(raw), Date.now())
    .first<SessionRow>();
}

async function proofFor(
  request: Request,
  env: Environment,
  auth: ReturnType<typeof createAuth> | null,
  provider: Provider,
) {
  if (provider === "chatgpt") {
    const subject =
      env.SITES_NATIVE_AUTH === "true" && request.headers.get("oai-authenticated-user-id");
    if (!subject || subject.length > 512) {
      fail(401, "Sign in again.");
    }
    const label = request.headers.get("oai-authenticated-user-email") || "ChatGPT";

    return { provider, subject, label: label.slice(0, 320), authUser: null, createdAt: Date.now() };
  }
  if (!auth) {
    fail(401, "Sign in again.");
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !["google", "email"].includes(provider)) {
    fail(401, "Sign in again.");
  }
  const google = await env.DB.prepare(
    "SELECT accountId FROM auth_account WHERE userId = ? AND providerId = 'google'",
  )
    .bind(session.user.id)
    .first<{ accountId: string }>();
  if ((provider === "google") !== !!google || (!google && !session.user.emailVerified)) {
    fail(401, "Sign in again.");
  }

  return {
    provider,
    subject: google ? google.accountId : session.user.email.toLowerCase(),
    label: (google
      ? session.user.displayEmail || session.user.name || "Google"
      : session.user.email
    ).slice(0, 320),
    authUser: session.user.id,
    createdAt: new Date(session.session.createdAt).getTime(),
  };
}

const displayNameRequest = z.object({ displayName: displayNameSchema }).strict();

type ProfileRow = { displayName: string | null; provider: string | null; label: string | null };

function accountDetailsQuery(db: Database, id: string) {
  return db
    .prepare(
      "SELECT a.display_name AS displayName,i.provider,i.label FROM places_accounts a LEFT JOIN places_identities i ON i.account_id=a.id WHERE a.id=? ORDER BY i.provider,i.subject",
    )
    .bind(id);
}

function accountFromRows(id: string, rows: ProfileRow[]) {
  if (!rows.length) {
    return null;
  }
  const methods = rows.flatMap(({ provider, label }) =>
    provider && label !== null ? [{ provider, label }] : [],
  );

  return { id, displayName: rows[0].displayName, methods };
}

async function accountDetails(db: Database, id: string) {
  return accountFromRows(id, (await accountDetailsQuery(db, id).all<ProfileRow>()).results);
}

/** Better Auth writes ISO dates. Older numeric rows retain their original millisecond semantics. */
function expiredDate(column: "expiresAt" | "createdAt") {
  return `((typeof(${column})='text' AND ${column}<=?) OR (typeof(${column})!='text' AND ${column}<=?))`;
}

async function maintainAuth(db: Database, now: number) {
  const iso = new Date(now).toISOString();
  const orphanCutoff = now - 86400000;
  // Limit work per request so a backlog cannot prevent the authentication that drains it.
  await db.batch([
    db
      .prepare(
        `DELETE FROM auth_session WHERE id IN (SELECT id FROM auth_session WHERE ${expiredDate("expiresAt")} LIMIT 100)`,
      )
      .bind(iso, now),
    db
      .prepare(
        `DELETE FROM auth_verification WHERE id IN (SELECT id FROM auth_verification WHERE ${expiredDate("expiresAt")} LIMIT 100)`,
      )
      .bind(iso, now),
    db
      .prepare(
        "DELETE FROM auth_rate_limit WHERE id IN (SELECT id FROM auth_rate_limit WHERE lastRequest < ? LIMIT 100)",
      )
      .bind(now - 300000),
    db
      .prepare(
        "DELETE FROM places_send_limits WHERE recipient_hash IN (SELECT recipient_hash FROM places_send_limits WHERE next_send <= ? LIMIT 100)",
      )
      .bind(now),
    db
      .prepare(
        `DELETE FROM auth_user WHERE id IN (SELECT u.id FROM auth_user u WHERE ${expiredDate("createdAt")} AND NOT EXISTS (SELECT 1 FROM places_identities WHERE auth_user_id=u.id) AND NOT EXISTS (SELECT 1 FROM auth_session WHERE userId=u.id) LIMIT 100)`,
      )
      .bind(new Date(orphanCutoff).toISOString(), orphanCutoff),
  ]);
}

export async function handleAccounts(request: Request, env: Environment) {
  const url = new URL(request.url);
  const path = url.pathname;
  const config = accountConfiguration(env, request);
  if (path === "/api/account/config" && request.method === "GET") {
    return json(config);
  }
  if (!config.enabled) {
    return json({ error: "Account sync is not available yet." }, 503);
  }
  try {
    if (url.origin !== env.AUTH_ORIGIN) {
      fail(403, "Open the main Voltura Places address to sign in.");
    }
    if (!["GET", "POST", "DELETE"].includes(request.method)) {
      fail(405, "Method not allowed.");
    }
    if (
      request.method !== "GET" &&
      (request.headers.get("Origin") !== env.AUTH_ORIGIN ||
        request.headers.get("Sec-Fetch-Site") === "cross-site")
    ) {
      fail(403, "Invalid request origin.");
    }
    const db = env.DB.withSession?.("first-primary") || env.DB;
    let deliveryError: unknown;

    const getAuth = async () => {
      const auth = createAuth(env, async (data) => {
        try {
          if (!config.providers.email || data.type !== "sign-in") {
            fail(400, "Email sign-in unavailable.");
          }
          await sendSignInCode(env, data);
        } catch (error) {
          deliveryError = error;
          throw error;
        }
      });
      await auth.$context;

      return auth;
    };

    if (path.startsWith("/api/auth/")) {
      const route = path.slice("/api/auth".length);
      const methods: Record<string, string> = {
        "/sign-in/social": "POST",
        "/sign-in/email-otp": "POST",
        "/email-otp/send-verification-otp": "POST",
        "/sign-out": "POST",
        "/callback/google": "GET",
      };
      if (methods[route] !== request.method) {
        fail(404, "Not found.");
      }
      if (request.method === "POST") {
        let body = await readJSON(request, 8192);
        if (route === "/sign-in/social") {
          if (!config.providers.google || body.provider !== "google" || body.idToken || body.link) {
            fail(400, "Google sign-in unavailable.");
          }
          body = {
            provider: "google",
            disableRedirect: true,
            callbackURL: `${env.AUTH_ORIGIN}/?account=google${body.linking === true ? "-link" : ""}`,
            errorCallbackURL: `${env.AUTH_ORIGIN}/?account=error`,
          };
        } else if (route.includes("email-otp")) {
          if (typeof body.email === "string") {
            body.email = body.email.trim().toLowerCase();
          }
          if (
            !config.providers.email ||
            typeof body.email !== "string" ||
            !emailAddress.safeParse(body.email).success ||
            body.email.endsWith("@identity.voltura.invalid")
          ) {
            fail(400, "Invalid email address.");
          }
          if (
            route === "/sign-in/email-otp" &&
            (typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp))
          ) {
            fail(400, "Invalid code.");
          }
          if (route === "/email-otp/send-verification-otp" && body.type !== "sign-in") {
            fail(400, "Invalid code request.");
          }
          if (route === "/email-otp/send-verification-otp") {
            const recipient = await digest(body.email.toLowerCase());
            const now = Date.now();
            const result = await db
              .prepare(
                "INSERT INTO places_send_limits(recipient_hash,next_send) VALUES(?,?) ON CONFLICT(recipient_hash) DO UPDATE SET next_send = excluded.next_send WHERE next_send <= ?",
              )
              .bind(recipient, now + 60000, now)
              .run();
            if (!result.meta.changes) {
              fail(429, "Wait one minute before requesting another code.");
            }
          }
          // Never accept identity labels or other Better Auth user fields from the browser.
          body =
            route === "/sign-in/email-otp"
              ? { email: body.email, otp: body.otp }
              : { email: body.email, type: "sign-in" };
        }
        const headers = new Headers(request.headers);
        headers.delete("Content-Length");
        request = new Request(request.url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
      }
      await maintainAuth(db, Date.now());
      const response = await (await getAuth()).handler(request);
      const headers = new Headers(response.headers);
      // Better Auth catches delivery errors internally; never report a code as sent when the relay failed.
      if (deliveryError) {
        throw deliveryError;
      }
      headers.set("Cache-Control", "private, no-store");
      if (route === "/sign-in/email-otp" && response.ok) {
        headers.delete("Content-Length");

        return new Response('{"ok":true}', { status: response.status, headers });
      }

      return new Response(response.body, { status: response.status, headers });
    }
    const routeMethods: Record<string, string[]> = {
      "/api/account": ["GET", "DELETE"],
      "/api/account/config": ["GET"],
      "/api/account/sign-out": ["POST"],
      "/api/account/connect": ["POST"],
      "/api/account/link": ["POST"],
      "/api/account/display-name": ["POST"],
    };
    if (!Object.hasOwn(routeMethods, path)) {
      fail(404, "Not found.");
    }
    if (!routeMethods[path].includes(request.method)) {
      return json({ error: "Method not allowed." }, 405, { Allow: routeMethods[path].join(", ") });
    }
    const current = await sessionFor(request, env, db);
    if (path === "/api/account" && request.method === "GET") {
      return json({
        ...config,
        account: current ? await accountDetails(db, current.account_id) : null,
      });
    }
    if (path === "/api/account/sign-out" && request.method === "POST") {
      const expected = request.headers.get("X-Places-Account");
      if (current && expected !== current.account_id) {
        fail(409, "The signed-in account changed.");
      }
      const providerLogout = await (
        await getAuth()
      ).api.signOut({ headers: request.headers, asResponse: true });
      await db.batch([
        db
          .prepare("DELETE FROM places_sessions WHERE token_hash = ?")
          .bind(await digest(readCookie(request, env, "session"))),
        db
          .prepare("DELETE FROM places_link_tickets WHERE token_hash = ?")
          .bind(await digest(readCookie(request, env, "link"))),
      ]);
      const response = json({ ok: true });
      response.headers.append("Set-Cookie", cookie(env, "session", "", 0));
      response.headers.append("Set-Cookie", cookie(env, "link", "", 0));
      for (const value of providerLogout.headers.getSetCookie()) {
        response.headers.append("Set-Cookie", value);
      }

      return response;
    }
    if (path === "/api/account/connect" && request.method === "POST") {
      const body = await readJSON(request, 2048);
      if (body.provider !== "chatgpt" && body.provider !== "google" && body.provider !== "email") {
        fail(400, "Sign-in method unavailable.");
      }
      if (!config.providers[body.provider]) {
        fail(400, "Sign-in method unavailable.");
      }
      const proof = await proofFor(
        request,
        env,
        body.provider === "chatgpt" ? null : await getAuth(),
        body.provider,
      );
      let accountId;
      if (body.linking === true) {
        const raw = readCookie(request, env, "link");
        const hash = await digest(raw);
        const ticket =
          raw &&
          (await db
            .prepare("SELECT * FROM places_link_tickets WHERE token_hash = ? AND expires_at > ?")
            .bind(hash, Date.now())
            .first<LinkTicket>());
        if (
          !ticket ||
          ticket.account_id !== current?.account_id ||
          ticket.provider !== proof.provider ||
          proof.createdAt < ticket.created_at - 1000
        ) {
          fail(401, "Linking expired. Sign in again and retry.");
        }
        const existing = await db
          .prepare("SELECT account_id FROM places_identities WHERE provider = ? AND subject = ?")
          .bind(proof.provider, proof.subject)
          .first<{ account_id: string }>();
        if (existing && existing.account_id !== ticket.account_id) {
          fail(
            409,
            "This login already belongs to another Voltura account. No accounts were combined.",
          );
        }
        const sessionHash = await digest(readCookie(request, env, "session"));
        const redeemedAt = Date.now();
        const results = await db.batch([
          db
            .prepare(
              "INSERT OR IGNORE INTO places_identities(provider,subject,account_id,label,auth_user_id) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM places_identities WHERE account_id=? AND provider=? AND subject<>?) AND EXISTS (SELECT 1 FROM places_link_tickets WHERE token_hash = ? AND expires_at > ?) AND EXISTS (SELECT 1 FROM places_sessions WHERE token_hash=? AND account_id=? AND expires_at>?)",
            )
            .bind(
              proof.provider,
              proof.subject,
              ticket.account_id,
              proof.label,
              proof.authUser,
              ticket.account_id,
              proof.provider,
              proof.subject,
              hash,
              redeemedAt,
              sessionHash,
              ticket.account_id,
              redeemedAt,
            ),
          db
            .prepare(
              "DELETE FROM places_link_tickets WHERE token_hash = ? AND expires_at > ? AND EXISTS (SELECT 1 FROM places_sessions WHERE token_hash=? AND account_id=? AND expires_at>?)",
            )
            .bind(hash, redeemedAt, sessionHash, ticket.account_id, redeemedAt),
        ]);
        if (!results[1].meta.changes) {
          fail(401, "Linking expired. Sign in again and retry.");
        }
        const linked = await db
          .prepare("SELECT account_id FROM places_identities WHERE provider = ? AND subject = ?")
          .bind(proof.provider, proof.subject)
          .first<{ account_id: string }>();
        if (linked?.account_id !== ticket.account_id) {
          fail(
            409,
            "This login already belongs to another Voltura account. No accounts were combined.",
          );
        }
        accountId = ticket.account_id;
      } else {
        const id = crypto.randomUUID();
        await db.batch([
          db
            .prepare(
              "INSERT INTO places_accounts(id,created_at) SELECT ?,? WHERE NOT EXISTS (SELECT 1 FROM places_identities WHERE provider = ? AND subject = ?)",
            )
            .bind(id, Date.now(), proof.provider, proof.subject),
          db
            .prepare(
              "INSERT OR IGNORE INTO places_identities(provider,subject,account_id,label,auth_user_id) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM places_accounts WHERE id = ?)",
            )
            .bind(proof.provider, proof.subject, id, proof.label, proof.authUser, id),
        ]);
        accountId = (
          await db
            .prepare("SELECT account_id FROM places_identities WHERE provider = ? AND subject = ?")
            .bind(proof.provider, proof.subject)
            .first<{ account_id: string }>()
        )?.account_id;
        if (!accountId) {
          fail(503, "Account service unavailable.");
        }
      }
      const raw = token();
      const now = Date.now();
      await db.batch([
        db
          .prepare(
            "UPDATE places_identities SET label = ? WHERE provider = ? AND subject = ? AND account_id = ?",
          )
          .bind(proof.label, proof.provider, proof.subject, accountId),
        db
          .prepare("DELETE FROM places_sessions WHERE token_hash = ?")
          .bind(await digest(readCookie(request, env, "session"))),
        db
          .prepare(
            "DELETE FROM places_sessions WHERE token_hash IN (SELECT token_hash FROM places_sessions WHERE expires_at <= ? LIMIT 100)",
          )
          .bind(now),
        db
          .prepare(
            "DELETE FROM places_link_tickets WHERE token_hash IN (SELECT token_hash FROM places_link_tickets WHERE expires_at <= ? LIMIT 100)",
          )
          .bind(now),
        db
          .prepare(
            "INSERT INTO places_sessions(token_hash,account_id,created_at,expires_at) VALUES(?,?,?,?)",
          )
          .bind(await digest(raw), accountId, now, now + lifetime),
      ]);
      const response = json({ account: await accountDetails(db, accountId) });
      response.headers.append("Set-Cookie", cookie(env, "session", raw, lifetime / 1000));
      response.headers.append("Set-Cookie", cookie(env, "link", "", 0));

      return response;
    }
    if (!current) {
      fail(401, "Sign in again.");
    }
    if (
      (path === "/api/account/link" ||
        path === "/api/account/display-name" ||
        (path === "/api/account" && request.method === "DELETE")) &&
      request.headers.get("X-Places-Account") !== current.account_id
    ) {
      fail(409, "The signed-in account changed. Reconcile its library before synchronizing.");
    }
    if (path === "/api/account/display-name") {
      if (request.headers.has("X-Places-Family")) {
        fail(400, "Invalid account scope.");
      }
      const input = displayNameRequest.safeParse(await readJSON(request, 2048));
      if (!input.success) {
        fail(422, "Invalid display name.");
      }
      const [changed, profile] = await db.batch<ProfileRow>([
        db
          .prepare(
            "UPDATE places_accounts SET display_name=? WHERE id=? AND EXISTS(SELECT 1 FROM places_sessions WHERE token_hash=? AND account_id=? AND expires_at>unixepoch('subsec')*1000)",
          )
          .bind(input.data.displayName, current.account_id, current.token_hash, current.account_id),
        accountDetailsQuery(db, current.account_id),
      ]);
      if (!changed.meta.changes) {
        fail(401, "Sign in again.");
      }

      return json({ account: accountFromRows(current.account_id, profile.results) });
    }
    if (path === "/api/account/link" && request.method === "POST") {
      const body = await readJSON(request, 2048);
      if (body.provider !== "chatgpt" && body.provider !== "google" && body.provider !== "email") {
        fail(400, "Sign-in method unavailable.");
      }
      if (!config.providers[body.provider]) {
        fail(400, "Sign-in method unavailable.");
      }
      if (
        await db
          .prepare("SELECT 1 FROM places_identities WHERE account_id=? AND provider=?")
          .bind(current.account_id, body.provider)
          .first()
      ) {
        fail(409, "This sign-in method is already linked.");
      }
      const raw = token();
      const now = Date.now();
      const result = await db.batch([
        db
          .prepare("DELETE FROM places_link_tickets WHERE token_hash=? AND account_id=?")
          .bind(await digest(readCookie(request, env, "link")), current.account_id),
        db
          .prepare(
            "INSERT INTO places_link_tickets(token_hash,account_id,provider,created_at,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM places_sessions WHERE token_hash=? AND account_id=? AND expires_at>?)",
          )
          .bind(
            await digest(raw),
            current.account_id,
            body.provider,
            now,
            now + 300000,
            await digest(readCookie(request, env, "session")),
            current.account_id,
            now,
          ),
      ]);
      if (!result[1].meta.changes) {
        fail(401, "Sign in again.");
      }

      return json({ ok: true }, 200, { "Set-Cookie": cookie(env, "link", raw, 300) });
    }
    if (path === "/api/account" && request.method === "DELETE") {
      const body = await readJSON(request, 1024);
      if (body.confirm !== "delete-places-account") {
        fail(400, "Confirm account deletion.");
      }
      const sessionHash = await digest(readCookie(request, env, "session"));
      const now = Date.now();
      const canDelete =
        "EXISTS(SELECT 1 FROM places_sessions WHERE token_hash=? AND account_id=? AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM places_families WHERE owner_id=?)";
      const guards = [sessionHash, current.account_id, now, current.account_id];
      const removed = await db.batch([
        db
          .prepare(
            `DELETE FROM auth_user WHERE id IN (SELECT auth_user_id FROM places_identities WHERE account_id=?) AND ${canDelete}`,
          )
          .bind(current.account_id, ...guards),
        db
          .prepare(`DELETE FROM places_accounts WHERE id=? AND ${canDelete}`)
          .bind(current.account_id, ...guards),
      ]);
      if (!removed[1].meta.changes) {
        if (!(await sessionFor(request, env, db))) {
          fail(401, "Sign in again.");
        }
        fail(409, "familyTransferFirst");
      }

      return json({ ok: true }, 200, { "Set-Cookie": cookie(env, "session", "", 0) });
    }
    fail(404, "Not found.");
  } catch (error) {
    return json(
      {
        error:
          error instanceof RequestError
            ? error.message
            : "Account service unavailable. Your places remain saved on this device.",
      },
      error instanceof RequestError ? error.status : 503,
      error instanceof RequestError && error.retryAfter
        ? { "Retry-After": String(error.retryAfter) }
        : {},
    );
  }
}
