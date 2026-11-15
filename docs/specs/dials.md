# Spec: activity and nutrition dials on the Diary, with steps and sleep goals (backlog item 21)

## Purpose
The Diary gets ring dials above the summary card: one nutrition dial of four concentric rings (calories, protein, carbs, fat) and one ring each for the imported steps and sleep of the viewed day, every ring with its numbers as text. Settings gets two new goals (steps, sleep hours), which is a saved-shape change (schema 10 to 11) that must reach sync, backup, restore and export without losing any existing value.

Written before the implementation by the test designer. Owner decisions of 2026-11-14 are taken as given. Where the plan left a name or a string open, this spec FIXES it (marked "decided here") so the tests can pin it; the owner can change any of these in review before the build, and the implementer must then ask for the test to be changed, not edit it.

## Sketch of the dial (owner: please approve or change before the build)
Phone, 375 px wide, card inner width about 343 px. The nutrition dial is the big one on the left; steps and sleep are two small rings on the right. Every ring has its numbers as text, next to it, never colour alone.

```
+-------------------------------------------------------------+
|  .-----------.                                              |
| /  .-------.  \        (steps ring)  Steps                  |
|| /  .-----.  \ |        62 px         6,120 / 10,000        |
|| | /  800  \  | |                                           |
|| | | kcal  |  | |       (sleep ring)  Sleep                 |
|| | \ left  /  | |        62 px         7 h 53 min / 8 h      |
|| \  '-----'  / |                                            |
| \  '-------'  /     rings are filled clockwise from 12 o'clock|
|  '-----------'      grey track behind each ring               |
|   128 px, 4 rings                                           |
|                                                             |
|  Calories 800 / 2000 kcal     Protein 80 / 150 g            |
|  Carbs 160 / 200 g            Fat 40 / 65 g                 |
+-------------------------------------------------------------+
|  (existing summary card, unchanged, below)                  |
```

Nutrition dial rings, outside to inside: calories (`--kcal`), protein (`--p`), carbs (`--c`), fat (`--f`). A ring over its goal is drawn in `--over` (red); its text then also says "over goal" in the accessible name. A ring with no data is an empty grey track and the text says `no data`.

Geometry decided here (SVG, `viewBox="0 0 128 128"`, scales with `width:100%`/`max-width:128px`): stroke 9, gap 3, so ring radii 59.5 / 47.5 / 35.5 / 23.5 (outer to inner); the centre disc (radius 23.5 - 4.5 = 19) holds the "800 / kcal left" text. Steps and sleep: `viewBox="0 0 64 64"` with stroke 7, radius 28.5. These numbers are a recommendation (the tested rule is in `ringRadii`: radii are positive, each one `stroke + gap` smaller than the one outside it, nothing overlaps). Fits 375 px: 128 + 62 + paddings is well under 343.

## Contract

### Layer and files (new shipped files go in `SHELL` in `sw.js`, `CACHE` bumped above 60, the value on main when this was written; never an exact number)
- `js/domain/dials.js` (domain, PURE: no DOM/storage/globals; imports only `core/{constants,format,dates,schema}` and domain modules)
- `js/ui/dials.js` (ui)
- `js/core/schema.js` (changed): goals gain two fields, `SCHEMA_VERSION` 11
- `index.html`, `css/themes.css`, `css/*.css` (dial styles), `js/ui/diary.js`, `js/ui/settings-view.js`, `js/domain/sync-records.js`, `sw.js`, `docs/*`

