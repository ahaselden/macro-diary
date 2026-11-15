# Spec: one simple Diary card, dials are optional single rings (follow-up to backlog item 21, schema 11 to 12)

## Purpose
The four-nested-rings dial plus the old summary card is too busy. The Diary gets ONE card: four rows (Calories, Protein, Carbs, Fat) with a filling bar each, and above them zero or more single-ring dials that the user chooses (default: calories only), with a pencil button at the top right that opens a small panel of checkboxes. The choice is saved data (`state.dials`, schema 12) and travels with sync and backup like the goals.

Written before the implementation by the test designer. Owner request of 2026-11-14 is taken as given. Where the request left a name or a string open, this spec FIXES it (marked "decided here") so the tests can pin it; the owner can change any of these in review before the build, and the implementer must then ask for the test to be changed, not edit it. Tests: `tests/dials-simplify.test.js` (S1-S20). `tests/dials.test.js` is NOT edited by the test designer; see "Superseded tests".

## Sketch (owner: please approve or change before the build)
Phone, 375 px. Default (calories only), then all six on, then none:

```
DEFAULT                                  ALL SIX                              NONE
+---------------------------------+      +---------------------------------+  +---------------------------------+
|                          [pencil]|      |                          [pencil]|  |                          [pencil]|
|   .-----.                       |      | (k)  (p)  (c)   wraps to a 2nd  |  | Calories   800 / 2000 kcal      |
|  / 1200  \   (single ring,      |      | (f) (steps) (sleep)  row of 3   |  | [#########-----------]          |
|  | kcal  |    centre = kcal     |      |  each: ring + name + text       |  | Protein    80 / 150 g           |
|  \ left  /    left/over/eaten)  |      |                                 |  | [#####----------]               |
|   '-----'                       |      | Calories   800 / 2000 kcal      |  | Carbs      160 / 200 g          |
| Calories   800 / 2000 kcal      |      | [#########-----------]          |  | [################---]            |
| [#########-----------]          |      | ... Protein, Carbs, Fat rows    |  | Fat        40 / 65 g            |
| Protein    80 / 150 g           |      +---------------------------------+  | [############--------]           |
| [#####----------]  (Carbs, Fat) |                                           +---------------------------------+
+---------------------------------+
EDIT MODE (after tapping the pencil): below the rows a panel
[x] Calories  [ ] Protein  [ ] Carbs  [ ] Fat  [ ] Steps  [ ] Sleep        [ Done ]
```
Rows: name, `value / goal unit` text, then a horizontal bar. A bar fills in the macro colour (`--kcal --p --c --f`). Over goal: the bar is full, drawn in `--over` (red) via the existing `.bar.over` class, AND the row says the words `over goal` (never colour alone). Goal 0: empty bar, the text is the value alone, nothing divides by zero.

## Contract

### Layers and files
- `js/core/schema.js` (core): `SCHEMA_VERSION = 12`; new exports `DIAL_KEYS`, `DEFAULT_DIALS`, `sanitizeDials`; `defaults()` gains `dials`; `sanitize()` and `migrate()` handle it.
- `js/domain/dials.js` (domain, PURE): keeps all current exports (`ringFraction isOver ringArc ringRadii formatSleep formatSteps dialModel`, unchanged behaviour); new exports `normalizeDials`, `toggleDial`; `dialModel` additionally returns `selected`, `rings`, `rows`.
- `js/ui/dials.js` (ui): `dialsHtml(model, editing = false)` (string only, importable in Node) and `renderDials()` (writes into `#dials`, wires events or exposes what `diary.js` needs to wire).
- `js/domain/sync-records.js`, `js/domain/merge.js`, `js/domain/backup.js`: carry `dials` (below).
- `index.html`, `css/components.css`, `js/ui/diary.js`, `sw.js` (bump `CACHE`; no new shipped file is expected, `SHELL` must still list `js/domain/dials.js` and `js/ui/dials.js`), `docs/DECISIONS.md` (`## D57.`), `docs/ARCHITECTURE.md`, `docs/BACKLOG.md`.
- `js/domain/reports.js` is NOT changed: the report JSON (`exportFiles` data file, keys `exported from to goals days`) stays as it is (an existing test pins those keys). The BACKUP export (`#bkExport`) is `JSON.stringify(state)`, so `dials` travels in it automatically.

