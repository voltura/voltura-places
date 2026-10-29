# Deployment and recovery

## Ownership and secrets

Public source: voltura/voltura-places. App: https://places.voltura.se/. Promo: https://voltura.se/places/. The opaque Sites project ID and DB binding live in .openai/hosting.json. Never replace the Site after uncertain outcomes.

Runtime keys: AUTH_ORIGIN, AUTH_SECRET, ACCOUNTS_ENABLED, optional SITES_NATIVE_AUTH, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MAIL_RELAY_URL and MAIL_RELAY_SECRET. Configure secrets using native Sites tools; never in frontend/Git. Google requires a dedicated Places web client redirecting to https://places.voltura.se/api/auth/callback/google. Never repurpose Music's client/callbacks.

The dedicated email relay uses its own 32-byte HMAC secret and fixed sender places@voltura.se. Keep PHP config/state outside every document root. Codes expire in five minutes, allow three failed attempts, and are stored hashed. The relay rejects replay and enforces recipient/global limits. Real receipt is a human verification step.

## Publication

Validate/commit reviewed changes to main; npm run publish synchronizes the exact public source commit with Sites, packages/saves/deploys it, and retains checkpoint IDs until success. CI validates contributions without deployment credentials. Manual merges do not autonomously publish Sites. Initial publication stays private until verified, then publicly enable as requested.

Add the custom domain through Sites and apply only its exact CNAME/TXT records at one.com. Preserve nameservers/mail/other products. Verify HTTPS and login callbacks after activation.

## Promo and Air protection

npm run publish:promo -- --dry-run reviews the exact file list without connecting. The publisher reuses the Windows-encrypted SFTP password and pinned SSH identity without changing them. Verify the company homepage and Air directory before writing. Only places/ descendants are allowed; reject links/traversal. Never root-sync or recursively remove remote content.

Stage immutable bytes and save source commit, original destination bytes/hashes, protected-file hashes and route-response baselines under ignored .artifacts/backups. Verify atomic overwrite-rename before promotion. Assets precede entry pages. Verify HTTPS payloads and protected baselines afterward, including /air/, /air/app/, /a/, /s/, /d/, /fortnox/. This does not establish authenticated Air-session behavior.

Relay public code/config are separately deployed; secrets never enter the promo manifest. Keep private configuration outside document roots. Failure after upload is still failure; retain journal/backups and inspect current state before rollback. Refuse rollback over unrelated later bytes.

## Recovery and cost

Redeploy a saved Sites version for code rollback. SQL migrations are append-only/backward-compatible; code rollback does not revert D1. Export owned data before destructive migrations. User JSON backups are independent recovery files.

No publisher buys services, credits, paid runners or upgrades. Sites inclusion is current beta policy with usage limits. Source, SQL and portable exports support future migration.
