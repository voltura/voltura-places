# Data and interfaces

## Local persistence

IndexedDB voltura-places version 1 contains partitioned workspaces and drafts. Keys are guest or verified account ID. Entities have stable ID, kind, value, server revision, deletion flag, local generation, dirty flag and optional preserved conflict. Changes/pending state commit atomically before success. Capacity: 5,000 live places, 200 live categories.

Places contain name, categoryId, WGS84 latitude/longitude, nullable accuracy in metres, capturedAt and updatedAt. Categories contain name, semantic color, optional validated icon identifier and optional built-in translation key. Icons follow atomic local writes, sync, group copying and backup/import. Missing icons use presentation defaults without rewriting records. Legacy amber Mushrooms displays rose until its appearance is explicitly saved. The palette adds rose. Older strict-schema app versions must update before reading categories with icons or rose values; older backups remain supported. Missing/deleted categories display/export as Other. Local category deletion moves its places to Other in the same transaction.

Preset revision 2 adds Mushrooms/Svampar to existing workspaces atomically on first read, without changing renamed categories, tombstones, drafts or in-flight requests. It queues the new category for reconciled accounts. Full category libraries defer the addition until a slot is available. Later deletion of this preset is respected. New workspaces start with all six presets.

Editor saves commit the record, pending state and removal of that record's matching draft in one transaction. Place deletion also removes only its matching draft atomically. Queued draft writes settle before these operations and before account/device removal enumerates partitions. A draft cleanup failure rolls back the record change rather than leaving a successful save behind an error. Local entity writes validate the shared schema before committing.

An editor retains its original value as a comparison base. If a clean cloud record changes or is deleted while the editor is open, saving preserves both the edited and current cloud versions as a conflict. A stale editor cannot overwrite a newer unsynced edit from another tab. Editing an existing conflict retains its recovery version; Keep both creates a fresh record without inheriting the original conflict metadata.

## Sync v1

GET /api/v1/sync returns `{version:1,accountId,records}`. POST accepts `{version:1,mutationId,baseRevision,deleted,entity}` and returns the accepted record or 409/current record. Require a Places session and matching X-Places-Account header. Writes also require the canonical Origin.

Reads use 250-record pages with `nextCursor`; pass it as `?after=` for the next page. Pull up to 50,000 records including deletion history, so tombstones do not consume the live-place capacity. A boundary failure preserves the local workspace.

Persist exact in-flight bodies before network access. D1 atomically commits CAS record changes and body-hashed receipts. Same-ID/same-body retries return receipts; changed bodies are rejected. Tombstones/receipts persist until account deletion. Device clocks never select winners.

Independent record edits merge. Identical concurrent writes converge on the cloud revision, preserving any newer device edits. Different same-record conflicts retain both versions. Keep device rebases on the cloud revision; Keep cloud accepts it; Keep both accepts cloud and creates a fresh device identity. Guest/account workspaces and pending writes remain partitioned. Normal sign-in copies new guest places automatically into the private account library; a different account than the last used on this browser requires explicit approval when unhandled guest places exist. Guest deviceAccounts tracks account history; account guestPlaces maps handled guest IDs to stable destination IDs or null for an explicit skip. Copy identities derive from account/source IDs so losing the account cache does not duplicate a cloud copy or resurrect its tombstone. Records, pending writes, transfer receipts and device account history commit in one IndexedDB transaction after photo preparation; failure/cancellation commits none of those changes. Previously copied guest originals stay independent: later account edits/deletions are preserved, and later guest edits do not overwrite a handled copy. New guest IDs are considered on returning sign-in. Legacy identical records are reused; legacy reconciled workspaces supply conservative account history when explicit history is absent. Account snapshots are validated before setup; existing reconciled workspaces retain local pending writes. Guest originals remain available after sign-out.

Snapshot pages reject duplicate identities and identities behind the requested cursor. A pull cannot change an existing record's kind or roll back its revision or preserved conflict. Acknowledgements likewise reject kind changes and retain newer cloud conflicts or an already accepted newer cloud version. Equal record values compare independently of object-property insertion order. New deletion markers remain writable when live capacity is full. Missing optional presets are added only while category capacity allows. A discarded synchronization operation cannot report a new status into its former view.

Denied or unavailable Web Locks fall back to the same transactionally persisted flight and server-receipt path. Account/workspace cancellation is checked between snapshot pages, preventing discarded pulls from fetching additional pages.

JSON write bodies must be bounded UTF-8 objects with an application/json media type. Malformed JSON/encoding or non-object bodies return 400, unsupported media types return 415, oversized bodies return 413, and entity/action schema failures return 422. Sync and group endpoints preserve these client-error statuses without changing stored data.