### Saved shape (decided here)
`state.dials`: array of keys from `DIAL_KEYS = ['k', 'p', 'c', 'f', 'steps', 'sleep']`; `DEFAULT_DIALS = ['k']`.
- `sanitizeDials(v)` -> NEW array (never the shared default, never the input): if `v` is not an array -> `['k']`; otherwise the known keys that occur in it (exact, case-sensitive strings), each once, returned in the FIXED ORDER k p c f steps sleep (not input order, so equal choices serialise equally and sync converges). Unknown, non-string and duplicate entries are dropped. An array that ends up empty (`[]`, or only unknown keys) is a valid, kept choice: it is NOT turned into the default. `'__proto__'`, `'constructor'` etc. are just unknown strings.
- `sanitize(d)` sets `d.dials = sanitizeDials(d.dials)`. `defaults().dials` is `['k']` (a fresh array each call).
- `migrate`: `if (v < 12) d.schemaVersion = 12;` (the `['k']` comes from `sanitize` because old data has no `dials`); every other value is kept. Data already at version 12 keeps its choice, including `[]`. `STORAGE_KEY` unchanged.

### `js/domain/dials.js` additions (decided here)
- `normalizeDials(list)` -> exactly what `sanitizeDials` returns (same rules; may call it).
- `toggleDial(list, key, on)` -> NEW array, input never mutated. Base = `normalizeDials(list)` (so a missing list starts from `['k']`). If `key` is not one of the six known keys (including `'__proto__'`, non-strings): returns the normalised base unchanged. `on === true`: add; `on === false`: remove; anything else (including no argument, `'yes'`, `1`): flip. Result is in the fixed order. May be `[]`.
- `dialModel(state, day)`: everything it returns today (`nutrition {label, centre, rings[4]}`, `steps`, `sleep`) is UNCHANGED, plus:
  - `selected`: array = `normalizeDials(state.dials)` (a missing, `null` or non-array `state.dials`, and a non-object `state`, give `['k']`; an array of only junk gives `[]`). A new array: mutating it does not touch `state.dials`.
  - `rings`: plain object with exactly the own keys `k p c f steps sleep` (in that order), each value the ring of that key (equal to `nutrition.rings[0..3]`, `steps`, `sleep`). Present for all six whatever is selected (the UI picks).
  - `rows`: array of the four nutrition rings (equal to `nutrition.rings`), for the rows list.
  - Still pure, never throws, never mutates a (deep-frozen) state; every string is fixed words and numbers (no `NaN`, `Infinity`, `undefined`, `null`, `[object`, `<`, `>`).

