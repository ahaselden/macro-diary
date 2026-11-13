# Spec: nutrition facts on the Amount screen (item-nutrition-facts)

## Purpose
After scanning or picking a food, the Amount screen (and the Edit entry screen, same module) shows only kcal and Protein/Carbs/Fat. It should also show a "Nutrition facts" block for the chosen amount (fiber, sugars, saturated fat, sodium, cholesterol), using the optional per-100 g `nut` object introduced with the day details page, with identical rows, units and number formatting to that page.

## Decisions made here
- **Per chosen amount, not per serving.** The block is scaled by `grams / 100` where grams is the amount currently typed (amount x unit), exactly like the kcal/macros card, and it re-renders whenever amount or unit changes.
- **No saved-shape change.** `nut` already exists on foods and entries (schema v8). `SCHEMA_VERSION` stays 8, no migration, no new stored field, `STORAGE_KEY` unchanged. Adding a diary entry already copies `nut` (existing behaviour; unchanged).
- The existing kcal/macros markup in `#prev2` is unchanged.
- A nutrient the food did not record is "Not recorded", never 0; a reported 0 shows `0 g` / `0 mg`.
- A food with no usable `nut` at all (hand-typed foods, old entries, a product with none of the five) shows ONE honest line instead of five rows. Wording is the implementer's, but it must not contain the five row labels and must not contain the text "Not recorded" five times.

## Contract

| Piece | Layer / file | Shape |
|---|---|---|
| `itemFacts(food, grams)` | `js/domain/details.js` (domain, pure) | Returns an ARRAY of exactly 5 objects `{ key, total }`, one per `NUT_KEYS` entry, in `NUT_KEYS` order. `total` = `food.nut[key] * grams / 100` when `food.nut` is a plain object whose OWN property `key` is a finite number >= 0, else `null`. `grams` that is not a finite number >= 0 (NaN, Infinity, negative, string, undefined) counts as 0. Never throws, never mutates `food`, never returns references into `food`. |
| `formatNut(total, unit)` | `js/domain/details.js` (pure) | `total` null / not a finite number / negative -> `'Not recorded'` (unit ignored). `0` -> `'0 <unit>'`. `0 < total < 0.1` -> `'<0.1 <unit>'`. Otherwise `total` rounded to 1 decimal with trailing `.0` dropped, then a space and the unit, e.g. `'3.5 g'`, `'500 mg'`. |
| Amount screen | `js/ui/amount-picker.js` (ui) | imports `itemFacts`, `formatNut` from `../domain/details.js`; `upd()` renders the block from `itemFacts(food, lastG)` each time. Block heading text `Nutrition facts`; container `id="itemFacts"`, a sibling after (or inside) `#prev2`. Rows use the labels Fiber, Sugars, Saturated fat, Sodium, Cholesterol and units g, g, g, mg, mg. |
| Day page | `js/ui/diary.js` | may replace its local `num1` with `formatNut`; its visible output must not change (identical strings). |

## Behaviours (tests in `tests/item-nutrition-facts.test.js`, titles carry the number)
1. `itemFacts` returns 5 entries in `NUT_KEYS` order with `key` and `total`; hand values: nut `{fiber:3,sugars:4,satFat:5,sodium:600,cholesterol:70}` at 50 g -> 1.5, 2, 2.5, 300, 35; at 250 g -> 7.5, 10, 12.5, 1500, 175.
2. A nutrient missing from `nut` has `total === null` (not 0); a reported 0 has `total === 0`.
3. No `nut`, or `nut` that is `undefined`/null/array/string/number -> all five totals null.
4. grams 0 -> recorded nutrients 0, unrecorded null. grams NaN, Infinity, negative, a numeric string, undefined -> treated as 0 (no NaN or Infinity ever appears in a total).
5. Huge grams (1e6) with fiber 3 -> 30000, finite.
6. Hostile `nut`: values that are strings, `'5'`, NaN, Infinity, negative, null, booleans, objects are all null; unknown extra keys are ignored; `JSON.parse('{"__proto__":{"fiber":5}}')` and an object that only INHERITS `fiber` (via `Object.create`) give null; a hostile `food` (null, undefined, string, array, number) gives five nulls.
7. Pure: a deeply frozen `food` does not throw and is unchanged; two calls give equal results; the result is a new array whose objects are not shared between calls.
8. Consistency with the day page: for an entry with `nut` and `grams`, `itemFacts(entry, entry.grams)[i].total` equals `dayDetails([entry], goals).nutrients[key].total` for each key (within 1e-9).
9. `formatNut` formats: `(3.5,'g')` -> `3.5 g`; `(500,'mg')` -> `500 mg`; `(0,'g')` -> `0 g`; `(0.04,'mg')` -> `<0.1 mg`; `(0.1,'g')` -> `0.1 g`; `(2.46,'g')` -> `2.5 g`; `(1234.56,'mg')` -> `1234.6 mg`; `(7,'g')` -> `7 g`.
10. `formatNut` of null, undefined, NaN, Infinity, a string, a negative number -> `Not recorded` for both units.
11. `formatNut` reproduces what the day page showed before: a table of totals (0, 0.04, 0.05, 0.1, 0.25, 1, 1.5, 12.34, 500, 1234.56) agrees with the formula `n>0&&n<0.1 ? '<0.1' : String(Math.round(n*10)/10)` followed by the unit.
12. Source: `js/ui/amount-picker.js` imports `itemFacts` and `formatNut` from `../domain/details.js`, calls `itemFacts(` inside `upd`, contains `Nutrition facts` and `itemFacts` (the container id), has the five row labels (in it or in details.js), and keeps the original card (`rd(p.k * f)`, `Protein`, `Carbs`, `Fat`, `id="prev2"`).
13. Schema unchanged: `SCHEMA_VERSION` is 8 (this passes before implementation; it guards against an accidental bump).

