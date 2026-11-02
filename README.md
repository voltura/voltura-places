# Voltura Places

**Save a place. Find your way back.** A mobile-first location library for the trailhead, the quiet clearing, and where you parked. Freeware with MIT-licensed source. English and Swedish.

Save GPS positions on your device, then name them, choose a category or add a photo. **Save with details** can start from GPS, a photo’s embedded location or manually entered coordinates. Browse List or Map with shared search and category filters, open places or directions in Google Maps or Apple Maps, share a snapshot link, and import/export JSON backups. Optional account sync brings places and photos to your other devices when online. Signing in automatically adds device places to Private places, with safe retries; their device originals are cleared only after the account save is confirmed.

- **Private places and separate groups.** Choose a library before saving. Each group has its own places, photos and members; private places stay private. Copy a private place to a chosen group while keeping the original independent.
- **Invite from inside the app.** In Settings → Family sharing, create a named group and share its four-digit code. The recipient signs in and enters it in their own app; the owner approves the request. Codes remain available until approved or cancelled. One account supports up to 20 groups, with up to 10 members each. Members can add, edit and delete shared places and photos.
- **List and Map.** Explore clustered category-coloured pins, select a place for details, or expand the map to fullscreen. Place details include a map preview. Saved places remain available offline; map backgrounds require internet and have no downloadable regions.
- **A readable interface.** Dark by default, with Light/System themes, English/Swedish, 12 category colours and 48 icons, optional English/Swedish category names with a one-name fallback, large phone controls, and a desktop details pane.
- **Offline and recovery.** Saves commit locally before success. Signed-in changes sync when online. Settings → Backup offers device-storage retention and JSON backups; browser data can still be cleared, so keep exports. Downloaded group copies remain readable/exportable after access ends.
- **Install from your browser.** Open Places first. iPhone Safari: menu beside the address bar → Share (or the visible Share button) → View More if needed → Add to Home Screen → Add, keeping Open as Web App enabled when shown. Android Chrome: More → Install and create shortcut → Install. No app store, paid map API or runtime AI service.

![Current dark Places interface with synthetic example places](site/assets/app-mobile.png)

App: https://places.voltura.se/ · About: https://voltura.se/places/

## Develop

```sh
npm ci
npm run setup
npm run dev
```

Node 24 LTS and npm 12. `npm run dev` runs the local API/built app with local D1 on port 5174. For visual review, run `npm run dev:ui` and always use http://127.0.0.1:5173/. It updates live with changes in this checkout and reuses an existing matching preview. If another app or checkout owns the port, startup reports a conflict instead of selecting a different port. Local sign-in needs explicit local configuration; no real email is sent by tests.

The optional Wrangler database explorer is disabled because this pinned release omits its UI bundle; local D1 and the app remain available.

```sh
npm run check
npm test
npm run build
npm run test:api
npm run test:auth
npm run test:browser
```

See [documentation](docs/README.md). Browser-local data can be cleared/evicted; account sync and exports provide recovery. Shared links and exports contain location data.

## Publish

`npm run publish` checks and publishes the exact clean-main commit through Sites. `npm run publish:promo -- --dry-run` reviews the one.com upload list without connecting. Public GitHub owns reviewed source; Sites keeps its deployment source mirror. The promo publisher cannot write outside `/places/`.

Sites is currently included with eligible OpenAI subscriptions during public beta, subject to usage limits and future policy. No additional services or credits are purchased by the scripts.