### `js/ui/dials.js` (decided here) - markup that `dialsHtml(model, editing)` returns (the inner HTML of the card)
The card in `index.html` is `<div class="card" id="dials"></div>` (a plain card: NO `role="button"`, NO `tabindex`; it holds a real button, and a button inside `role=button` is invalid). Everything below is generated.
1. Pencil: `<button type="button" id="dialsEdit" class="dials-edit" aria-label="Choose dials" aria-expanded="false|true">` (visible icon only, a pencil; exactly one; `aria-expanded` is `true` while editing). Placed top right by CSS. It is NOT inside `#dialsOpen`. Tapping it, or Enter/Space on it, toggles the panel and must NOT open the details.
2. Clickable area: `<div id="dialsOpen" role="button" tabindex="0" aria-label="Nutrition details for this day: 800 of 2000 kcal eaten. Press to open.">` containing the dial area and the rows. Click, Enter or Space on it (or anywhere in it) opens the existing nutrition details dialog (`openDetails` in `js/ui/diary.js`, title `Nutrition details`), exactly what `#summary` did. The label starts with `Nutrition details` and contains the calories eaten.
3. Dial area: `<div class="dial-area">` ONLY when at least one dial is selected (absent when none). Inside, one `<div class="dial" data-dial="KEY">` per selected key, in the FIXED order k p c f steps sleep whatever the order of `model.selected`; unknown or repeated keys in `selected` are ignored. Each dial: an `<svg viewBox=...>` with ONE ring (a grey track circle `class="ring-track"` and, when the fraction is above 0, an arc circle `class="ring-arc"` with `stroke-dasharray` from `ringArc`, `transform="rotate(-90 cx cy)"`, `stroke` = the ring colour, or `var(--over)` when `over`); an accessible name `aria-label="<ring.label>"` (escaped) on the ring's `role="img"` element; the visible name (`Calories`, `Protein`, `Carbs`, `Fat`, `Steps`, `Sleep`) and the visible `text` of the ring (`no data` for steps or sleep without data). The calories dial shows `nutrition.centre` (`1200` / `kcal left`, or `over`) inside the ring. The other dials show their value text near the ring (exact layout is the implementer's).
4. Rows: `<div class="mrow" data-row="KEY">` for k, p, c, f (always, in that order, even with no dial selected). Inside: the name, the ring's `text` (`800 / 2000 kcal`, `80 / 150 g`, `160 / 200 g`, `40 / 65 g`), and `<div class="bar [over]"><i style="width:NN%;background:var(--kcal|--p|--c|--f)"></i></div>`. `NN` = `fraction * 100` (0 for goal 0 or no usable value). When the ring is `over`: the `bar` element also has class `over`, the `<i>` has NO macro `background:` (the existing `.bar.over>i` CSS draws it in `--over`), width 100%, and the row contains the words `over goal` as visible text. Rows that are not over contain neither. Exactly at the goal is not over.
5. Edit panel, ONLY when `editing === true`: `<div id="dialsPanel">` (sibling of `#dialsOpen`, NOT inside it) with six `<input type="checkbox" id="dialPick-KEY" ...>` (KEY = k p c f steps sleep) each `checked` exactly when selected, each with `<label for="dialPick-KEY">NAME</label>` whose text is exactly `Calories`, `Protein`, `Carbs`, `Fat`, `Steps`, `Sleep`, and `<button type="button" id="dialsDone">Done</button>`. Not present when not editing.
6. Every string from the model passes through `esc()`; every number printed (radius, dash, percentage) is finite and made by `ringArc`/clamping, so no `NaN`/`Infinity`/`undefined` ever appears. `dialsHtml` never throws, whatever it is given (also for a model without rows, with `selected` junk, `editing` not a boolean: anything but `true` means not editing). The pencil is drawn even for an empty or hostile model, so the choice can always be changed.

### Wiring (behaviour; the implementer chooses the code layout)
- Edit mode is UI-only state (not saved; closed after reload and after day navigation is acceptable, but it must stay open while ticking boxes).
- Ticking or unticking a checkbox: `state.dials = toggleDial(state.dials, key, checked)`, then `touchSettings(state, Date.now())` (from `js/domain/entries.js`, so sync timestamps it), `save()`, re-render; keyboard focus stays on that same checkbox (the re-render must restore it). Never write `state.settingsUpdatedAt` by hand.
- Done (or the pencil again) closes the panel; focus returns to the pencil.
- `#summary` is deleted from `index.html` and from `js/ui/diary.js` (no remaining reference); `#activityLine` stays exactly as is (hidden muted line, set with `textContent`), between `#dials` and `#meals`. The old nutrition numbers it showed (`800`, `of 2000 kcal eaten`, `remaining`) now live in the calories row and, when selected, the calories dial centre; the calories dial centre shows kcal left / over as today (a caption `kcal eaten` for goal 0 is allowed, see open question 2 of `dials.md`).
- CSS: rows use the existing `.bar` and `.bar.over>i`; the old `#dials`/`.dials-*` nested-dial rules can go; the card must not scroll sideways at 320 px.