## Backup and sharing v1

Backup JSON: `{format:"voltura-places",version:1,exportedAt,places:[{id,value}],categories:[{id,value}]}`. Backups with photos use version 2 and add `photos:[{id,data}]` with JPEG data URLs; version 1 remains supported. Exclude credentials, drafts, sync operations, revisions and tombstones. Require finite coordinate ranges, bounded names, unique IDs, an Other category, valid category references and complete, valid photo attachments. Files are limited to 80 MiB.

Validate completely before one transaction. Merge retains conflicting existing values and gives incoming copies new identities; Replace tombstones missing entries. Import then uses normal sync. Reject unknown versions without modifying storage. New versions require documented compatibility.

Shared links: `/#place=<base64url UTF-8 JSON>` containing `{version:1,name,category,latitude,longitude}`. Validate and remove the fragment from the address bar after reading. Anyone holding the original link can read it; no expiry/revocation. Saving creates a new identity.

Merge imports preserve existing deletion markers by recovering incoming deleted identities under new IDs. Place/category ID collisions are remapped in both merge and replace modes, including category references. Unchanged categories do not create unnecessary pending writes. Incoming share fragments are consumed on launch and subsequent hash changes; malformed place fragments are also removed after validation.

## Family libraries

Migration 0003 introduces shared family libraries. Migration 0005 preserves existing memberships while allowing an account to belong to up to twenty groups, each with at most ten members. Every group has its own non-login storage account, records, photos and mutation receipts. The owner manages that group's membership; every member can read/add/edit/delete its shared content. Personal records remain separate. Copy to group lets the user choose the destination group, creates an independent record/photo copy and matches categories by name; it does not move or subsequently mirror the private original.

`GET /api/family` returns the `families` array, member identity labels and an optional pending request. Group management mutations require an explicit `familyId`; create returns the affected ID alongside the current list. There is no implicit primary group or parallel single-group API. Authentication and `X-Places-Account` always identify the actual person. Sync/photo requests additionally supply `X-Places-Family`; the server resolves membership to storage ownership. SQL reads and CAS/photo writes include membership predicates. Revisions, tombstones, conflicts and idempotency apply independently in each library. Joining another group does not leave an existing one.

The default invitation is a four-digit code entered inside the recipient's own installed app under Family sharing. Migration 0004 stores hashed, unique active codes, pending requests and attempt counters in the same D1 database. New codes have no time limit and are consumed by one successful approval or cancellation. The existing numeric expires_at/expiresAt field uses zero for no expiry; previously issued timed codes keep their original expiry. Pending requests stay available until approval, rejection, rotation or cancellation. Entering a code requires sign-in and creates a request, granting no membership, locations, family name or photos. Only the current owner can see requesting identity labels and explicitly approve or decline. Approval atomically checks the current code, any legacy expiry, membership capacity and owner; then consumes the code and cancels other requests. Rotation/cancellation clears pending requests. Codes are not access credentials; owner approval is essential because four digits can be guessed.

Code entry and generation are limited independently to five attempts per account per fifteen minutes, plus twenty per trusted proxy IP where available. Only a hash of that IP is stored in bounded, expiring rate-limit state. At most five pending requests are retained per code. Family settings poll every five seconds while visible/online, without overlapping requests, so owners see requests and recipients see approval. No code is logged or retained in browser storage.

Code request plus owner approval is the sole group invitation mechanism. Migration 0006 removes unused URL invitation tokens; existing memberships and place/photo data remain. Old group-invitation links no longer grant access. Location snapshot sharing links remain a separate feature. No messages are sent by the app.

Local workspace/draft/photo keys are `family:<signed-in-account-id>:<family-id>`, separating each person's cached data and pending writes. The metadata cache migrates older single-group entries and retains every known active or read-only group. Normal launch, foreground, reconnection and visible-page polling synchronize the selected library. Offline writes queue normally. After membership ends, the last downloaded copy remains readable/exportable locally and cloud operations are denied for that group. Removal cannot recall downloaded copies or exports, and does not affect another group's membership or records.

Visible-page polling refreshes memberships as well as records. The selected group keeps its stable identity and metadata when other groups are added, removed or joined elsewhere. Account transitions discard transient dialogs and cancel pending import/reconciliation/photo work. Sync responses received after a workspace is deselected cannot acknowledge or restore its data; the persisted flight remains available for an idempotent retry if that account returns.

An owner must transfer ownership or delete each group they own before deleting their account; leaving an owned group requires resolving that group first. Family deletion cascades shared cloud data and memberships, preserving personal libraries. Existing photo limits apply separately to shared storage. Account/device removal clears that person's local private and family partitions without clearing another person's copies.

