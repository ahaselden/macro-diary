# Spec: nutrition details for a day (backlog item 16)

## Purpose
Tapping the day summary at the top of the Diary opens a details page for that day: calories and P/C/F against the goals, plus the other nutrition-label facts (fiber, sugars, saturated fat, sodium, cholesterol) added up over the day's entries. The extra facts are optional per food; the page must say honestly how many items reported each one and must never show a missing value as 0.

## Contract (names decided here; the implementation must use them)

| Piece | Layer / file | Shape |
|---|---|---|
| `NUT_KEYS` | `js/core/schema.js` | `['fiber','sugars','satFat','sodium','cholesterol']` (this order) |
| `sanitizeNut(v)` | `js/core/schema.js` | pure. Returns a NEW plain object holding only those known keys of `v` whose value is `typeof 'number'`, finite and in range (below); returns `undefined` when nothing valid is left (or `v` is not a plain object) |
| `SCHEMA_VERSION` | `js/core/schema.js` | becomes `8` (header comment gains a line for v8) |
| `migrate(d)` | `js/core/schema.js` | v7 (and older) -> 8; adds nothing (no entry gains a `nut`); never drops data |
| `sanitize(d)` | `js/core/schema.js` | for every plain-object entry in `d.days[*]` (arrays), and every food in `d.recent` and `d.custom`: `nut` is replaced by `sanitizeNut(nut)`, or the property is deleted when that is `undefined`. Entries/foods are never dropped because of `nut` |
| `sanitizeFood(f)` | `js/core/schema.js` | (recipe ingredient foods, plan-item foods) output gains `nut` ONLY when `sanitizeNut(f.nut)` is defined |
| `mapOFF(p)` | `js/services/off.js` | result gains `nut` only when at least one nutrient is reported (below); otherwise NO `nut` property, and the rest of the result is byte-for-byte what it is today |
| `mapUSDA(f)` | `js/services/usda.js` | same rule |
| `dayDetails(entries, goals)` | `js/domain/details.js` (NEW; domain, pure) | see "Return shape" |
| `index.html` / `js/ui/diary.js` | ui | `#summary` gets `role="button"`, `tabindex="0"`, an accessible name, and opens the details dialog on click, Enter and Space |

### Stored shape
`nut` is an optional sibling of `per100` on a food and on a diary entry: `{ fiber?, sugars?, satFat?, sodium?, cholesterol? }`, all PER 100 g (sodium and cholesterol in mg, the rest in g). `per100` stays exactly `{k,p,c,f}`. A key is present only when the source reported it. Absent means "not recorded", never 0. A reported 0 is stored as 0.

### Ranges (per 100 g, inclusive; outside the range the key is dropped, not clamped)
fiber, sugars, satFat: 0..100. sodium: 0..40000 mg. cholesterol: 0..5000 mg. Only JS numbers are accepted (numeric strings, booleans, null are dropped).

### Source mapping
- Open Food Facts nutriments: `fiber_100g`, `sugars_100g`, `saturated-fat_100g` (g, kept), `sodium_100g` (g, x1000 -> mg), `cholesterol_100g` (g, x1000 -> mg). A value is kept only when it is a finite number >= 0 (and in range); missing/null/negative/NaN are skipped.
- USDA `foodNutrients` by `nutrientNumber`: 291 fiber (g), 269 sugars (g), 606 saturated fat (g), 307 sodium (mg), 601 cholesterol (mg). Same keep rule. A reported value of 0 is kept (`usdaNut` returning 0 must not be treated as absent: do not use `||`).
- Custom foods typed by hand have no `nut` (Custom form unchanged this round).

