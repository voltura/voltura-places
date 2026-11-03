# Architecture

## Route ownership

Route recording lifecycle belongs to app/useRouteRecording; browser foundation owns its Web Lock, GPS watch, append-only drafts, immutable geometry storage and attachment transport. Shared route schemas derive geometry hashes and summaries without presentation dependencies. Features own route maps and descriptive editing; the server authorizes geometry and builds public snapshots from authorized persisted records. Geometry downloads are bounded to three concurrent requests.

## Source style

`npm run format` applies the repository's pinned source-style tools; `npm run format:check` verifies without writing. `npm run check` includes that verification, so CI rejects style drift. Run the formatter after edits and the full check before submitting changes. `.editorconfig` supplies editor defaults; the executable formatter/linter configuration is authoritative.

- Oxfmt owns TypeScript, TSX, JavaScript, CSS, HTML, JSON/JSONC, YAML and Markdown layout: two spaces, LF endings, a final newline, semicolons, double quotes, trailing commas and parenthesized arrow parameters. The print-width target is 100 characters; formatters may retain longer indivisible content. JSX uses double quotes and closing brackets on their own line when multiline.
- ESLint adds complementary rules: braces on every control-flow body, one variable binding per declaration, blank lines around functions/classes (including arrow-function bindings), after the import section and before returns. Multiline class members are separated. Oxfmt collapses repeated blank lines. Keep related state declarations together and separate logical phases inside larger functions; the latter remains a review judgment.
- PHP uses Prettier's PHP plugin with four spaces, single quotes and a 100-character target, targeting PHP 8.2-compatible syntax. Standalone SQL uses sql-formatter's SQLite dialect, two spaces, uppercase keywords and separated statements. Embedded SQL strings remain untouched. Migration names, statement order and breakpoint comments must remain intact.
- Import order, side-effect order, names, public APIs and program behavior are preserved. Formatting is not a reason to refactor or reorder code. Do not disable rules to make checks pass; resolve legitimate exceptions explicitly in the owning configuration and document why.
- Git-ignored dependencies, generated bundles/types, private configuration and test artifacts are excluded. The lockfile is maintained by npm. Source, scripts, configuration and tests follow the same rules, including new untracked files that are not ignored.

The formatter command runs ESLint fixes before layout formatting so one command produces the final style. Use `npm run format` rather than invoking one underlying tool alone. Inline ESLint disable comments cannot bypass the policy. Both publishers check style before building new publication artifacts; the promo rollback path restores its existing backup without reformatting it. Tool versions and the lockfile are committed together. Significant style changes should be reviewed separately from behavioral changes.

## Module boundaries

| Owner               | Responsibility                                                                    | May depend on                          |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| `client/app`        | Workspace/account composition, browser lifecycle hooks and feature loading        | Features, foundation, UI, shared       |
| `client/features`   | User flows and their transient form state                                         | Other features, foundation, UI, shared |
| `client/foundation` | Browser persistence, synchronization, preferences and in-memory record operations | Foundation, shared                     |
| `client/ui`         | Domain-neutral interaction and dialog primitives                                  | UI                                     |
| `shared`            | Schemas, protocol capacities, canonical identities and image validation           | Shared                                 |
| `server`            | Session/provider verification, authorization, D1 and HTTP endpoints               | Server, shared                         |

`npm run check` enforces these runtime import boundaries using the production build parser, including re-exports and literal dynamic imports. Type-only imports are erased by that parser; TypeScript checks their types. All server source, including the Better Auth adapter and account endpoints, is strict TypeScript. Transport parsing in `server/http.ts` has no account dependency; endpoints retain their own authorization and domain-error translation.

`library-types.ts` owns browser workspace metadata. `library-records.ts` owns in-memory edits, capacity checks and cloud record transitions; `library.ts` owns their IndexedDB transaction/cancellation boundaries and multi-workspace orchestration. The category editor owns its transient draft, so typing and appearance selection do not update app-wide state. Preference types/parsing belong to browser foundation; the app hook owns appearance and persistence effects.

### Application orchestration

`App.tsx` composes focused app-layer controllers and renders the shell. `useSession` owns account discovery, provider-return handling, logout and account/device removal. `useWorkspace` owns library selection, membership refresh, access state and subscriptions to local workspace changes. Account changes go through session acceptance and one workspace transition; library changes use that same transition to invalidate operations and reset transient workflows synchronously.

`operations.ts` provides separate account and workspace generations. Operation contexts capture the originating identity/key and a validity predicate, so leaving and returning to the same account or workspace never revives an old operation. Account-scoped exports can continue across library selection; edits, GPS, imports and copies use workspace-scoped validity. Writes pass these predicates into existing foundation transactions. Copies additionally verify destination membership. Membership loss invalidates selected-workspace operations while preserving cached records for read/export. Late reads, errors and completions cannot update another scope; newer workspace reads supersede older reads in the same scope.

