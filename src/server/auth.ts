import { readBytes, RequestError } from "./http";
import { digest, hex } from "../shared/digest";
import type { Environment } from "./types";
import { betterAuth } from "better-auth";
import { emailOTP, type EmailOTPOptions } from "better-auth/plugins/email-otp";

export type SignInCode = Parameters<EmailOTPOptions["sendVerificationOTP"]>[0];

export function usableMailRelay(url: string | undefined) {
  if (!url || !URL.canParse(url)) {
    return false;
  }
  const target = new URL(url);

  return target.protocol === "https:" && !target.username && !target.password;
}

export async function sendSignInCode(env: Environment, { email, otp, type }: SignInCode) {
  if (type !== "sign-in" || !env.MAIL_RELAY_URL || !env.MAIL_RELAY_SECRET) {
    throw new Error("Email sign-in unavailable");
  }
  const target = new URL(env.MAIL_RELAY_URL);
  if (!usableMailRelay(env.MAIL_RELAY_URL)) {
    throw new Error("Email sign-in unavailable");
  }
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
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 429) {
      const seconds = Number(response.headers.get("Retry-After"));
      throw new RequestError(
        429,
        "Wait before requesting another code.",
        Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3600 ? seconds : 60,
      );
    }
    throw new Error("Email delivery unavailable");
  }
  try {
    const receipt = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(response, 256)),
    );
    if (response.status === 200 && receipt?.ok === true) {
      return;
    }
  } catch {}
  throw new Error("Email delivery unavailable");
}

// Request-scoped: a D1 binding or a visitor's session must never leak into another request.
export function createAuth(
  env: Environment,
  sendCode: (data: SignInCode) => Promise<void> = (data) => sendSignInCode(env, data),
) {
  return betterAuth({
    appName: "Voltura Places",
    baseURL: env.AUTH_ORIGIN,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    database: env.DB,
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