### Saved shape (decided here)
`state.goals = { k, p, c, f, steps, sleepH }`. `steps`: goal in steps per day, a whole number, default 10000. `sleepH`: goal in hours per night, may be fractional (7.5), default 8.
Sanitising in `sanitize()` (so it applies to loaded data, restore, backup and sync alike), per field, same style as the other goals (numeric text is accepted and converted, a value that is not usable falls back to the DEFAULT, never clamped):
- `steps`: finite number or numeric text, `0 <= n <= 1000000`, rounded to a whole number (7500.6 -> 7501). Otherwise 10000.
- `sleepH`: finite number or numeric text, `0 <= n <= 24`. Otherwise 8.
- `null`, `''`, `true`, `false`, objects, `NaN`, `+-Infinity`, negatives: default.
- 0 is a valid value (it means "no goal": the ring stays empty and shows its text).
- `goals` always has exactly the keys `k p c f steps sleepH` (unknown keys dropped, own keys only, `__proto__` etc. never copied).
`migrate()`: `if (v < 11) d.schemaVersion = 11;` (the defaults come from `sanitize`). `defaults().goals` = `{ k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8 }`. `STORAGE_KEY` unchanged.

### `js/domain/dials.js` exports (decided here)
- `ringFraction(value, goal)` -> number in `[0, 1]`. `value / goal` capped at 1. Returns 0 when `value` or `goal` is not a finite number (strings are NOT converted), when `goal <= 0`, when `value < 0`.
- `isOver(value, goal)` -> boolean. True only when both are finite numbers, `goal > 0` and `value > goal` (strictly: exactly at goal is not over).
- `ringArc(fraction, radius)` -> `{ circumference, filled, gap, dasharray }`: `circumference = 2 * PI * radius`; `fraction` clamped to `[0, 1]` (NaN or non-number = 0); `filled = fraction * circumference`; `gap = circumference - filled` (never negative); `dasharray = filled + ' ' + gap` (two plain numbers). A radius that is not a finite number above 0 gives `{ circumference: 0, filled: 0, gap: 0, dasharray: '0 0' }`. Never produces NaN/Infinity text. The ring starts at 12 o'clock and runs clockwise: the UI does that with `transform="rotate(-90 cx cy)"` on the circle and no dash offset, so the arc maths has no offset.
- `ringRadii(size, stroke, gap, count)` -> array of `count` radii, outermost first: first = `size / 2 - stroke / 2`, each next = previous - (stroke + gap). If any radius minus `stroke / 2` would not be above 0, or an argument is not a finite positive number (`gap` may be 0), or `count` is not an integer 1..8, returns `[]`.
- `formatSleep(minutes)` -> `'7 h 53 min'`, `'8 h'`, `'45 min'`, `'0 min'`; whole minutes (rounded); `''` for anything that is not a finite number `>= 0`. (Same wording as `activityLine`.)
- `formatSteps(n)` -> `'9,431'` (en-US thousands separators, rounded); `''` for anything that is not a finite number `>= 0`.
- `dialModel(state, day)` -> the whole dial as plain data. Never throws, never mutates `state` (it may be deep-frozen), needs no DOM. Shape:
```
{
  nutrition: {
    label: string,                         // accessible name of the whole nutrition dial, contains the calories eaten and the goal
    centre: { text: '800', caption: 'kcal left' | 'kcal over' },   // text = String(Math.round(Math.abs(goal.k - eaten.k)))
    rings: [ ring, ring, ring, ring ]      // exactly this order: k, p, c, f (outside to inside)
  },
  steps: ring,
  sleep: ring
}
ring = { key, name, value, goal, fraction, over, hasData, text, label, color }
```
Ring fields:
| ring | key | name | value | goal | text (has goal) | color |
|---|---|---|---|---|---|---|
| calories | `'k'` | `'Calories'` | eaten, unrounded | `goals.k` | `'800 / 2000 kcal'` | `'var(--kcal)'` |
| protein | `'p'` | `'Protein'` | eaten | `goals.p` | `'80 / 150 g'` | `'var(--p)'` |
| carbs | `'c'` | `'Carbs'` | eaten | `goals.c` | `'160 / 200 g'` | `'var(--c)'` |
| fat | `'f'` | `'Fat'` | eaten | `goals.f` | `'40 / 65 g'` | `'var(--f)'` |
| steps | `'steps'` | `'Steps'` | `activity.steps` or `null` | `goals.steps` | `'6,120 / 10,000'` | `'var(--ring-steps)'` |
| sleep | `'sleep'` | `'Sleep'` | `activity.sleepMinutes` or `null` | `goals.sleepH * 60` (minutes) | `'7 h 53 min / 8 h'` | `'var(--ring-sleep)'` |

