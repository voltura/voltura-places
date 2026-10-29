# Architecture

Vite builds React/TypeScript and Workbox. The Worker ESM build embeds compiled app assets and packages the Sites manifest/migrations with nodejs_compat. Sites provisions the sole D1 binding DB. No separate Cloudflare account is required.

Client composition → features → shared UI. Composition/features may use browser foundation and shared schemas. Server modules never import client state. IndexedDB transactions own local durability, not React state.

D1 uses prepared statements. Better Auth is request-scoped and verifies provider proofs. Separate Places identities/sessions prevent implicit account merges by email text. Server authorization derives ownership from HttpOnly sessions and verifies the expected account header on private reads/writes.

The app and its service worker exist only on the Places Sites origin. The static promo builds separately and uploads only to one.com's places directory. It has no service worker or sibling-repository runtime dependencies.

The fixed-template email endpoint lives under places/mail/relay.php. Configuration and replay/rate-limit state stay outside every document root. No arbitrary message/header input is accepted.

One npm package, lockfile and Node 24 toolchain keep setup reproducible. Scripts own build/release operations. Account failure does not prevent guest saving/export.
