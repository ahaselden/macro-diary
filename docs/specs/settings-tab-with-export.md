# Spec: Settings tab replaces More; Export lives at the bottom of Settings

## Purpose
The fifth bottom-nav button becomes "Settings" and opens the Settings page directly, so the "More" hub and the separate Export page disappear. The whole Export UI moves into Settings as the last group of cards, just before the Backup card.

Owner request (verbatim): "Instead of the 'More' button. Let's change that to settings. Add the export data to the bottom of the settings before the backup card".

No saved-shape change, no `SCHEMA_VERSION` bump (stays 8), `STORAGE_KEY` unchanged, no new shipped file (`SHELL` in `sw.js` unchanged), `sw.js` `CACHE` goes from `macro-diary-v54` to `macro-diary-v55`.

## Contract

| Piece | Layer / file | Shape |
|---|---|---|
| Nav | `index.html` `nav.tabs` | Exactly five buttons: Diary, Plan, Recipes, Shop, then `<button data-tab="settings"><span>⚙️</span>Settings</button>`. No `data-tab="more"`, no text "More" |
| Removed markup | `index.html` | `#v-more`, `#moreExport`, `#moreSettings`, `#v-export` (the section wrapper), every `‹ More` back button (`.back-more`, `[data-more]`) |
| Settings page | `index.html` `#v-settings` | Card order: Units, Daily goals, Appearance (`#themeToggle`), Food databases, Sync between devices, then the Export group, then Backup. Export group, in order: card with `<h2>Export your data</h2>` + `#xKind` + `#xDate` + `#xRange`; `#xStats` card; `#xTable` card (class `card tscroll`); buttons card with `#xEntries #xSummary #xJson #xShare`. All export ids unchanged, each appears once, all inside `#v-settings` |
| `showTab(name)` | `js/ui/tabs.js` | `NAV_PARENT` removed. Known view: shows `#v-<name>`, highlights nav button `data-tab=name`, `#datebar` visible only for `diary`, calls the registered callback, scrolls to top. **Unknown name (old `'more'`, `'export'`, anything without a `#v-<name>` view): falls back to `'diary'`** (decided here: must not throw, must not leave every view hidden; diary is the app's home). Exactly one `.view` has class `on` afterwards |
| `initTabs()` | `js/ui/tabs.js` | Wires only the nav buttons. Must not touch `#moreExport`, `#moreSettings` or `[data-more]` (they no longer exist; `$('#moreExport').onclick` would throw on null) |
| Settings `onShow` | `js/ui/settings-view.js` | The single `registerTab('settings', ...)` callback now also calls `renderExport()` (imported from `./export-view.js`). It still calls `setThemePanel(false)`, `setKeyEditor(false)`, `resetKeyEditor()`, `loadSettings()` |
| `export-view.js` | `js/ui/export-view.js` | Still exports `renderExport` and `initExport`; no longer calls `registerTab` (the `registerTab('export', ...)` line is deleted). `xData`, `exportFiles`, D48 columns, CSV/JSON/share behaviour unchanged |

Decided: `registerTab` keeps ONE callback per tab, so the export refresh is called directly from the settings callback (ui to ui import, no new mechanism). `export-view.js` must not import `settings-view.js` (no cycle).

## Behaviours (tick each)
1. `index.html` nav has exactly five buttons; the fifth is `data-tab="settings"`, contains the emoji ⚙️ and the text `Settings`; no `data-tab="more"`, no `⋯`, no word `More` anywhere in the nav.
2. `index.html` no longer contains `v-more`, `moreExport`, `moreSettings`, `data-more`, `back-more`, `id="v-export"`.
3. `#v-settings` order: Units, Daily goals, `#themeToggle`, Food databases, Sync between devices, Export your data, `#xKind`, `#xDate`, `#xRange`, `#xStats`, `#xTable`, `#xEntries`, `#xSummary`, `#xJson`, `#xShare`, Backup. Each export id appears exactly once in `index.html` and inside `#v-settings`; `#xTable` card keeps class `tscroll`.
4. `showTab('settings')` (fake DOM): `#v-settings` is the only `.view` with `on`, nav `settings` highlighted, `#datebar` hidden, registered settings callback called once, `scrollTo(0,0)` called.
5. `showTab('diary')` shows `#datebar` again (display `''`) and highlights Diary.
6. `showTab('more')`, `showTab('export')`, `showTab('nope')`, `showTab(undefined)`, `showTab('__proto__')`, `showTab('constructor')` do not throw, and end on the diary view (only `#v-diary` has `on`, Diary highlighted, `#datebar` visible, diary callback called).
7. `initTabs()` with a DOM that has only the five nav buttons does not throw; clicking the Settings button shows settings.
8. Source: `tabs.js` has no `NAV_PARENT`, no `moreExport`, `moreSettings`, `data-more`; no file under `js/` (except vendor) mentions `data-more`, `moreExport`, `moreSettings`, `v-more`, or `'more'` as a tab name.
9. Source: exactly one `registerTab('settings'` under `js/`; no `registerTab('export'` anywhere; the settings callback calls `renderExport(`, `setThemePanel(false)` and `setKeyEditor(false)`; `settings-view.js` imports `renderExport` from `./export-view.js`; `export-view.js` still exports `renderExport` and `initExport` and does not import `settings-view.js`.
10. `sw.js` `CACHE` is exactly `macro-diary-v55`; `SCHEMA_VERSION` is still 8; `STORAGE_KEY` still `macrodiary.v1`.
11. `main.js` still imports and calls `initExport()` and `initSettings()` and `initTabs()` (so the handlers on the export ids are wired though the page moved).

## Edge cases and hostile input
- A stale service worker or bookmark calls `showTab('more')`: falls back to diary, no blank screen.
- Prototype names as tab names must not select anything via an object lookup (`onShow['constructor']` is a function on `{}`: a plain `{}` lookup would call `Object` as a callback; the implementation must not call non-registered callbacks. Tested by calling `showTab('constructor')` and checking no stray call happens).
- Imported/synced data in the export table or key line is escaped as before (unchanged code, covered by `export-nutrition-facts` tests and `usda-key-safeguards`).
- Opening Settings with a huge diary: `renderExport` runs on every open, same cost as the old Export page.
- 375 px wide: no horizontal page scroll; `#xTable` scrolls inside its card (`.tscroll`).
- `#xDate` empty on first open: `renderExport` fills it from the diary day (unchanged).
- Export cards now sit in the same page as the USDA key editor and Appearance panel: opening Settings still collapses both; choosing Monthly in `#xKind` must not collapse them.

## Existing tests and scenarios that must change
Tests (node):
- `tests/settings-tidy.test.js` test 5 (card order): updated by the test designer in this change to include `<h2>Export your data</h2>` between Sync and Backup. Its "ids once" list is unchanged and still true.
- `tests/settings-tidy.test.js` test 10 (single `registerTab('settings'`) still true, must stay green.
- No other node test references More, `v-export`, `moreSettings` or `data-more` (searched `tests/`). `tests/export-nutrition-facts.test.js` only reads `export-view.js` for `exportFiles`; still true.

Headless scenarios that navigate through More (cannot be edited by the test designer; the browser-tester must rewrite them to `click('[data-tab="settings"]')` and drop the `#moreSettings` / `#moreExport` / `[data-more]` clicks):
- `tools/browser-test/scenarios/smoke.mjs` (tab list includes `'more'`; becomes `'settings'`)
- `tools/browser-test/scenarios/settings-tidy.mjs` (lines 21 and 97; also the heading-order check around line 108 needs the Export h2 between Sync and Backup, and its 375 px card-rect checks now see more cards)
- `tools/browser-test/scenarios/sync-on-launch.mjs` (line 51)
- `tools/browser-test/scenarios/sync-usda-key.mjs` (lines 26, 128, 133: the Export visit and the `[data-more]` back click go away)
- `tools/browser-test/scenarios/usda-key-safeguards.mjs` (line 19)
- `tools/browser-test/scenarios/export-nutrition-facts.mjs` (line 66: `[data-tab="more"]` + `#moreExport` becomes `[data-tab="settings"]`, then scroll `#xKind` into view)

Also: `css/components.css` has now-unused `.more-btn` and `.back-more` rules (line 65-67). Removing them is optional; if removed, `sw.js` CACHE is already bumped. Not tested.

## What cannot be tested automatically
Node tests use a fake DOM (weak stand-in): real visibility, scrolling, focus order, layout at 375 px, nav highlight colour and downloads need the browser checklist. Real touch, safe-area and share sheet need a phone.

## Manual checklist for the headless browser (browser-tester)
Common setup unless stated: serve the app, seed `localStorage['macrodiary.v1']` with `{schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {}, goals: {k:2000,p:150,c:200,f:65}, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false, recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: {checks:{},extras:{}}, days: {"2026-11-10": {"entries":[{"id":"e1","meal":"Lunch","name":"Rice","k":400,"p":10,"c":80,"f":2,"amt":1,"unit":"serving"}]}, "2026-11-11": {"entries":[{"id":"e2","meal":"Dinner","name":"Pasta","k":600,"p":20,"c":100,"f":10,"amt":1,"unit":"serving"}]}}}` (if the entry shape differs, seed by logging two entries on two days through the UI), reload, wait for `.tabs`. "Open Settings" = click `[data-tab="settings"]`, wait for `#themeToggle` visible. Network blocked, no stubs. Downloads: intercept `download()` or use Playwright's download event.

- **C1 Five buttons, no More.** Setup: default. Steps: read `nav.tabs button`. Expect: exactly 5 buttons, labels in order Diary, Plan, Recipes, Shop, Settings; the last has `data-tab="settings"` and shows ⚙️; no button text contains `More`; no element `#v-more`, `#moreExport`, `#moreSettings`; `[data-more]` count 0. Covered by headless? yes
- **C2 Settings opens directly.** Steps: click the Settings nav button once. Expect: `#v-settings` visible, `#v-diary` not visible, `#datebar` not visible, the Settings nav button has class `on` and is the only one with `on`, `window.scrollY` is 0, no `‹ More` button anywhere. Covered by headless? yes
- **C3 Card order.** Steps: Open Settings; read `#v-settings h2` texts plus `#themeToggle` in DOM order. Expect: Units, Daily goals, Appearance (the toggle), Food databases, Sync between devices, Export your data, Backup, and nothing after Backup. Covered by headless? yes
- **C4 Export report on open.** Setup: seed above, `#xKind` default Weekly, today inside the seeded week or set `#xDate` to 2026-11-11. Steps: Open Settings, scroll `#xKind` into view. Expect: `#xRange` is non-empty text; `#xStats` shows `Days logged`, `Total calories`, `Avg calories / day`, `Avg P / C / F`; `#xTable` contains a table with header `Day`, `kcal`, `P`, `C`, `F`. Covered by headless? yes
- **C5 Period pickers update.** Steps: Open Settings, set `#xDate` to 2026-11-11, select Daily in `#xKind`. Expect: `#xRange` equals the pretty form of 2026-11-11 (a single date, no arrow), `Days logged` is 1, `Total calories` 600, table has exactly one data row. Select Monthly. Expect: range contains ` → `, `Days logged` 2, `Total calories` 1,000, `Avg calories / day` 500. Select Yearly. Expect: table header first cell `Month (avg/day)`. Covered by headless? yes
- **C6 Download has D48 columns.** Steps: with Daily and 2026-11-11, click `#xEntries`. Expect: one download whose name contains `-entries-` and ends `.csv`; its header line includes the columns introduced by D48 (take the exact header from `docs/DECISIONS.md` D48 or the `export-nutrition-facts` scenario); a row contains `Pasta`. Click `#xJson`: a download whose name contains `-data-` and `.json`, parseable, first key `exported`. Click `#xSummary`: name contains `-summary-`. Covered by headless? yes
- **C7 Empty period.** Steps: select Daily and `#xDate` 2020-01-01, click `#xEntries`. Expect: `#xTable` text `Nothing logged in this period.`, `Days logged` 0, and either no download plus the toast `Nothing to export` or a header-only file (whichever the old Export page did; no error, page still usable). Click `#xShare`: toast `Nothing logged`. Covered by headless? yes
- **C8 Backup still last.** Steps: Open Settings, scroll to the bottom. Expect: the Backup card (`Backup to file`, `Restore from file`, `Delete all data`) is the last card; `#xShare` is above `#bkExport` in the page (smaller bounding-box top). Covered by headless? yes
- **C9 Appearance collapsed on re-open.** Steps: Open Settings, click `#themeToggle` (expanded), click the Diary nav button, click Settings again. Expect: `#themeToggle` `aria-expanded` `false`, swatches hidden. Also: with the panel expanded, change `#xKind` to Monthly: the panel stays expanded. Covered by headless? yes
- **C10 Key editor still works.** Steps: Open Settings, click `#keyEdit`, type `abc123` in `#apiKey`, click `#keySave`. Expect: toast `Saved`, `#keyLine` shows the masked/summary text for the key, `#keyEditor` hidden. Click `#keyEdit` again, leave, switch to Diary and back to Settings. Expect: `#keyEditor` hidden (collapsed on re-open), `#keyLine` still shows the key summary. Covered by headless? yes
- **C11 Nav highlight and datebar.** Steps: click Diary, Settings, Plan, Settings, Diary. Expect: after each click exactly that button has `on`; `#datebar` visible only on Diary; the page scrolls to top on each switch (scroll Settings to the bottom first, switch away and back: `scrollY` 0). Covered by headless? yes
- **C12 Stale 'more' tab.** Steps: in the page, run `showTab`-equivalent is not exposed, so instead set `location.hash`-free: skip if `showTab` is not reachable from the page; otherwise `import('/js/ui/tabs.js')` in `page.evaluate` and call `showTab('more')`. Expect: no console error, `#v-diary` visible, Diary highlighted. Covered by headless? yes (via dynamic import)
- **C13 375 px layout.** Setup: viewport 375x667. Steps: Open Settings, set Monthly, scroll the whole page. Expect: `document.documentElement.scrollWidth <= 375`; `#xTable` card has `scrollWidth >= clientWidth` and the page does not scroll sideways (the table scrolls inside `#xTable`); `#xEntries`, `#xSummary`, `#xJson`, `#xShare` all fully inside the viewport width (left >= 0, right <= 375); the last card (Backup) is not hidden behind the bottom nav after scrolling to the end (its bottom edge is above the nav top). Covered by headless? yes
- **C14 Keyboard.** Steps: Open Settings, focus `#xKind`, press Tab. Expect: focus goes to `#xDate`. Press Tab until `#xEntries` is active (at most one extra stop for the scrollable table is allowed), then Tab: `#xSummary`, `#xJson`, `#xShare`, then (after `#xShare`) `#bkExport`. Shift+Tab from `#bkExport` returns to `#xShare`. Press Enter on `#xEntries`: a download starts. Change `#xKind` with the keyboard (ArrowDown): the report updates. Covered by headless? yes
- **C15 Hostile values.** Setup: seed a diary entry named `<img src=x onerror="window.__x=1">` and `"=HYPERLINK(1)"`, and `theme` `<script>`. Steps: Open Settings, Daily on that date, click `#xEntries`. Expect: no `img` inside `#v-settings`, `window.__x` undefined, the table shows the name as text; the downloaded CSV cell for the formula name starts with a single quote or other neutraliser (the `csvCell` rule: `= + - @`). Covered by headless? yes
- **C16 Other tabs unaffected.** Steps: visit Plan, Recipes, Shop, Diary via the nav. Expect: each shows its view, no console errors, no `#v-export` element exists. Covered by headless? yes

### Owner on a real device
- **O1** On the installed PWA, after the update (service worker v55) the bottom bar shows Settings with a gear and no More. Real phone / service worker update.
- **O2** Tap Download entries (CSV) and Share this summary at the bottom of Settings: the file lands in Downloads and the share sheet opens. Real phone / share sheet.
- **O3** Settings is long now: scrolling to Export and Backup is comfortable, nothing hides under the bottom bar on a notched phone. Real phone / safe area.

## Open questions
- Should the Export cards be visually grouped (a small divider or a "Export" section heading) or are four plain cards fine? Assumed: four plain cards, the first headed `Export your data`.
- Fallback for unknown tab is Diary (assumed, not stated by the owner).
- The `.more-btn` / `.back-more` CSS rules become dead; removal not required here.
- C6 needs the exact D48 header string; the browser-tester should copy it from `docs/DECISIONS.md` D48 (the spec author did not restate it to avoid copying implementation details).
