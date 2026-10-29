# Asset provenance

The Places pin/check SVG is original project artwork. PNG app icons are deterministically rendered from it with resvg during build.

`scripts/branding.mjs` generates normal 192/512 icons, dedicated opaque safe-zone maskable icons, 152/167/180 Apple touch icons, small PNG/ICO favicons and a Windows tile icon. `assets/branding/apple-startup-devices.json` starts from an independent copy of Air's device catalogue, expanded with older Pro/Max and Mini sizes verified against Playwright's device descriptors: 16 iPhone/iPad screen/DPR combinations, both orientations and both system appearances (64 startup PNGs). Air is not imported or modified by the build.

Startup images show only the Places mark and name. Android's installed launch presentation uses the manifest icon/background. Startup images and social cards are excluded from Workbox precaching to avoid downloading every device variant on updates.

English/Swedish 1200×630 social cards are generated locally from project vector artwork and the checked-in Inter font. Inter was obtained from the Google Fonts repository (`ofl/inter/Inter[opsz,wght].ttf`); its SIL Open Font License is retained beside it. The font is a build input, not a browser font download. The promo publisher allows only the two localized, content-hashed social image names inside `/places/assets/`.

`site/assets/app-mobile.png` and `app-mobile-sv.png` are actual Chromium viewport captures of the local app at 390×844. Their three locations were entered manually as synthetic examples for screenshots, not captured from a person's position. English place names are user content and remain unchanged when the UI switches to Swedish. The promo labels these as example places.

The app uses system fonts and Lucide icons (ISC license). React, Better Auth, Zod and Workbox use their respective open-source licenses; bundled third-party license comments are retained by the build. No paid image, map, font or AI generation service is required.

# Photo test fixture

`tests/fixtures/photo.jpg` is a generated solid teal rectangle, with no personal imagery or location metadata.

`photo-gps.jpg` adds synthetic EXIF GPS (59.5, 18.25) to that rectangle to verify metadata parsing. It is not a real photograph or captured user position.
