CREATE TABLE places_family_codes (
 family_id TEXT PRIMARY KEY REFERENCES places_families(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE places_family_requests (
 account_id TEXT PRIMARY KEY REFERENCES places_accounts(id) ON DELETE CASCADE,
 family_id TEXT NOT NULL REFERENCES places_family_codes(family_id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE places_family_code_limits (
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 resets_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX places_family_requests_family ON places_family_requests(family_id,code_hash,created_at);
--> statement-breakpoint
CREATE INDEX places_family_codes_expiry ON places_family_codes(expires_at);
--> statement-breakpoint
CREATE INDEX places_family_code_limits_expiry ON places_family_code_limits(resets_at);
