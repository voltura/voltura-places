CREATE TABLE places_records (
 account_id TEXT NOT NULL REFERENCES places_accounts(id) ON DELETE CASCADE,
 id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('place','category')),
 value TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), last_mutation TEXT NOT NULL,
 PRIMARY KEY(account_id,id)
);
--> statement-breakpoint
CREATE TABLE places_receipts (
 account_id TEXT NOT NULL REFERENCES places_accounts(id) ON DELETE CASCADE,
 mutation_id TEXT NOT NULL, body_hash TEXT NOT NULL, record TEXT NOT NULL,
 PRIMARY KEY(account_id,mutation_id)
);