- Eaten values are rounded with `rd` for the text; the goal text is the goal as a plain number (`Number(goal)`), the sleep goal text is `formatSleep(goal minutes)`.
- `fraction = ringFraction(value, goal)`, `over = isOver(value, goal)` (for a ring without data: fraction 0, over false).
- `label` (the accessible name, also what a screen reader says): `name + ': ' + text with ' / ' replaced by ' of '`, then `', over goal'` when over. Examples: `'Calories: 800 of 2000 kcal'`, `'Steps: 12,000 of 10,000, over goal'`, `'Sleep: 7 h 53 min of 8 h'`.
- No data (steps or sleep): `hasData: false`, `value: null`, `fraction: 0`, `over: false`, `text: 'no data'`, `label: name + ': no data'`. Steps are "no data" when the day has no activity record, or the record has no `steps` key, or `steps` is not a finite number `>= 0`. A recorded `steps: 0` IS data (`hasData: true`, text `'0 / 10,000'`). Sleep is "no data" the same way (no `sleepMinutes`, or not a finite number `> 0`). The night that ends on that day is what `activityForDay(state, day)` already returns.
- No usable goal (missing, not a finite number, `<= 0`): `goal: 0`, `fraction: 0`, `over: false`, the text is the value alone (`'6,120'`, `'7 h 53 min'`, `'800 kcal'`, `'80 g'`), and the label is `name + ': ' + value text + ', no goal set'`. Nothing divides by zero. Nutrition rings always have data (nothing logged is a real 0).
- Every string in the model is made of fixed words and numbers: it contains no `NaN`, `Infinity`, `undefined`, `null`, `[object` and no `<` or `>`, whatever the state holds.

### `js/ui/dials.js` exports (decided here)
- `dialsHtml(model)` -> string: the SVG and text for `model` (from `dialModel`). PURE string building, importable in Node. EVERY string from the model goes through `esc()`; numbers go through `ringArc` (so a hostile `fraction` can never print `NaN`). Contains: for each ring an `<svg>` circle pair (grey track, then the arc with `stroke-dasharray` and `stroke` = the ring colour, or `var(--over)` when `over`), `aria-label` = the ring's `label` (escaped) on the ring's element, and the ring's `text` as visible text; the centre text and caption; the text `no data` for a ring without data.
- `renderDials()` -> writes `dialsHtml(dialModel(state, view.day))` into `#dials` and sets its `aria-label`. Called from `renderDiary()`.

### Markup and wiring
- `index.html`, inside `#v-diary`, BEFORE `#summary`: `<div class="card" id="dials" role="button" tabindex="0"></div>`. `#summary` (and `#activityLine`) stay exactly as they are.
- Tapping `#dials`, or Enter/Space on it, opens the same day details dialog as `#summary` (`openDetails` in `js/ui/diary.js`).
- Settings, in the goals card after Fat: `<label for="gSteps">Steps</label><input id="gSteps" type="number" inputmode="numeric" min="0">` and `<label for="gSleep">Sleep (hours)</label><input id="gSleep" type="number" inputmode="decimal" min="0" max="24" step="0.25">`. They are saved by the existing change handler together with the other goals (so `touchSettings` runs when one of them changed, because `synced()` already serialises the whole `state.goals`). A typed value that is not a number `>= 0`, or a sleep above 24, is not saved (the previous value stays), the same as an invalid calorie goal today.
- Colours: `css/themes.css` defines `--ring-steps` and `--ring-sleep` as hex colours in `:root` AND in every complete theme block (the 13 `[data-theme=...]` blocks that define `--card`). In each theme both have contrast ratio at least 3:1 against that theme's `--card` (WCAG for graphics), differ from each other, from that theme's `--p --c --f --accent` and from the two `--over` values (`#dc2626`, `#f87171`).

