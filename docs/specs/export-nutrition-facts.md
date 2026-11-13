# Spec: extra nutrients in the exports (export-nutrition-facts)

## Purpose
Owner request: "the export data should include the additional nutrition fact details like sodium, saturated fat, etc..." Diary entries may carry an optional per-100 g `nut` object (fiber, sugars, satFat, sodium mg, cholesterol mg); the Export data screen writes calories and macros only. The CSV and JSON exports must also carry those nutrients, scaled by the entry's grams, without inventing zeros for nutrients that were never recorded.

## Decisions made here
- **Columns are ALWAYS present** (owner decision), appended after the existing columns, in both CSV files, whether or not anything was recorded. The layout therefore never varies between exports. Existing columns and their order never move.
- **This changes the layout pinned by `tests/golden/reports.json`.** The golden's existing columns and values stay byte-identical; only the appended columns are added (see "Changes to existing tests/golden"). The JSON golden text is unchanged (entries without nutrients are untouched).
- `xData` and `rollup` are NOT changed (rows keep exactly `date,k,p,c,f,n` / `label,k,p,c,f,days`); nutrient maths happens inside `exportFiles` from `state.days`.
- **"Recorded" means** the entry's `nut` is a plain object whose OWN property `key` is a finite number >= 0 AND the scaled amount (`grams * value / 100`) is finite. Anything else (missing, `null`, string, NaN, Infinity, negative, inherited, `nut` that is an array/string/number) is **not recorded**: empty CSV cell, absent from JSON totals, not counted. A recorded 0 stays `0`.
- **Scaling and rounding:** `grams * per100value / 100`, rounded to **one decimal** with `Math.round(v * 10) / 10` (same as `r1`; same precision as the Nutrition details page), written as a plain number (`5`, `2.4`, not `5.0`). Every nutrient (g and mg), entries and summary alike.
- **Daily totals** (summary CSV) sum only recorded values; the cell is empty when no entry that day recorded that nutrient. Partial coverage is shown by **count columns**: `Items logged` (all entries that day) and one `<Nutrient> items` count per nutrient (entries that recorded it; 0 when none). A single combined count was rejected: it would hide that fiber is recorded but sodium is not.
- **Yearly summary** keeps the file's convention (per-month average per logged day): nutrient cell = month total / `Days logged`, empty when no entry in the month recorded it; the count columns are month SUMS (not averages).
- **JSON:** `days` is still the stored entries as stored (`nut` per 100 g exported exactly as saved). Each entry with at least one recorded nutrient gets ONE extra last property `nutTotal`: scaled, 1-decimal totals for the recorded keys only, in `NUT_KEYS` order. Other entries are not touched. Top-level keys and order stay `exported, from, to, goals, days`. `exportFiles` builds copies and never mutates `state`.
- **No UI change.** On-screen stats table, "Share summary" text (macros only) and the three buttons stay as they are.
- **No saved-shape change**, `SCHEMA_VERSION` stays 8, no migration, `STORAGE_KEY` unchanged.

## Contract
| Piece | Layer / file | Shape |
|---|---|---|
| `exportFiles(state, x, exportedAt)` | `js/domain/reports.js` (domain, pure) | Same signature and file list/names/types/order as today. |
| Entries CSV header | same | `Date,Meal,Food,Brand,Amount (g),Amount (oz),Logged as,Calories,Protein (g),Carbs (g),Fat (g),Source,Fiber (g),Sugars (g),Saturated fat (g),Sodium (mg),Cholesterol (mg)` (17 columns). |
| Summary CSV header | same | `Date` or `Month`, `Days logged`, `Calories` or `Avg calories/day`, `Protein (g)`, `Carbs (g)`, `Fat (g)`, `Calorie goal`, then `Fiber (g),Sugars (g),Saturated fat (g),Sodium (mg),Cholesterol (mg),Items logged,Fiber items,Sugars items,Saturated fat items,Sodium items,Cholesterol items` (18 columns). |
| JSON entry | same | `{ ...entry as stored, nutTotal?: { fiber?, sugars?, satFat?, sodium?, cholesterol? } }` |
| `xData`, `rollup`, `csvCell`, `toCSV` | same | unchanged. |
| `js/ui/export-view.js` | ui | unchanged. |

Tests use only `exportFiles`, `xData`, `rollup`.

