# Spec: Settings tidy-up (Units and Daily goals first, Appearance becomes a collapsed card)

## Purpose
Make Settings shorter and put the things people change often (units, daily goals) at the top. The Appearance card shrinks to one tappable heading row that shows the current theme name and expands to reveal the colour swatches.

Owner request (2026-11-13, backlog item 17): "Changing the Appearance to a minimized card that expands and show the colors if it expands. Reorganize the settings to have the units and daily goals above the appearance."

No saved-shape change, no schema bump, `STORAGE_KEY` unchanged. The expanded/collapsed state is NOT saved.

## Contract

| Piece | Layer / file | Shape |
|---|---|---|
| `themeLabel(key)` | `js/ui/theme.js` (new export) | Pure. Returns the display name from `THEMES` for a known key (`'auto'` gives `'Auto'`, `'black'` gives `'Black (OLED)'`, `'contrast'` gives `'High contrast'`). Non-string input gives `'Auto'` (same default `applyTheme` uses for highlighting). An unknown string gives `'Light'` (the look `effTheme()` falls back to). Must use an exact key match (no object lookup: `'constructor'`, `'__proto__'`, `'toString'` are unknown keys and give `'Light'`). Never throws |
| `setThemePanel(open)` | `js/ui/theme.js` (new export) | Sets `#themePanel.hidden = !open` and `#themeToggle` attribute `aria-expanded` to `'true'`/`'false'` (via `setAttribute`). Touches nothing else: no `state`, no `save()`, no `applyTheme()` |
| `initTheme()` | `js/ui/theme.js` | Unchanged duties (builds `#themes`, click handler, `settings:changed`), plus: wires `#themeToggle` click to toggle `setThemePanel`, and starts collapsed |
| `applyTheme()` | `js/ui/theme.js` | Unchanged duties, plus: `#themeName.textContent = themeLabel(state.theme)` (textContent, never innerHTML) |
| Settings `onShow` | `js/ui/settings-view.js` | The existing single `registerTab('settings', ...)` callback also calls `setThemePanel(false)`. `registerTab` keeps ONE callback per tab name (a second registration silently replaces the first), so there must be exactly one `registerTab('settings'` in `js/` |

Markup (`index.html`, inside `#v-settings`). Ids are decided here because the plan did not give them:
- The Appearance card has ONE real `<button type="button" id="themeToggle" aria-expanded="false" aria-controls="themePanel">` as its heading row. Visible text starts with `Appearance`, then a separator ` · `, then `<span id="themeName">` (the current theme name), then a chevron (decorative, `aria-hidden="true"`). The button must be the only `<button>` outside the panel in that card.
- `<div id="themePanel" hidden>` holds the existing intro paragraph (`Choose a theme. Auto switches between Light and Dark with your device.`) and `<div class="themes" id="themes">`. `hidden` keeps it out of the tab order and away from screen readers while collapsed.
- Card order in `#v-settings` (by `<h2>`/heading text; the Appearance heading now lives in the button): Units, Daily goals, Appearance, Food databases, Sync between devices, Backup. Card content, ids and labels are otherwise unchanged.
- CSS lives in `css/components.css` (rotate/flip chevron, full-width left-aligned button, 44 px touch target). `sw.js` `CACHE` bumped because shipped files change; no new shipped file, so `SHELL` is unchanged.

Decided: collapsed on every open of Settings (`onShow` collapses), the expanded state is not saved anywhere and is not in `state`.

Is a pure helper worth it? Yes, a small one: `themeLabel`. `theme.js` can be imported in Node if `globalThis.matchMedia` is stubbed first (it calls `matchMedia` at module load); `tests/settings-tidy.test.js` does that, so `themeLabel` and the toggle logic are tested by import with a hand-made fake DOM. The fake DOM is a weak stand-in for a browser (it does not prove focus, visibility or layout), which is why the checklist below exists.