### Sync, backup (decided here)
- Settings record: `toRecords` puts `dials` (the sanitised array) into the `settings` record value next to `goals` (a state whose `dials` is missing or junk must not make `toRecords` throw; the value then has no `dials` or a valid array). The `settings` record is stamped by `settingsUpdatedAt`; the newest settings record wins as a whole (existing rule), so `dials` follows the same winner as the goals.
- `applyRecords`/`mergeStates` (`SETTINGS_KEYS` gains `'dials'`): a settings record WITHOUT a `dials` field (written by an old-device build) must leave THIS device's choice alone rather than reset it to the default (its goals/units still apply and its stamp still counts). Decided: the same for a record whose `dials` is present but not an array (`'x'`, `null`, `5`, `{}`, `true`): ignored, local choice kept. A record whose `dials` IS an array is sanitised (`sanitizeDials`) and taken when its record wins, including `[]`. Two devices converge in both merge orders, also when the stamps are equal.
- Backup restore (`mergeRestore` in `backup.js`): a NEWER settings backup brings its `dials`; an older or untimestamped one keeps this device's; a backup that has NO `dials` field (made before this feature, or schema 11 or earlier) keeps this device's choice even when it is newer (the implementer must look at the raw backup BEFORE `migrate()` fills the default); a backup whose `dials` is not an array keeps this device's choice; `[]` is restored as `[]`.
- Old devices: a device running the old build ignores `dials` in the record (`sanitize` there does not know it); nothing to test here, it is covered by the "absent field" rule above on the new device.

## Behaviours (tests in `tests/dials-simplify.test.js`, number = test title)
Saved shape
- **S1** `SCHEMA_VERSION` is 12; `defaults().schemaVersion` 12; `defaults().dials` is `['k']` and a fresh array each call; `DIAL_KEYS` is `k p c f steps sleep`; `DEFAULT_DIALS` is `['k']`; `STORAGE_KEY` is still `macrodiary.v1`; goals defaults unchanged.
- **S2** `sanitizeDials`: fixed order, unique, unknown dropped, `[]` kept, only-unknown gives `[]`, case-sensitive, non-array gives `['k']`, fresh arrays, frozen input fine, huge arrays fine.
- **S3** `sanitize()` applies it to `d.dials` (including `[]`, junk to default, idempotent); goals/theme untouched.
- **S4** Migration from 1, 2, 5, 8, 9, 10, 11 keeps days, tombstones, settingsUpdatedAt, theme, units, activity, goals and gives `dials ['k']`; version 12 keeps its choice including `[]`; store load/save/reload; `replace`.
Domain
- **S5** `normalizeDials` equals `sanitizeDials`; `toggleDial` flips/sets/removes in the fixed order, bad keys change nothing, non-boolean `on` flips, never mutates, can reach `[]` and all six.
- **S6** `dialModel` additions `selected`, `rings` (six keys), `rows` (four) and unchanged old fields; defaults when `dials` missing; `[]` allowed; no mutation of a frozen state; clean strings.
- **S7** The choice goes through `touchSettings`; the `settings` record carries `dials` and the new stamp.
Sync and backup
- **S8** Round trip, `[]` applied, convergence in both orders, older record does not win, tie converges.
- **S9** Old-device record without `dials` leaves the local choice (also local `[]`); present-but-not-array ignored; arrays cleaned; `__proto__` in a record never pollutes.
- **S10** Backup: newer brings dials, older/untimestamped keeps ours, backup without dials keeps ours even when newer, junk dials keeps ours, `[]` restored; the saved JSON carries `dials`.
UI strings (`dialsHtml`, real code)
- **S11** Default: one calories dial (a single ring), four rows with the right text and a bar, pencil, no panel; `#dialsOpen` is a labelled button holding the dial and rows.
- **S12** All six in the fixed order (even when `selected` is shuffled), each with name, label, text, colour, and the arc filled by the right fraction (0.4, 80/150, 0.8, 40/65, 0.612, 473/480), clockwise from 12 o'clock, nothing red.
- **S13** Nothing selected: no dial area, four rows and the pencil remain; unselected dials not drawn; no data shown as text.
- **S14** Rows: widths 40 / 53.3 / 80 / 61.5 %, macro colours; over gets class `over` and the words `over goal` and no macro colour; exactly at goal is not over; goal 0 gives an empty bar and no NaN.
- **S15** Pencil: real `<button>` with `aria-label="Choose dials"`, `aria-expanded`, outside `#dialsOpen`; the panel only when editing: six labelled checkboxes reflecting the choice, `Done`.
- **S16** Injection safe: hostile strings escaped (visible as `&lt;img`), hostile numbers never print NaN, hostile `selected`, hostile or empty models do not throw and keep the pencil.
Wiring and shipping (WEAK static text checks, see below)
- **S17** `index.html`: one `#dials` plain card, no `#summary`, `#activityLine` hidden and in order before `#meals`, the goal inputs still there, no hard-coded pencil.
- **S18** `diary.js` no longer touches `#summary`, calls `renderDials()`, keeps the activity line; the ids and `openDetails`/`Enter` appear in the wiring; `dials.js` imports `toggleDial` and `touchSettings` and calls them and `save()`; the stamp is not written by hand.
- **S19** Security (static): `ui/dials.js` assigns `innerHTML` only from `dialsHtml(...)`, uses `esc`, no `insertAdjacentHTML`/`eval`/`document.write`, no service import; `domain/dials.js` imports only allowed modules and no browser globals; the new exports exist.
- **S20** `sw.js` `SHELL` lists both dials files, `schema.js` and `index.html`; `CACHE` number greater than 62 (the value on this branch when written; NEVER an exact number); `docs/DECISIONS.md` has `## D57.` mentioning dial, 12, default and sync; `docs/ARCHITECTURE.md` mentions `dials.js`.

