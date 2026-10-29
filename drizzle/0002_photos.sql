CREATE TABLE places_photos (
 account_id TEXT NOT NULL REFERENCES places_accounts(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 hash TEXT NOT NULL,
 bytes INTEGER NOT NULL,
 data BLOB NOT NULL,
 PRIMARY KEY(account_id,id)
);
