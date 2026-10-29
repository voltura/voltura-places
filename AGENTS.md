# Voltura Places

Offline-first React PWA. Sites Worker + D1; one.com owns only the isolated promo/email endpoint.

- Start with docs/README.md; read task-relevant authorities. Preserve unrelated work.
- Client composition → features → domain-neutral UI; browser infrastructure and shared schemas stay independent of presentation. Server owns authorization.
- Persist records and pending writes atomically before success. Preserve account partitioning, deletion markers, CAS revisions and idempotent requests.
- Never log positions, names, identity/session tokens, mail codes or secrets.
- Air isolation: one.com writes stay inside `/places/`; `/air`, `/a`, `/s`, `/d` and root configuration are protected. No root sync/recursive remote cleanup.
- Update existing documentation owners when durable behavior changes.
- Run check, relevant tests, and a build for integrated/dependency changes. Test adverse authorization and data-integrity cases.
- Show significant UI in a working preview, collect feedback, and distinguish emulation from physical-device checks.
- Publish exact validated clean-main commits. Sites and one.com publishers are independent. Never alter sibling repositories/publishers.
- Secrets stay in Sites/private one.com config. Backups, local secrets and test artifacts are ignored. Never purchase services, credits or upgrades.
- Runtime AI is unnecessary. Source is MIT. Document current Sites limits without promising permanent unlimited hosting.