`useSynchronization` owns startup/foreground/reconnection/manual synchronization and the existing thirty-second account/record refresh. Overlapping foreground, reconnect and timer events share an account refresh and record sync pass. A committed edit during record sync requests a follow-up pass. It combines selected-group and private-visit status without masking a group failure. The existing foundation synchronization module retains Web Locks, request coalescing, durable flights and retry semantics. Membership polling remains independently owned by the workspace controller, every five seconds while visible/online, with account generations and mutation/request guards.

Editing/GPS, backup/device reconciliation, sharing/group copying and browsing each have a focused controller. Their dialog components compose existing feature views without changing native modal/focus ownership. Pure `foundation/library-selectors.ts` functions derive live places/categories, private visit statuses and filtered/sorted results; the query hook memoizes those results for both List and Map. Browsing owns map selection/fullscreen/provider state. Core feature imports remain eager.

Browser `foundation/http.ts` owns general JSON transport and `ApiError`, independently of synchronization. `account-contract.ts` owns account response validation and schema-derived types. Account/group features import these owners directly; specialized photo byte transport remains separate. No new state-management dependency, endpoint, persisted format or migration is introduced.

Sync failure classification stays in browser foundation; the shared SyncStatus feature maps states to localized explanations independently of account presentation. Manual sync awaits a complete pass and returns its final state only while the originating operation remains current. A manual request during an active pass queues another pass. Selected active-group membership loss transitions through the same workspace switch as deliberate navigation, cancelling stale work and persisting Private places. Intentionally reopening an archived group remains possible and synchronizes private visit data without treating the read-only group as a failed cloud request.

Settings, group management and both editors are part of the initial app bundle. Core interactions never wait for another feature module or loading dialog. The existing optional Leaflet map and photo GPS parser retain their established lazy-loading/offline-precache behavior.

Capacity validation counts live entities in one pass without filtered arrays; single-record replacement retains order/revision semantics without rebuilding the entire records array. Shared digest helpers preserve the existing UTF-8 SHA-256 identities and photo/receipt hashes.

## Runtime and integration

### Build dependency security

The npm overrides pin every transitive `minimatch` to 11.0.1, including ESLint,
Workbox's glob and filelist, and `glob` to 14.0.2. This closes
GHSA-g3hv-75wg-m249's pattern-amplification path and keeps Workbox's file discovery
compatible with minimatch 11's matcher representation. Glob 14.0.2 also includes
the cancellation repair for GHSA-3g3m-2fjr-6pw4. Dependency-security tests cover the
expansion limit, large-pattern handling, ordinary matching and Workbox-style glob
discovery. Review these callers and remove the overrides when their declared
versions include compatible safe releases.

`deepmerge` 4.3.1 remains a development-only dependency of Workbox's Rollup resolver.
GHSA-gcqx-w48m-w2h4 has no upstream patched release. In resolver 16.0.3 its only call
clones fixed, module-local default arrays and booleans (`deepMerge({}, defaults)`);
user options are combined separately with a shallow spread. No application input
reaches this merge and it is absent from the production Worker/client. The alert
is classified as vulnerable code not used, rather than claiming the package is
patched. Reassess this disposition when the resolver or its dependency path changes.

Browser installation infrastructure captures install offers before React renders and exposes a session-only external store to the shared InstallPlaces feature used by Settings and mobile first-use onboarding. It owns browser listeners, single-use offers, pending/error state and display-mode detection independently of presentation, accounts and persistence. Development hot replacement disposes its listeners.

Place details reuse the lazy-loaded map feature in a non-interactive 180px preview. Only visible details mount a preview; mobile does not mount the hidden desktop pane. The app owns the List/Map mode and workspace-scoped expansion target so expanding a preview shows the selected place in the main map without carrying targets across account/library changes. Map previews use the same tile/privacy/security/cache rules as the main map. Composition also owns workspace-scoped fullscreen state. The main map promotes its existing inline dialog to a viewport-filling native modal without remounting Leaflet; desktop pin details use the existing sheet while fullscreen. Nested sheets remain above the map, and workspace/view changes or an empty result set end fullscreen.

The optional Map view lazy-loads bundled Leaflet and its marker clustering plugin. It renders only the selected workspace's existing live records. Tiles come directly from OpenStreetMap by default. Preferences can select Naturkartan's Swedish terrain tiles. A bundled Natural Earth country outline selects Swedish coverage at zoom 7 and above; other areas and wider views use OpenStreetMap. A failed Naturkartan tile switches that map to OpenStreetMap until reconnection or a preference change. Both exact tile hosts are allowed by the image CSP. Tile images send an origin-only referrer; outgoing map links retain no-opener/no-referrer protection. Tiles use normal HTTP caching, with no service-worker runtime cache, bulk downloads or prefetch. Provider availability is best-effort; the list and local records remain independent of tiles.