## Behaviours (tests in `tests/dials.test.js`; tick them off in review)
Domain, ring maths
1. `ringFraction`: 50/100 = 0.5, 0/100 = 0, 100/100 = 1, 150/100 = 1 (capped), 1/3 is one third, 250/1000 = 0.25.
2. `ringFraction` with goal 0, negative, NaN, Infinity, missing or a string, or a negative/NaN/string/missing value: exactly 0 (no division by zero); Infinity value stays finite in `[0, 1]`.
3. `isOver`: 101/100 true; 100/100 false; 99.9/100 false; goal 0 or negative or NaN false; value NaN false.
4. `ringArc(0.25, 10)`: circumference 62.8318..., filled a quarter, gap the rest, `dasharray` is those two numbers; fraction 0 gives filled 0; fraction 1 gives gap 0 (never negative); fraction above 1, below 0, NaN, string are clamped; hostile radius gives zeros and no `NaN`/`Infinity` in the string.
5. `ringRadii(120, 8, 3, 4)` = `[56, 45, 34, 23]`; `ringRadii(100, 10, 2, 2)` = `[45, 33]`; no ring overlaps another; rings that do not fit, hostile arguments, `count` 0 or 9 or 2.5 give `[]`.
6. `formatSleep`: 473 -> `7 h 53 min`, 480 -> `8 h`, 45 -> `45 min`, 0 -> `0 min`, 1440 -> `24 h`, 59.6 -> `1 h`, 450 -> `7 h 30 min`; NaN, negative, string, null, Infinity -> `''`. `formatSteps`: 9431 -> `9,431`, 0 -> `0`, 1234567 -> `1,234,567`, 9430.6 -> `9,431`; hostile -> `''`.

Domain, the model
7. `dialModel` nutrition: for 800 kcal / 80 g P / 160 g C / 40 g F eaten against 2000 / 150 / 200 / 65: rings in the order k p c f with the fixed names, keys and colours; fractions 0.4, 80/150, 0.8, 40/65; texts `800 / 2000 kcal`, `80 / 150 g`, `160 / 200 g`, `40 / 65 g`; centre text `1200` with caption `kcal left` (2000 - 800); no ring over.
8. Over and exactly at the goal: calories 2100 of 2000 gives over true, fraction 1, centre `100` / `kcal over`; exactly 2000 gives over false, fraction 1, centre `0` / `kcal left`; one macro over leaves the others and the calories not over.
9. A day with nothing logged: all zero fractions, `hasData` true, centre equals the calorie goal, `kcal left`.
10. Steps and sleep from the day's activity record: 6120 steps of 10000 -> fraction 0.612, text `6,120 / 10,000`, label `Steps: 6,120 of 10,000`; 473 min of 8 h -> fraction 473/480, text `7 h 53 min / 8 h`, label `Sleep: 7 h 53 min of 8 h`, colours `var(--ring-steps)`, `var(--ring-sleep)`; a 7.5 h goal reads `7 h 30 min`.
11. Over for steps and sleep: 12000 of 10000 -> over true, fraction 1, label ends `, over goal`; 540 min of 8 h likewise.
12. No data is never a silent 0: no record for the day, a record for another day, a record without `steps` (only sleep), a record without sleep, a record holding only workouts: `hasData` false, value null, text `no data`, label `Steps: no data` / `Sleep: no data`, fraction 0, over false. A recorded `steps: 0` is data with text `0 / 10,000`.
13. Missing or zero goals (an old state without the new goal fields, `steps: 0`, `sleepH: 0`, NaN, negative, text): fraction 0, over false, text is the value alone, label ends `, no goal set`, no NaN/Infinity anywhere; calories goal 0 does not throw.
14. Hostile state: `null`, `undefined`, `{}`, an activity record with `steps: NaN`, `'5000'`, `-1`, `Infinity`, `sleepMinutes: 0`/`-5`/`'x'`, a day key of `__proto__` / `constructor` / `toString`, goals made of `<img onerror=x>` strings, a deep-frozen state: no throw, no mutation, every string of the model passes the "fixed words and numbers" rule above.

