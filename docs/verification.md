# Verification

## Observed on 29 October 2026

- TypeScript with unused-code checks, documentation checks and production Worker/PWA build passed.
- Fresh `npm run dev` startup and its local health endpoint passed with the optional Wrangler explorer disabled; browser flows also passed against a fresh server.
- Nineteen model/IndexedDB/photo/update/publisher tests passed, including quota rollback, invalid imports, backup round trips, in-flight edits, account partitioning, stopping uploads on account changes, conflict/deletion recovery, existing-library mushroom preset migration and identical concurrent preset writes.
- Local workerd/D1 integration passed authorization, CAS races, identical retries, changed retry rejection, deletion/session invalidation and coordinate validation.
- Real Better Auth handlers passed signed fixture email delivery, hashed/single-use codes, expiry, attempt limits, simultaneous code reuse, Google token/state fixtures and explicit identity linking.
- Seven mobile Chromium flows passed GPS quick-save-before-naming, offline reload/GPS saving, missing-location validation/search, clear signed-in account controls/sign-out with a delayed response, dark default, mushroom selection, and copy feedback above an open map dialog. These use synthetic identity/GPS/clipboard fixtures.
- Desktop/mobile preview confirmed inset scrollbars preserve rounded panel corners, the header stays visible, and the background page is locked. Copy feedback was visibly clear inside the modal; Dark is the default for fresh preferences.
- English/Swedish mobile and desktop layouts were visually inspected. Promo screenshots contain synthetic examples.
- Initial app deployed through Sites; custom domain, DNS and TLS are active. `/api/health` and account configuration return HTTP 200. Forged native identity headers are rejected with HTTP 401 at the live gateway.
- Promo publication at https://voltura.se/places/ passed exact HTTPS payload checks and unchanged Air/root file hashes and route responses. Initial backup: `2026-10-29T12-33-18Z`. This does not establish an authenticated Air session.
- Dedicated relay GET returns 405 and unsigned POST returns 403. Live sign-in codes arrived in Outlook and authenticated two independent browser sessions successfully.
- The dedicated `voltura-places` Google project is in production with a Places-only origin/callback and basic email/profile/OpenID scopes. Credentials are Sites secrets; no billing was enabled. Real Google OAuth consent/callback and explicit linking to the verified email account succeeded.
- A synthetic place at 0, 0 synchronized from Chrome to the independent in-app browser. An edit from that browser synchronized back. A live service-worker update retained the account library and reopened an unfinished editor with its draft text intact; saving afterward succeeded. One clearly labelled example remains in the owner's account.

Physical iPhone/Android GPS, map handoff, installation, daylight readability and installed updates with unfinished work still require physical-device checks. Local fixtures and desktop browser checks are not substitutes.

Real provider checks above are separate from automated fixtures. Do not describe desktop browser verification as physical-phone acceptance.

Photo/update verification: 19 Vitest tests, 35 local workerd/D1 API checks, the real-handler authentication fixture and seven mobile Chromium flows pass. Photo checks cover private ownership, bounded uploads, immutable retries, legacy-client preservation, deletion cascades, backup round trips, invalid-image recovery, offline reload and removal drafts. A separate test verifies foreground/minute update checks. Two long-open preview tabs both displayed update prompts above dialogs; accepting in one restored the other tab's unfinished draft. Camera/library controls follow Air's separate capture/picker pattern. Physical iPhone camera capture and HEIC decoding remain unverified.

The photo GPS fixture verifies local EXIF extraction before compression, absent/malformed metadata recovery, and saving from the photo position without numeric coordinate inputs. Manual latitude/longitude fields were removed. Browser geolocation is the normal flow.

Optional GPS review: 23 Vitest tests and nine mobile Chromium flows pass. New fixtures verify changing accuracy (80 → 25 → 6 m), explicit confirmation before persistence, setting persistence, editor cancellation retaining drafts, denial without saving, stale/invalid fix rejection, one-minute watch cleanup and rejection of late callbacks. Unit conversion checks cover metres/feet and upward rounding; the browser verifies a saved Feet preference and ±20 ft in both review and the saved-place editor. The live meter shows device-reported estimates; physical-phone forest reception is not established by these fixtures.

Library simplification: ten browser flows now include a desktop check that the empty library has one practical instruction and one Works offline status, no decorative welcome content, and a details column only after selecting a place. The existing GPS/photo/account flows continue to pass.
