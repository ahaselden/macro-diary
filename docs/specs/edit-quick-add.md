# Edit quick adds: required name, rename a diary entry, edit a saved custom food

Backlog item 13. A custom food saved with an empty Name box is silently called "Quick add" and can never be renamed. This feature makes the name required, lets the user rename any diary entry, and lets them edit a saved custom food ("My food") in place.

## Contract

Domain (pure, `js/domain/food.js`):

- `cleanFoodName(raw, max = 100) -> string`. Non-string -> `''`. Otherwise trim, collapse every run of whitespace (spaces, tabs, newlines) to one space, cut to `max` characters, trim again (so a cut never leaves a trailing space). HTML is NOT stripped or escaped (it stays plain data; the UI escapes).
- `updateCustomFood(state, key, patch, now) -> food | null`. MUTATES `state` (like `js/domain/entries.js`). `key` is `foodKey(existingFood)` (`name|brand|source`). `patch` is a plain object, every field optional:
  `{ name, brand, servingG, k, p, c, f, barcode }` where `k,p,c,f` are values PER SERVING (as typed in the form) and are stored per 100 g: `per100.x = x * 100 / servingG` (servingG = patch.servingG, else the food's existing servingG, else 100). If none of `k,p,c,f` is given `per100` is untouched. `barcode: ''` removes the barcode; a non-empty barcode must satisfy `isBarcode`.
  On success: the food is changed IN PLACE (same position in `state.custom`, no duplicate), `updatedAt = now`, name/brand pass through `cleanFoodName`, the changed food is returned. If name or brand changed, `state.measures[oldKey]` moves to `state.measures[newKey]` (old key deleted, labels and grams kept).
  Returns `null` and leaves `state` completely unchanged when: `key` matches no saved custom food; the cleaned name is empty; the new identity would replace a DIFFERENT saved food (`replacesCustom(otherFood, edited)` is true); a number is NaN/not finite/negative, `servingG` is not > 0, or the barcode is invalid; `state`, `patch` or `now` is not usable. Never throws; never touches `Object.prototype`.
- Entries are renamed with the existing `updateEntry(state, day, id, { name }, now)` in `js/domain/entries.js` (no new function), with the name first passed through `cleanFoodName`.

UI (not unit-testable, see checklist). Names decided here so the checklist is precise:

- `js/ui/custom-food.js`: empty/whitespace Name -> toast `Enter a name`, nothing saved, the form stays. No literal `Quick add` anywhere in this file. The Name input keeps id `cName`. Edit mode: dialog title (`#dTitle`) `Edit food`, fields prefilled (`#cName`, `#cBar`, `#cSize`, `#cK`, `#cP`, `#cC`, `#cF`, per-serving values), the save-to-My-foods checkbox is not shown, the main button `#cGo` reads `Save changes`, and a one-sentence note reads exactly `Past diary entries keep the name and numbers they were logged with.` Saving calls `updateCustomFood`, toasts `Food updated`, and returns to the Search tab with the saved foods listed. A refused collision toasts `You already have a food with that name`.
- `js/ui/add-food.js`: each result tagged `My food` shows a button with visible text `Edit` and attribute `data-edit-food` (the result's index); clicking it opens the form above and does NOT open the Amount screen. Results tagged `Recent` or from a database have no Edit button.
- `js/ui/amount-picker.js` (Edit entry only): a `Name` field `#eName` prefilled with the entry name, above Amount. `Save changes` (`#addGo`) stores `cleanFoodName(#eName)` via `updateEntry`; an empty name toasts `Enter a name`, the dialog stays open and nothing changes. The `h2` of the dialog keeps showing the name the dialog was opened with until it is reopened. Only that entry changes: other entries, Recent and saved foods are untouched.

## Behaviours (each has a numbered test in `tests/edit-quick-add.test.js`)

1. `cleanFoodName` trims and collapses all whitespace runs: `"  Cheez-it \t Duo\n"` -> `"Cheez-it Duo"`.
2. `cleanFoodName` returns `''` for `''`, whitespace only, and every non-string (null, undefined, number, object, array).
3. `cleanFoodName` caps at 100 characters by default (custom max honoured) and never leaves a trailing space after the cut.
4. `cleanFoodName` keeps HTML, quotes and `__proto__` as plain text and never throws on hostile input (very long input, lone surrogates, objects whose `toString` throws).
5. `updateCustomFood` renames a food: new name, `updatedAt = now`, same position, list length unchanged, other foods unchanged, the edited food is returned and is the object in `state.custom`.
6. `updateCustomFood` stores edited per-serving numbers per 100 g (hand values: serving 30 g, 150 kcal, 3 P, 18 C, 7.5 F -> per100 500, 10, 60, 25) and changes `servingG`; a name-only patch leaves `per100` and `servingG` untouched.
7. A rename (or brand change) moves saved measures from the old `foodKey` to the new one with labels/grams intact and removes the old key; an edit that does not change the key leaves `state.measures` alone.
8. Refused (null, state deep-equal to before): empty or whitespace name, name of a non-string type.
9. Refused: the new identity would replace a DIFFERENT saved food (same name/brand/source with no barcodes, or the same barcode). Allowed: same name as another food when both have different barcodes; keeping its own name (editing only numbers) is never a collision.
10. Refused: key not found (including `__proto__`, `constructor`, empty string).
11. Barcode: valid code is stored; `''` removes it; invalid code (7 digits, letters) is refused with state unchanged.
12. Hostile numbers: NaN, Infinity, negative, `servingG` 0, strings that are not numbers are refused with state unchanged; 1e308 never throws and never leaves a non-finite value in `per100`; a patch parsed from JSON containing `__proto__`/`constructor` keys does not pollute `Object.prototype` and does not add those fields to the food; unusable `state`/`patch`/`now` return null without throwing.
13. HTML in the new name/brand is stored literally (not stripped, not escaped).
14. Editing a food never changes past diary entries or `state.recent`: they keep name, brand, per100 and `updatedAt`.
15. Renaming an entry: `updateEntry(state, day, id, { name: cleanFoodName(x) }, now)` changes only that entry's name and `updatedAt`; its grams, meal, per100, other entries and `state.custom` are untouched; an empty cleaned name must not be sent (cleanFoodName gives `''`, which the UI refuses).
16. Sync: `toRecords` stamps the `custom` record with the edited food's `updatedAt`; `mergeStates` keeps the edited version of a food over the older copy (either argument order); a renamed entry beats its older copy in `mergeStates` (either order) and an older rename loses to a newer one.
17. WEAK source checks: `custom-food.js` no longer contains the literal `Quick add`, imports/uses `cleanFoodName` and `updateCustomFood`; `amount-picker.js` uses `cleanFoodName` and has `eName`; `add-food.js` has `data-edit-food`. These only prove wording and wiring exist, not that anything works.

## Edge cases and hostile input

Empty / whitespace / non-string names; 10 000 character names; names that are only HTML (`<img src=x onerror=...>`); prototype keys as food key or in patch; NaN, Infinity, negative, 1e308, numeric strings; two foods with the same name but different barcodes; foods with no `updatedAt` (old data); `state.measures` missing; `state.custom` missing; imported or synced foods with odd shapes (never throw). A food already at 100 saved foods: editing never adds, so the cap is not an issue.

## Cannot be tested automatically

Everything in the UI (dialogs, toasts, prefill, button visibility, escaping on screen). Covered by the checklist below, run by the headless browser tester where marked `yes`.

Seed state **S** used by the checklist (schema v6, `localStorage['macrodiary.v1']`): `weightUnit 'g'`, `useOFF false`, `useUSDA false`, `tombstones {}`.
- `custom`: (a) `{name:'Cheez-it Duo', brand:'', source:'Custom', servingG:30, per100:{k:500,p:10,c:60,f:25}, updatedAt:1000}`, (b) `{name:'Homemade chili', brand:'', source:'Custom', servingG:250, per100:{k:100,p:8,c:10,f:3}, updatedAt:900}`.
- `measures`: `{'Cheez-it Duo||Custom': [{label:'box', g:200, updatedAt:1000}]}`.
- `recent`: `[{name:'Test Oats', brand:'Acme', source:'OFF', per100:{k:370,p:13,c:60,f:7}, servingG:0, servingLabel:''}]`.
- `days[today]`: `e1` Breakfast 'Cheez-it Duo' (source Custom, per100 as (a), grams 30, unitKey 'w:g', amount 30, disp '', updatedAt 1000) and `e2` Breakfast 'Quick add' (source Custom, per100 `{k:200,p:5,c:20,f:10}`, grams 100, unitKey 'w:g', amount 100, disp '', updatedAt 1000).
Expected kcal: e1 150, e2 200.

### Checklist (headless-runnable)

**C1** Empty name refused. Setup: S. Steps: click `[data-add="Lunch"]`, click the `Custom` tab button, leave `#cName` empty, fill `#cK` 100, click `#cGo`. Expect: toast text `Enter a name`; the dialog is still open on the form; `localStorage` custom list still has 2 foods; no Amount screen. Covered by headless? yes.

**C2** Whitespace-only name refused. Setup: S. Steps: as C1 but fill `#cName` with three spaces. Expect: toast `Enter a name`, custom still 2 foods. Covered by headless? yes.

**C3** Named food saves and logs with its name. Setup: S. Steps: `[data-add="Lunch"]`, `Custom` tab, `#cName` = `  Peanut   bar  `, `#cSize` 40, `#cK` 200, click `#cGo`, then `#addGo`. Expect: Amount screen `h2` is `Peanut bar` (trimmed, collapsed); after `#addGo` a Lunch row named `Peanut bar` with `200` kcal; stored custom list has 3 foods and the first is named `Peanut bar`. Covered by headless? yes.

**C4** No 'Quick add' text in the form. Setup: S. Steps: open `[data-add="Lunch"]`, `Custom` tab. Expect: the dialog body text does not contain `Quick add`; `#cName` placeholder is a grey example (any text) and the value is empty. Covered by headless? yes.

**C5** Rename a diary entry. Setup: S. Steps: click the name of the Breakfast row `Quick add` (`.nm`), in the `Edit entry` dialog read `#eName` (value `Quick add`), fill `#eName` = `Cheez-it Duo bites`, click `#addGo`. Expect: toast `Updated`; Breakfast now lists `Cheez-it Duo bites` (200 kcal) and no row `Quick add`; the row `Cheez-it Duo` (150 kcal) is unchanged; in `localStorage` e2 has `name 'Cheez-it Duo bites'`, `grams 100`, `per100.k 200`, `updatedAt` within 60 s of now; e1 `updatedAt` still 1000; custom foods unchanged (names `Cheez-it Duo`, `Homemade chili`). Covered by headless? yes.

**C6** Entry rename with empty name refused. Setup: S. Steps: open the `Quick add` row, fill `#eName` with empty text, click `#addGo`. Expect: toast `Enter a name`; the dialog stays open; closing it (`#dClose`) shows the row still named `Quick add`; stored e2 name `Quick add`, `updatedAt` 1000. Covered by headless? yes.

**C7** Entry rename keeps amount edits working together. Setup: S. Steps: open the `Cheez-it Duo` row, set `#eName` = `Duo snack`, `#amt` = 60, click `#addGo`. Expect: row `Duo snack` shows `300` kcal. Covered by headless? yes.

**C8** Edit button only on My food results. Setup: S. Steps: `[data-add="Breakfast"]`, in `#q` type `Cheez`; then clear and type `Oats`. Expect: for `Cheez` one result with badge `My food` and a button `Edit`; for `Oats` one result with badge `Recent` and no `Edit` button. Covered by headless? yes.

**C9** Edit opens the prefilled form, not the Amount screen. Setup: S. Steps: `[data-add="Breakfast"]`, type `Cheez` in `#q`, click `[data-edit-food]`. Expect: `#dTitle` is `Edit food`; `#cName` value `Cheez-it Duo`; `#cSize` 30; `#cK` 150; `#cP` 3; `#cC` 18; `#cF` 7.5; `#cGo` text `Save changes`; no `#cSave` checkbox visible; the text `Past diary entries keep the name and numbers they were logged with.` is shown; no `#addGo` button. Covered by headless? yes.

**C10** Save an edit in place and rename. Setup: S. Steps: as C9, then fill `#cName` = `Cheez-it Duo 2pk`, `#cK` = 300, click `#cGo`. Expect: toast `Food updated`; back on the Search tab; typing `Cheez` shows exactly one `My food` result named `Cheez-it Duo 2pk` (not two); stored custom list has 2 foods, the edited food is still first, `updatedAt` within 60 s of now, `per100.k` 1000 (300 per 30 g); `Homemade chili` untouched; `source` still `Custom`. Covered by headless? yes.

**C11** History stays honest. Setup: S, then do C10. Steps: close the dialog (`#dClose`). Expect: the Breakfast row is still named `Cheez-it Duo` and still `150` kcal; stored e1 unchanged (name, per100.k 500, `updatedAt` 1000). Covered by headless? yes.

**C12** Saved measures follow the rename. Setup: S, then do C10. Steps: reload the page, open the stored state. Expect: `measures` has key `Cheez-it Duo 2pk||Custom` with `[{label:'box', g:200}]` and no key `Cheez-it Duo||Custom`. In the add dialog, pick `Cheez-it Duo 2pk`: the `#unit` dropdown offers `box`. Covered by headless? yes.

**C13** Collision refused. Setup: S. Steps: edit `Homemade chili` (type `chili` in `#q`, click `[data-edit-food]`), set `#cName` = `Cheez-it Duo`, click `#cGo`. Expect: toast `You already have a food with that name`; form stays open; stored custom still has `Homemade chili` and `Cheez-it Duo` unchanged. Covered by headless? yes.

**C14** Empty name refused when editing a food. Setup: S. Steps: as C9, clear `#cName`, click `#cGo`. Expect: toast `Enter a name`; stored food unchanged. Covered by headless? yes.

**C15** Hostile name is shown as text. Setup: S. Steps: edit entry e2, `#eName` = `<img src=x onerror=window.__x=1>`, `#addGo`; then edit food (a) with the same text as name and `#cGo`; type `img` in `#q`. Expect: the diary row and the search result show the literal text; `window.__x` is `undefined`; the page has no `img` element inside `#meals` or `#results`. Covered by headless? yes.

**C16** Reload persistence. Setup: S, do C10 and C5. Steps: reload. Expect: both new names are still shown. Covered by headless? yes.

**C17** No page errors during C1 to C16. Covered by headless? yes.

### Owner on a real device

- **R1** On the phone, open Edit food and Edit entry with the on-screen keyboard: the Name field and the Save button stay reachable and nothing is hidden behind the keyboard. Covered by headless? no: real phone keyboard.
- **R2** Tap `Edit` on a My food result with a thumb: the button is easy to hit and does not open the Amount screen by accident. Covered by headless? no: real touch.
- **R3** Open the real saved data: find the entry/food the owner remembers as "Cheez-it Duo" and rename it; confirm it survives closing and reopening the installed app. Covered by headless? no: real data.
- **R4** With sync on across two real devices, edit a food on one and confirm the other shows it after syncing. Covered by headless? no: real network and devices.

## Open questions (not decided here; tests avoid them)

1. Editing the numbers (grams, per100) of a PAST entry: not offered; should it be?
2. Offer "also update past entries with this food"? The spec says history is NOT changed.
3. Foods that came from a database (OFF/USDA/Recent): only the entry name is editable, no food editor. Should Recent foods be editable too?
4. The 100 custom foods cap: unchanged; should reaching it warn?
5. Sync: `mergeStates` matches custom foods by `foodKey`. A rename gives the food a new key, so a device that still has the old name will merge BOTH (the old name comes back as a duplicate). There is no tombstone for custom foods. Same for `state.measures` keys. Accept, or add a tombstone/`replaces` field? Not tested.
6. Should moved measures get a new `updatedAt` so the move wins a sync? Not tested (only that labels and grams survive).
7. When the renamed key already has saved measures: merge by label or the new key's list wins? Not tested.
8. Maximum accepted numeric size for calories/grams (1e308 is only tested for not throwing and finite output).
9. Exact toast wording (`Enter a name`, `Food updated`, `You already have a food with that name`) and ids `eName`, `data-edit-food` are this spec's decisions; change them together with the checklist if the implementer needs different ones.
10. Editing the food from a diary entry (a link from Edit entry to the saved food) is not part of this feature.
