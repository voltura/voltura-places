# UI contract

Light is the default; Dark/System and English/Swedish are device preferences. Semantic CSS tokens, readable typography and restrained surfaces distinguish Places from Music's styling. Primary targets are at least 56px; regular targets at least 48px.

Save here stays in a safe-area bottom dock. Tap requests fresh high-accuracy GPS, shows progress and permits cancel. After local commit it opens a non-blocking editor. Defaults use localized date/time and last-used category (Other initially). Closing keeps the saved place. Editor drafts persist separately.

Cards expose name/category/date and Open maps. Search/category/sort use ordinary controls and scrolling. Desktop adds a details pane; mobile uses a sheet. Edit/share/delete are secondary. Destructive actions require confirmation. Core flows do not depend on gestures/hover/animation/map canvas.

First map opening asks for a provider and remembers it. OS/browser handlers control native-app opening. Sharing presents the irrevocable snapshot disclosure before share/copy. Settings separates preferences, categories, backups and accounts. Reconciliation/conflicts are explicit decisions. Status distinguishes local saving, pending operations, successful sync and failure.

Installed launches open the library. Service-worker updates wait for acceptance and preserve drafts/pending data. Private APIs are never HTTP-cached. Promo has no service worker. Physical-device/daylight checks remain distinct from emulation.