### Return shape of `dayDetails(entries, goals)`
```
{ items: <number of usable entries>,
  macros: { k, p, c, f },                 // totals, same numbers as nutrition.totals() over the usable entries
  pct:    { k, p, c, f },                 // Math.round(total / goal * 100); null when that goal is not a finite number > 0
  nutrients: { fiber: { total, recorded, missing }, sugars: {...}, satFat: {...}, sodium: {...}, cholesterol: {...} } }
```
A "usable entry" passes `validEntry` (string id, per100, finite grams > 0) and is a plain object; everything else is ignored and not counted anywhere. For a nutrient: `recorded` = usable entries whose `nut[key]` is a finite number >= 0; `missing` = `items - recorded`; `total` = sum over recorded entries of `nut[key] * grams / 100`, or `null` when `recorded === 0` (so the page shows "Not recorded", never 0). `dayDetails` always returns all five nutrient keys, even for `[]`, `undefined` or garbage input (then `items: 0`, macros all 0, every nutrient `{ total: null, recorded: 0, missing: 0 }`). It never throws and never mutates its inputs.

## Behaviours (tests `D<n>` in `tests/nutrition-details.test.js`)

1. `SCHEMA_VERSION` is 8; `defaults().schemaVersion` is 8; `NUT_KEYS` is the five keys in order.
2. `migrate` of v7 and older data gives schemaVersion 8, entries/foods unchanged (no `nut` is added anywhere), fixtures `state.json` and `backup.json` survive, `createStore` loading a stored v7 string gives v8 intact.
3. `sanitizeNut` keeps valid keys (including a reported 0), drops absent ones (absent stays absent), returns `undefined` when nothing valid.
4. `sanitizeNut` hostile input: strings, numeric strings, negative, over-range, NaN, +-Infinity, null, booleans, arrays/objects as values, extra keys, `__proto__`/`constructor`/`prototype` keys, non-object input; range boundaries inclusive. Result is a fresh plain object (not the input) and `Object.prototype` is never polluted.
5. `sanitize` cleans `nut` on entries in `days`, on `recent` and `custom` foods; entries/foods are kept; a `nut` with nothing valid is removed; valid values and entries without `nut` are untouched.
6. `sanitizeFood`/`sanitizeRecipe`/`sanitizePlanDay` carry a valid `nut` through recipe-ingredient foods and plan-item foods, drop hostile parts, and add no `nut` property when there is none.
7. `mapOFF` reads the five nutrients with the g -> mg conversion; unreported ones are absent; reported 0 kept; garbage ignored; nothing reported -> no `nut` key and `per100` still exactly four keys.
8. `mapUSDA` reads 291/269/606/307/601; unreported absent; reported 0 kept; nothing reported -> no `nut` key; existing output otherwise unchanged.
9. `dayDetails` scales by grams/100 and sums (hand-computed example).
10. `dayDetails` mixed recorded/missing entries: `recorded`/`missing` counts and totals only over recorded.
11. `dayDetails` zero versus absent: a reported 0 counts as recorded with total 0; all-absent gives `total: null`.
12. `dayDetails` tolerates malformed entries, malformed `nut`, non-array input; does not mutate.
13. `dayDetails` macros equal `totals()`; `pct` rounds and is null for a zero/invalid goal; goals missing -> all null.
14. Sync: `toRecords` day records carry `nut`; `applyRecords` keeps a valid `nut` and sanitises a hostile one (entry still arrives); a record from a device that has no `nut` is accepted unchanged.
15. `mergeStates`: entries travel whole. The newer entry wins as a whole, including its `nut` or lack of it; equal stamps converge in both argument orders; a device lacking `nut` does not erase it from an entry it never edited (older stamp loses).
16. Backup: `mergeRestore` of a backup carrying `nut` brings it in sanitised; hostile `nut` in a backup is cleaned and the entry kept; an old backup (v7, no `nut`) merges as before; JSON round trip of state keeps `nut`.
17. `copyEntries` copies `nut` (deep copy, not the same object; editing the copy does not change the original).
18. Editing a saved custom food (`updateCustomFood`) keeps its `nut`.
19. Source text: the code that builds a diary entry / recent food from a chosen food, and the plan and recipe food pickers, carry `nut` (`js/ui/amount-picker.js`, `js/ui/plan-view.js`, `js/ui/recipe-editor.js` each mention `nut`); `js/ui/diary.js` makes `#summary` a keyboard button (`role="button"` and `tabindex` set where the summary is rendered or in `index.html`) and imports `dayDetails`; `js/domain/details.js` imports nothing from `ui/`, `services/` and uses no `document`/`localStorage`/`fetch`.

