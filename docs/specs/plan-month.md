# Spec: plan month view and month auto-fill

## Purpose
Let the user see a whole calendar month of the meal plan (a grid with kcal and item counts per day), jump from a day to its week, and auto-fill either the current week or the whole month. All new logic is pure and lives in `domain/plan.js`; `autoplan.js` is unchanged because it already accepts any list of dates.

Provenance: written red-first by the test designer from the task plan, `domain/plan.js`, `core/dates.js` and the auto-fill spec. No implementation was read. Calendar golden values are hand derived: 2025-01-01 Wed, 2026-01-01 Thu, 2027-01-01 Fri, 2028-01-01 Sat, hence 2025-11-01 Sat, 2025-12-01 Mon, 2026-08-01 Sat, 2025-03-01 Sat, 2027-02-01 Mon, 2028-02-01 Tue.

## Contract
All in `js/domain/plan.js` (layer: domain; imports stay `core/{constants,dates}` + domain; no DOM/storage/globals). No schema change, no new saved field, no sync change. `sw.js` CACHE bump is the implementer's job (no new shipped file expected).

| Export | Shape |
|---|---|
| `monthDates(anyDate)` | `string[]`: every `'YYYY-MM-DD'` of that month, ascending (28..31). Invalid input -> `[]`. |
| `monthStart(anyDate)` | `'YYYY-MM-01'`; invalid -> `''`. |
| `addMonths(anyDate, n)` | the 1st of the month `n` months later (n may be negative or 0); invalid date, or `n` not an integer (NaN, Infinity, 1.5, string, null, undefined) -> `''`. |
| `monthGrid(anyDate)` | `Array<Array<{date, inMonth:boolean}>>`: 4..6 rows of 7, Monday first (same as `weekStart`), first row starts on the Monday on/before the 1st, last row ends on the Sunday on/after the last day; padding cells have `inMonth:false`. Invalid -> `[]`. |
| `monthSummary(state, anyDate)` | `{ [date]: { k, items, complete } }` with exactly one key per date of the month (no padding days), in ascending key order. Invalid date -> `{}`. |
| `autofillDates(range, viewDate, today)` | `{ dates: string[], skippedPast: number }`. |

## Decisions made in this spec (the plan left them open)
- D-valid: a date is valid only if it is a string that round-trips through `fmt(parse(s))` (so `'2025-02-30'`, `'2025-1-1'`, `'2025-11-17 '`, numbers, Date objects, null are invalid). Same rule as autoplan.
- D-k: `k` is `dayNutrition(...).total.k`, NOT rounded (the UI rounds for display with `rd`).
- D-empty: a day with 0 items (or no record) is `{ k: 0, items: 0, complete: true }`. The UI treats `items === 0` as empty and ignores `complete`.
- D-hostile: `state` null/undefined/not an object, or `plan`/`recipes` missing/null, behave as an empty plan; malformed day records (`{}`, `null`, `slots: null`, non-array slot) count as empty days. Never throws, never mutates (deep-frozen state works), never creates plan records. Prototype keys (`__proto__` in plan, recipe id `constructor`) neither pollute nor resolve to recipes (a recipe item with an unknown/inherited id is incomplete).
- D-range: `autofillDates` range `'week'` = the Monday-Sunday week containing `viewDate`; `'month'` = the calendar month containing `viewDate`; anything else (including `'MONTH'`, `''`, null, `'__proto__'`) = week. Dates `< today` are dropped and counted in `skippedPast`; today is kept. `viewDate` or `today` invalid -> `{ dates: [], skippedPast: 0 }`.

## Behaviours
Domain tests: `tests/plan-month.test.js` (ids match titles). UI: `tests/plan-month-ui.test.js`.