## Behaviours (tests in `tests/export-nutrition-facts.test.js`; titles carry the number)
1. Entries CSV header is exactly the 17 columns above and the first 12 cells of every row are the legacy values (calories/macros unchanged).
2. Entry rows hold the scaled value, 1 decimal: 200 g of nut {fiber 2.5, sugars 10, satFat 1.2, sodium 400, cholesterol 30} gives 5, 20, 2.4, 800, 60; 33 g with sugars 3 gives 1 (0.99 rounded).
3. Not recorded is an EMPTY cell, a recorded 0 is `0`: 150 g with nut {fiber 0, sodium 100} gives fiber `0`, sugars/satFat/cholesterol empty, sodium 150; an entry with no `nut` has five empty cells.
4. Columns are present even when nothing in range was recorded: entries CSV still 17 columns with the five cells empty on every row; summary CSV 18 columns with five empty totals, `Items logged` = entries that day and all five counts 0.
5. Summary CSV, daily rows: totals sum recorded values only (hand-built day: fiber 5+0=5, sugars 20, satFat 2.4, sodium 950, cholesterol 60), `Items logged` 3, counts 2, 1, 1, 2, 1. A day in the same file with nothing recorded has five empty totals, `Items logged` 1, counts 0.
6. Summary CSV, yearly: per-month total / days logged (Nov: fiber 2.5, sugars 10, satFat 1.2, sodium 475, cholesterol 30; Dec: only sugars 1, the rest empty); counts are month sums (Nov: Items logged 4, fiber items 2).
7. JSON: an entry with recorded nutrients has `nutTotal` with only recorded keys, scaled and 1-decimal (`{fiber:5,sugars:20,satFat:2.4,sodium:800,cholesterol:60}`; `{fiber:0,sodium:150}`), `nut` still exactly as stored, and `nutTotal` is the last property of the entry.
8. JSON entries with no recorded nutrient are exactly as stored (deep-equal, no `nutTotal`, even for `nut: {}` or hostile `nut`); top-level keys stay `exported, from, to, goals, days` in order; the JSON parses.
9. CSV injection still holds: Food `=HYPERLINK("x")`, Brand `-1+1`, Logged as `@sum` come out as `'=HYPERLINK("x")`, `'-1+1`, `'@sum` after parsing; no nutrient cell starts with an apostrophe or contains text.
10. Hostile `nut` (strings, `'5'`, NaN, Infinity, negative, null, booleans, objects, array / number / string as the whole `nut`, own `__proto__` key, inherited `fiber`, unknown keys) is ignored: cells empty, not counted, no `NaN`/`Infinity`/`undefined`/`[object` anywhere in any output, nothing throws.
11. Huge grams: 1e9 g with fiber 3 gives `30000000`; a scaled value that overflows to Infinity (fiber 1e308, 1e6 g) is treated as not recorded.
12. Purity: a deeply frozen `state` does not throw; `state` equals its pre-call clone; two calls give identical files; the state's entries gain no `nutTotal`.
13. Empty range (no days) still returns no files.
14. Guards that pass before implementation: `xData` rows keys `date,k,p,c,f,n`; year `rollup` rows keys `label,k,p,c,f,days`; `SCHEMA_VERSION` is 8; `js/ui/export-view.js` still imports `exportFiles` and has no nutrient words.

## Edge cases and hostile input
Empty range; entries without `nut`; mixed days; huge grams; `__proto__` and inherited keys; legacy entries; `nut` as non-object; numeric strings; HTML in names (CSV is text; the on-screen table is unchanged and `esc`aped). Ranges are enforced by `sanitizeNut` on load; the export does not re-clamp, it only refuses non-finite results.

