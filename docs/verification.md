# Verification

## Observed on 29 October 2026

- TypeScript with unused-code checks, documentation checks and production Worker/PWA build passed.
- Fresh `npm run dev` startup and its local health endpoint passed with the optional Wrangler explorer disabled; browser flows also passed against a fresh server.
- Thirteen model/IndexedDB/publisher tests passed, including quota rollback, invalid imports, backup round trips, in-flight edits, account partitioning, stopping uploads on account changes and conflict/deletion recovery.
- Local workerd/D1 integration passed authorization, CAS races, identical retries, changed retry rejection, deletion/session invalidation and coordinate validation.
- Real Better Auth handlers passed signed fixture email delivery, hashed/single-use codes, expiry, attempt limits, simultaneous code reuse, Google token/state fixtures and explicit identity linking.
- Five mobile Chromium flows passed GPS quick-save-before-naming, offline reload/manual saving, invalid manual input/search, and sign-out with a delayed account response. These use synthetic identity/GPS fixtures.
- English/Swedish mobile and desktop layouts were visually inspected. Promo screenshots contain synthetic examples.
- Initial app deployed through Sites; custom domain, DNS and TLS are active. `/api/health` and account configuration return HTTP 200. Forged native identity headers are rejected with HTTP 401 at the live gateway.
- Promo publication at https://voltura.se/places/ passed exact HTTPS payload checks and unchanged Air/root file hashes and route responses. Initial backup: `2026-10-29T12-33-18Z`. This does not establish an authenticated Air session.
- Dedicated relay GET returns 405 and unsigned POST returns 403. Live sign-in codes arrived in Outlook and authenticated two independent browser sessions successfully.
- The dedicated `voltura-places` Google project is in production with a Places-only origin/callback and basic email/profile/OpenID scopes. Credentials are Sites secrets; no billing was enabled. Real Google OAuth consent/callback and explicit linking to the verified email account succeeded.
- A synthetic place at 0, 0 synchronized from Chrome to the independent in-app browser. An edit from that browser synchronized back. A live service-worker update retained the account library and reopened an unfinished editor with its draft text intact; saving afterward succeeded. One clearly labelled example remains in the owner's account.

Physical iPhone/Android GPS, map handoff, installation, daylight readability and installed updates with unfinished work still require physical-device checks. Local fixtures and desktop browser checks are not substitutes.

Real provider checks above are separate from automated fixtures. Do not describe desktop browser verification as physical-phone acceptance.
