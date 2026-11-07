# Deployment and recovery

## Route deployment

Deploy route-compatible server support and migrations before exposing the route-aware client. Older clients omit routes from SQL-paginated snapshots; ordinary mutation limits remain unchanged. Publish only an exact validated clean-main commit using the existing publishers. Physical-phone GPS and installed-app behavior are separate from browser-emulated verification.

## Local preview

The single human-review app preview is http://127.0.0.1:5173/. Start it with `npm run dev:ui`; all changes in the same checkout appear through Vite hot reload. Repeated startup reuses a preview only when its development-only identity matches this project and checkout. Port binding is strict: a different server or checkout produces a clear conflict, never a new preview port. Switching to another checkout is an explicit stop/start of the chosen preview. For interactive account and invitation flows, also run `npm run dev` to keep the local API/D1 service alive on 5174. It uses the 5173 preview as its canonical origin and upstream, so proxied account reads and writes pass the same origin checks as production. Cached demo groups alone do not provide a running API. Browser tests apply migrations to a dedicated .artifacts/browser-test-db and start their own API on 5174 with a 5174 canonical origin. Stop the interactive API before those tests and restart it afterward. Tests start the promo preview on 5175 or reuse the instance identified with this checkout. Local API/D1 and browser tests use 5174; the isolated promo server uses 5175. These are separate services, not alternative app review addresses. Do not move the user's review tab between ports or clear browser data; local storage and permissions belong to each origin.

## Ownership and secrets

Public source: voltura/voltura-places. App: https://places.voltura.se/. Promo: https://voltura.se/places/. The opaque Sites project ID and DB binding live in .openai/hosting.json. Never replace the Site after uncertain outcomes.

Runtime keys: AUTH_ORIGIN, AUTH_SECRET, ACCOUNTS_ENABLED, optional SITES_NATIVE_AUTH, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MAIL_RELAY_URL and MAIL_RELAY_SECRET. Configure secrets using native Sites tools; never in frontend/Git. Google requires a dedicated Places web client redirecting to https://places.voltura.se/api/auth/callback/google. Never repurpose Music's client/callbacks.

Map search uses `LANTMATERIET_CLIENT_ID` (production Consumer Key) and `LANTMATERIET_CLIENT_SECRET` (production Consumer Secret) as Sites runtime secrets. In Lantmäteriet's production API portal, subscribe the Voltura Places application to OrtnamnDirekt v2.2 and enable the Client Credentials grant. The Worker requests `ortnamn_direkt_read` from the production token endpoint. Keep verification-environment credentials separate. New Sites secret names take effect on deployment. The endpoint returns a temporary-unavailable response when either binding is missing. No new migration is needed. Verify a real place-name query with the production key pair before publishing map search. [Lantmäteriet API portal guide](https://apimanager.lantmateriet.se/docs/)

The owner machine retains the Places OAuth client backup with Windows current-user encryption at `%LOCALAPPDATA%/Voltura Places/google-oauth-client.dpapi`. Plaintext browser downloads are removed after backup verification and Sites configuration. Never print decrypted values or commit them.

The dedicated email relay uses its own 32-byte HMAC secret and fixed sender places@voltura.se. Keep PHP config/state outside every document root. Codes expire in five minutes, allow three failed attempts, and are stored hashed. The relay rejects replay and enforces recipient/global limits. Real receipt is a human verification step.

## Publication