## Changes to existing tests/golden
- `tests/golden/reports.json`: ONLY the `text` of the CSV files in `cases[].files[]` changed (JSON files, `x`, `rollup`, `rangeOf` untouched, file formatting kept: CRLF, 1-space indent, no trailing newline). Entries CSV: header gets `,Fiber (g),Sugars (g),Saturated fat (g),Sodium (mg),Cholesterol (mg)` and every data row gets `,,,,,` appended. Summary CSV: header gets `,Fiber (g),Sugars (g),Saturated fat (g),Sodium (mg),Cholesterol (mg),Items logged,Fiber items,Sugars items,Saturated fat items,Sodium items,Cholesterol items`; each row gets `,,,,,` then `,<n>,0,0,0,0,0` where `<n>` is the number of entries that day (the golden's own `x.rows[].n`), summed per month for yearly rows. Derived mechanically from the golden's own data (the fixture has no `nut`), not from running new code. Diff: 56 lines (28 changed `text` entries).
- `tests/reports.test.js` and `tests/fixtures/state.json`: NOT edited (the test reads the golden; it now fails until the implementation lands).
- `tests/csv.test.js` / `tests/golden/csv.json`: unaffected.

## What cannot be tested automatically
Opening the CSV in Excel/Numbers/Sheets, real Open Food Facts data, the real file download on a phone.

## Headless checklist (browser-tester)
Common: the runner may intercept the page's `download()` as `tools/browser-test/scenarios/sync-usda-key.mjs` does (swallow the anchor click, read the Blob text). Open the export screen: More tab, `#moreExport`. Controls `#xKind` (Daily/Weekly/Monthly/Yearly), `#xDate`, buttons `#xEntries`, `#xSummary`, `#xJson`. Parse CSV after stripping the leading BOM (U+FEFF). Open Food Facts sodium and cholesterol grams are converted to mg (x1000) as in `item-nutrition-facts.md`.

**C1 A logged product exports its nutrients (entries CSV)**
Setup: fresh profile; Open Food Facts answers a search for "Test bar" with one product "Test bar" (brand Acme, serving_quantity 50) and nutriments `{ "energy-kcal_100g":400, proteins_100g:10, carbohydrates_100g:50, fat_100g:20, fiber_100g:7, sugars_100g:12, "saturated-fat_100g":3, sodium_100g:0.5, cholesterol_100g:0.02 }`. USDA off.
Steps: Today, `+ Add` on Lunch, search "Test bar", pick it, unit grams (`#unit` value `w:g`), `#amt` 200, `#addGo`. More, Export data, Period Daily, `#xDate` today, click `#xEntries`.
Expect: file name starts `macro-diary-entries-day-`. Header ends `Fiber (g),Sugars (g),Saturated fat (g),Sodium (mg),Cholesterol (mg)` with 17 columns. The Test bar row has Calories 800 and last five cells `14`, `24`, `6`, `1000`, `40`.
Covered by headless? yes.

**C2 A product with no extra nutrients leaves blanks, not zeros**
Setup: as C1 plus Open Food Facts answers "Plain thing" with nutriments `{ "energy-kcal_100g":200, proteins_100g:5, carbohydrates_100g:30, fat_100g:4 }`.
Steps: log Test bar 200 g, then Plain thing 100 g (grams unit, `#amt` 100) on Lunch; export Daily entries.
Expect: the Plain thing row has five empty trailing cells (row ends `,,,,,`; no `0` there). The Test bar row is as in C1.
Covered by headless? yes.

**C3 Daily totals and honest coverage (summary CSV)**
Setup: state of C2.
Steps: click `#xSummary` (Daily).
Expect: header ends `Fiber (g),Sugars (g),Saturated fat (g),Sodium (mg),Cholesterol (mg),Items logged,Fiber items,Sugars items,Saturated fat items,Sodium items,Cholesterol items`. The data row ends `14,24,6,1000,40,2,1,1,1,1,1`.
Covered by headless? yes.

**C4 JSON carries per-100 g and scaled totals**
Setup: state of C2.
Steps: click `#xJson`.
Expect: `days[today]` has two entries. Test bar: `nut` = `{fiber:7,sugars:12,satFat:3,sodium:500,cholesterol:20}`, `nutTotal` = `{fiber:14,sugars:24,satFat:6,sodium:1000,cholesterol:40}`. Plain thing: no `nutTotal`, no `nut`.
Covered by headless? yes.

**C5 A day without nutrients still has the columns, empty**
Setup: seed localStorage `macrodiary.v1` (schemaVersion 8) with one entry dated today, no `nut` (name "Plain toast", 50 g, per100 k 250 p 8 c 45 f 3).
Steps: export Daily entries, then Daily summary.
Expect: entries header has 17 columns and the row ends `,,,,,`. Summary header has 18 columns; the row ends `,,,,,,1,0,0,0,0,0`.
Covered by headless? yes.

**C6 On-screen export page and share text unchanged**
Setup: state of C2.
Steps: open the export screen, Daily, today.
Expect: table header cells `Day`, `kcal`, `P`, `C`, `F` (plus an empty bar cell); `Days logged` 1; no "Fiber", "Sodium" or "Cholesterol" in `#xStats` or `#xTable`. No page errors.
Covered by headless? yes.

### Owner on a real device
- O1: export a week of real food (some scanned, some typed) and open the entries and summary CSV in your spreadsheet: blanks look blank, zeros look like zeros, columns line up.
- O2: compare one day's sodium total in the summary CSV with the Nutrition details page for that day.

## Open questions
1. Yearly nutrient cells divide by `Days logged` (including days with no nutrient data), like the calorie convention; this can understate the true average when coverage is partial. The count columns show that.
2. Share summary text and on-screen table stay macros-only (not requested).
