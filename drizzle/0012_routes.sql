CREATE TABLE places_records_routes (
  account_id TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('place', 'route', 'category')),
  value TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  last_mutation TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);

--> statement-breakpoint
INSERT INTO
  places_records_routes (
    rowid,
    account_id,
    id,
    kind,
    value,
    revision,
    deleted,
    last_mutation
  )
SELECT
  rowid,
  account_id,
  id,
  kind,
  value,
  revision,
  deleted,
  last_mutation
FROM
  places_records;

--> statement-breakpoint
DROP TABLE places_records;

--> statement-breakpoint
ALTER TABLE places_records_routes
RENAME TO places_records;

--> statement-breakpoint
CREATE INDEX places_records_live_kind ON places_records (kind, deleted, account_id);

--> statement-breakpoint
CREATE TABLE places_geometry (
  account_id TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (
    bytes > 0
    AND bytes <= 1048576
  ),
  data TEXT NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (account_id, id)
);

--> statement-breakpoint
CREATE INDEX places_geometry_capacity ON places_geometry (account_id, bytes);