## Behaviours (tick each)
1. `themeLabel` returns the display name for every key in `THEMES`.
2. `themeLabel` falls back: non-string input gives `Auto`, an unknown string (including prototype names and HTML) gives `Light`; it never throws and returns plain text.
3. `index.html`: the Appearance card has one `<button type="button">` with `id="themeToggle"`, `aria-expanded="false"`, `aria-controls="themePanel"`, text `Appearance` and a `#themeName` span; the old plain `<h2>Appearance</h2>` is gone.
4. `index.html`: `#themePanel` has the `hidden` attribute and contains `#themes` and the intro text; `#themes` is no longer outside it.
5. `index.html`: card order in `#v-settings` is Units, Daily goals, Appearance, Food databases, Sync between devices, Backup; the other ids are all still present once (`wUnit gK gP gC gF srcUSDA srcOFF keyLine keyEdit keyEditor apiKey syncApiKey keySave keyCancel syncCard syncBox bkExport bkImport bkFile wipe themes`).
6. `setThemePanel(true/false)` flips `#themePanel.hidden` and `#themeToggle` `aria-expanded` together and changes nothing in state or storage.
7. After `initTheme()`: panel is hidden and `aria-expanded` is `false`; clicking `#themeToggle` opens it, clicking again closes it; the toggle itself never changes `state.theme` or writes storage.
8. Choosing a theme (click on a `.th[data-t]` button inside `#themes`) sets `state.theme`, writes `macrodiary.v1` with that theme, sets `document.documentElement.dataset.theme`, updates `#themeName`, and leaves the panel open.
9. `#themeName` shows the current theme's display name on `applyTheme()` (so `settings:changed` from a sync or restore also updates it), including for a stored unknown theme (`Light`) and non-string (`Auto`).
10. Opening the Settings tab collapses the panel: `settings-view.js` calls `setThemePanel(false)` from the one `registerTab('settings', ...)` callback, and there is exactly one `registerTab('settings'` in `js/`.
11. `theme.js` never writes the name with `innerHTML`, and the toggle is a native button (no `role="button"` div, no key handler needed).
12. `sw.js` `CACHE` number is higher than 52 (shipped files changed). (Weak check: it only proves a bump happened.)
13. No saved-shape change: `SCHEMA_VERSION` and `STORAGE_KEY` are unchanged (`macrodiary.v1`), and `theme.js` does not store any "open" flag in `state`.

## Edge cases and hostile input
- Stored `theme` is `'<img src=x onerror=alert(1)>'`, `'__proto__'`, `'constructor'`, `''`, `null`, a number or an object: the page still loads, the summary shows `Light` (string) or `Auto` (non-string), no HTML is injected, `data-theme` is a known theme.
- `settings:changed` arrives while the panel is open (a sync pull): the name updates, the panel stays open.
- Tapping the toggle many times quickly ends in the state the click count implies, with `aria-expanded` and `hidden` never disagreeing.
- Narrow screen 375 px: the card and the swatch grid cause no horizontal scrolling.
- Existing tests that depend on the old layout: none found. `tests/usda-key-safeguards.test.js` S14 and `tests/sync-usda-key.test.js` B16 only compare positions among `keyLine` .. `syncCard` and `apiKey` to `syncCard`; those stay in the same relative order. `tools/browser-test/scenarios/*.mjs` do not reference `#themes`, `Appearance` or card order (checked by search); `sync-usda-key.mjs` finds the Food databases card by heading text, still valid.

## What cannot be tested automatically
Node tests use a fake DOM, so real focus, visibility, layout, scrolling and keyboard activation need the browser checklist (headless Chromium covers most; a real phone covers touch).

## Manual checklist for the headless browser (browser-tester)
Common setup unless stated: serve the app, seed `localStorage['macrodiary.v1']` with `{schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {}, goals: {k:2000,p:150,c:200,f:65}, apiKey: '', syncApiKey: false, useUSDA: false, useOFF: false, recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: {checks:{},extras:{}}, days: {}}`, reload, wait for `.tabs`. "Open Settings" = click `[data-tab="more"]`, click `#moreSettings`, wait for `#themeToggle` visible. No network stubs needed (leave the network blocked).