UI strings
15. `dialsHtml`: contains an `<svg` with a `viewBox`, an `aria-label` for each of the 6 rings equal to the escaped label, the visible text of every ring (`800 / 2000 kcal`, `80 / 150 g`, `160 / 200 g`, `40 / 65 g`, `6,120 / 10,000`, `7 h 53 min / 8 h`) and the centre `kcal left`; no `var(--over)` when nothing is over; contains `var(--over)` when a ring is over; the text `no data` for a ring without data and no `NaN`.
16. `dialsHtml` is injection safe: a model whose names, texts, labels, captions and colours are `<img src=x onerror=alert(1)>` or `"onmouseover="x` produces no `<img`, no `<script` and no raw `"` that closes an attribute (`onmouseover="` and `onload="` do not appear); a model with NaN/Infinity/negative fractions prints no `NaN`/`Infinity`.

Saved shape
17. `SCHEMA_VERSION` is 11; `defaults()` has schemaVersion 11 and goals `{ k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8 }`; `STORAGE_KEY` is still `macrodiary.v1`.
18. Migration from every older version (1, 2, 5, 8, 9, 10) keeps every existing value (the four goals, days, tombstones, settingsUpdatedAt, theme, units, recipes, plan, activity) and adds `steps: 10000`, `sleepH: 8`; through the store (load, save, reload) too, and a user's custom `steps`/`sleepH` survive a save and reload.
19. Sanitising: valid values kept (7500 / 7.5, 0 / 0, 24 for sleep), numeric text converted, 7500.6 -> 7501; out of range, NaN, Infinity, negative, null, `''`, booleans, objects fall back to the defaults (sleep 24.5 -> 8, steps 1e12 -> 10000); an old `goals` without the fields gets the defaults; the other goals are unaffected; goals with extra keys or `__proto__` give exactly the six own keys and the prototype stays clean.

Sync, backup, export
20. Sync records: the `settings` record's `goals` carries `steps` and `sleepH`; a round trip through `toRecords`/`applyRecords` reproduces them; two devices converge on the newer settings record in both orders.
21. An old-device settings record (goals without the new fields) still applies: the four goals are taken, `steps`/`sleepH` are valid numbers (the defaults 10000 / 8 when the receiving device also had the defaults; see open question 1). A hostile settings record (text, negative, 99 hours, `__proto__`) gives valid values and never corrupts the state.
22. Backup/restore: `mergeRestore` of a NEWER settings backup brings its steps and sleep goals; of an older or untimestamped backup keeps this device's; a backup without the new fields restores with the defaults. The export JSON (`exportFiles` data file) contains `goals.steps` and `goals.sleepH`.

Wiring and shipping (static source checks, weak: see below)
23. `index.html`: `#dials` once, `role="button"`, `tabindex="0"`, inside `#v-diary` and before `#summary`; `#summary` markup unchanged; `#gSteps` and `#gSleep` are number inputs with their `<label for>`, in the goals card after `#gF`, `gSleep` with `max="24"`.
24. `js/ui/settings-view.js` reads and loads both inputs and its goals assignment sets `steps` and `sleepH`; the change listener list includes both ids; a sleep above 24 is refused (the source mentions the limit 24).
25. `js/ui/diary.js` imports `./dials.js`, calls `renderDials`, and `#dials` has the same open-details handler (click and Enter/Space) as `#summary`.
26. `css/themes.css`: `--ring-steps` and `--ring-sleep` in `:root` and in all 13 theme blocks, as hex colours, contrast >= 3:1 against `--card`, distinct from the others (rule in the contract).
27. Shipping: `sw.js` `SHELL` lists `js/domain/dials.js` and `js/ui/dials.js`; `CACHE` number is greater than 60; layering (domain/dials.js imports only allowed modules and touches no browser global; ui/dials.js imports no service); `docs/DECISIONS.md` has `## D56.` mentioning dial and schema 11; `docs/ARCHITECTURE.md` mentions `dials.js`.

