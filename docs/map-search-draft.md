# Draft: In-app map search for Swedish place names

Search for places outside the saved library without leaving Voltura Places. The first version covers Swedish place names from Lantmäteriet's Ortnamn Direkt, including villages and named outdoor locations.

## Search and browse

- Keep the library search local and available even in an empty library. When a non-blank query returns zero matches, show **Map search** beside **Clear search** under **No matching places** in both List and Map. Keep **Clear filters** as the label when category or status filters are active. Filter-only empty states retain their existing behavior.
- For a query like `Slåboda`, tapping **Map search** opens a dedicated in-app results view and submits the prefilled query. Let the user edit it and submit again. Back restores the library query, filters, view, scroll position, and focus when the original control is still available.
- Reuse the existing Leaflet map and background preferences. Fit to the returned pins and show an accessible results list beneath the map on phones. Tapping a row or pin selects the same result and highlights it on both surfaces. Show municipality and county to distinguish places with the same name. Keep the results list usable when the map or tiles are unavailable.
- Localize the experience in English and Swedish. Show short, distinct messages for loading, no results, offline, and temporary failure. Offer retry after a transient failure and query refinement after no results. Credit Lantmäteriet in the results.

## Order by distance

- If Places already has a recent device location, sort the returned matches nearest first by straight-line distance. Use the existing distance helper and freshness policy, show distances in the user's preferred units, and use provider order for ties. Distance sorting applies to the returned matches, which are limited to 10 placements.
- Without a fresh position, start in provider order and offer **Sort by distance**. Only that explicit action may prompt for location permission. If location is denied, unavailable, or expires, keep the list usable in provider order and omit distances. Preserve the selected result when ordering changes. Distance calculation stays in the browser.

## Add to the library

- Selecting a result offers **Add place** in a writable library. Open the existing editor with an editable name and the provider's coordinates prefilled. Treat the coordinates as a map location with unknown GPS accuracy. Confirming Save uses the existing workspace authorization and atomic save path. Guests save to their guest library and signed-in users save to the active writable library.
- Keep results and selections in memory, separate from saved records and library counts. Cancelling the editor creates no saved record. Read-only libraries allow browsing and selection. Cancel or discard stale searches on resubmission, dismissal, or an account or library change. Recheck the workspace before opening the editor and on save.

## Search service

- Add a same-origin Sites Worker endpoint available to guests and signed-in users. Send only the explicitly submitted, trimmed query to Lantmäteriet. Validate its length, rate-limit requests, and enforce an upstream timeout. Keep queries, device locations, result coordinates, and credentials out of logs.
- Validate provider responses and return up to 10 placements with an ID, name, municipality, county, latitude, and longitude. Preserve separate placements for a name and verify coordinate conversion and axis order against the API response format. Return distinct outcomes for no results, rate limiting, and temporary provider failure. Keep credentials in Sites secrets. This flow requires no database migration. [Ortnamn Direkt API reference](https://geotorget.lantmateriet.se/dokumentation/GEODOK/21/latest/atkomst-och-leverans/teknisk-beskrivning.html)

## Lantmäteriet access for Voltura AB

1. **Organisationskonto** Voltura AB has Geotorget account. This is the personal login used to manage the company's access in Geotorget. [Accounts and permissions](https://www.lantmateriet.se/sv/geotorget-produktstod/guider/konton-och-behorigheter/)
2. **Systemkonto.** **Mitt konto → Behörigheter** and order a dedicated **PROD** system account for Voltura Places is created. A separate **VER** system account is also created for using Lantmäteriet's verification environment. [Accounts and permissions](https://www.lantmateriet.se/sv/geotorget-produktstod/guider/konton-och-behorigheter/)
3. **Ortnamn Direkt access.** Open **Beställning** on the product page, assign the API permission to the intended system account, and verify the entitlement in Geotorget. The product listing shows no fee. [Ortnamn Direkt](https://geotorget.lantmateriet.se/geodataprodukter/ortnamn-direkt-api)
4. **OAuth 2.0 credentials.** Sign in to the API portal with the system account, configure a permission group for Ortnamn Direkt, and generate its application credentials. Store those credentials in Sites secrets. [API access instructions](https://geotorget.lantmateriet.se/dokumentation/GEODOK/21/2.1_utgaende/atkomst-och-leverans.html)
   Need help to configure these, i am logged in as prod system account in chrome.

## Verification and rollout

- Cover blank and matching queries, empty libraries, active filters, and return navigation in both List and Map. Use mocked responses for `Slåboda`, duplicate names and multiple placements, invalid coordinates, no results, rate limits, timeouts, offline mode, and stale responses after a library change.
- Verify distance order, ties, unit display, expired location, and denied permission. Verify that confirmed guest, private, and writable-group saves go to the correct library, that cancellation creates no saved record, and that read-only access and a mid-flow workspace change cannot write to the wrong library.
- Run `npm run format`, `npm run check`, relevant tests, and the production build. Use the shared preview at `http://127.0.0.1:5173/` for phone and desktop review and collect feedback. Verify location permission and touch behavior on a physical phone separately from emulation.
- Verify `Slåboda` and other small Swedish place names with live credentials before enabling production access. Coverage for `Slåboda` is still unverified. Update the existing UI, architecture, deployment, and verification docs as the behavior is implemented and verified.
