# UI contract

Dark is the default for a new installation; existing saved theme choices are preserved. Light/System and English/Swedish are device preferences. Semantic CSS tokens, readable typography and restrained surfaces distinguish Places from Music's styling. Primary targets are at least 56px; regular targets at least 48px.

Save here stays in a safe-area bottom dock. Tap requests fresh high-accuracy GPS, shows progress and permits cancel. After local commit it opens a non-blocking editor. Defaults use localized date/time and last-used category (Other initially). Closing keeps the saved place. Editor drafts persist separately.

Cards expose name/category/date and Open maps. Search/category/sort use ordinary controls and scrolling. Desktop adds a details pane; mobile uses a sheet. Edit/share/delete are secondary. Destructive actions require confirmation. Core flows do not depend on gestures/hover/animation/map canvas.

Keep the application functional and quiet: no slogans, decorative empty-library illustration, exploration copy, or unselected details welcome panel. An empty library gives one short Save here instruction. Show Works offline once in the save dock. Desktop uses a centred library until a selected place needs the details column. Product promotion belongs on the separate promotional site.

First map opening asks for a provider and remembers it. OS/browser handlers control native-app opening. Sharing presents the irrevocable snapshot disclosure before share/copy. Settings separates preferences, categories, backups and accounts. Reconciliation/conflicts are explicit decisions. Status distinguishes local saving, pending operations, successful sync and failure.

Modal sheets keep their header/close button visible and scroll only their inner content. Scrollbars stay inside the rounded panel, follow the theme, and do not scroll the background page. Normal page scrolling resumes when every sheet is closed.

Toasts belong to the active modal when one is open, so copy confirmations/errors remain visible and accessible above its backdrop. Closing the modal returns remaining feedback to the page.

Account settings explicitly say Signed in or Not signed in. A signed-in account shows each distinct identity label once, explains automatic sync, and keeps Sync now/Sign out together. Optional linking lives under Sign-in methods and uses Link labels; Continue labels are reserved for signing in.

Installed launches open the library. Service-worker updates wait for acceptance and preserve drafts/pending data. Private APIs are never HTTP-cached. Promo has no service worker. Physical-device/daylight checks remain distinct from emulation.

Users never type latitude/longitude. Save here requests the phone/browser location API and immediately persists the returned fix. Add place and the editor offer Use current location; a selected photo with valid embedded GPS offers Use photo location as an explicit choice. Photos without readable GPS explain the fallback. Existing positions are not silently moved by attaching a photo. Accuracy is reported from the device, not promised; a new GPS selection updates accuracy/capture time and photo positions have unknown accuracy.

Preferences includes Review GPS accuracy before saving (off by default, persisted per device). When on, Save here and the editor's Use current location open a live review instead of accepting the first fix. Request high-accuracy watchPosition with no cached fixes. Display the latest valid estimate in metres, its age and four qualitative bars: ≤10 m, ≤20 m, ≤50 m, >50 m. These are UI thresholds, not guarantees or GPS signal strength. Estimates may improve or worsen as fresh fixes arrive.

Distance units is a separate persisted preference: Metres (m, default) or Feet (ft). It applies to the live review, editor and saved-place details. Round displayed radii upward; unit selection never changes stored metre accuracy, coordinates, quality thresholds or backup/sync data.

The user confirms Use this position when satisfied; no place is created before confirmation. An editor confirmation updates only its draft until Save changes. Cancel preserves the library/editor draft. Reject invalid fixes and positions older than 15 seconds; disable confirmation once a displayed fix becomes stale. Stop watching on close, confirmation, account change, error, or after one minute. Retry starts a fresh bounded session. Permission/timeout/unavailable errors remain recoverable. Existing quick-save behavior is unchanged when the option is off.

Each editor offers Take photo (rear-camera capture hint), Choose photo (normal image picker), preview and Remove photo. One compressed image belongs to each place and follows saved drafts, offline use, cloud sync and JSON backups. Unsupported image formats show recovery feedback without replacing the previous photo. Native capture behavior depends on the device/browser.

Visible tabs check for updates every minute and on foreground/reconnection, with a manual Check for updates action in Preferences. Prompts appear above Settings or inside the editor. Accepting an update flushes drafts before all controlled tabs reload. Older clients need one refresh to receive this update-checking behavior.