Tests 1-6 and 17-22, 15-16 hit real code. 23-27 are static text checks and are weak (they prove words are in files, not that the screen works): the headless checklist C1-C14 is what proves the screens.

## Edge cases and hostile input (covered by the tests above)
- Empty/missing: no entries, no activity, `state.activity` missing or not an object, goals missing or `undefined`.
- Numbers: NaN, +-Infinity, negative, 0, huge (1e308, 1e12), fractions (7.5 h, 7500.6 steps), numeric strings, booleans, `null`.
- Types: arrays, objects, functions where a number is expected.
- Keys: `__proto__`, `constructor`, `toString` as day keys and inside goals.
- Strings: HTML and attribute-breaking quotes in every field the UI prints (the UI prints only model strings, which are fixed words and numbers, but `dialsHtml` must still escape them: defence in depth, imported/synced data reaches `state`).
- Synced/imported data: old-device records without the fields, records with hostile goals, backups from before the change.
- Big days: 200000 steps (the import cap) of a 10000 goal: capped ring, text keeps the real number.

## What cannot be tested automatically, and the manual checklist
Unit tests cannot see layout, colour, the SVG actually drawing clockwise from the top, tap targets, or a screen reader. A headless browser can check the DOM and computed styles (and take a 375 px screenshot) but not taste, and not a real phone.

### Headless checklist (browser-tester; viewport 375 x 800 unless stated; no network is needed: all data is seeded into `localStorage` key `macrodiary.v1` before load, as JSON, with `schemaVersion` 11 unless stated; "today" below is the date the page shows as Today)

Seed A = goals `{k:2000,p:150,c:200,f:65,steps:10000,sleepH:8}`, today's entries: one Lunch entry `{id:'e1', meal:'Lunch', name:'Rice', brand:'', source:'custom', per100:{k:100,p:10,c:20,f:5}, grams:800, updatedAt:1}` (= 800 kcal, 80 g P, 160 g C, 40 g F), `activity` for today `{updatedAt:1, source:'google-health', steps:6120, sleepMinutes:473}`.

