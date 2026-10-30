# Voltura Places

**Save a place. Find your way back.** A mobile-first location library for the trailhead, the quiet clearing, and where you parked. Freeware with MIT-licensed source. English and Swedish.

Quick-save GPS positions, organize/search offline, open external map apps, share copies, import/export JSON, and optionally synchronize your phone/PC library. No paid map API, app store or runtime AI service.

Create named groups in Settings → Family sharing and generate a four-digit code for the selected group. The other person enters it in their own Places app and you approve their request. Each person can belong to several groups using one account. Choose a group before saving to share places and photos; personal places and other groups stay separate. Existing private places can be copied into a chosen group.

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