## Edge cases and hostile input (covered by the tests above)
- `dials` missing, `null`, string, number, object, array of junk, array of 100,000 duplicates or 50,000 unknown keys, `'__proto__'`/`'constructor'` entries, `'<img src=x>'` entries, case variants (`'K'`).
- Backups and synced records from before this feature, with hostile `dials`, with `__proto__` keys; equal stamps; `[]` as a real choice.
- Model strings with HTML and attribute-breaking quotes; fractions NaN/Infinity/negative/strings; `selected` with unknown, repeated, non-string entries; `editing` not a boolean.
- Goal 0 (no bar fill, no division by zero), over goal, exactly at goal, an empty day, no activity (steps/sleep `no data`, never `0`).

## Superseded tests (the implementer retires or rewrites these; the test designer does not edit them)
Tests in `tests/dials.test.js` that CONTRADICT this spec and must be retired (deleted, or replaced by the S-tests above) in the implementing commit, with the reason in the PR:
- **15** (`dialsHtml` with the four-ring nutrition dial and the side rings, `dialsHtml(model)` shape, `var(--over)` rules for the old markup): superseded by S11-S14.
- **16** (injection test written against the old markup): superseded by S16 (keep its idea).
- **23** (`#dials` has `role="button"` and `tabindex="0"`, `#summary` must stay unchanged and below `#dials`): superseded by S17. The `#gSteps`/`#gSleep` half of 23 must be kept (move it to a new test or keep the test with only that half).
- **25** (`#dials` and `#summary` both have the open-details handler): superseded by S18.
Tests in `tests/dials.test.js` that stay valid (the model keeps `nutrition`, `steps`, `sleep` unchanged): 1-14, 19-22, 24, 26, 27 (27: `CACHE > 60` still true; `D56` section still exists). Tests 17 and 18 only need the schema literal 11 -> 12 (below).

