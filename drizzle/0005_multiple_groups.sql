CREATE TABLE places_family_members_multi (
 family_id TEXT NOT NULL REFERENCES places_families(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES places_accounts(id) ON DELETE CASCADE,
 joined_at INTEGER NOT NULL,
 PRIMARY KEY(family_id,account_id)
);
--> statement-breakpoint
INSERT INTO places_family_members_multi SELECT family_id,account_id,joined_at FROM places_family_members;
--> statement-breakpoint
DROP TABLE places_family_members;
--> statement-breakpoint
ALTER TABLE places_family_members_multi RENAME TO places_family_members;
--> statement-breakpoint
CREATE INDEX places_family_members_account ON places_family_members(account_id);
