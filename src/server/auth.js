import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";

export const hex = (bytes) =>
  [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
export const digest = async (value) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

export async function sendSignInCode(env, { email, otp, type }) {
  if (type !== "sign-in" || !env.MAIL_RELAY_URL || !env.MAIL_RELAY_SECRET)
    throw new Error("Email sign-in unavailable");
  const target = new URL(env.MAIL_RELAY_URL);
  if (target.protocol !== "https:") throw new Error("Email sign-in unavailable");
  const body = JSON.stringify({
    recipient: email,
    code: otp,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.MAIL_RELAY_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Voltura-Signature": signature },
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Email delivery unavailable");
}

// Request-scoped: a D1 binding or a visitor's session must never leak into another request.
export function createAuth(env, sendCode = (data) => sendSignInCode(env, data)) {
  return betterAuth({
    appName: "Voltura Places",
    baseURL: env.AUTH_ORIGIN,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    database: env.DB.sqlite || env.DB,
    trustedOrigins: [env.AUTH_ORIGIN],
    logger: { disabled: true },
    // Better Auth also filters input:false fields from trusted provider profiles.
    // Our public auth routes strip caller-supplied profile fields before invoking it.
    user: {
      modelName: "auth_user",
      additionalFields: { displayEmail: { type: "string", required: false } },
    },
    session: {
      modelName: "auth_session",
      expiresIn: 600,
      freshAge: 600,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "auth_account",
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    verification: { modelName: "auth_verification" },
    advanced: {
      cookiePrefix: "places-auth",
      useSecureCookies: !env.AUTH_ORIGIN?.startsWith("http://127.0.0.1:"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: { generateId: () => crypto.randomUUID() },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({ data: { ...session, ipAddress: "", userAgent: "" } }),
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limit",
      window: 60,
      max: 30,
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              overrideUserInfoOnSignIn: true,
              // Separate namespaces prevent implicit Google/email linking by email text.
              mapProfileToUser: async (profile) => ({
                email: `google-${await digest(profile.sub)}@identity.voltura.invalid`,
                displayEmail: profile.email,
              }),
            },
          }
        : {},
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: "hashed",
        resendStrategy: "rotate",
        sendVerificationOTP: sendCode,
      }),
    ],
  });
}