Vite builds React/TypeScript and Workbox. The Worker ESM build embeds compiled app assets and packages the Sites manifest/migrations with nodejs_compat. Sites provisions the sole D1 binding DB. No separate Cloudflare account is required.

Client composition → features → shared UI. Composition/features may use browser foundation and shared schemas. Server modules never import client state. IndexedDB transactions own local durability, not React state.

The shared visit helper derives canonical personal-status identities from a source library/place reference independently of presentation. Status entities live in the person's private workspace; composition reads that workspace alongside a selected group and synchronizes both under their existing independent locks. Group synchronization failures remain visible even if private synchronization succeeds. GPS saves and backup imports can update shared place records and private status in one browser transaction. The server's existing authorized sync path routes visit entities to a separate private D1 table and excludes them from group snapshots. List and Map consume the same memoized status/category/text-filtered place set.

Browser database infrastructure lazily shares one connection promise per record/photo database, including concurrent first operations. Failed opens and browser-terminated connections can retry; version changes close the old connection so another tab can upgrade. Connection reuse does not cache workspace values or bypass transactions. Library queries memoize their derived results and index categories; sorting computes timestamps/distances once per matching record and reuses locale formatters. The photo GPS parser loads as a separate precached chunk on first photo selection, keeping it out of startup JavaScript while preserving offline use.

Snapshot merging and device copying index identities and canonical values rather than repeatedly scanning whole libraries. Bulk imports and category deletion batch record replacements while retaining record order, generations, revisions, flights and conflict metadata. Idle mutation checks and unchanged pulls do not write or broadcast a workspace. Photo synchronization reads cached identities without loading each blob and continues past an unavailable attachment to recover the rest.

Embedded public assets use the runtime's native base64 decoder through `node:buffer`; HEAD serves metadata without decoding a payload. The existing Node compatibility configuration remains in use. Static cache/security headers and exact asset bytes are unchanged.

D1 uses prepared statements. Better Auth is request-scoped and verifies provider proofs. Separate Places identities/sessions prevent implicit account merges by email text. Server authorization derives ownership from HttpOnly sessions and verifies the expected account header on private reads/writes.

The app and its service worker exist only on the Places Sites origin. The static promo builds separately and uploads only to one.com's places directory. It has no service worker or sibling-repository runtime dependencies.

The fixed-template email endpoint lives under places/mail/relay.php. Configuration and replay/rate-limit state stay outside every document root. No arbitrary message/header input is accepted.

One npm package, lockfile and Node 24 toolchain keep setup reproducible. Scripts own build/release operations. Account failure does not prevent guest saving/export.

App responses use the `same-origin` referrer policy: Safari retains the canonical Origin on same-origin writes, while cross-origin requests omit referrers. Explicit map-tile policy and protected outgoing links retain their existing behavior. Server origin checks continue to reject null, missing and foreign origins on account writes.

Compressed place photos use separate IndexedDB blobs and the existing private D1 database. No additional storage service, account or paid API is introduced. Shared image validation is independent of browser processing and server authorization.

App composition refreshes group metadata every five seconds while the authenticated app is online and visible, plus foreground/reconnection events. Account identity and request generations reject late responses across account changes or membership actions. The join-request feature presents only live-verified requests in owned groups and uses the existing server-authorized approve/decline endpoints; dismissals stay in account-session memory. Family membership is a server authorization boundary, independent of login identity. The shared workspace resolver verifies the actual account and optional family header before mapping requests to family storage. Management stays in a focused family module; existing record/photo synchronization is reused. Per-workspace synchronization locks and member-specific local keys prevent private/family and account-switch writes from crossing partitions.

Appearance is device-local: the existing preferences `theme` field stores Light/Dark/System and the validated `skin` field stores the independent visual theme. The same-origin blocking appearance initializer resolves root attributes before CSS paints; client composition tracks System changes and updates the browser theme color. Skin tokens/materials live separately from layout CSS, with no server or record-schema dependency.

The browser-only map-coordinate helper computes a shared minimal longitude arc for bounds and pins. Presentation never rewrites stored longitude. Invitation freshness uses owner-only opaque metadata computed in the server group module; no invitation code is cached. Import capacity reservations are transient workspace metadata, independent of the record/sync schema, and guard browser transactions while bounded photo blobs are staged.

Usage reporting is browser infrastructure, started and disposed by app composition. It has no dependency on account state, records or synchronization. Settings controls a separate device-local reporting preference. The Worker statistics module owns bounded anonymous reporting and public aggregate queries using the existing D1 binding. The static promo reads the aggregate endpoint with a hashed module asset; no one.com database or additional service is used.