Other existing tests that fail or must change (literal updates, the implementer explains each in the PR; run `npm test` to find the rest):
- Schema version 11 -> 12 pins (`SCHEMA_VERSION`, `defaults().schemaVersion`, `migrate(...).schemaVersion`, `/export const SCHEMA_VERSION = 11;/` source checks): `tests/dials.test.js` 17 and 18; `tests/favourite-recipes.test.js` F1 (lines 22, 23, 31); `tests/export-nutrition-facts.test.js` (line 185); `tests/google-health-ui.test.js` (line 91, the `SCHEMA_VERSION = 11;` regex); `tests/item-nutrition-facts.test.js` (line 127); `tests/google-health-activity.test.js` test 19 (lines 106-135: `schemaVersion` 11 in migrate/store asserts); `tests/nutrition-details.test.js` (lines 33, 34, 42, 49, 52, 54, 260); `tests/page-nutrition.test.js` (lines 34, 35, 45, 52); `tests/recipe-import-ui.test.js` (line 122); `tests/settings-tab-with-export.test.js` (line 119); `tests/saved-food-ids.test.js` (lines 99-102, 108, 126, 215); `tests/settings-tidy.test.js` (line 173); `tests/store.test.js` (line 94); `tests/sync-usda-key.test.js` (lines 25, 27, 33, 37, 46, 48, 186). Only the literal 11 changes to 12 (and `dials: ['k']` where a whole-state literal is compared).
- `#summary` is gone: `tests/google-health-ui.test.js` 44b (order `summary`, `activityLine`, `meals` and `#summary` role=button: change to `#dials` before `#activityLine` before `#meals`, and `#dialsOpen` is generated, so drop the role check or point it at `js/ui/dials.js`) and 45 (last assert `id="summary"|#summary` in `diary.js`: replace by `dialsOpen`); `tests/nutrition-details.test.js` D19 (asserts `#summary` is a `role="button"`: point it at `dialsOpen` in `js/ui/dials.js`).
- Any test that compares a whole `defaults()`-shaped state with `deepEqual` will need `dials: ['k']`.
- `tools/browser-test/scenarios/dials.mjs` (the old headless scenario) will fail: the browser-tester rewrites it from the checklist below.

## What cannot be tested automatically, and the manual checklist
Unit tests cannot see layout, colour, the SVG actually drawing clockwise from the top, tap targets, focus, or a screen reader. S17-S20 only prove words are in files. The headless scenarios below prove the screens; taste and real devices stay with the owner.

### Headless scenarios (browser-tester; no network is needed: all data is seeded into `localStorage` key `macrodiary.v1` as JSON before load; "today" is the date the page shows as Today)
Seed A = `schemaVersion: 12`, `dials: ['k']`, goals `{k:2000,p:150,c:200,f:65,steps:10000,sleepH:8}`, today one Lunch entry `{id:'e1', meal:'Lunch', name:'Rice', brand:'', source:'custom', per100:{k:100,p:10,c:20,f:5}, grams:800, updatedAt:1}` (= 800 kcal, 80 g P, 160 g C, 40 g F), `activity` for today `{updatedAt:1, source:'google-health', steps:6120, sleepMinutes:473}`, `settingsUpdatedAt: 5`. Viewport 375 x 800 unless stated.

