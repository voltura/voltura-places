CREATE TABLE places_families (
 id TEXT PRIMARY KEY REFERENCES places_accounts(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES places_accounts(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE places_family_members (
 family_id TEXT NOT NULL REFERENCES places_families(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL UNIQUE REFERENCES places_accounts(id) ON DELETE CASCADE,
 joined_at INTEGER NOT NULL,
 PRIMARY KEY(family_id,account_id)
);
--> statement-breakpoint
CREATE TABLE places_family_invites (
 family_id TEXT PRIMARY KEY REFERENCES places_families(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 used_by TEXT REFERENCES places_accounts(id) ON DELETE CASCADE
);
