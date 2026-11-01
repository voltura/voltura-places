CREATE TABLE places_activity (
 browser_hash TEXT PRIMARY KEY,
 last_seen INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX places_activity_last_seen ON places_activity(last_seen);
--> statement-breakpoint
CREATE TABLE places_statistics (
 id INTEGER PRIMARY KEY CHECK(id = 1),
 started_at INTEGER NOT NULL,
 generated_at INTEGER NOT NULL DEFAULT 0,
 payload TEXT
);
--> statement-breakpoint
INSERT INTO places_statistics(id,started_at) VALUES(1,unixepoch() * 1000);