## Existing tests that must change (they pin schema 7)
Changed by the implementer and explained in the PR (the new value is 8):
- `tests/favourite-recipes.test.js` F1 (lines ~21-23) and line ~31 (`schemaVersion` 7).
- `tests/page-nutrition.test.js` N1 (lines ~33-35), line ~45 and line ~52 (`schemaVersion` 7).
- `tests/recipe-import-ui.test.js` U12 (line ~122, regex `SCHEMA_VERSION = 7;`).
- `tests/store.test.js` line ~92 (`migrate({ schemaVersion: 7 }).schemaVersion` -> 8; its title says "never lowers the version").
- `tests/sync-usda-key.test.js` B1 (25-27), B2 (33, 37, 46, 48) and line ~186.
I did not edit these (I may only touch new files). Until they are updated they will fail once `SCHEMA_VERSION` becomes 8. They are the expected, listed breakage.

## Edge cases and hostile input
Empty day; 1 entry; 1000 entries; grams 0, negative, NaN, huge (1e7); `nut` values as strings, negative, 1e308, NaN, Infinity, null, nested objects; `nut` itself a string, array, null, number; extra keys; `__proto__` own key (as produced by `JSON.parse`); HTML such as `<img onerror>` in names and as `nut` values (only numbers survive, so HTML can only appear in names, which the UI must `esc()`); entries from sync/backup with `nut` on one side only; old schema-7 data; floating point (use approximate comparison for scaled sums).

## What cannot be tested automatically
Layout, tap targets, focus ring and screen-reader wording; behaviour on a real phone (Safari). Everything else is in the headless checklist below.

