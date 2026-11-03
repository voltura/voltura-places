CREATE TABLE places_route_snapshots (
  publisher TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (publisher, hash)
);

--> statement-breakpoint
CREATE TABLE places_route_shares (
  publisher TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  workspace TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  route_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  snapshot_hash TEXT NOT NULL,
  PRIMARY KEY (publisher, workspace, route_id),
  FOREIGN KEY (publisher, snapshot_hash) REFERENCES places_route_snapshots (publisher, hash)
);

--> statement-breakpoint
CREATE TABLE places_route_share_attempts (
  publisher TEXT NOT NULL REFERENCES places_accounts (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (publisher, id)
);

--> statement-breakpoint
CREATE INDEX places_route_share_attempt_time ON places_route_share_attempts (publisher, created_at);
