# Data and interfaces

## Local persistence

IndexedDB voltura-places version 1 contains partitioned workspaces and drafts. Keys are guest or verified account ID. Entities have stable ID, kind, value, server revision, deletion flag, local generation, dirty flag and optional preserved conflict. Changes/pending state commit atomically before success. Capacity: 5,000 live places, 200 live categories.

Places contain name, categoryId, WGS84 latitude/longitude, nullable accuracy in metres, capturedAt and updatedAt. Categories contain name, semantic color and optional built-in translation key. Missing/deleted categories display/export as Other. Local category deletion moves its places to Other in the same transaction.

Preset revision 2 adds Mushrooms/Svampar to existing workspaces atomically on first read, without changing renamed categories, tombstones, drafts or in-flight requests. It queues the new category for reconciled accounts. Full category libraries defer the addition until a slot is available. Later deletion of this preset is respected. New workspaces start with all six presets.

## Sync v1

GET /api/v1/sync returns `{version:1,accountId,records}`. POST accepts `{version:1,mutationId,baseRevision,deleted,entity}` and returns the accepted record or 409/current record. Require a Places session and matching X-Places-Account header. Writes also require the canonical Origin.

Reads use 250-record pages with `nextCursor`; pass it as `?after=` for the next page. Pull up to 50,000 records including deletion history, so tombstones do not consume the live-place capacity. A boundary failure preserves the local workspace.

Persist exact in-flight bodies before network access. D1 atomically commits CAS record changes and body-hashed receipts. Same-ID/same-body retries return receipts; changed bodies are rejected. Tombstones/receipts persist until account deletion. Device clocks never select winners.

Independent record edits merge. Identical concurrent writes converge on the cloud revision, preserving any newer device edits. Different same-record conflicts retain both versions. Keep device rebases on the cloud revision; Keep cloud accepts it; Keep both accepts cloud and creates a fresh device identity. Guest/account workspaces and pending writes remain partitioned. First sign-in explicitly reconciles guest merge or cloud-only.

## Backup and sharing v1

Backup JSON: `{format:"voltura-places",version:1,exportedAt,places:[{id,value}],categories:[{id,value}]}`. Backups with photos use version 2 and add `photos:[{id,data}]` with JPEG data URLs; version 1 remains supported. Exclude credentials, drafts, sync operations, revisions and tombstones. Require finite coordinate ranges, bounded names, unique IDs, an Other category, valid category references and complete, valid photo attachments. Files are limited to 80 MiB.

Validate completely before one transaction. Merge retains conflicting existing values and gives incoming copies new identities; Replace tombstones missing entries. Import then uses normal sync. Reject unknown versions without modifying storage. New versions require documented compatibility.

Shared links: `/#place=<base64url UTF-8 JSON>` containing `{version:1,name,category,latitude,longitude}`. Validate and remove the fragment from the address bar after reading. Anyone holding the original link can read it; no expiry/revocation. Saving creates a new identity.

## Family libraries

Migration 0003 adds one family membership per account, with at most ten members. A family has its own non-login storage account, records, photos and mutation receipts. The owner manages membership; every member can read/add/edit/delete shared content. Personal records remain separate. Copy to family creates independent records and photos, matching categories by name; it does not move or subsequently mirror the private original.

`GET /api/family` returns the current family and member identity labels. Canonical-origin POST actions create, invite, revoke, preview, join, remove, leave, transfer or delete. Authentication and `X-Places-Account` always identify the actual person. Family sync/photo requests additionally supply `X-Places-Family`; the server resolves membership to storage ownership. SQL reads and CAS/photo writes include membership predicates. Existing revisions, tombstones, conflicts and idempotency apply independently in each library.

Invitations use 32 random bytes in `/#family=<base64url token>`. Only a SHA-256 hash is stored. Links expire after seven days, admit one account, and are replaced/revoked by the owner. Acceptance requires sign-in and explicit confirmation; a retry by the accepted member is idempotent. The fragment is removed after reading and retained only in session storage while completing sign-in. Anyone holding an unused link can join, so users share it privately. No messages are sent by the app.

Local workspace/draft/photo keys are `family:<signed-in-account-id>:<family-id>`, separating each person's cached data and pending writes. Normal launch, foreground, reconnection and visible-page polling synchronize the selected library. Offline writes queue normally. After membership ends, the last downloaded copy remains readable/exportable locally and cloud operations are denied. Removal cannot recall downloaded copies or exports. Export an old family copy before joining another family; the settings shortcut tracks only the latest family.

Visible-page polling refreshes membership as well as records. A different family discovered on another device returns this device to its private library, so old cached places cannot be presented under the new family's name. Account transitions discard transient dialogs and cancel pending import/reconciliation/photo work. Sync responses received after a workspace is deselected cannot acknowledge or restore its data; the persisted flight remains available for an idempotent retry if that account returns.

The owner must transfer ownership to an existing member or delete the family before leaving/deleting their account. Family deletion cascades shared cloud data and memberships, preserving personal libraries. Existing photo limits apply separately to shared storage. Account/device removal clears that person's local private and family partitions without clearing another person's copies.

## Privacy/recovery

GPS is explicit, never background-tracked. No end-to-end encryption claim. The app does not encrypt local copies/exports. Cleared browser storage loses unsynced data; cloud sync and exports provide recovery. Account deletion cascades records, identities, sessions and receipts.

Sign-out invalidates both the Places session and the short-lived Better Auth proof session. A pending offline logout is account-specific; a server account-change response clears the stale marker instead of trapping the next account in a retry loop. Disabled account configuration denies family/photo capabilities as well as personal synchronization.

## Photos

Places optionally reference one immutable `photoId`. Camera/library inputs decode and re-encode to JPEG (maximum 1280 pixels per side, 256 KiB), stripping source metadata. Separate IndexedDB `voltura-places-photos` version 1 stores workspace-partitioned blobs without blocking older tabs on a main-database upgrade. Persist the photo before its place/draft reference; interrupted writes can leave an unreferenced photo, never a successful place save without its local photo.

The client reads original photo GPS locally with pinned MIT library exifr before compression. Only an explicit Use photo location action changes the place position; camera metadata itself is not uploaded. Missing, malformed or picker-stripped metadata is a normal fallback. Browser image decoding still determines which image formats can be attached.

Private `/api/v1/photos/:id` GET/PUT requires the session and expected account; PUT also checks canonical Origin, bounded JPEG headers/dimensions and immutable content hash. D1 migration 0002 stores blobs in the existing database. Upload photos before syncing their place references and download referenced cloud/conflict photos for offline use. `X-Places-Photos: 1` opts into photo references; older clients receive compatible records and their edits preserve existing photos.

Each workspace/account permits 50 MiB and 1,000 stored photos. Replaced/removed image blobs remain private until account deletion or local workspace removal, and count toward this limit. Account deletion cascades cloud photos. Shared snapshot links exclude photos. Guest photos cross into an account only through explicit guest-library reconciliation. Photo backups validate before writing; storage failures preserve existing places.