HTML responses include a fresh cryptographically random CSP script nonce in the response header. Cloudflare copies it onto its injected JavaScript Detections browser check, as documented in [Cloudflare's CSP guidance](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/#if-you-have-a-content-security-policy-csp). The app retains same-origin scripts and blocks arbitrary inline scripts; do not add unsafe-inline or a fixed challenge hash. Client startup configures Zod without dynamic code generation to avoid a blocked eval probe under this policy. HTML uses no-store and skips static ETag/304 handling so network responses do not reuse a nonce. Other assets retain their existing validators/cache policies and API responses retain the strict nonce-free policy. The service worker's explicit offline precache remains separate from HTTP caching. Verify the injected script's nonce and absence of CSP violations on the deployed HTML; local checks cannot reproduce Cloudflare's injection.

The build version uses package.json's semantic version followed by the source revision and client-asset digest. The publisher rechecks clean main and the captured revision after validation and before packaging, and pushes that exact commit SHA rather than a moving branch tip. A concurrent checkout change stops publication for revalidation without discarding local work.

Validate/commit reviewed changes to main; npm run publish synchronizes the exact public source commit with Sites, packages/saves/deploys it, and retains checkpoint IDs until success. CI validates contributions without deployment credentials. Manual merges do not autonomously publish Sites. Initial publication stays private until verified, then publicly enable as requested.

Add the custom domain through Sites and apply only its exact CNAME/TXT records at one.com. Preserve nameservers/mail/other products. Verify HTTPS and login callbacks after activation.

## Promo and Air protection

npm run publish:promo -- --dry-run reviews the exact file list without connecting. The publisher reuses the Windows-encrypted SFTP password and pinned SSH identity without changing them. The promo manifest contains two localized promo pages, two localized statistics pages, four localized phone/desktop screenshots, one screenshot per theme, language and color mode, two social cards, one stylesheet, one hashed usage script and one icon. Only places/ descendants are allowed; reject links/traversal. Never root-sync or recursively remove remote content.

Stage immutable bytes and save source commit and original Places destination bytes/hashes under ignored .artifacts/backups. Verify atomic overwrite-rename before promotion. Assets precede entry pages. Verify the uploaded Places bytes over SFTP and HTTPS afterward. Routine deployment and rollback do not read, hash or probe the company homepage, Air, root configuration or sibling routes. Isolation is enforced by the fixed Places destination allowlist, pinned SSH host identity, remote symlink/type rejection and scoped atomic writes; downloaded backups remain available for recovery.

Relay public code/config are separately deployed; secrets never enter the promo manifest. Keep private configuration outside document roots. Failure after upload is still failure; retain journal/backups and inspect current state before rollback. Refuse rollback over unrelated later bytes.

For the 0.1.22 replay-boundary repair, run `node --test tests/mail-relay-runtime.test.mjs` with PHP available, then use `node scripts/publish-relay-fix.mjs --apply <validated-main-sha>` from the committed checkout. This one-time publisher requires the pinned SFTP host, the specific reviewed PHP blob and an exact match for a previously shipped relay template with its installation-specific config path. It backs up the existing public relay under `.artifacts/backups`, atomically replaces only `places/mail/relay.php` and performs a read-only HTTPS method check. Existing fixed bytes are skipped. An unknown remote payload aborts before staging. The initial secret setup command is separate.

## Recovery and cost

Redeploy a saved Sites version for code rollback. SQL migrations are append-only/backward-compatible; code rollback does not revert D1. Export owned data before destructive migrations. User JSON backups are independent recovery files.

No publisher buys services, credits, paid runners or upgrades. Sites inclusion is current beta policy with usage limits. Source, SQL and portable exports support future migration.

Promo publication captures a clean main SHA before building and checks it again after the build, before remote mutation, before each promotion and at completion. The backup journal records that captured SHA. Dirty-checkout dry runs remain available without connecting. A shared source guard rejects both later dirty changes and clean commit switches; rollback remains restricted to the Places allowlist.

Code statistics at `/places/stats.html` and `/places/sv/stats.html` are regenerated by the promo build from Git-tracked source files. They report physical lines (including comments and blanks), source/test files, languages, scripts and dependency counts, with the source revision. Lockfiles, generated files, dependencies, documentation and images are excluded from source totals. Local previews label dirty snapshots; publication requires clean main. Code-only statistics updates need only the promo publisher. Usage statistics also require the Sites activity/aggregate endpoints and migration 0007.

Usage statistics use the existing Sites Worker and DB; there are no new secrets or services. Validate with `npm run check`, `npm test`, `npm run build`, `npm run test:api`, `node --test tests/statistics-runtime.test.mjs`, relevant browser tests and `npm run publish:promo:dry-run`. Deploy the exact validated clean-main Sites commit before the promo payload so the live page can read the new endpoint. Publication remains two independent operations. Migration 0007 is additive; older code ignores its tables. The Places-only promo manifest contains thirteen base files plus one capture per theme, language and color mode. Preview the app at 5173 and the separate promo at 5175, with the local API on 5174. The promo requests local usage through the canonical 5173 app proxy. Do not use production data as a local-preview fallback.

Migration 0009 (`0009_personal_visits.sql`) must be applied before deploying the personal-status client/server. It creates the private visit table and index without rewriting existing place records. Refresh older devices before syncing new descriptions/statuses because the shared schemas are strict. This source change does not itself publish or migrate production.

Promo publication checks each hashed asset against its filename and requires one file for each expected asset. Identical remote payloads skip promotion and still receive paced HTTPS verification. Temporary HTTP 429 and 503 responses receive bounded retries. Rollback verifies the prior bytes, including empty files, and rejects unrelated remote changes or deletions. The email relay uses its own installer and is outside the promo manifest.

Use --skip-https-verification with the promo publisher when the operator will check the live pages manually. SFTP integrity and rollback protections still apply.