- M1 `monthDates` returns all days ascending; lengths 30/31/28; same list for any day in the month.
- M2 Leap years: Feb 2028 = 29, 2100 = 28, 2000 = 29.
- M3 December/January and the year boundary.
- M4 DST months (2025-03, 2025-11, 2025-10) have one entry per calendar day.
- M5 `monthDates` invalid input -> `[]`, no throw.
- M6 `monthStart`.
- M7 `addMonths` across years, negative, 0, no day-of-month overflow (Jan 31 + 1 = Feb 1).
- M8 `addMonths` invalid date or non-integer `n` -> `''`.
- M9 `monthGrid` Nov 2025: 5 rows, starts Mon 2025-10-27, padding flagged, ends Sun 2025-11-30.
- M10 Feb 2027: 4 rows, no padding.
- M11 6-row months (Aug 2026, Mar 2025) incl. DST days contiguous.
- M12 Leap Feb 2028: 5 rows, Mon 2028-01-31 .. Sun 2028-03-05.
- M13 Dec 2025 grid ends Sun 2026-01-04; every row starts on `weekStart` of its dates.
- M14 Invariants for every month 2025..2028 (4..6 rows, contiguous, in-month cells = `monthDates`, padding < 7 days at each end).
- M15 `monthGrid` invalid -> `[]`.
- M16 `monthSummary` keys = the month's dates; shape `{k, items, complete}`.
- M17 Empty days `{0,0,true}`; planned days hand-computed (2 x 600 + 1.5 x 250 = 1575); other months not included.
- M18 `k` unrounded (5.05); zero-gram food and deleted recipe -> `complete:false`, items counted.
- M19 Pure: frozen state, unchanged, no records created.
- M20 Hostile state/day records never throw; invalid date -> `{}`.
- M21 Prototype keys safe.
- M22 `autofillDates('week', ...)` returns the Mon-Sun week.
- M23 Past days dropped and counted; today included; all past -> `{dates:[], skippedPast:30}`; today = Sunday -> one day, 6 skipped.
- M24 Month range (leap Feb, 28-day Feb); weeks across Dec 31/Jan 1 and over DST end.
- M25 Unknown range = week.
- M26 Invalid dates -> `{ dates: [], skippedPast: 0 }`.
- M27 `proposePlan` over 31 dates fills every Lunch once.
- M28 Over Feb 2027 (28) and Feb 2028 (29): exactly the month.
- M29 Repeat window (3 days) holds over the whole month incl. every Sunday->Monday boundary; no repeat note with 4 recipes.
- M30 Planned slots respected, only empty slots filled (60 of 62), `applyProposal` adds 60, never overwrites, second apply adds 0.
- M31 Deterministic per seed; `monthSummary` reflects the applied plan.
- PU1 `plan-view.js` imports `monthGrid, monthSummary, addMonths, autofillDates` from `../domain/plan.js`.
- PU2 Week and Month toggle `<button>`s with `aria-pressed`; no `role="button"`.
- PU3 Previous/next month `<button>`s with aria-labels containing "previous month"/"next month" (case-insensitive).
- PU4 Month view uses `monthGrid` + `monthSummary`; day cells are `<button aria-label=...>` mentioning kcal and item(s).
- PU5 `esc(` used near the grid code; aria-label does not start with a raw interpolation.
- PU6 A view variable (`view|mode|range...`) is set to `'week'` and `weekStart(` is used (tap on a day switches to its week).
- PU7 Auto-fill dialog calls `autofillDates(`, mentions "skipped", offers radios or `aria-pressed` buttons for the range.
- PU8 Accept uses `applyProposal` + `save()`; `proposePlan(...)` receives `dates`.
- PU9 `newId` yields 5000 unique ids with Date.now and Math.random frozen (extracted `const newId = ...` plus top-level `let x = 0` counters are evaluated in a sandboxed `Function`).

## Edge cases and hostile input covered
Leap Feb 2028/2100/2000, Feb 2027, 6-row months, year boundary, `'2025-02-30'`, `''`, null, numbers, Date objects, `'__proto__'`, week containing Dec 31/Jan 1, DST days (2025-03-09, 2025-11-02 US; 2025-03-30, 2025-10-26 EU), null/odd state, malformed day records, deep-frozen state, prototype keys, non-integer/NaN `n`, hostile range values.

## Cannot be tested automatically (manual checklist)
- [ ] Week | Month toggle switches views; the pressed state is announced by a screen reader; keyboard Tab/Enter/Space work on toggle, day cells and prev/next.
- [ ] Month grid looks right on a phone width (7 columns, no horizontal scroll, 6-row months fit), padding days are visibly dimmed and today is marked.
- [ ] Day cell shows kcal (rounded) and item count; empty days look empty; incomplete days are flagged.
- [ ] Tapping a day (also a padding day) switches to the week view containing it.
- [ ] Prev/next month cross year boundaries (Dec <-> Jan) and Feb 2028 shows 29 days.
- [ ] Auto-fill dialog: range defaults to the current view; switching Week/Month regenerates; "N past days skipped" shows when applicable; with everything past, the dialog says nothing to fill.
- [ ] Month auto-fill accepted: planned meals are not overwritten, reload keeps the plan, Accept twice adds nothing.
- [ ] A recipe named `<img src=x onerror=alert(1)>` renders as text in the dialog and in the grid aria-labels.
- [ ] Phone picks up the new `CACHE` (reload twice), works offline, month plan syncs to a second device.

## How weak the UI tests are
PU1-PU8 are regexes over source text: they show markup, imports and calls exist, not that the grid renders, that a tap changes the view, or that the dialog's range choice works. PU5/PU6/PU7 look at a text window near a call and are fragile to refactoring (loosen the regex and say so in the PR). PU9 is better than a pattern check because it executes the extracted `newId` definition, but it is still not the real module (it assumes `newId` is a `const` arrow/expression defined at top level and any counter is a top-level `let x = 0`; a `function newId` declaration needs the test updated). The domain tests M1-M31 are real behavioural tests.

## Open questions
1. `autofillDates` with `today` invalid returns empty (decided here); the UI always passes a valid today so this is only defensive.
2. Should a recipe item whose recipe is missing count `complete:false` in `monthSummary`? Taken from `itemNutrition` (yes); tested in M18/M21.
3. The existing auto-fill test U2 requires a `<button>` with text "Auto-fill week". If the implementer renames it (e.g. "Auto-fill") U2 must be changed and the change explained in the PR; this spec does not mandate the label.
4. Padding days in the month grid: whether tapping them is allowed is a UI choice (checklist assumes yes); `monthSummary` deliberately has no padding entries, so the UI shows only a plain number for them.
5. The 3-day repeat window across a month relies on autoplan's rule D-repeat with 4 near-equal recipes; M29 would also fail if autoplan changed its default `noRepeatDays`.
