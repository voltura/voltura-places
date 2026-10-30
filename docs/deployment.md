# Deployment and recovery

## Local preview

The single human-review app preview is http://127.0.0.1:5173/. Start it with `npm run dev:ui`; all changes in the same checkout appear through Vite hot reload. Repeated startup reuses a preview only when its development-only identity matches this project and checkout. Port binding is strict: a different server or checkout produces a clear conflict, never a new preview port. Switching to another checkout is an explicit stop/start of the chosen preview. For interactive account and invitation flows, also run `npm run dev` to keep the local API/D1 service alive on 5174. It uses the 5173 preview as its canonical origin and upstream, so proxied account reads and writes pass the same origin checks as production. Cached demo groups alone do not provide a running API. Browser tests temporarily start their own API on 5174 with a 5174 canonical origin; stop the interactive API before those tests and restart it afterward. Local API/D1 and browser tests use 5174; the isolated promo server uses 5175. These are separate services, not alternative app review addresses. Do not move the user's review tab between ports or clear browser data; local storage and permissions belong to each origin.

## Ownership and secrets

Public source: voltura/voltura-places. App: https://places.voltura.se/. Promo: https://voltura.se/places/. The opaque Sites project ID and DB binding live in .openai/hosting.json. Never replace the Site after uncertain outcomes.

Runtime keys: AUTH_ORIGIN, AUTH_SECRET, ACCOUNTS_ENABLED, optional SITES_NATIVE_AUTH, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MAIL_RELAY_URL and MAIL_RELAY_SECRET. Configure secrets using native Sites tools; never in frontend/Git. Google requires a dedicated Places web client redirecting to https://places.voltura.se/api/auth/callback/google. Never repurpose Music's client/callbacks.

The owner machine retains the Places OAuth client backup with Windows current-user encryption at `%LOCALAPPDATA%/Voltura Places/google-oauth-client.dpapi`. Plaintext browser downloads are removed after backup verification and Sites configuration. Never print decrypted values or commit them.

The dedicated email relay uses its own 32-byte HMAC secret and fixed sender places@voltura.se. Keep PHP config/state outside every document root. Codes expire in five minutes, allow three failed attempts, and are stored hashed. The relay rejects replay and enforces recipient/global limits. Real receipt is a human verification step.

## Publication

The build version uses package.json's semantic version followed by the source revision and client-asset digest. The publisher rechecks clean main and the captured revision after validation and before packaging, and pushes that exact commit SHA rather than a moving branch tip. A concurrent checkout change stops publication for revalidation without discarding local work.

Validate/commit reviewed changes to main; npm run publish synchronizes the exact public source commit with Sites, packages/saves/deploys it, and retains checkpoint IDs until success. CI validates contributions without deployment credentials. Manual merges do not autonomously publish Sites. Initial publication stays private until verified, then publicly enable as requested.

Add the custom domain through Sites and apply only its exact CNAME/TXT records at one.com. Preserve nameservers/mail/other products. Verify HTTPS and login callbacks after activation.

## Promo and Air protection

npm run publish:promo -- --dry-run reviews the exact file list without connecting. The publisher reuses the Windows-encrypted SFTP password and pinned SSH identity without changing them. The promo manifest contains two localized pages, four localized phone/desktop screenshots, two social cards, one stylesheet and one icon. Only places/ descendants are allowed; reject links/traversal. Never root-sync or recursively remove remote content.

Stage immutable bytes and save source commit and original Places destination bytes/hashes under ignored .artifacts/backups. Verify atomic overwrite-rename before promotion. Assets precede entry pages. Verify the uploaded Places bytes over SFTP and HTTPS afterward. Routine deployment and rollback do not read, hash or probe the company homepage, Air, root configuration or sibling routes. Isolation is enforced by the fixed Places destination allowlist, pinned SSH host identity, remote symlink/type rejection and scoped atomic writes; downloaded backups remain available for recovery.

Relay public code/config are separately deployed; secrets never enter the promo manifest. Keep private configuration outside document roots. Failure after upload is still failure; retain journal/backups and inspect current state before rollback. Refuse rollback over unrelated later bytes.

## Recovery and cost

Redeploy a saved Sites version for code rollback. SQL migrations are append-only/backward-compatible; code rollback does not revert D1. Export owned data before destructive migrations. User JSON backups are independent recovery files.

No publisher buys services, credits, paid runners or upgrades. Sites inclusion is current beta policy with usage limits. Source, SQL and portable exports support future migration.
