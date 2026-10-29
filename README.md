# Voltura Places

**Save a place. Find your way back.** A mobile-first location library for the trailhead, the quiet clearing, and where you parked. Freeware with MIT-licensed source. English and Swedish.

Quick-save GPS positions, organize/search offline, open external map apps, share copies, import/export JSON, and optionally synchronize your phone/PC library. No paid map API, app store or runtime AI service.

App: https://places.voltura.se/ · About: https://voltura.se/places/

## Develop

```sh
npm ci
npm run setup
npm run dev
```

Node 24 LTS and npm 12. The complete local app runs at http://127.0.0.1:5174 with local D1. Optional `npm run dev:ui` starts Vite HMR on 5173. Local sign-in needs explicit local configuration; no real email is sent by tests.

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
