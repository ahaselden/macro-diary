# Spec: copy diary entries to another meal / day (BACKLOG item 12)

Purpose. Let the user copy one entry, or a whole meal, to another meal and/or another day without searching for the food again. It is a copy: the original stays.

Tests: `tests/copy-to-meal.test.js` (B-numbers below match the test titles; C-numbers are the manual/headless checklist).

## Contract

Domain, `js/domain/entries.js` (pure; mutates the `state` it is given like `addEntry`; may import `MEALS` from `../core/constants.js`):
- `copyEntries(state, fromDay, ids, toDay, toMeal, now, makeId) -> entry[]`
  - `fromDay`, `toDay`: `'YYYY-MM-DD'` strings. `ids`: array of entry ids. `toMeal`: one of `MEALS` (`Breakfast`, `Lunch`, `Dinner`, `Snacks`). `now`: ms (becomes `updatedAt`). `makeId`: `() => string`, injected for determinism; callers pass the app's normal id generator.
  - Returns the NEW entries, in the order they were created (the diary order of `fromDay`, each source entry at most once). They are the very objects stored in `state.days[toDay]`. Returns `[]` when nothing was copied. Never throws on bad input.

UI, `js/ui/diary.js` (agreed element names; the checklist depends on them):
- Each entry row gets a small button `data-copy="<entry id>"`, `aria-label="Copy"`, visible text `Copy`. Clicking it must NOT open the edit dialog and must not delete.
- Each meal card gets a button `data-copy-meal="<meal>"`, visible text `Copy meal`.
- Both open a dialog (the shared `<dialog id="dlg">`, title `Copy to`) with `<select id="copyMeal">` (options from `MEALS`, preselected: the meal of the entry / the meal being copied), `<input type="date" id="copyDate">` (default: the day being viewed) and `<button id="copyGo">Copy</button>`.
- After `Copy` the dialog closes, the diary re-renders (`diary:changed`) and a toast shows exactly `Copied 1 item to Lunch` / `Copied 3 items to Dinner` (singular `item` for exactly 1). The viewed day does not change.

