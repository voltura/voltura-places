# Asset provenance

`public/flags/gb.svg` and `se.svg` are local vector drawings of the UK and Swedish flags for English/Svenska selection, following Music's country choices. They require no external image service or font support.

The Places pin/check SVG is original project artwork, with a dark forest surface and mint gradient matching the app’s default theme. PNG app icons are deterministically rendered from it with resvg during build.

`scripts/branding.mjs` generates normal 192/512 icons, dedicated opaque safe-zone maskable icons, 152/167/180 Apple touch icons, small PNG/ICO favicons and a Windows tile icon. `assets/branding/apple-startup-devices.json` starts from an independent copy of Air's device catalogue, expanded with older Pro/Max and Mini sizes verified against Playwright's device descriptors: 16 iPhone/iPad screen/DPR combinations, both orientations and both system appearances (64 startup PNGs). Air is not imported or modified by the build.

Apple touch icons use opaque square backgrounds for iOS corner masking. Startup images show only the Places mark and name. Android's installed launch presentation uses the manifest icon/background. Startup images and social cards are excluded from Workbox precaching to avoid downloading every device variant on updates.

English/Swedish 1200×630 social cards are generated locally from project vector artwork, the matching localized mobile screenshot and the checked-in Inter font. Inter was obtained from the Google Fonts repository (`ofl/inter/Inter[opsz,wght].ttf`); its SIL Open Font License is retained beside it. The font is a build input, not a browser font download. The promo publisher allows only the two localized, content-hashed social image names inside `/places/assets/`.

`site/assets/app-mobile.png` and `app-mobile-sv.png` are actual Chromium captures of the local app at 390×844, refreshed on 2 November 2026. They show List view with its List/Map switch. Native scrollbars are hidden only in the isolated capture session, preserving scrolling in the real app. Their three locations are synthetic examples, not captured from a person's position; example names do not describe actual businesses or destinations. Example place names are authored separately for the English and Swedish promo captures. Swedish examples use Svampar, Kafé vid sjön and Där vi parkerade; this is localized demo content, not automatic translation of user-saved names. The phone imagery has no caption or footer strip. Synthetic-content provenance is recorded here and in image alternative text. Desktop captures `site/assets/app-desktop.png` and `app-desktop-sv.png` are 1000×871 viewport captures of the same isolated library in Map view with a selected place. Capture-only 70% CSS zoom keeps the complete map, details preview and OpenStreetMap attribution visible. Background tiles are actual OpenStreetMap tiles; copyright attribution remains visible in both map surfaces. A separate temporary Playwright browser session isolates IndexedDB, preferences and mocked signed-out account responses from the user's review browser data. The selected mushroom example uses the owner-supplied mushroom photograph requested for the promo on 2 November 2026. It was imported through the app’s normal photo picker, which redraws/compresses the image without retaining source metadata; its example coordinates are synthetic and unrelated to the photograph. The original upload is not added to the repository or deployment. The promo uses straight device frames to avoid rotated screenshot edge seams.

The app uses system fonts and Lucide icons (ISC license). React, Better Auth, Zod and Workbox use their respective open-source licenses; bundled third-party license comments are retained by the build. No paid image, map, font or AI generation service is required.

# Photo test fixture

`tests/fixtures/photo.jpg` is a generated solid teal rectangle, with no personal imagery or location metadata.

`photo-gps.jpg` adds synthetic EXIF GPS (59.5, 18.25) to that rectangle to verify metadata parsing. It is not a real photograph or captured user position.
