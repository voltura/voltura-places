import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare, Response as WorkerResponse, convertV4MiniflareOptions } from "miniflare";
import { readFile } from "node:fs/promises";
import { createHmac, generateKeyPairSync, sign as signBytes } from "node:crypto";

test("Workers + D1: real auth handlers, signed email transport, cookies, code expiry/reuse/attempts, native linking and logout", async () => {
  const bundle = await build({
    stdin: {
      contents:
        "import {handleAccounts} from './src/server/accounts.js';export default {fetch:handleAccounts};",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    conditions: ["workerd", "worker", "browser"],
    external: ["node:*"],
    target: "es2022",
  });
  const mails = [],
    secret = "test-mail-signature-secret-over-32-characters";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "test-google-key",
    alg: "RS256",
    use: "sig",
  };
  let googleEmail = "listener@example.com";
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: [{ type: "ESModule", path: "accounts.js", contents: bundle.outputFiles[0].text }],
      compatibilityDate: "2026-07-01",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      bindings: {
        ACCOUNTS_ENABLED: "true",
        SITES_NATIVE_AUTH: "true",
        AUTH_ORIGIN: "https://places.test",
        AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
        MAIL_RELAY_URL: "https://mail.test/relay.php",
        MAIL_RELAY_SECRET: secret,
        GOOGLE_CLIENT_ID: "test-google-client",
        GOOGLE_CLIENT_SECRET: "test-google-secret",
      },
      outboundService: async (request) => {
        if (request.url === "https://www.googleapis.com/oauth2/v3/certs")
          return WorkerResponse.json({ keys: [jwk] });
        if (request.url === "https://oauth2.googleapis.com/token") {
          const form = new URLSearchParams(await request.text());
          assert.equal(form.get("code"), "valid-test-code");
          assert.ok(form.get("code_verifier"));
          const now = Math.floor(Date.now() / 1000);
          const unsigned = [
            JSON.stringify({ alg: "RS256", kid: jwk.kid }),
            JSON.stringify({
              iss: "https://accounts.google.com",
              aud: "test-google-client",
              sub: "google-user-one",
              email: googleEmail,
              email_verified: true,
              name: "Google listener",
              iat: now,
              exp: now + 300,
            }),
          ]
            .map((value) => Buffer.from(value).toString("base64url"))
            .join(".");
          const id_token = `${unsigned}.${signBytes("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
          return WorkerResponse.json({
            access_token: "fixture-access-token",
            token_type: "Bearer",
            expires_in: 300,
            id_token,
          });
        }
        assert.equal(new URL(request.url).origin, "https://mail.test");
        const body = await request.text();
        assert.equal(
          request.headers.get("X-Voltura-Signature"),
          createHmac("sha256", secret).update(body).digest("hex"),
        );
        mails.push(JSON.parse(body));
        return new WorkerResponse('{"ok":true}', { status: 200 });
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const migration of ["0000_accounts", "0001_library", "0002_photos", "0003_families"]) {
      const sql = await readFile(new URL(`../drizzle/${migration}.sql`, import.meta.url), "utf8");
      for (const statement of sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean))
        await db.prepare(statement).run();
    }
    let cookies = new Map(),
      nativeId = "",
      requestNumber = 0,
      expectedAccount = "";
    const call = async (path, body, method = body ? "POST" : "GET") => {
      const response = await mf.dispatchFetch(`https://places.test${path}`, {
        method,
        redirect: "manual",
        headers: {
          Origin: "https://places.test",
          "X-Places-Account": expectedAccount,
          "CF-Connecting-IP": `192.0.2.${++requestNumber}`,
          "Content-Type": "application/json",
          Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          ...(nativeId
            ? {
                "oai-authenticated-user-id": nativeId,
                "oai-authenticated-user-email": "listener@example.com",
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(";")[0],
          index = pair.indexOf("=");
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      return response;
    };
    const send = (email) =>
      call("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
    const sign = (email, otp) => call("/api/auth/sign-in/email-otp", { email, otp });
    assert.equal((await call("/api/account")).status, 200);
    const sent = await send("listener@example.com");
    assert.equal(sent.status, 200, await sent.text());
    assert.match(mails[0].code, /^\d{6}$/);
    const stored = await db.prepare("SELECT value FROM auth_verification").first();
    assert.ok(!stored.value.includes(mails[0].code));
    assert.notEqual((await send("listener@example.com")).status, 200, "recipient cooldown");
    const signed = await call("/api/auth/sign-in/email-otp", {
      email: "listener@example.com",
      otp: mails[0].code,
      displayEmail: "spoof@example.com",
    });
    assert.equal(signed.status, 200);
    assert.deepEqual(await signed.json(), { ok: true }, "no credentials in response JSON");
    assert.equal(
      (await db.prepare("SELECT displayEmail FROM auth_user").first()).displayEmail,
      null,
      "caller cannot supply a provider label",
    );
    const proofSession = await db.prepare("SELECT ipAddress,userAgent FROM auth_session").first();
    assert.equal(proofSession.ipAddress, "");
    assert.equal(proofSession.userAgent, "");
    assert.ok(
      [...cookies.keys()].some((name) => name.startsWith("__Secure-places-auth")),
      "secure Better Auth cookie",
    );
    const connected = await call("/api/account/connect", { provider: "email" });
    assert.equal(connected.status, 200);
    const account = (await connected.json()).account;
    expectedAccount = account.id;
    assert.equal(account.methods[0].provider, "email");
    assert.ok(
      connected.headers
        .getSetCookie()
        .some(
          (value) =>
            value.startsWith("__Host-places-session=") &&
            /HttpOnly/.test(value) &&
            /Secure/.test(value),
        ),
    );
    assert.notEqual((await sign("listener@example.com", mails[0].code)).status, 200, "single use");
    nativeId = "separate-native-same-email";
    const separate = await call("/api/account/connect", { provider: "chatgpt" });
    assert.notEqual(
      (await separate.json()).account.id,
      account.id,
      "matching email text never merges identities",
    );
    assert.equal(
      (await (await call("/api/account/connect", { provider: "email" })).json()).account.id,
      account.id,
    );
    nativeId = "site-scoped-user";
    assert.equal(
      (await call("/api/account/connect", { provider: "chatgpt", linking: true })).status,
      401,
      "no implicit linking",
    );
    assert.equal((await call("/api/account/link", { provider: "chatgpt" })).status, 200);
    const linked = await call("/api/account/connect", { provider: "chatgpt", linking: true });
    assert.equal(linked.status, 200);
    const linkedAccount = (await linked.json()).account;
    assert.equal(linkedAccount.id, account.id);
    assert.equal(linkedAccount.methods.length, 2);
    assert.equal(
      (await call("/api/account/connect", { provider: "chatgpt", linking: true })).status,
      401,
      "link ticket single use",
    );
    const google = await call("/api/auth/sign-in/social", { provider: "google" });
    assert.equal(google.status, 200);
    const authorize = new URL((await google.json()).url);
    assert.equal(authorize.hostname, "accounts.google.com");
    assert.equal(
      authorize.searchParams.get("redirect_uri"),
      "https://places.test/api/auth/callback/google",
    );
    const badCallback = await call("/api/auth/callback/google?code=invalid&state=invalid");
    assert.notEqual(badCallback.status, 200, "state validation");
    const googleLogin = async () => {
      const started = await call("/api/auth/sign-in/social", {
        provider: "google",
        scopes: ["https://mail.google.com/"],
        callbackURL: "https://untrusted.test/",
        additionalData: { displayEmail: "spoof@example.com" },
      });
      const target = new URL((await started.json()).url);
      assert.deepEqual(
        target.searchParams.get("scope").split(" ").sort(),
        ["email", "openid", "profile"],
        "only identity scopes",
      );
      const callback = await call(
        `/api/auth/callback/google?code=valid-test-code&state=${encodeURIComponent(target.searchParams.get("state"))}`,
      );
      assert.equal(callback.status, 302, await callback.clone().text());
      assert.equal(callback.headers.get("Location"), "https://places.test/?account=google");
      return call("/api/account/connect", { provider: "google" });
    };
    const googleConnected = await googleLogin();
    assert.equal(googleConnected.status, 200, await googleConnected.clone().text());
    const googleAccount = (await googleConnected.json()).account;
    assert.notEqual(
      googleAccount.id,
      account.id,
      "Google and email with identical email text stay separate",
    );
    assert.deepEqual(
      googleAccount.methods,
      [{ provider: "google", label: "listener@example.com" }],
      "verified Google email survives the provider-profile mapper",
    );
    googleEmail = "updated@example.com";
    const refreshedGoogle = (await (await googleLogin()).json()).account;
    assert.equal(
      refreshedGoogle.id,
      googleAccount.id,
      "provider subject remains the identity after an email change",
    );
    assert.deepEqual(
      refreshedGoogle.methods,
      [{ provider: "google", label: googleEmail }],
      "existing identity label refreshes after verified sign-in",
    );
    // Return to the original account for the remaining logout/expiry checks.
    await call("/api/account/connect", { provider: "chatgpt" });
    assert.equal((await send("expired@example.com")).status, 200);
    await db
      .prepare(
        "UPDATE auth_verification SET expiresAt = 0 WHERE identifier LIKE '%expired@example.com%'",
      )
      .run();
    assert.notEqual((await sign("expired@example.com", mails.at(-1).code)).status, 200);
    // Fresh IP avoids the independent IP rate limiter while testing per-code attempts.
    assert.equal((await send("attempts@example.com")).status, 200);
    const good = mails.at(-1).code;
    const wrong = good === "000000" ? "000001" : "000000";
    for (let i = 0; i < 3; i++)
      assert.equal((await sign("attempts@example.com", wrong)).status, 400);
    const exhausted = await sign("attempts@example.com", good);
    assert.notEqual(exhausted.status, 200, "attempt limit");
    assert.notEqual(exhausted.status, 429, "per-code limit, not the IP limiter");
    assert.equal((await send("concurrent@example.com")).status, 200);
    const concurrentCode = mails.at(-1).code;
    const concurrent = await Promise.all([
      sign("concurrent@example.com", concurrentCode),
      sign("concurrent@example.com", concurrentCode),
    ]);
    assert.equal(
      concurrent.filter((response) => response.status === 200).length,
      1,
      "one code can establish only one session under contention",
    );
    assert.equal(
      (
        await call("/api/auth/get-verification-otp", {
          email: "listener@example.com",
          type: "sign-in",
        })
      ).status,
      404,
      "no OTP retrieval endpoint",
    );
    assert.equal((await call("/api/account/sign-out", {})).status, 200);
    assert.equal((await (await call("/api/account")).json()).account, null);
    assert.equal(
      (await call("/api/account/connect", { provider: "email" })).status,
      401,
      "logout also invalidates the temporary provider proof; no silent reconnect",
    );
  } finally {
    await mf.dispose();
  }
});
