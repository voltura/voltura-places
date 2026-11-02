CREATE TABLE places_visits (
  account_id TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'visit'),
  value TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  last_mutation TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);

--> statement-breakpoint
CREATE INDEX places_visits_counts ON places_visits (account_id, deleted);