## Behaviours (domain)
1. B1 Copy to another meal: a new entry with a NEW id (from `makeId`), `meal` = `toMeal`, `updatedAt` = `now`; `name`, `brand`, `barcode`, `source`, `grams`, `amount`, `unit`, `per100` (every other field) equal the original's; no fields added or lost.
2. B2 The original is untouched (all fields, its `updatedAt`, its meal, its position).
3. B3 Same day and same meal duplicates: the list then holds the original and the copy (copy appended).
4. B4 A different day: that day's list is created; if it already has entries they are kept and the copy is appended.
5. B5 Several ids: one new entry each, distinct ids, `makeId` called once per created entry (and not for skipped ones); results in diary order of `fromDay` (not the order of `ids`); a repeated id is copied once.
6. B6 No shared references: mutating `copy.per100` or `copy.name` leaves the original unchanged (deep copy).
7. B7 Tombstones: none are created for new ids; existing tombstones are unchanged; a state without a `tombstones` key does not gain one.
8. B8 Goes through `addEntry`: so a tombstone for the freshly generated id is cleared (existing invariant "re-adding an id undoes its deletion"), others stay.
9. B9 Ids not in `fromDay` (unknown, or only on another day) are skipped; result is only the created entries, `[]` when none; an empty `ids`, or an unknown `fromDay`, gives `[]` and does not create an empty day list.
10. B10 `toMeal` not in `MEALS` (wrong case, empty, undefined, non-string, `__proto__`, `constructor`) copies nothing: `[]`, state deep-equal to before, `makeId` never called.
11. B11 `toDay` not strictly `YYYY-MM-DD` (empty, `2026-1-5`, `2026/11/12`, trailing junk or newline, leading space, `__proto__`, non-strings, HTML) copies nothing, same guarantees as B10.
12. B12 Hostile `fromDay`/`ids`: `__proto__`, `constructor`, `toString`, `hasOwnProperty` as day or id; non-array `ids` (undefined, null, string, number, NaN, object, array-like, Set, boolean); non-string ids; junk entries already stored in the day (null, string, no id, no nutrition, grams 0) are neither copied nor throw. No prototype pollution.
13. B13 Only OWN days are read: an inherited day (days object with a prototype) is not copied from; a null-prototype `days` object works.
14. B14 HTML in `name`/`brand` is kept as plain data (escaping is the UI's job); 2000 entries copy correctly with unique ids; a 200000-element `ids` array of unknown ids returns `[]` in well under 3 s (no quadratic scan).
15. B15 Sync: a state containing a copy, merged with an empty state via `mergeStates` (both argument orders), keeps the original and the copy (copy keeps its new id, meal and `updatedAt`); if the original is deleted later (tombstone), the copy survives the merge.

## Behaviours (UI, weak static checks)
16. B16 `diary.js` imports `copyEntries` from `../domain/entries.js`, calls it with `state` first and `Date.now()` as `now`, contains `data-copy=`, `data-copy-meal=`, `id="copyMeal"`, `id="copyDate"`, `id="copyGo"`, the texts `Copy meal` and `Copied`, and builds the meal options with `MEALS.map`. WEAK: source text only; it proves wording and wiring exist, not that anything works. The checklist covers the rest.
17. B17 `diary.js` does not write into `state.days` itself (all creation goes via the domain function). Passes today (regression guard, proves nothing about the new feature).

## Edge cases and hostile input covered
Prototype keys as day/id/meal; non-array and NaN `ids`; huge arrays; HTML/script in names; junk entries in a stored day; inherited days; tombstone interplay; merge in both directions. A copy into a day that does not exist; copying onto itself (same day, same meal).

## Cannot be tested automatically
Dialog rendering, focus, toast timing, tap targets, the date picker, persistence across reload: covered by the headless checklist below where Chromium can do it, otherwise by the owner list. Not covered: a calendar-valid date check (see open question 3), whether `makeId` really yields unique ids across devices (the app's id generator is tested elsewhere), concurrent sync with a real backend.

## Manual / headless checklist
Common setup for every item (call it S): fresh browser profile; before the app loads, `localStorage['macrodiary.v1']` holds a valid state with `days` = `{ "<TODAY>": [ E1 Breakfast "Test Oats" brand "Acme" 40 g per100 {k:370,p:13,c:60,f:7} id "e1" ; E2 Lunch "Test Rice" 150 g per100 {k:130,p:2.7,c:28,f:0.3} id "e2" ; E3 Lunch "Test Chicken" 100 g per100 {k:165,p:31,c:0,f:3.6} id "e3" ] }`, `tombstones` `{}`, goals any. No network is needed (all external requests blocked). Open the Diary tab (the default). Today shows as `Today`. Kcal of E1 is 148, E2 195, E3 165.

- **C1** Copy one entry to another meal, same day.
  Setup: S. Steps: click `Copy` on the row "Test Oats". In the dialog choose `Dinner` in `#copyMeal`; leave `#copyDate` as it is; click `#copyGo`.
  Expect: dialog closed; toast `Copied 1 item to Dinner`; the Dinner card now lists "Test Oats" with `148` kcal; the Breakfast card still lists "Test Oats"; the day total rises by 148; the edit dialog did not open. Covered by headless? yes.
- **C2** Dialog defaults.
  Setup: S. Steps: click `Copy` on "Test Rice".
  Expect: dialog title `Copy to`; `#copyMeal` value `Lunch` with exactly the options Breakfast, Lunch, Dinner, Snacks; `#copyDate` value is today's date (`YYYY-MM-DD`); a `Copy` button. Covered by headless? yes.
- **C3** Same meal duplicates.
  Setup: S. Steps: `Copy` on "Test Rice", keep Lunch and today, click `#copyGo`.
  Expect: toast `Copied 1 item to Lunch`; Lunch lists "Test Rice" twice, both `195`; Lunch header shows 555 kcal (195+195+165). Covered by headless? yes.
- **C4** Copy to another day.
  Setup: S. Steps: `Copy` on "Test Chicken"; set `#copyDate` to yesterday; choose `Snacks`; click `#copyGo`. Then click the previous-day button (`#prev`, "Previous day").
  Expect: before navigating, today is unchanged (Chicken only under Lunch once); yesterday shows "Test Chicken" under Snacks with `165` kcal, and nothing else. Covered by headless? yes.
- **C5** Copy a whole meal.
  Setup: S. Steps: click `Copy meal` on the Lunch card; choose `Dinner`; keep today; click `#copyGo`.
  Expect: toast `Copied 2 items to Dinner`; Dinner lists "Test Rice" (195) and "Test Chicken" (165); Lunch still lists both; Breakfast untouched. Covered by headless? yes.
- **C6** Copy meal to another day, preselected meal.
  Setup: S. Steps: click `Copy meal` on Lunch; `#copyMeal` should read `Lunch`; set `#copyDate` to tomorrow; click `#copyGo`; then click `#next`.
  Expect: toast `Copied 2 items to Lunch`; tomorrow shows Lunch with both items; the viewed day only changes when `#next` is clicked. Covered by headless? yes.
- **C7** Copy is independent of the original.
  Setup: S, then do C1. Steps: click the Dinner "Test Oats" row (opens edit), change grams to 80, save.
  Expect: Dinner "Test Oats" shows `296` kcal; Breakfast "Test Oats" still shows `148`. Covered by headless? yes.
- **C8** Deleting the copy does not delete the original and vice versa.
  Setup: S, then do C3. Steps: click the delete `✕` of the first "Test Rice" under Lunch.
  Expect: Lunch lists "Test Rice" once (`195`) and "Test Chicken". Covered by headless? yes.
- **C9** Persistence.
  Setup: S, then do C1. Steps: reload the page.
  Expect: Dinner still lists "Test Oats", Breakfast too; reading `localStorage['macrodiary.v1']` shows 4 entries, the 4 ids are distinct, the new entry has `meal` `"Dinner"` and an `updatedAt` close to now, `tombstones` is `{}`. Covered by headless? yes.
- **C10** Hostile text is shown as text.
  Setup: S but E1's name is `<img src=x onerror=window.__x=1>` . Steps: `Copy` E1 to Snacks, click `#copyGo`.
  Expect: the Snacks row shows the literal text `<img src=x onerror=window.__x=1>`; `window.__x` is undefined; no page error. Covered by headless? yes.
- **C11** Controls do not break existing ones.
  Setup: S. Steps: click `+ Add` on Breakfast; close the dialog with `✕`; click the "Test Rice" row body.
  Expect: `+ Add` opens the add dialog; row click opens the edit dialog for Test Rice (not the copy dialog); neither shows `Copied`. Covered by headless? yes.
- **C12** Cancelling copies nothing.
  Setup: S. Steps: `Copy` on "Test Oats", then close with `✕`.
  Expect: no toast; entry counts unchanged (3 rows in total). Covered by headless? yes.
- **C13** Empty date.
  Setup: S. Steps: `Copy` on "Test Oats"; clear `#copyDate`; click `#copyGo`.
  Expect: nothing is copied (still 3 rows), the dialog stays open or a toast explains; no page error. (Exact wording is an open question.) Covered by headless? yes.

### Owner on a real device
- [ ] On the phone, the `Copy` button on each row is easy to hit and does not make the row too crowded at 360 px width; the `✕` is still easy to hit.
- [ ] The date picker opens the phone's native calendar and the chosen date is the one that receives the copy.
- [ ] iPhone Safari: the dialog, `select` and date input work and the toast is readable.
- [ ] With sync on, copy an entry on the phone; it appears on a second device after sync, and the original is still there.
- [ ] Copy a real meal (3 or more items) from yesterday to today and check totals against your own expectations.

## Open questions
1. Should a later `move` option (copy then delete original) exist? Not specified; not tested.
2. Copying a whole meal to a date that already has entries in that meal: should the dialog ask before duplicating? The plan does not say; the spec and tests assume it just appends (B4) with no confirmation.
3. `toDay` validation is format-only in the tests. `2026-02-30` or `2026-13-45` are not tested either way; the implementer may reject them but tests do not require it.
4. Order of results: spec says diary order of `fromDay`, not the order of `ids`. Chosen by the designer because it is deterministic and keeps meals tidy; the plan is silent.
5. Duplicate ids in `ids` are copied once (designer's choice).
6. Do junk stored entries (failing `validEntry`) get copied? Tests require they are not (B12); the plan is silent.
7. Does an empty meal card show `Copy meal`? Plan says "each meal card"; checklist only uses non-empty meals. If shown on an empty meal, the toast/behaviour is unspecified.
8. Exact toast wording (`Copied N item(s) to <Meal>`) and the dialog title `Copy to` are the designer's choice; also what happens on an empty `#copyDate` (C13).
9. If `makeId` returns an id that already exists in the target day: not specified, not tested.
10. Whether the copy dialog reuses `#dlg` or a new `<dialog>`: C-items name only the title, `#copyMeal`, `#copyDate`, `#copyGo`.