## Edge cases and hostile input
Empty/absent `nut`, grams 0 / NaN / huge, prototype keys, numeric strings, a `food` that is an entry (edit mode passes an entry, which has `nut` when it was saved from a database food), HTML in food names (unchanged, still `esc`ed; the facts contain only numbers and fixed labels, so nothing external is inserted unescaped). Out-of-range values are not clamped by `itemFacts` (ranges are enforced by `sanitizeNut` when data is loaded).

## What cannot be tested automatically
Visual layout, one-thumb comfort, real products. Headless checks below use stubbed network.

## Headless checklist (browser-tester)
Common: fresh profile, today's diary. "Add a food" = `+ Add` on Lunch. The Amount screen has `#amt`, `#unit`, `#mealSel`, `#prev2`, `#addGo`.

**C1 Scanned product shows facts at the chosen amount**
Setup: Open Food Facts answers one product "Test bar" with nutriments `{ "energy-kcal_100g":400, proteins_100g:10, carbohydrates_100g:50, fat_100g:20, fiber_100g:7, sugars_100g:12, "saturated-fat_100g":3, sodium_100g:0.5, cholesterol_100g:0.02 }`, serving_quantity 50.
Steps: Add a food, search "Test bar", pick it. Choose the grams unit (`#unit` value `w:g`), set `#amt` to 100.
Expect: `#prev2` still shows "400" and "kcal", Protein "10 g", Carbs "50 g", Fat "20 g". Below it a "Nutrition facts" block: Fiber "7 g", Sugars "12 g", Saturated fat "3 g", Sodium "500 mg", Cholesterol "20 mg". No "Not recorded" text.
Covered by headless? yes.

**C2 Facts scale with the amount**
Setup: as C1.
Steps: on the same screen set `#amt` to 50, then to 250.
Expect: at 50 g: Fiber "3.5 g", Sugars "6 g", Saturated fat "1.5 g", Sodium "250 mg", Cholesterol "10 mg". At 250 g: "17.5 g", "30 g", "7.5 g", "1250 mg", "50 mg". kcal at 250 g reads "1000".
Covered by headless? yes.

**C3 Product with no extra nutrients shows one honest line**
Setup: Open Food Facts answers "Plain thing" with nutriments `{ "energy-kcal_100g":200, proteins_100g:5, carbohydrates_100g:30, fat_100g:4 }`.
Steps: search "Plain thing", pick it.
Expect: kcal and Protein/Carbs/Fat as before; a "Nutrition facts" heading (or the one line) and exactly one explanatory line; none of the texts "Fiber", "Sugars", "Saturated fat", "Sodium", "Cholesterol" appear on the screen; the text "Not recorded" does not appear.
Covered by headless? yes.

**C4 Partly recorded: reported 0 versus missing**
Setup: Open Food Facts answers "Half bar" with nutriments `{ "energy-kcal_100g":300, proteins_100g:5, carbohydrates_100g:40, fat_100g:10, fiber_100g:0, sodium_100g:0.4 }`.
Steps: search "Half bar", pick it, grams unit, `#amt` 100.
Expect: Fiber "0 g", Sodium "400 mg"; Sugars, Saturated fat and Cholesterol each show "Not recorded".
Covered by headless? yes.

