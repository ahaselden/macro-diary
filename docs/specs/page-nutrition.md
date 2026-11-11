# Spec: use the page's stated nutrition, and fix servings from yields like "12 Wings"

Extends the recipe import (`docs/specs/recipe-import.md`, DECISIONS D29/D30) and VISION principle 4 ("honest numbers"). Tests:
`tests/page-nutrition.test.js` (domain, N1..N38), `tests/page-nutrition-ui.test.js` (weak static UI checks, U1..U6),
fixtures in `tests/fixtures/site-corpus/`.

## Purpose

An imported recipe showed 0 kcal until every ingredient was linked to a food, which is unusable. The importer now keeps the page's
per-serving calories and macros as **stated nutrition**; the app uses it, labelled as coming from the page (an estimate), until all
of the recipe's ingredients are linked to foods, after which the linked foods win. The importer also derives the number of servings
correctly when the page's yield is a count of items ("12 Wings") and its serving size is the same items.

This reverses the earlier "never import nutrition" decision (owner, 2026-11-10). DECISIONS D29/D30 and the recipe-import spec must be
updated by the implementer (not by the test designer).

## Contract

### core/schema.js (schema v6)
- `SCHEMA_VERSION = 6`. `STORAGE_KEY` stays `'macrodiary.v1'`. `migrate` gets a `v < 6` step (no structural change; `sanitize` adds `stated: null`).
- Recipe shape gains `stated: null | { k, p, c, f, per }`: calories and grams of protein / carbs / fat **per serving**.
  `k` finite 0..20000; `p`, `c`, `f` finite 0..5000; `per` a string of at most 40 characters (the page's serving-size text, may be `''`).
  The object has exactly these five keys.
- `sanitizeRecipe(r, id)` keeps a valid `stated` (as a fresh object, key order `k, p, c, f, per`), and returns `stated: null` for anything
  else: missing, wrong types (strings, booleans, objects, arrays as numbers), NaN, Infinity, negative, over the bounds, a non-object, missing
  keys, extra keys (including an own `__proto__` key). Never throws, never mutates its input.

### domain/recipes.js
- `newRecipe(id, now)` returns `stated: null`.
- `recipeNutrition(recipe, measures)` result gains `source: 'foods' | 'stated' | 'none'` and `estimated: boolean`. A `stated` is "valid" by the
  same rule as in `sanitizeRecipe`.
  - No valid `stated`: everything exactly as before; `source` is `'foods'` when `linked > 0`, else `'none'`; `estimated` false.
  - Valid `stated` and the foods result is `complete`: `source 'foods'`, foods numbers, `estimated` false.
  - Valid `stated` otherwise (including a recipe with no ingredients): `source 'stated'`, `perServing = {k,p,c,f}` of `stated`,
    `total = perServing x servings` (servings > 0, else 1), `complete: true`, `estimated: true`. `linked`, `count`, `missing`, `totalGrams`
    stay the foods numbers.
  - Never throws on a malformed recipe (null, undefined, `{}`, hostile `stated`); results are fresh objects (changing them cannot change the recipe).

### domain/plan.js
- `itemNutrition` uses `recipeNutrition` unchanged and adds `estimated` (true for a stated recipe item, false for foods recipes).
- `entryFor` (via `logItem` / `logDay`): the "nothing to log" condition becomes `source === 'none'`. A stated recipe is logged; `per100` is
  computed with the existing 100 g serving for an unknown weight, so the diary counts `perServing x item servings`.

### domain/autoplan.js
- Candidates need `source !== 'none'` (was `linked > 0`); stated recipes count as complete (so they pass without `includeIncomplete`).
  The `k > 0` requirement is unchanged.

### domain/recipe-import.js
- The import result (all three routes and the empty results) has the old eight keys **plus `nutrition`**:
  `null | { k, p, c, f, per }` (same shape and bounds as `stated`, key order `k, p, c, f, per`).
- **Page route** (`importFromJsonLd`, `importFromHtml`): reads the node's `nutrition` object (own properties only).
  - `calories`: a string such as `'336'`, `'434 calories'`, `'172 kcal'`, `'1,200 kcal'`, `'336 cal'` (case-insensitive, surrounding space ok). A kJ-only
    value is not used. A value with other junk (`'about 300 kcal'`, `'12 apples'`, `'1e999'`, `'-5'`, `'NaN'`) is unusable. **Calories are
    required**: without a usable value `nutrition` is `null`.
  - `proteinContent`, `carbohydrateContent`, `fatContent`: grams as `'31.8g'`, `'3.7 g'`, `'80'` (bare numbers are grams) or milligrams (`'250 mg'` = 0.25).
    A missing or unusable macro becomes `0` and adds ONE warning that names which macros were not listed (protein, carbs, fat).
  - `per` = `servingSize` cleaned like other imported text (tags removed, entities decoded, whitespace collapsed) and cut to 40 characters; `''` when
    absent or not a string.
  - Values outside the schema bounds never reach `nutrition` (it is `null`, or the offending macro is treated as unusable; see open questions).
- **Warnings**:
  - nutrition used: the note, exactly `Calories and macros come from the page (per serving), so treat them as an estimate: link foods to replace them.`
    (constant `NOTE` in the tests; fixtures' goldens contain it, so the wording is part of the contract), plus the missing-macros warning when macros are missing.
  - `nutrition` listed but unusable (non-empty object or non-empty string with no usable calories): a warning containing the word "nutrition", and no note.
  - empty or absent `nutrition` (`undefined`, `null`, `{}`, `''`): no nutrition warning.
  - The old "page lists nutrition, not imported" warning is gone.
- **Text route** (`importFromText`): optional lines `Calories: 336`, `Protein 31 g`, `Carbs 46 g` (also `Carbohydrates`), `Fat 4 g` (case-insensitive,
  colon optional, optional `kcal` / `g`) **before the first section header** fill `nutrition` exactly as above (`per` is `''`). They are not
  ingredients, steps, title or description. After a section header such lines are ordinary ingredient/step text.
- **Servings**: new pure export `servingsFromPage(recipeYield, servingSize)` returns a number in (0, 1000] or `null`.
  1. Find the yield's unit noun: the word after the number (`'12 Wings'` -> wings, `'Makes 24 cookies'` -> cookies). For an array, prefer the element that
     has a unit noun. `servings`, `serving`, `portions`, `portion`, `people`, `person`, `persons` are NOT unit nouns (they mean servings).
  2. If the yield has a unit noun AND `servingSize` is a string with a number and the SAME noun (case-insensitive, plural-insensitive:
     cookie/cookies, wing/Wings): result = yieldNumber / servingNumber rounded to 2 decimals, if within (0, 1000].
  3. Otherwise (and when step 2 would leave the bounds or divide by zero): exactly the old behaviour, `parseYield(recipeYield)`.
  `importFromJsonLd` calls it with `recipeYield` and `nutrition.servingSize`. `parseYield` itself is unchanged.
- `toRecipe(result, id, now, sourceUrl)` copies `result.nutrition` into `recipe.stated` (validated like `sanitizeRecipe`, as a copy); invalid or absent
  gives `null`; never throws; does not mutate the result; the recipe passes `sanitizeRecipe` unchanged.

### ui (weak, static checks only)
- `js/ui/recipe-editor.js`: block "Nutrition per serving (from the page)" with number inputs `reKcal`, `reProt`, `reCarb`, `reFat` (each with a label) reading and
  writing `draft.stated`; blank kcal means `stated = null`; the `per` text is shown as escaped plain text. The summary card says "from linked foods", "from the page
  (estimate): link all ingredients to use your own foods", or nothing/none, from `recipeNutrition().source`. Entering the numbers by hand works for any recipe.
- `js/ui/recipes-view.js`: card shows a "from page" badge instead of "incomplete" when `source` is `'stated'`.
- `js/ui/plan-view.js`: the "link foods" toast condition uses `source === 'none'` (not `linked === 0`).
- `sw.js`: `CACHE` bumped (greater than `macro-diary-v29`); `SHELL` unchanged (no new shipped file).
- All page text goes through `esc()`.

## Behaviours (tick off in review)

Schema and persistence
1. (N1) `SCHEMA_VERSION` is 6, `defaults().schemaVersion` is 6, `STORAGE_KEY` unchanged.
2. (N2) A saved v5 state with recipes and no `stated` loads at v6 with `stated: null` and nothing else changed (recipes, `updatedAt` not re-stamped, plan, tombstones, goals, days); older versions also reach 6.
3. (N3) `sanitizeRecipe` keeps a valid `stated` exactly, including bound values (0, 20000, 5000, `per` of 0 and 40 characters); the recipe key set gains `stated`; nameless recipes still rejected; input not mutated.
4. (N4) Missing `stated` becomes `null`; every invalid form (wrong types, NaN, Infinity, negative, huge, non-object, missing or extra keys, own `__proto__`) becomes `null`; no prototype pollution.
5. (N5) `newRecipe` returns `stated: null`.
6. (N6) Restoring a backup keeps `stated`; a v5 backup restores with `stated: null` and the rest identical; hostile `stated` in a backup is dropped to `null`.
7. (N7) A sync recipe record round-trips with `stated`; a hostile `stated` in a record is dropped to `null` while the recipe still arrives.

recipeNutrition
8. (N8) Without `stated`: numbers as before; `source` `'foods'` when something is linked, else `'none'`; `estimated` false; a recipe object with no `stated` property at all behaves the same.
9. (N9) With `stated` and nothing linked: `source 'stated'`, `estimated` true, `complete` true, `perServing` = stated, `total` = stated x servings (hand: 336/31.8/46.7/3.7 x 4 = 1344/127.2/186.8/14.8; 200 x 2.5 = 500), `missing`/`count` as foods.
10. (N10) Servings 0, negative, NaN, missing, null or a non-number use 1 serving.
11. (N11) With `stated` and partly linked ingredients: stated numbers are used; `linked`, `count`, `missing`, `totalGrams` are the foods numbers.
12. (N12) With `stated` and all counted ingredients linked: linked foods win (`source 'foods'`, `estimated` false, foods numbers); an unlinked ignorable ingredient (salt) does not prevent that.
13. (N13) `stated` on a recipe with no ingredients is used; an invalid `stated` is ignored exactly like an absent one.
14. (N14) Never throws on malformed recipes with or without `stated`, never mutates (also frozen input), returns fresh objects.

Plan and auto-fill
15. (N15) `itemNutrition` of a stated recipe item = perServing x item servings (hand: 300/20/30/10 x 2 = 600/40/60/20), `complete` true, `estimated` true; foods recipes `estimated` false; a deleted recipe is still incomplete.
16. (N16) `dayNutrition` and `monthSummary` count a stated recipe (300 x 1.5 = 450) and report the day complete.
17. (N17) `logItem` logs a stated recipe with nothing linked: `per100` = per serving (100 g serving), `grams` 200 for 2 servings, `amount` 2, source `'Recipe'`; kcal counted by the diary = 600; logging twice is a no-op.
18. (N18) `logItem` of a stated recipe that is partly linked logs the STATED numbers (336 x 1.5 = 504 kcal).
19. (N19) A recipe with neither linked foods nor stated still cannot be logged; `logDay` counts stated recipes.
20. (N20) Auto-fill proposes a stated recipe without `includeIncomplete`, using the stated kcal (target 600, stated 280/serving gives 2 servings; the foods would have said 100/serving) and `complete: true`.
21. (N21) Auto-fill still ignores recipes with neither linked foods nor valid `stated`, even with `includeIncomplete`.

Importer
22. (N22) Every import result has a `nutrition` key (`null` when the page/text has none), on the page, HTML and text routes and on empty/hostile input; a complete recipe without nutrition has no warnings.
23. (N23) Calories parse from `'336'`, `'434 calories'`, `'172 kcal'`, `'1,200 kcal'`, `'336 cal'` and variants; macros absent gives `{k, p:0, c:0, f:0, per:''}`.
24. (N24) Calories are required: kJ-only, junk, `''`, `'1e999'`, negative, over 20000, non-strings all give `nutrition: null`; macros without calories give `null`.
25. (N25) Macros parse from `'31.8g'`, `'80'`, `'3.7 g'`, `'250 mg'` (= 0.25) for protein, carbs and fat; unlisted macros are 0; fixed key order.
26. (N26) A missing or unusable macro becomes 0 and a (single, non-duplicated) warning names exactly the macros not listed.
27. (N27) Warnings: exactly the NOTE when nutrition is used with all macros; NOTE + one macro warning when macros are missing; listed-but-unusable keeps a "nutrition" warning and no note; empty/absent adds none; the old "not imported" warning is gone.
28. (N28) `per` is the cleaned servingSize cut to 40 characters; `''` when absent or not a string; no markup survives.
29. (N29) Hostile nutrition (huge, non-finite, objects, arrays, own `__proto__`, inherited fields, cycles, megabyte strings, throwing `toString`) never throws, never pollutes, never yields out-of-bounds values, and does not mutate (frozen) input.
30. (N30) Pasted text: `Calories` / `Protein` / `Carbs` / `Fat` lines before the first section header fill `nutrition` (case-insensitive, optional units and colon, CRLF) and are not ingredients, steps, title or description; calories required; lines after a header stay ingredient text.
31. (N31) Pasted text with absurd or hostile nutrition values gives `null` (or in-bounds numbers) and never throws.
32. (N32) `servingsFromPage`: `['12','12 Wings']` per `'12 Wings'` = 1; `'24 cookies'` per `'1 cookie'` = 24, per `'2 cookies'` = 12; `10 cookies` per `3 cookies` = 3.33; case- and plural-insensitive; array order does not matter.
33. (N33) `servingsFromPage` otherwise falls back to the old rule: `'6 servings'` + `'1.5 cups'` = 6; `['8','8 servings']` + `'1 serving'` = 8; "servings/portions/people/persons" are never divided; different nouns, missing or non-string servingSize, numeric yield, ranges keep the old result; no yield is `null`.
34. (N34) `servingsFromPage` is always `null` or finite in (0, 1000]; zero or absurd serving numbers never give Infinity/0; hostile and huge inputs never throw and finish quickly.
35. (N35) `importFromJsonLd` applies it: the three page shapes give 6, 1 and 8 servings; no nutrition keeps the old yield rule; unknown servings still default to 4 with the warning; `parseYield(['12','12 Wings'])` is still 12.
36. (N36) `toRecipe` copies valid nutrition into `recipe.stated` (a copy), invalid or absent becomes `null`, never throws, input unchanged, passes `sanitizeRecipe` unchanged, key set gains `stated`.

Fixtures (end to end)
37. (N37) The three invented pages (`synthetic-pumpkin-barley-stew`, `synthetic-baked-wings`, `synthetic-herb-chicken-strips`) import to hand-computed servings (6, 1, 8) and nutrition, their goldens agree, `toRecipe` + `recipeNutrition` give `source 'stated'` with totals 2016, 434 and 1376 kcal; hosts are reserved domains; the yield shapes seen on real pages (`'6 servings'`, `['12','12 Wings']`, `['8','8 servings']`) are kept.
38. (N38) The two earlier corpus goldens gained only `nutrition: null`; all five fixture pairs exist.

UI (weak static, U1..U6): editor inputs and labels (U1); read/write `draft.stated`, blank = null, `esc` on `per` (U2); source wording on the summary card (U3); "from page" badge (U4); plan toast uses `source === 'none'` (U5); `CACHE` bumped past v29 (U6).

## Edge cases and hostile input covered

Empty/absent/`{}`/`''` nutrition; kJ-only; `'1e999'`, `'calories: 1e999'`, `'Infinity'`, `'NaN'`, negative and over-bound numbers, 1e6-character strings;
numbers as objects/arrays/functions/throwing `toString`; own `__proto__` and `constructor.prototype` keys, inherited properties, cyclic objects;
HTML in `servingSize`; non-string servingSize; `stated` with extra keys/NaN/negative/huge in saved data, backups and sync records; `recipeNutrition` on
`null`/`undefined`/`{}`; frozen inputs; division by zero in `servingsFromPage`; huge arrays and strings given to `servingsFromPage`.

## Changes to earlier tests (all caused by the owner's decision or by schema v6)

`tests/recipe-import.test.js`
- `KEYS` (used by R12, R24, R26, R30, R34): added `'nutrition'` (the result has nine keys now).
- R12: added one assertion that the graph fixture (310 calories, no macros) gives `nutrition {k:310,p:0,c:0,f:0,per:''}`.
- R23: the `nut` block asserted "nutrition on the page is ignored", "no calories/macros field" and "no nutrition value leaks into the result". Replaced by: the "come from the page" note is present, the result has the `nutrition` key, and `nutrition` equals `{k:310,p:9,c:0,f:0,per:''}`. Reason: the owner reversed the decision. All other R23 assertions unchanged (`RE_NUT` still used for the "no nutrition warning when nothing is listed" checks).
- R31: the exact `toRecipe` key list gained `'stated'`.

`tests/fixtures/recipe-import/expected/graph-webpage-recipe.json` (golden used by R12): `warningCount` 1 -> 2 and `warningPatterns` `["nutrition"]` -> `["come from the page", "protein"]`. Reason: the fixture's page states 310 calories, so it now gets the note plus the "macros not listed" warning.

`tests/site-corpus.test.js`: `EXPECTED` gained `nutrition: null` (tests 21 to 24 use it; `expectedFor` equals the importer result and `checkSite` compares every key).

`tests/fixtures/site-corpus/synthetic-lentil-soup.expected.json` and `synthetic-taco-bowl.expected.json`: added `"nutrition": null` and nothing else. Tests that read them without being edited themselves and fail only until the importer returns `nutrition`: `tests/import-dev-tools-parser.test.js` test 36, `tests/split-topping-lists.test.js` test 18, `tests/site-corpus.test.js` test 30.

`tests/recipes.test.js` ("newRecipe / newIngredient shapes"): added `stated: null` to the expected `newRecipe` object.
`tests/planner-data.test.js`: the `recipe()` helper gained `stated: null` (used by the sync round-trip test and others that deepEqual sanitised recipes).
`tests/favourite-recipes.test.js`: helper `rec()` gained `stated: null`; F1 now expects `SCHEMA_VERSION` 6 (title updated); F2 expects `schemaVersion` 6 after migrating; F5's exact key list gained `'stated'`; F26's expected merged recipe gained `stated: null`.
`tests/recipe-import-ui.test.js` U12: `SCHEMA_VERSION` is now 6 (was "stays 5"); the `STORAGE_KEY` check is unchanged.

Not edited but affected in name only: `tests/store.test.js` uses `SCHEMA_VERSION` symbolically and still holds.

## What cannot be tested automatically (manual checklist)

The UI tests are static source-text checks and are **weak**: they prove that markup, wording and calls exist, not that anything works or is escaped at runtime.
Desktop browser only (no phone, no camera involved).
- [ ] Import three real pages (through the local stand-in or the live app): one stating servings per cup, one with an item-count yield such as "12 Wings", one with "8 servings". Each editor shows the stated numbers in "Nutrition per serving (from the page)"; the card shows "from page"; the item-count recipe has 1 serving.
- [ ] The summary card says "from the page (estimate): link all ingredients to use your own foods".
- [ ] Link every counted ingredient to a food: the card flips to "from linked foods" and the numbers change to the foods' numbers; the badge becomes none (or "incomplete" while some are unlinked and no stated exists).
- [ ] Clear the kcal box: the recipe has no stated nutrition (shows 0 / "incomplete" as before); type numbers into a hand-made recipe: they are used and labelled.
- [ ] The page's serving text with `<b>` or `&amp;` in it is shown as plain text in the editor.
- [ ] Plan a stated recipe for 2 servings, then log it to the diary: the diary shows the stated kcal x 2; the "link foods" toast appears only for a recipe with neither foods nor stated numbers.
- [ ] Auto-fill proposes stated recipes.
- [ ] Restore a backup made before this change: recipes load, nothing lost, no stated nutrition. Restore a new backup: stated survives. Sync between two browsers carries stated.
- [ ] After deploy, the app updates (cache bumped) and an existing saved recipe list still opens.

## Honest limits

- The page's numbers are the site's claim, not verified; they can be wrong, per a different serving, or computed with a different yield. The app labels them as an estimate but cannot check them.
- Plan and day totals include stated (estimated) recipes with no per-total flag; only the per-item `estimated` field exists, and the plan UI does not show it in totals.
- Per-serving numbers are only as good as the servings count; a wrong yield rescales the recipe total.
- The unit-noun rule (`servingsFromPage`) is a heuristic: unusual plurals (loaf/loaves, batch/batches) are not matched and fall back to the old yield rule.
- The UI is covered by static tests and the manual checklist only; desktop only.

## Open questions (resolved by the test designer as noted; tests assert only what is stated)

1. **Exact wording of the note.** The brief gave `'Calories and macros come from the page (per serving)...: link foods to replace them'`. The tests pin the full sentence in `NOTE` above because the corpus goldens compare warnings exactly. If the owner prefers other words, change `NOTE` (tests, goldens) and the importer together.
2. **One warning or two** when macros are missing: the tests require the note PLUS one separate macros warning (the note alone when all three macros are listed). Hence the R12 golden count of 2.
3. **Out-of-bounds macro** (e.g. `proteinContent: '99999'`): whole `nutrition` null, or that macro treated as unusable (0 plus warning)? Tests accept either and only require in-bounds output.
4. **Zero calories** (`'0'`): allowed by the bounds, not tested. **Numeric (non-string) `calories`** (e.g. `336` as a JSON number): not tested. **Calories with kJ in the same string** (`'350 kcal (1465 kJ)'`): not tested.
5. **`per` longer than 40 characters** inside saved data: truncate or reject? Not tested for `sanitizeRecipe` (the importer is tested to cut at 40).
6. **String numbers inside `stated`** (`k: '300'`): the brief says finite numbers; not tested either way.
7. **Inherited (prototype) properties on a `stated` object:** not required; only own-key data is specified.
8. **Does `servingsFromPage` use `servingSize` when the nutrition itself is unusable** (calories missing)? Not tested.
9. **Macro lines in pasted text before the title** or with a value such as `Calories: lots`: only "after a header they stay text" and "hostile never throws" are tested.
10. **Fallback when the unit rule leaves the bounds**: tests require only `null` or a finite value in (0, 1000], not which.

## Verification log (implementer, Windows, desktop built-in browser)
- `npm test`: 662 pass. The local corpus (`npm run test:sites`, git-ignored snapshots of three real pages) caught the change; the new results were reviewed (page A: 6 servings / 336 kcal; page B, whose yield counted items: 1 serving / 434 kcal; page C: 8 servings / 172 kcal) and the snapshots refreshed.
- In the app (local stand-in as the import service): importing the three real pages filled the editor's four boxes, the serving text, the summary ("Numbers are from the page (estimate)") and the import note; saving worked; the list showed "from page" badges; a saved v5 recipe (fully linked, no `stated`) loaded at schema 6 with `stated: null` and no badge.
- NOT done: planning and logging a stated recipe through the UI, linking all ingredients and watching the source flip in the UI (covered by unit tests only), restoring an old backup, two-device sync, a phone.
- Open questions resolved as: zero calories are not used (calories must be above 0); a numeric (non-string) calories value is accepted; `per` is cut to 40 characters; `servingSize` is used for servings only when the page's nutrition is an object.
