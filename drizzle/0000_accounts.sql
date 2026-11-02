CREATE TABLE "auth_user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" integer NOT NULL,
  "image" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "displayEmail" text
);

--> statement-breakpoint
CREATE TABLE "auth_session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" date NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE
);

--> statement-breakpoint
CREATE TABLE "auth_account" (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);

--> statement-breakpoint
CREATE TABLE "auth_verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" date NOT NULL,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);

--> statement-breakpoint
CREATE TABLE "auth_rate_limit" (
  "id" text NOT NULL PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

--> statement-breakpoint
CREATE INDEX "auth_session_userId_idx" ON "auth_session" ("userId");

--> statement-breakpoint
CREATE INDEX "auth_account_userId_idx" ON "auth_account" ("userId");

--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");

--> statement-breakpoint
CREATE TABLE places_accounts (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);

--> statement-breakpoint
CREATE TABLE places_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  auth_user_id TEXT,
  PRIMARY KEY (provider, subject)
);

--> statement-breakpoint
CREATE INDEX places_identities_account ON places_identities (account_id);

--> statement-breakpoint
CREATE TABLE places_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

--> statement-breakpoint
CREATE INDEX places_sessions_account ON places_sessions (account_id);

--> statement-breakpoint
CREATE TABLE places_link_tickets (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

--> statement-breakpoint
CREATE TABLE places_send_limits (
  recipient_hash TEXT PRIMARY KEY,
  next_send INTEGER NOT NULL
);

--> statement-breakpoint