**C5 Tiny amount**
Setup: as C1.
Steps: set `#amt` to 0.1 (grams).
Expect: Cholesterol "<0.1 mg" (0.02 mg x 0.1 g/100 g... i.e. well under 0.1), Fiber "<0.1 g", Sodium "0.5 mg".
Covered by headless? yes.

**C6 Hand-typed (custom) food**
Setup: a saved custom food "Home soup" with per100 `{k:50,p:2,c:6,f:1}` and no `nut` (stored in localStorage `macrodiary.v1`, schemaVersion 8, in `custom`).
Steps: Add a food, open the Custom/My foods list, pick "Home soup".
Expect: kcal and macros as before; the single honest line; no extra-nutrient row labels.
Covered by headless? yes.

**C7 Editing an existing entry shows its facts**
Setup: today holds one Lunch entry "Saved bar", grams 200, unitKey `w:g`, amount 200, per100 `{k:100,p:1,c:1,f:1}`, nut `{fiber:3,sugars:4,satFat:5,sodium:600,cholesterol:70}`, and a second entry "Old oat" with no `nut`.
Steps: click "Saved bar" (opens "Edit entry"); then close, click "Old oat".
Expect: for "Saved bar": Fiber "6 g", Sugars "8 g", Saturated fat "10 g", Sodium "1200 mg", Cholesterol "140 mg". Changing `#amt` to 100 shows "3 g", "4 g", "5 g", "600 mg", "70 mg". For "Old oat": the single honest line only.
Covered by headless? yes.

**C8 Adding keeps the facts and the day page agrees**
Setup: as C1.
Steps: pick "Test bar", grams, 100, Add to diary; click `#summary`.
Expect: day details Fiber "7 g", Sugars "12 g", Saturated fat "3 g", Sodium "500 mg", Cholesterol "20 mg" (same text as the Amount screen showed).
Covered by headless? yes.

### Owner on a real device
- O1 Scan a real barcode on the phone: the facts block is readable under the macros and the Add button is still reachable without awkward scrolling.
- O2 The sodium figure for a real pack at the serving amount matches the label.

## Open questions
1. Exact wording of the honest line and whether the facts sit inside `#prev2` or just below it is the implementer's; checks only need "Nutrition facts" and the row labels.
2. Whether row text is `Fiber 3.5 g` in one element or label and value in separate elements: checklist only matches visible text.
3. Out-of-range values in `nut` are not clamped by `itemFacts`; if that should change, it is a separate decision.

## Part 2: keep the barcode (owner addition)
A food that came from a barcode lookup (or that the user scanned/typed) keeps its code as `barcode`, a string of 8-14 digits, on the food, on the diary entry and on the recent food made from it. The Amount screen shows a small muted line `Barcode 810030518914`.

### Findings about existing code (checked, not assumed)
- `sanitizeFood` (recipe/plan foods) and custom foods already accept `barcode` (`/^\d{8,14}$/`). `sanitize()` and `sync-records` do NOT touch `barcode` on diary entries, recent foods or synced custom foods, so a hostile value there passes through today. This spec therefore adds a sanitiser rule (B3, B4).
- `mapOFF` / `mapUSDA` drop `code` / `gtinUpc` today. `copyEntries` deep-clones the whole entry, so copy already carries any extra field (B7 guards it).
- **Schema bump: NOT needed (decision).** `barcode` is an optional sibling that old data simply lacks; no migration adds or rewrites anything and v8 data stays valid. `SCHEMA_VERSION` stays 8 (behaviour 13). Counter-argument in open question 4.