- **H1 Old save upgrades to the default.** Setup: Seed A but `schemaVersion: 11` and NO `dials` field. Steps: open the app. Expect: exactly one `[data-dial]` element, `[data-dial="k"]`, with centre text `1200` and `kcal left`; four rows `[data-row]` k p c f with texts `800 / 2000 kcal`, `80 / 150 g`, `160 / 200 g`, `40 / 65 g`; `#summary` does not exist (`document.querySelector('#summary')` is null); `#activityLine` is visible and reads `From Google Health: ` followed by the steps/sleep text. Covered by headless? yes.
- **H2 Bars fill and are coloured.** Setup: Seed A. Expect: each row's `.bar > i` width divided by its `.bar` width is 0.40 / 0.533 / 0.80 / 0.615 (+-0.01) for k / p / c / f; computed `background-color` of the fills equals the computed `--kcal`, `--p`, `--c`, `--f`; no `.bar` has class `over`; the text `over goal` does not appear in `#dials`. Covered by headless? yes.
- **H3 Over goal.** Setup: Seed A but entry `grams: 2200` (2200 kcal, 220 P, 440 C, 110 F). Expect: all four `.bar` have class `over`, every fill is full width and its computed background equals the computed `--over`; each row contains the visible text `over goal`; row k text `2200 / 2000 kcal`; the calories dial centre reads `200` / `kcal over` and its arc `stroke` equals computed `--over`. Covered by headless? yes.
- **H4 Goal 0.** Setup: Seed A with goals `{k:0,p:0,c:0,f:0,steps:10000,sleepH:8}`. Expect: row texts `800 kcal`, `80 g`, `160 g`, `40 g`; each fill has width 0; no `NaN` or `Infinity` in `#dials`; no uncaught page error. Covered by headless? yes.
- **H5 The pencil opens the panel, not the details.** Setup: Seed A. Steps: click `#dialsEdit`. Expect: `#dialsPanel` is visible; `#dialsEdit` has `aria-expanded="true"` and `aria-label` `Choose dials`; the dialog `#dlg` is NOT open; `#dialPick-k` is checked and the other five are not; six labels with the exact texts `Calories`, `Protein`, `Carbs`, `Fat`, `Steps`, `Sleep`, and clicking a label text toggles its checkbox. Then click `#dialsDone`: panel gone, `aria-expanded="false"`, focus on `#dialsEdit`. Covered by headless? yes.
- **H6 Keyboard.** Setup: Seed A. Steps: focus `#dialsEdit` with Tab from the date bar (or `focus()`), press Enter: the panel opens, details NOT open. Press Tab to reach `#dialPick-k`, press Space: it unchecks. Close the panel; focus `#dialsOpen` (it has `tabindex=0`, `role=button`, a non-empty `aria-label` starting `Nutrition details`), press Enter: `#dlg` opens with the title `Nutrition details`; close it; press Space: opens again. Covered by headless? yes.
- **H7 Picking dials saves, in the fixed order.** Setup: Seed A, edit mode open. Steps: tick `#dialPick-sleep`, then `#dialPick-p`. Expect: `[data-dial]` elements in DOM order `k`, `p`, `sleep`; after each click keyboard focus is still on the clicked checkbox (`document.activeElement.id`); `localStorage` `macrodiary.v1` now has `dials` equal to `["k","p","sleep"]` and `settingsUpdatedAt` greater than 5; the dials show `Protein` with `80 / 150 g` and `Sleep` with `7 h 53 min / 8 h`; reload the page: still `k, p, sleep`. Covered by headless? yes.
- **H8 All six on, 375 px and 320 px.** Setup: Seed A with `dials` all six. Expect (375): `[data-dial]` order `k p c f steps sleep`; texts `800 / 2000 kcal`, `80 / 150 g`, `160 / 200 g`, `40 / 65 g`, `6,120 / 10,000`, `7 h 53 min / 8 h` all inside `#dials` bounding box, none overlapping another; each dial has an element with `aria-label` equal to `Calories: 800 of 2000 kcal`, `Protein: 80 of 150 g`, `Carbs: 160 of 200 g`, `Fat: 40 of 65 g`, `Steps: 6,120 of 10,000`, `Sleep: 7 h 53 min of 8 h`; each arc's `stroke-dasharray` first number divided by `2 * PI * r` is 0.4 / 0.533 / 0.8 / 0.615 / 0.612 / 0.985 (+-0.01) and the arc has `transform` `rotate(-90 ...)`; `document.documentElement.scrollWidth` is at most 375. Repeat at 320 x 700: `scrollWidth` at most 320, `#dials` right edge at most 320, no text clipped (each text's box inside `#dials`), the dials wrap rather than overflow. Take screenshots `Screenshots/dials-simplify-375.png` and `...-320.png`. Covered by headless? yes for the numbers; the look: owner list.
- **H9 None selected.** Setup: Seed A with `dials: []`. Expect: no `[data-dial]`, no `.dial-area`, the four rows and `#dialsEdit` present; `#dialsOpen` still opens the details on click. Then open the panel: all six checkboxes unchecked. Tick `#dialPick-f` then untick it: `localStorage` `dials` is `[]` again; reload: still no dial and the panel shows all unticked (an empty choice is NOT reset to calories). Repeat the layout check at 375 and 320: no sideways scroll. Covered by headless? yes.
- **H10 Tapping the card opens the details; the pencil does not.** Setup: Seed A. Steps: click the text `Protein` in the rows: `#dlg` opens with the title `Nutrition details`; close it; click the calories dial: opens; close; click `#dialsEdit`: `#dlg` stays closed. With edit mode open, click `#dialPick-steps` and `#dialsDone`: `#dlg` stays closed. Covered by headless? yes.
- **H11 No data is not 0.** Setup: Seed A with `dials: ['steps','sleep']` and `activity: {}`. Expect: the text `no data` appears twice inside the dials, aria-labels `Steps: no data` and `Sleep: no data`, neither shows `0 /`; the rows are unaffected. A recorded `steps: 0` (activity `{updatedAt:1, source:'google-health', steps:0, sleepMinutes:473}`) shows `0 / 10,000`. Covered by headless? yes.
- **H12 Day navigation.** Setup: Seed A with `dials` all six plus yesterday: no entries, activity `{updatedAt:1, source:'google-health', steps:3000, sleepMinutes:400}`. Steps: click `#prev` (`Previous day`). Expect: row texts `0 / 2000 kcal`, `0 / 150 g`, `0 / 200 g`, `0 / 65 g`, calories centre `2000` / `kcal left`, steps `3,000 / 10,000`, sleep `6 h 40 min / 8 h`; `#next` returns to today. The chosen dials do not change. Covered by headless? yes.
- **H13 Themes.** Setup: Seed A with all six dials. Steps: in Settings choose Light, Dark, Ocean, Contrast in turn, go back to the Diary each time. Expect: the arcs' computed `stroke` is never `rgba(0, 0, 0, 0)`; bar fills are visible (computed background differs from the card background); no sideways scroll. Covered by headless? yes for existence; legibility: owner list.
- **H14 Settings is unchanged.** Setup: Seed A. Expect: Settings still has `#gK #gP #gC #gF #gSteps #gSleep` with their values; no page error in the console; `#summary` absent everywhere. Covered by headless? yes.
- **H15 Backup carries the choice.** Setup: Seed A, tick `#dialPick-steps`. Steps: Settings, click `#bkExport`, capture the download. Expect: JSON `schemaVersion` 12 and `dials` `["k","steps"]`. Covered by headless? yes if downloads can be captured; otherwise owner list.