- **C1 Dials show, in order.** Setup: Seed A, open the app (Diary). Steps: none. Expect: element `#dials` exists and is visible, and its position is above `#summary` (its bottom edge is at or above the top edge of `#summary`); `#summary` is still present and still shows `800` and `of 2000 kcal eaten`. Covered by headless? yes.
- **C2 Every ring has its numbers as text.** Setup: Seed A. Expect: the text of `#dials` contains `800 / 2000 kcal`, `80 / 150 g`, `160 / 200 g`, `40 / 65 g`, `6,120 / 10,000`, `7 h 53 min / 8 h`, and the centre shows `1200` with `kcal left`. Covered by headless? yes.
- **C3 Every ring has an accessible name.** Setup: Seed A. Expect: `#dials` contains 6 elements with an `aria-label` equal to (in any order) `Calories: 800 of 2000 kcal`, `Protein: 80 of 150 g`, `Carbs: 160 of 200 g`, `Fat: 40 of 65 g`, `Steps: 6,120 of 10,000`, `Sleep: 7 h 53 min of 8 h`; `#dials` itself has `role=button`, `tabindex=0` and a non-empty `aria-label`. Covered by headless? yes.
- **C4 Fill amount and direction.** Setup: Seed A. Steps: read the calories arc circle in the nutrition dial: its `stroke-dasharray` (two numbers) and its `r`. Expect: first number divided by the circumference `2 * PI * r` is 0.4 (+-0.005); the arc has `transform="rotate(-90 ...)"` (starts at 12 o'clock) and no negative `stroke-dashoffset`; the same for the steps arc (0.612) and sleep arc (0.985). The rings are concentric: the four nutrition circle pairs share one centre and their radii strictly decrease in the order calories, protein, carbs, fat. Covered by headless? yes (the real look of "clockwise from the top": owner list).
- **C5 Colours.** Setup: Seed A. Expect: computed `stroke` of the calories, protein, carbs, fat arcs equals the computed value of `--kcal`, `--p`, `--c`, `--f`; steps and sleep arcs use `--ring-steps` and `--ring-sleep`, which differ from each other. Covered by headless? yes.
- **C6 Over goal turns red.** Setup: Seed A but today's entry `grams:2200` (2200 kcal, 220 P, 440 C, 110 F), activity steps 12000, sleepMinutes 540. Expect: all six arcs have `stroke` equal to the computed `--over`; text `2200 / 2000 kcal`, `12,000 / 10,000`, `9 h / 8 h`; centre `200` with `kcal over`; aria-labels end with `, over goal`; every arc is a full circle (dasharray first number about equal to circumference). Covered by headless? yes.
- **C7 No data is not 0.** Setup: Seed A but remove `activity` entirely (`activity: {}`). Expect: text `no data` appears twice in `#dials` (steps and sleep), aria-labels `Steps: no data` and `Sleep: no data`, neither text contains `0 /`; nutrition rings unaffected. Covered by headless? yes.
- **C8 A recorded zero is not "no data".** Setup: Seed A with activity `{updatedAt:1, source:'google-health', steps:0, sleepMinutes:473}`. Expect: the steps text is `0 / 10,000` (not `no data`), the sleep text `7 h 53 min / 8 h`. Covered by headless? yes.
- **C9 Goal 0 does not break.** Setup: Seed A with goals steps 0, sleepH 0. Expect: steps text `6,120` and sleep text `7 h 53 min` (value alone), labels end `, no goal set`, no `NaN` or `Infinity` anywhere in `#dials`, the page has no uncaught error. Covered by headless? yes.
- **C10 Tap opens the details.** Setup: Seed A. Steps: click `#dials`. Expect: the dialog `#dlg` opens with the title `Nutrition details` (the same as clicking `#summary`). Then close it, focus `#dials`, press Enter: it opens again; close, press Space: opens. Covered by headless? yes.
- **C11 Day navigation.** Setup: Seed A plus yesterday: entries none, activity for yesterday `{steps:3000, sleepMinutes:400}`. Steps: click `#prev` (the previous-day button, label `Previous day`). Expect: the label reads yesterday's date, nutrition centre `2000` `kcal left`, steps `3,000 / 10,000`, sleep `6 h 40 min / 8 h`; clicking `#next` returns to today's numbers. Covered by headless? yes.
- **C12 375 px layout.** Setup: Seed A, viewport 375 x 800. Expect: `document.documentElement.scrollWidth` is at most 375 (no sideways scroll); `#dials` right edge at most 375 and its left edge at least 0; the nutrition dial `<svg>` is at least 120 px wide; every ring's text is visible (not clipped: its bounding box is inside `#dials`) and the texts do not overlap each other. Take a screenshot to `Screenshots/dials-375.png` for the owner. Repeat at 320 x 700: still no sideways scroll. Covered by headless? yes for the numbers; the look: owner list.
- **C13 Themes.** Setup: Seed A. Steps: in Settings choose each theme in turn (Light, Dark, and at least Ocean and Contrast), go back to Diary. Expect: for each theme the computed `--ring-steps` and `--ring-sleep` are not empty, steps and sleep arcs have a `stroke` that is not `rgba(0, 0, 0, 0)`, and differ from the card background colour. Covered by headless? yes for existence; legibility: owner list.
- **C14 New goals in Settings.** Setup: an OLD save: `schemaVersion: 10`, goals `{k:1800,p:120,c:150,f:50}`, no steps/sleep fields, one Lunch entry as in Seed A, activity as in Seed A. Steps: open the app, open Settings. Expect: `#gK` is `1800`; `#gSteps` is `10000`; `#gSleep` is `8`; the Diary dials show steps `6,120 / 10,000`, sleep `7 h 53 min / 8 h`, calories text `800 / 1800 kcal`. Then in Settings type `7000` into `#gSteps` and `7.5` into `#gSleep` (blur or press Tab so the change fires): the toast `Saved` appears; go to Diary: steps text `6,120 / 7,000`, sleep text `7 h 53 min / 7 h 30 min`. Reload the page: values still `7000` / `7.5` in Settings and the Diary. Then type `30` into `#gSleep`: nothing changes (Settings reload shows `7.5`); type `-5` into `#gSteps`: still `7000`. Covered by headless? yes.
- **C15 Backup carries the goals.** Setup: as the end of C14 (steps 7000, sleep 7.5). Steps: click `#bkExport` and capture the downloaded JSON. Expect: its `goals` is `{"k":1800,"p":120,"c":150,"f":50,"steps":7000,"sleepH":7.5}` and `schemaVersion` is 11. Covered by headless? yes if downloads can be captured; otherwise owner list.

### Owner on a real device
- **R1** Look at the dial on your phone in light and dark themes: does it read like the Google cardio widget, are four thin rings still distinguishable, is the centre text readable at arm's length?
- **R2** Check a real imported day (after a Google Health import): steps and sleep match the activity line under the summary card.
- **R3** Colour-blind check (or greyscale screenshot): you can still tell over-goal from under-goal because the text says it.
- **R4** Screen reader (TalkBack or VoiceOver): the dial area is announced with its summary; each ring is announced with its label.
- **R5** Sync: change the steps goal on one device, open the other: the new goal arrives. (Needs two devices and a sync account.)

## Open questions (for the owner; tests avoid depending on them unless said)
1. **RESOLVED (2026-11-14) by `docs/specs/goals-sync-rule.md`: a settings record or backup that lacks steps/sleep goals (or has an unusable value) now keeps this device's value; tests 21 and 22 of `tests/dials.test.js` were updated accordingly. The text below is the original question.** **Old-device settings records win with defaults.** Settings sync takes the whole `goals` object from the newest settings record. A device on the old version has no steps/sleep goals, so when its (newer) record wins, this device's steps and sleep goals are replaced by 10000 / 8. The plan says "old-device records without the new fields still merge and get defaults", which is what test 21 pins for a receiver on defaults; for a receiver with custom goals the test accepts either the defaults or the receiver's own value (it only requires valid numbers). Preferable behaviour: keep the receiver's value for a missing field. Owner to decide.
2. **Centre text when the calorie goal is 0.** Not specified; tests only require no throw and clean strings. Suggested: show the calories eaten with caption `kcal eaten`.
3. **Overflow mark.** The plan allows red OR an overflow mark; this spec fixes red (`--over`) plus `over goal` in the accessible name, and the text numbers already show the excess. An extra mark (for example `!`) is left to the implementer; no test depends on it.
4. **Sleep goal in half hours.** `#gSleep` uses step 0.25; the stored value is not rounded (7.333 stays 7.333). Say if it should be rounded to a quarter hour.
5. **Steps goal above 1,000,000** falls back to 10000 (not clamped), like the activity importer's out-of-range rule. Say if you want a different cap.
6. **Week or month view** of steps and sleep is out of scope here (backlog item says "later").
7. **Existing tests that must change.** Adding fields to `state.goals` changes the exact result of some older tests that compare whole goals objects (see the report); the test designer may not edit them. Listed in the hand-off, the implementer must change them (goals literals only) and explain each in the PR.
