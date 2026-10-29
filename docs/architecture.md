# Architecture

Vite builds React/TypeScript and Workbox. The Worker ESM build embeds compiled app assets and packages the Sites manifest/migrations with nodejs_compat. Sites provisions the sole D1 binding DB. No separate Cloudflare account is required.

Client composition → features → shared UI. Composition/features may use browser foundation and shared schemas. Server modules never import client state. IndexedDB transactions own local durability, not React state.

D1 uses prepared statements. Better Auth is request-scoped and verifies provider proofs. Separate Places identities/sessions prevent implicit account merges by email text. Server authorization derives ownership from HttpOnly sessions and verifies the expected account header on private reads/writes.

The app and its service worker exist only on the Places Sites origin. The static promo builds separately and uploads only to one.com's places directory. It has no service worker or sibling-repository runtime dependencies.

The fixed-template email endpoint lives under places/mail/relay.php. Configuration and replay/rate-limit state stay outside every document root. No arbitrary message/header input is accepted.

One npm package, lockfile and Node 24 toolchain keep setup reproducible. Scripts own build/release operations. Account failure does not prevent guest saving/export.

Compressed place photos use separate IndexedDB blobs and the existing private D1 database. No additional storage service, account or paid API is introduced. Shared image validation is independent of browser processing and server authorization.

Family membership is a server authorization boundary, independent of login identity. The shared workspace resolver verifies the actual account and optional family header before mapping requests to family storage. Management stays in a focused family module; existing record/photo synchronization is reused. Per-workspace synchronization locks and member-specific local keys prevent private/family and account-switch writes from crossing partitions.