An existing invitation applicant can repeat their request when all five pending slots are occupied, without taking an additional slot. Automatic device copying that fails for a library/photo limit or a missing source photo offers the explicit keep-on-device choice, allowing account-only access while preserving guest originals.

## Privacy/recovery

On launch, Places checks persistent-storage permission and requests it automatically when supported and not already granted. This best-effort browser request never blocks launch or local saving; denial, missing APIs and errors are tolerated. Backup settings retain a manual retry. The browser decides whether to grant persistence; this is neither encryption nor a backup, and explicit clearing of website data still removes local copies.

GPS is explicit, never background-tracked. No end-to-end encryption claim. The app does not encrypt local copies/exports. Cleared browser storage loses unsynced data; cloud sync and exports provide recovery. Account deletion cascades records, identities, sessions and receipts.

Sign-out invalidates both the Places session and the short-lived Better Auth proof session. A pending offline logout is account-specific; a server account-change response clears the stale marker instead of trapping the next account in a retry loop. Disabled account configuration denies family/photo capabilities as well as personal synchronization.

Account metadata changes in another tab trigger a fresh account check. Browser settings-storage failures do not prevent online account discovery; a failed logout retains an in-memory retry marker when browser settings cannot persist it. Export preparation and photo retrieval stop when their originating account is discarded.

## Photos

Photo writes recheck cancellation inside their transaction. Open photo views observe newly stored bytes and retry on reconnection. Upload preparation recovers an already-cloud-backed photo when its local blob is missing. Copying into another workspace remaps colliding photo IDs when the bytes differ, reuses an equal destination image when available, and preserves both original images.

Places optionally reference one immutable `photoId`. Camera/library inputs decode and re-encode to JPEG (maximum 1280 pixels per side, 256 KiB), stripping source metadata. Separate IndexedDB `voltura-places-photos` version 1 stores workspace-partitioned blobs without blocking older tabs on a main-database upgrade. Persist the photo before its place/draft reference; interrupted writes can leave an unreferenced photo, never a successful place save without its local photo.

The client reads original photo GPS locally with pinned MIT library exifr before compression. Only an explicit Use photo location action changes the place position; camera metadata itself is not uploaded. Missing, malformed or picker-stripped metadata is a normal fallback. Browser image decoding still determines which image formats can be attached.

Private `/api/v1/photos/:id` GET/PUT requires the session and expected account; PUT also checks canonical Origin, bounded JPEG headers/dimensions and immutable content hash. D1 migration 0002 stores blobs in the existing database. Upload photos before syncing their place references and download referenced cloud/conflict photos for offline use. `X-Places-Photos: 1` opts into photo references; older clients receive compatible records and their edits preserve existing photos.

Each workspace/account permits 50 MiB and 1,000 stored photos. Replaced/removed image blobs remain private until account deletion or local workspace removal, and count toward this limit. Account deletion cascades cloud photos. Shared snapshot links exclude photos. Guest photos cross into an account only through explicit guest-library reconciliation. Photo backups validate before writing; storage failures preserve existing places.

## Recovery follow-up — 0.1.2

Editor drafts retain the original entity comparison base; legacy restored drafts with no trustworthy base preserve a conflicting current version instead of silently overwriting it. Discard removes only the matching draft identity. Snapshot merge, mutation preparation and acknowledgements recheck workspace cancellation inside their IndexedDB transactions. Identical higher-revision pull values converge without conflict.

A capacity-rejected exact mutation can be deferred durably while freeing deletion mutations run, then resumes with its original request ID/body. Uncertain network failures retain the original flight. Deferred flights block imports just like active flights.

Imports validate the merged capacity before persisting photo bytes and reserve that capacity against other current-client tabs during the photo/record commit phase. Reservations expire after five minutes after interruption and are removed without recreating a deleted workspace. Concurrent writes during an active reservation return syncBusy. Browser decoding verifies imported/downloaded image data in addition to shared JPEG table/frame/scan structural checks; photo decoding is sequential to bound phone memory. Photo ID collisions reuse equal destination bytes so repeating the same backup does not add duplicate places. Group copying recovers cloud-backed source photos and reuses categories by name.

Group responses expose an opaque, secret-derived invitation version to the current owner only, or null when no active invitation remains. It cannot be used as an invitation code. The owner UI compares it while polling to invalidate consumed, cancelled or rotated in-memory codes; numeric codes are still never stored in browser settings. Membership refreshes preserve the composition's in-memory inactive groups when settings storage is unavailable.