- **C1 Collapsed by default.** Setup: theme `auto`. Steps: Open Settings. Expect: `#themeToggle` is a `<button>` whose normalised text starts with `Appearance · Auto`; `aria-expanded` is `false`; `aria-controls` is `themePanel`; `#themePanel` is not visible; no `.th` button is visible; the text `Choose a theme.` is not visible. Covered by headless? yes
- **C2 Click expands and collapses.** Steps: Open Settings, click `#themeToggle`. Expect: `aria-expanded` `true`; `#themePanel` visible; exactly 14 `.th` buttons visible (Auto, Light, Dark, Black (OLED), Midnight, Forest, Nord, Dracula, Ember, Ocean, Rose, Solarized, Paper, High contrast), each with a colour swatch (`.pv`); the intro text `Choose a theme. Auto switches between Light and Dark with your device.` visible. Click `#themeToggle` again. Expect: `aria-expanded` `false`; panel and swatches not visible; `document.documentElement.dataset.theme` and the stored `theme` unchanged by the toggling (stored `auto`). Covered by headless? yes
- **C3 Keyboard.** Steps: Open Settings; focus `#themeToggle` (Tab from the page top until it is active, or `.focus()`); press Enter. Expect: `aria-expanded` `true`, swatches visible, `document.activeElement.id` is `themeToggle`. Press Space. Expect: `aria-expanded` `false`, swatches hidden, focus still on `themeToggle`. While collapsed, press Tab repeatedly from `themeToggle`: focus never lands on a `.th` button (it goes on to the next card's controls, `#srcUSDA`). Covered by headless? yes
- **C4 Picking a theme.** Steps: Open Settings, click `#themeToggle`, click the button labelled `Forest theme` (aria-label). Expect: `document.documentElement.dataset.theme` is `forest`; `#themeName` text is `Forest`; toggle text starts `Appearance · Forest`; `#themePanel` still visible and `aria-expanded` `true`; the `Forest` button has class `on`; stored `theme` is `forest`. Click `Auto theme`: `dataset.theme` is `light` or `dark` per the emulated colour scheme, name `Auto`, stored `auto`. Covered by headless? yes
- **C5 Persists across reload, collapsed again.** Setup: as C4 ending with `forest` chosen. Steps: reload, wait for `.tabs`, check `dataset.theme` immediately; Open Settings. Expect: `dataset.theme` is `forest` before Settings is opened; toggle text starts `Appearance · Forest`; `aria-expanded` `false`; panel not visible. Covered by headless? yes
- **C6 Re-opening Settings collapses.** Steps: Open Settings, click `#themeToggle` (expanded), click `[data-more]` (the `‹ More` back button), click `#moreSettings` again. Expect: `aria-expanded` `false`, panel not visible, name unchanged. Also switch to the Diary tab and back through More, same result. Covered by headless? yes
- **C7 Card order.** Steps: Open Settings. Expect: the card headings in DOM order inside `#v-settings` are `Units`, `Daily goals`, `Appearance`, `Food databases`, `Sync between devices`, `Backup` (read the `h2` texts plus the toggle's `Appearance`); on screen the vertical positions (`getBoundingClientRect().top`) of `#wUnit`, `#gK`, `#themeToggle`, `#srcUSDA`, `#syncCard`, `#bkExport` are strictly increasing. Covered by headless? yes
- **C8 Other cards unaffected.** Steps: Open Settings; set `#wUnit` to `oz`, type `1800` into `#gK` and press Tab. Expect: stored `weightUnit` `oz`, stored `goals.k` `1800`; `#keyLine` reads `USDA key: not set` with `#keyEdit` visible and `#keyEditor` hidden; `#syncCard` visible with its heading `Sync between devices`; `#bkExport`, `#bkImport`, `#wipe` visible. Covered by headless? yes
- **C9 Narrow screen.** Setup: viewport 375 x 700. Steps: Open Settings, expand Appearance. Expect: `document.documentElement.scrollWidth <= window.innerWidth` both collapsed and expanded; `#themeToggle` bounding height at least 40 px; the toggle's right edge is within the viewport. Covered by headless? yes
- **C10 Hostile stored theme.** Setup: seed with `theme: '<img src=x onerror="window.__x=1">'`. Steps: reload, Open Settings. Expect: no page error; `window.__x` undefined; `dataset.theme` is `light`; `#themeName` text is the literal `Light`; `#themeToggle` contains no `<img` element; expand the panel: the `Auto` button is not marked `on` and none is (acceptable). Repeat with `theme: '__proto__'` and with `theme: 7`: no errors, name `Light` and `Auto` respectively. Covered by headless? yes
- **C11 Screen reader hiding.** Steps: Open Settings (collapsed). Expect: `#themePanel` has the `hidden` attribute, computed `display` is `none`; after expanding it has no `hidden` attribute. Covered by headless? yes
- **C12 Picking while expanded keeps it open.** Steps: Open Settings, expand, click `Dark theme`, then click `Light theme`. Expect: after each click `#themeName` is `Dark` then `Light`, `aria-expanded` stays `true`, panel visible. Covered by headless? yes (a real `settings:changed` from a sync pull is covered only by Node behaviour 9)

### Owner on a real device
- **O1** On the phone, open Settings: Appearance is one line with the current theme name and a chevron; tap it, the colours appear; tap a colour, the app recolours instantly and the panel stays open; leave Settings and come back, it is collapsed. Covered by headless? no: real phone touch and real data
- **O2** Installed PWA after the update: close and reopen the app twice so the new service worker version is picked up, then repeat O1. Covered by headless? no: real phone / service worker update / Safari

## Open questions
- Element ids `themeToggle`, `themePanel`, `themeName` are decided here, not in the plan. If the implementer prefers other names the tests and checklist must be updated together.
- Fallback label for an unknown stored string is `Light` (what is actually shown) rather than `Auto`; the owner may prefer `Auto`. Pinned as `Light` until told otherwise.
- Whether the chevron is a text glyph or a CSS pseudo-element is left open; the checks use "text starts with" so either passes.