### Owner on a real device
- **R1** Look at the card in light and dark themes: is it calmer than the nested rings; do the six dials fit and wrap nicely; is the pencil big enough to hit (aim at least 44 x 44 px tap target) and clearly top right?
- **R2** Over-goal: can you tell it from the words and the bar, not only the red?
- **R3** Screen reader (TalkBack or VoiceOver): the pencil is announced as `Choose dials`; the card as a button `Nutrition details for this day`; each dial by its label; checkboxes by their names; focus stays on a checkbox you just toggled.
- **R4** Sync: change the dials on one device, open the other: the choice arrives. An older build (before this change) that syncs afterwards must not reset it. (Two devices and a sync account.)
- **R5** After the update installs on your phone (new service worker): your goals and entries are all still there and the card shows calories only until you choose more.

## Open questions (for the owner; tests avoid depending on them unless said)
1. **Old device wins a goals change.** Unchanged from `dials.md` open question 1 (steps and sleep goals reset to defaults when an old-device settings record wins). Not touched here. `dials` itself is protected by the "absent field keeps local" rule above.
2. **A version-11 save that somehow already has `dials`.** `migrate` for `v < 12` sets the default per the request ("Migration from <=11 sets default ['k']"), but `sanitize` keeps a valid array that is already present. Real version-11 data never has the field; the tests do not pin this case.
3. **Dial order.** Fixed (k p c f steps sleep), not user-orderable; the saved array is always in that order.
4. **Edit panel stays open across a day change?** Left to the implementer; not tested.
5. **Pencil icon.** Any pencil glyph/SVG; only the accessible name `Choose dials` is pinned.
6. **Calories dial when the calorie goal is 0.** Not specified (see `dials.md` open question 2); only "no throw, no NaN" is tested.
7. **Report JSON (`exportFiles` data file) does not carry `dials`.** Chosen to keep its documented key list. Say if the report should carry it too.
8. **Where the event wiring lives** (`diary.js` or `dials.js`): free, as long as S18's words appear in one of them.