### Contract additions
| Piece | Layer / file | Shape |
|---|---|---|
| `sanitizeBarcode(v)` | `js/core/schema.js`, pure | returns `v` when it is a string matching `/^\d{8,14}$/` (no trim), else `undefined` |
| `sanitize(d)` | schema.js | for every plain-object entry in `d.days[*]` and every food in `d.recent` / `d.custom`: an invalid `barcode` is deleted, a valid one kept, absent stays absent |
| sync / backup | `js/domain/sync-records.js`, `backup.js` | entries and custom foods arriving from sync or a backup have `barcode` cleaned the same way (valid carried, hostile dropped, entry still arrives) |
| `mapOFF(p)` | services/off.js | result gains `barcode` ONLY when `normalizeBarcode(p.code)` is non-empty (string, 8/12/13/14 digits, correct check digit; leading zeros kept as given); otherwise no `barcode` property and the rest of the result is unchanged |
| `mapUSDA(f)` | services/usda.js | same rule using `f.gtinUpc` |
| `pickFoodBarcode(scanned, found)` | `js/domain/barcode.js`, pure | returns the string to store: `normalizeBarcode(scanned)` when non-empty (the code the user scanned and the lookup matched wins, even over a zero-padded form such as OFF's `0810030518914`); else `normalizeBarcode(found)`; else `''`. Never throws; non-strings give `''`. |
| `js/ui/add-food.js` | ui | when the search text is a barcode, the food handed to `showFood` gets `barcode` = `pickFoodBarcode(add.q, food.barcode)` (only when non-empty) |
| `js/ui/amount-picker.js` | ui | shows a muted `Barcode <digits>` line (escaped) only when `food.barcode` is set; adding copies `barcode` into the entry and the recent food only when set (key absent otherwise); editing an entry keeps its `barcode` |

### Behaviours (tests B1..B9)
- B1. `mapOFF` with `code:'810030518914'` gives `barcode:'810030518914'`; `'0810030518914'` is kept as given; no `code`, bad check digit, `'123'`, a number, an object -> no `barcode` key; everything else in the result is identical to the same product without `code`.
- B2. `mapUSDA` with `gtinUpc` likewise.
- B3. `sanitizeBarcode` accepts only 8-14 digit strings; hostile values (number, padded string, letters, 15 or 7 digits, null, objects) give `undefined`.
- B4. `sanitize()` keeps a valid entry/recent/custom `barcode`, deletes a hostile one (the entry stays), leaves absent absent.
- B5. Sync: `toRecords` carries entry `barcode`; `applyRecords` cleans hostile ones, keeps valid ones, entries still arrive; same for `custom`.
- B6. Backup: `mergeRestore` cleans and carries entry `barcode`; entries without it are unchanged.
- B7. `copyEntries` carries `barcode` to the copy.
- B8. `pickFoodBarcode`: `('810030518914','0810030518914')` -> `'810030518914'`; `('', '0810030518914')` -> `'0810030518914'`; `('810030518914', undefined)` -> same; `('junk','810030518914')` -> found; `('810030518914','036000291452')` (two different valid codes) -> scanned; both junk/absent/non-string -> `''`.
- B9. Source: amount-picker contains `Barcode `, reads `food.barcode`, copies `barcode` into the info object used for the entry and recent food, escapes it; add-food.js calls `pickFoodBarcode`.

### Headless checklist additions
**C9 Scanned code is kept and shown**
Setup: Open Food Facts answers `/api/v2/product/810030518914.json` with status 1 and product "Test bar" (nutriments as C1) and `code` "0810030518914".
Steps: Add a food, type `810030518914` in the search box, press Search, pick "Test bar".
Expect: Amount screen shows the muted text "Barcode 810030518914" (not the zero-padded form). Click "Add to diary"; click the new entry: the Edit entry screen shows "Barcode 810030518914". In localStorage `macrodiary.v1` the entry and the first `recent` item have `barcode` "810030518914".
Covered by headless? yes.

**C10 Text-search result with a code, no scan**
Setup: Open Food Facts search for "Test bar" answers one product with `code` "810030518914".
Steps: search "Test bar" (words), pick it.
Expect: "Barcode 810030518914" is shown.
Covered by headless? yes.

**C11 No code means no line**
Setup: OFF answers "Plain thing" (as C3) with no `code`; also a saved custom food without a barcode.
Steps: pick each.
Expect: the text "Barcode" does not appear on the Amount screen; the saved entry has no `barcode` key.
Covered by headless? yes.

**C12 Hostile code**
Setup: today holds an entry "Odd" with `barcode` `"<img src=x onerror=alert(1)>"` written into localStorage (schemaVersion 8).
Steps: reload, click "Odd".
Expect: no "Barcode" line, no `img` element inside the dialog, no alert; the entry opens normally.
Covered by headless? yes.

### Owner on a real device (additions)
- O3 Scan a real product with the camera: the Amount screen shows the same digits as the printed code.

### Open questions (part 2)
4. Schema bump: CLAUDE.md says saved-shape changes bump `SCHEMA_VERSION`. This spec treats an optional, sanitised, absent-by-default field as not a shape change. If the owner prefers v9, behaviour 13 and the v8 assertions in tests/nutrition-details.test.js change together.
5. `mapOFF`/`mapUSDA` use `normalizeBarcode` (check-digit validated), whereas `sanitizeBarcode` only checks 8-14 digits (a hand-typed custom code with any check digit survives). A scanned code wins even when it differs from the found code (a lookup for a scanned code is trusted); a differing result is not flagged.
6. A typed (not scanned) 8-14 digit code that fails the check digit is not stored by `pickFoodBarcode`; whether the UI should keep it is left open.
