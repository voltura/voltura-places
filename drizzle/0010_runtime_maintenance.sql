ALTER TABLE places_family_codes
ADD COLUMN generation TEXT NOT NULL DEFAULT '';

--> statement-breakpoint
CREATE INDEX auth_session_expiry ON auth_session (expiresAt);

--> statement-breakpoint
CREATE INDEX auth_verification_expiry ON auth_verification (expiresAt);

--> statement-breakpoint
CREATE INDEX auth_user_created ON auth_user (createdAt);

--> statement-breakpoint
CREATE INDEX auth_rate_limit_last_request ON auth_rate_limit (lastRequest);

--> statement-breakpoint
CREATE INDEX places_identities_auth_user ON places_identities (auth_user_id);

--> statement-breakpoint
CREATE INDEX places_sessions_expiry ON places_sessions (expires_at);

--> statement-breakpoint
CREATE INDEX places_link_tickets_expiry ON places_link_tickets (expires_at);

--> statement-breakpoint
CREATE INDEX places_send_limits_expiry ON places_send_limits (next_send);

--> statement-breakpoint
CREATE INDEX places_photos_capacity ON places_photos (account_id, bytes);
