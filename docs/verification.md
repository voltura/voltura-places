# Verification

## Observed on 29 October 2026

- TypeScript with unused-code checks, documentation checks and production Worker/PWA build passed.
- Thirteen model/IndexedDB/publisher tests passed, including quota rollback, invalid imports, backup round trips, in-flight edits, account partitioning, stopping uploads on account changes and conflict/deletion recovery.
- Local workerd/D1 integration passed authorization, CAS races, identical retries, changed retry rejection, deletion/session invalidation and coordinate validation.
- Real Better Auth handlers passed signed fixture email delivery, hashed/single-use codes, expiry, attempt limits, simultaneous code reuse, Google token/state fixtures and explicit identity linking.
- Mobile Chromium flows passed GPS quick-save-before-naming, offline reload/manual saving, invalid manual input and search. These use a synthetic GPS position.
- English/Swedish mobile and desktop layouts were visually inspected. Promo screenshots contain synthetic examples.
- Initial app deployed through Sites; custom domain, DNS and TLS are active. `/api/health` and account configuration return HTTP 200. Forged native identity headers are rejected with HTTP 401 at the live gateway.
- Promo publication at https://voltura.se/places/ passed exact HTTPS payload checks and unchanged Air/root file hashes and route responses. Initial backup: `2026-10-29T12-33-18Z`. This does not establish an authenticated Air session.
- Dedicated relay GET returns 405 and unsigned POST returns 403. A live email-code request was accepted for delivery; human receipt/sign-in confirmation remains pending.
- Google client registration is prepared in the separate `voltura-places` Google project, with no billing enabled. Completing the Google policy/client steps awaits action-time user confirmation; Google is hidden until credentials are configured.

Physical iPhone/Android GPS, map handoff, installation, daylight readability, Google OAuth and received email codes require actual device/provider checks. Local fixtures and browser emulation are not substitutes.

Automated fixtures do not establish real Google login, physical-device GPS/map handoff, or received email. Keep those limitations explicit until observed.