## Manual / headless checklist
All headless items seed `localStorage` key `macrodiary.v1` with the stated state (schemaVersion 8, goals `{k:2000,p:150,c:200,f:65}`, `days` for today's date `TODAY`) and reload. No network is used. Entry fields: `{id, meal, name, brand:'', source:'', per100:{k,p,c,f}, grams, nut?}`.

**C1 Opens by click**
Setup: Diary tab. Today has two entries: `a` "Oats" per100 `{k:380,p:13,c:66,f:7}`, grams 50, nut `{fiber:10, sugars:1, satFat:1.2, sodium:5, cholesterol:0}`; `b` "Cola" per100 `{k:42,p:0,c:10.6,f:0}`, grams 330, no nut.
Steps: click the day summary (`#summary`).
Expect: a dialog/page opens containing today's date, the text "Nutrition facts", rows labelled "Fiber", "Sugars", "Saturated fat", "Sodium", "Cholesterol". Fiber shows "5 g" with "from 1 of 2 items"; Sugars "0.5 g"; Saturated fat "0.6 g"; Sodium "2.5 mg"; Cholesterol "0 mg" (a reported 0, NOT "Not recorded"). Calories show 329 (190 + 138.6 = 328.6, rounded) with goal 2000.
Covered by headless? yes.

**C2 Keyboard**
Setup: as C1.
Steps: focus `#summary` with Tab (it must be reachable), press Enter; close the details; focus it again, press Space.
Expect: both Enter and Space open the details; `#summary` has `role="button"` and `tabindex="0"`; Escape (or the close button) closes it and the Diary is unchanged.
Covered by headless? yes.

**C3 Not recorded, never 0**
Setup: today has one entry "Cola" as above, no `nut`.
Steps: open the details.
Expect: each of the five rows shows the words "Not recorded"; the digit text "0 g" / "0 mg" does not appear in the nutrition facts list; calories 139 shown; a short note says old entries and hand-typed foods have no extra values.
Covered by headless? yes.

**C4 Empty day**
Setup: no entries today.
Steps: click `#summary`.
Expect: opens without error; calories 0; all five rows "Not recorded"; no "from 0 of 0" wording is required but no "NaN" or "undefined" text anywhere.
Covered by headless? yes.

**C5 Percent of goal**
Setup: one entry per100 `{k:200,p:20,c:30,f:10}`, grams 100, goals p 150 c 200 f 65 k 2000.
Steps: open the details.
Expect: Calories 200 of 2000 (10%), Protein 20 / 150 g (13%), Carbs 30 / 200 g (15%), Fat 10 / 65 g (15%).
Covered by headless? yes.

**C6 Hostile saved data**
Setup: one entry named `<img src=x onerror=alert(1)>` with nut `{fiber:"9", sodium:-5, sugars:1e308}`.
Steps: reload, open the details.
Expect: no dialog from `alert`, the name (if shown) is literal text, fiber/sodium/sugars rows say "Not recorded", the app does not crash.
Covered by headless? yes.

**C7 Other day**
Setup: Diary on yesterday with its own entries; today different.
Steps: press the previous-day arrow, open the details.
Expect: the details show yesterday's date and yesterday's totals, not today's.
Covered by headless? yes.

**C8 Lookup stores nut (stubbed network)**
Setup: Open Food Facts answers one product "Test bar" with `nutriments` `{ "energy-kcal_100g":400, proteins_100g:10, carbohydrates_100g:50, fat_100g:20, fiber_100g:7, sugars_100g:12, "saturated-fat_100g":3, sodium_100g:0.5, cholesterol_100g:0.02 }`, serving_quantity 50.
Steps: Add a food (+ Add on Lunch), search "Test bar", pick it, accept the amount 100 g, Add; click `#summary`.
Expect: Fiber "7 g", Sugars "12 g", Saturated fat "3 g", Sodium "500 mg", Cholesterol "20 mg", each "from 1 of 1 items".
Covered by headless? yes.

### Owner on a real device
- O1 Real Safari/iPhone: tapping the summary opens the details and it scrolls and closes comfortably with one thumb.
- O2 Screen reader (VoiceOver): `#summary` is announced as a button and the rows read as "Fiber, 5 grams".
- O3 Real data: after scanning a few real products from Open Food Facts and USDA, the sodium figure matches the label on the pack (mg, not g).
- O4 Sync two real devices: add a looked-up food on one, the details on the other show the same extras.

## Open questions
1. Exact UI wording beyond "Nutrition facts", the five row labels, "Not recorded" and "from N of M items" is not fixed; the honesty note's wording is the implementer's choice (C3 only requires its meaning).
2. Numeric strings from the sources (OFF sometimes returns `"3.5"`): plan only says numbers; this spec keeps `sanitizeNut` strict (strings dropped) and says nothing about `mapOFF` converting numeric strings first. Not tested.
3. Rounding on screen (1 decimal for g, whole mg?) is not specified; C1 values were chosen so that either "5 g"/"5.0 g" style reads as the same number; the browser-tester should match on the number.
4. `sanitize` for `days` entries is new behaviour (today it does not touch entries). The spec says valid entries are never dropped; entries that are not plain objects are left exactly as they are.
5. Percent is rounded to a whole number and null for a zero goal: my choice, the plan only says "percent-of-goal".
6. Nutrients are added "scaled by grams/100"; for entries whose grams were edited later this uses the current grams, as the macros do.
7. Merge: an older entry with `nut` loses to a newer edit that lacks it (whole-entry last-writer-wins, as for every other field). Fine for this round since `nut` is set only when a food is added, but the owner may want a field-level merge later.
