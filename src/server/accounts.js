import { createAuth, digest, sendSignInCode } from "./auth.js";

const lifetime = 30 * 86400000;
const json = (body, status = 200, headers = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const token = () => crypto.randomUUID() + crypto.randomUUID();
const cookieName = (env, name) =>
  `${env.AUTH_ORIGIN?.startsWith("https:") ? "__Host-" : ""}places-${name}`;
const cookie = (env, name, value, maxAge) =>
  `${cookieName(env, name)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.AUTH_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`;
const readCookie = (request, env, name) =>
  (request.headers.get("Cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName(env, name)}=`))
    ?.split("=")
    .slice(1)
    .join("=") || "";
export function accountConfiguration(env, request) {
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
          email: !!(env.MAIL_RELAY_URL && env.MAIL_RELAY_SECRET),
        }
      : {},
  };
}
export async function readJSON(request, limit) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    fail(415, "JSON required.");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "Request required.");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      fail(
        413,
        "The synced library is too large. Nothing was changed. Export a backup and reduce the collection before trying again.",
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(text + decoder.decode());
  } catch {
    fail(400, "Invalid request.");
  }
}
export async function sessionFor(request, env, db) {
  const raw = readCookie(request, env, "session");
  if (!raw || raw.length > 100) return null;
  return db
    .prepare(
      "SELECT account_id, created_at FROM places_sessions WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(await digest(raw), Date.now())
    .first();
}
async function proofFor(request, env, auth, provider) {
  if (provider === "chatgpt") {
    const subject =
      env.SITES_NATIVE_AUTH === "true" && request.headers.get("oai-authenticated-user-id");
    if (!subject || subject.length > 512) fail(401, "Sign in again.");
    const label = request.headers.get("oai-authenticated-user-email") || "ChatGPT";
    return { provider, subject, label: label.slice(0, 320), authUser: null, createdAt: Date.now() };
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !["google", "email"].includes(provider)) fail(401, "Sign in again.");
  const google = await env.DB.prepare(
    "SELECT accountId FROM auth_account WHERE userId = ? AND providerId = 'google'",
  )
    .bind(session.user.id)
    .first();
  if ((provider === "google") !== !!google || (!google && !session.user.emailVerified))
    fail(401, "Sign in again.");
  return {
    provider,
    subject: google ? google.accountId : session.user.email.toLowerCase(),
    label: google ? session.user.displayEmail || session.user.name || "Google" : session.user.email,
    authUser: session.user.id,
    createdAt: new Date(session.session.createdAt).getTime(),
  };
}
async function accountDetails(db, id) {
  const methods = await db
    .prepare("SELECT provider, label FROM places_identities WHERE account_id = ? ORDER BY provider")
    .bind(id)
    .all();
  return { id, methods: methods.results };
}
export async function handleAccounts(request, env) {
  const url = new URL(request.url),
    path = url.pathname,
    config = accountConfiguration(env, request);
  if (path === "/api/account/config" && request.method === "GET") return json(config);
  if (!config.enabled) return json({ error: "Account sync is not available yet." }, 503);
  try {
    if (url.origin !== env.AUTH_ORIGIN)
      fail(403, "Open the main Voltura Places address to sign in.");
    if (!["GET", "POST", "DELETE"].includes(request.method)) fail(405, "Method not allowed.");
    if (
      request.method !== "GET" &&
      (request.headers.get("Origin") !== env.AUTH_ORIGIN ||
        request.headers.get("Sec-Fetch-Site") === "cross-site")
    )
      fail(403, "Invalid request origin.");
    const db = env.DB.withSession?.("first-primary") || env.DB;
    let deliveryError;
    const getAuth = async () => {
      const auth = createAuth(env, async (data) => {
        try {
          if (!config.providers.email || data.type !== "sign-in")
            fail(400, "Email sign-in unavailable.");
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
      const methods = {
        "/sign-in/social": "POST",
        "/sign-in/email-otp": "POST",
        "/email-otp/send-verification-otp": "POST",
        "/sign-out": "POST",
        "/callback/google": "GET",
      };
      if (methods[route] !== request.method) fail(404, "Not found.");
      const now = Date.now();
      await db.batch([
        db.prepare("DELETE FROM auth_session WHERE expiresAt <= ?").bind(now),
        db.prepare("DELETE FROM auth_verification WHERE expiresAt <= ?").bind(now),
        db.prepare("DELETE FROM auth_rate_limit WHERE lastRequest < ?").bind(now - 300000),
        db.prepare("DELETE FROM places_send_limits WHERE next_send <= ?").bind(now),
        db
          .prepare(
            "DELETE FROM auth_user WHERE createdAt < ? AND NOT EXISTS (SELECT 1 FROM places_identities WHERE auth_user_id = auth_user.id) AND NOT EXISTS (SELECT 1 FROM auth_session WHERE userId = auth_user.id)",
          )
          .bind(now - 86400000),
      ]);
      if (request.method === "POST") {
        let body = await readJSON(request, 8192);
        if (route === "/sign-in/social") {
          if (!config.providers.google || body.provider !== "google" || body.idToken || body.link)
            fail(400, "Google sign-in unavailable.");
          body = {
            provider: "google",
            disableRedirect: true,
            callbackURL: `${env.AUTH_ORIGIN}/?account=google${body.linking === true ? "-link" : ""}`,
            errorCallbackURL: `${env.AUTH_ORIGIN}/?account=error`,
          };
        } else if (route.includes("email-otp")) {
          if (typeof body.email === "string") body.email = body.email.trim().toLowerCase();
          if (
            !config.providers.email ||
            typeof body.email !== "string" ||
            body.email.length > 254 ||
            body.email.endsWith("@identity.voltura.invalid")
          )
            fail(400, "Invalid email address.");
          if (route === "/email-otp/send-verification-otp" && body.type !== "sign-in")
            fail(400, "Invalid code request.");
          if (route === "/email-otp/send-verification-otp") {
            const recipient = await digest(body.email.toLowerCase()),
              now = Date.now();
            const result = await db
              .prepare(
                "INSERT INTO places_send_limits(recipient_hash,next_send) VALUES(?,?) ON CONFLICT(recipient_hash) DO UPDATE SET next_send = excluded.next_send WHERE next_send <= ?",
              )
              .bind(recipient, now + 60000, now)
              .run();
            if (!result.meta.changes) fail(429, "Wait one minute before requesting another code.");
          }
          // Never accept identity labels or other Better Auth user fields from the browser.
          body =
            route === "/sign-in/email-otp"
              ? { email: body.email, otp: body.otp }
              : { email: body.email, type: "sign-in" };
        }
        request = new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(body),
        });
      }
      const response = await (await getAuth()).handler(request),
        headers = new Headers(response.headers);
      // Better Auth catches delivery errors internally; never report a code as sent when the relay failed.
      if (deliveryError) throw deliveryError;
      headers.set("Cache-Control", "private, no-store");
      if (route === "/sign-in/email-otp" && response.ok)
        return new Response('{"ok":true}', { status: response.status, headers });
      return new Response(response.body, { status: response.status, headers });
    }
    const current = await sessionFor(request, env, db);
    if (path === "/api/account" && request.method === "GET")
      return json({
        ...config,
        account: current ? await accountDetails(db, current.account_id) : null,
      });
    if (path === "/api/account/sign-out" && request.method === "POST") {
      const expected = request.headers.get("X-Places-Account");
      if (current && expected && expected !== current.account_id)
        fail(409, "The signed-in account changed.");
      const providerLogout = await (
        await getAuth()
      ).api.signOut({ headers: request.headers, asResponse: true });
      await db
        .prepare("DELETE FROM places_sessions WHERE token_hash = ?")
        .bind(await digest(readCookie(request, env, "session")))
        .run();
      const response = json({ ok: true });
      response.headers.append("Set-Cookie", cookie(env, "session", "", 0));
      response.headers.append("Set-Cookie", cookie(env, "link", "", 0));
      for (const value of providerLogout.headers.getSetCookie())
        response.headers.append("Set-Cookie", value);
      return response;
    }
    if (path === "/api/account/connect" && request.method === "POST") {
      const body = await readJSON(request, 2048);
      if (!config.providers[body.provider]) fail(400, "Sign-in method unavailable.");
      const proof = await proofFor(
        request,
        env,
        body.provider === "chatgpt" ? null : await getAuth(),
        body.provider,
      );
      let accountId;
      if (body.linking === true) {
        const raw = readCookie(request, env, "link"),
          hash = await digest(raw);
        const ticket =
          raw &&
          (await db
            .prepare("SELECT * FROM places_link_tickets WHERE token_hash = ? AND expires_at > ?")
            .bind(hash, Date.now())
            .first());
        if (
          !ticket ||
          ticket.provider !== proof.provider ||
          proof.createdAt < ticket.created_at - 1000
        )
          fail(401, "Linking expired. Sign in again and retry.");
        const existing = await db
          .prepare("SELECT account_id FROM places_identities WHERE provider = ? AND subject = ?")
          .bind(proof.provider, proof.subject)
          .first();
        if (existing && existing.account_id !== ticket.account_id)
          fail(
            409,
            "This login already belongs to another Voltura account. No accounts were combined.",
          );
        const results = await db.batch([
          db
            .prepare(
              "INSERT OR IGNORE INTO places_identities(provider,subject,account_id,label,auth_user_id) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM places_link_tickets WHERE token_hash = ? AND expires_at > ?)",
            )
            .bind(
              proof.provider,
              proof.subject,
              ticket.account_id,
              proof.label,
              proof.authUser,
              hash,
              Date.now(),
            ),
          db.prepare("DELETE FROM places_link_tickets WHERE token_hash = ?").bind(hash),
        ]);
        if (!results[1].meta.changes) fail(401, "Linking expired. Sign in again and retry.");
        const linked = await db
          .prepare("SELECT account_id FROM places_identities WHERE provider = ? AND subject = ?")
          .bind(proof.provider, proof.subject)
          .first();
        if (linked?.account_id !== ticket.account_id)
          fail(
            409,
            "This login already belongs to another Voltura account. No accounts were combined.",
          );
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
            .first()
        ).account_id;
      }
      const raw = token(),
        now = Date.now();
      await db.batch([
        db
          .prepare(
            "UPDATE places_identities SET label = ? WHERE provider = ? AND subject = ? AND account_id = ?",
          )
          .bind(proof.label, proof.provider, proof.subject, accountId),
        db.prepare("DELETE FROM places_sessions WHERE expires_at <= ?").bind(now),
        db.prepare("DELETE FROM places_link_tickets WHERE expires_at <= ?").bind(now),
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
    if (!current) fail(401, "Sign in again.");
    if (
      (path === "/api/account/link" || (path === "/api/account" && request.method === "DELETE")) &&
      request.headers.get("X-Places-Account") !== current.account_id
    )
      fail(409, "The signed-in account changed. Reconcile its library before synchronizing.");
    if (path === "/api/account/link" && request.method === "POST") {
      const body = await readJSON(request, 2048);
      if (!config.providers[body.provider]) fail(400, "Sign-in method unavailable.");
      const raw = token(),
        now = Date.now();
      await db
        .prepare(
          "INSERT INTO places_link_tickets(token_hash,account_id,provider,created_at,expires_at) VALUES(?,?,?,?,?)",
        )
        .bind(await digest(raw), current.account_id, body.provider, now, now + 300000)
        .run();
      return json({ ok: true }, 200, { "Set-Cookie": cookie(env, "link", raw, 300) });
    }
    if (path === "/api/account" && request.method === "DELETE") {
      const body = await readJSON(request, 1024);
      if (body.confirm !== "delete-places-account") fail(400, "Confirm account deletion.");
      if (
        await db
          .prepare("SELECT 1 FROM places_families WHERE owner_id=?")
          .bind(current.account_id)
          .first()
      )
        fail(409, "familyTransferFirst");
      await db.batch([
        db
          .prepare(
            "DELETE FROM auth_user WHERE id IN (SELECT auth_user_id FROM places_identities WHERE account_id = ?)",
          )
          .bind(current.account_id),
        db.prepare("DELETE FROM places_accounts WHERE id = ?").bind(current.account_id),
      ]);
      return json({ ok: true }, 200, { "Set-Cookie": cookie(env, "session", "", 0) });
    }
    fail(404, "Not found.");
  } catch (error) {
    return json(
      {
        error: error.status
          ? error.message
          : "Account service unavailable. Your places remain saved on this device.",
      },
      error.status || 503,
    );
  }
}
