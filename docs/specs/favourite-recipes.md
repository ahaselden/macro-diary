# Spec: favourite recipes

## Purpose
Let the user mark recipes as favourites (a star on each recipe card and in the editor) and filter the recipes list to favourites only (docs/VISION.md section 4.3). The flag lives on the recipe itself, so it syncs, backs up and merges through the existing recipe paths with no new record kind.

Provenance: written red-first. The author read `schema.js`, `domain/recipes.js`, `merge.js`, `backup.js`, `sync-records.js`, `ui/recipes-view.js`, the head of `ui/recipe-editor.js` and `index.html`. Domain tests were validated against a throwaway prototype in the scratchpad (not in the repo) to prove they are satisfiable; they fail in the repo because the feature is missing.

## Contract
| Layer / file | Export | Shape |
|---|---|---|
| core `js/core/schema.js` | `SCHEMA_VERSION` | `5` (was 4). `defaults().schemaVersion` follows it. `STORAGE_KEY` (`macrodiary.v1`) unchanged. |
| core `schema.js` | `migrate(d)` | gains a v4 -> v5 step (`d.schemaVersion = 5`); no re-stamping of recipes, nothing dropped. |
| core `schema.js` | `sanitizeRecipe(r, id)` | result gains `favorite: boolean`, `r.favorite === true` only. Everything else unchanged (still `null` for nameless/non-object). |
| domain `js/domain/recipes.js` | `newRecipe(id, now)` | now includes `favorite: false`. |
| domain `recipes.js` | `setFavorite(state, id, on, now)` | MUTATES `state` like `saveRecipe`. If `state.recipes` has own property `id` (use `Object.hasOwn`, never `in`): sets `recipe.favorite = (on === true)`, `recipe.updatedAt = now`, returns `true`. Otherwise returns `false`, never throws, never mutates, never creates `state.recipes`, never touches `state.tombstones`. |
| domain `recipes.js` | `searchRecipes(state, q, opts)` | new optional `opts = {}`; `opts.favoritesOnly === true` keeps only recipes with `favorite === true`, ANDed with the text query. Order unchanged (name case-insensitive, then id). |
| UI | `js/ui/recipes-view.js`, `js/ui/recipe-editor.js`, `index.html` | see U1-U6 and the manual checklist. |

Decision (the plan left it open): `setFavorite` with the value the recipe already has is treated as applied: it still stamps `updatedAt` and returns `true` (simplest rule: "known id -> applied"). Callers that want to avoid sync churn compare first.

## Behaviours
Tests are in `tests/favourite-recipes.test.js`; ids match test titles.

Schema
- F1 `SCHEMA_VERSION` is 5, `defaults()` carries it, `STORAGE_KEY` is `'macrodiary.v1'`.
- F2 v4 data (recipes without `favorite`) migrates to schemaVersion 5, every recipe field intact (including `updatedAt`, not re-stamped), `favorite:false`, tombstones kept.
- F3 an existing `favorite:true` survives `migrate` on v1, v4 and v5 data.
- F4 `sanitizeRecipe` / `sanitize`: `favorite` is a strict boolean; only `true` is true. Strings (`'true'`), numbers, null, objects, arrays, NaN, a `valueOf` trick all become `false`.
- F5 `sanitizeRecipe` gains exactly one key (`favorite`); nameless input still gives `null`.

Domain
- F6 `newRecipe` has `favorite:false`.
- F7 `setFavorite` sets the flag, stamps `updatedAt = now`, returns `true` (on and off).
- F8 same value again: returns `true` and re-stamps (decision above).
- F9 only `favorite` and `updatedAt` of that recipe change; other recipes, tombstones, days untouched.
- F10 `on` is coerced strictly: only `true` turns it on; any other value (including truthy `'yes'`, `1`) turns it off; stored value is always a boolean.
- F11 unknown id (`'nope'`, `''`, `undefined`, `null`, number, object, `'__proto__'`, `'constructor'`, `'toString'`, ...) returns `false`, no throw, no mutation, no prototype pollution.
- F12 bad/empty state (`null`, `undefined`, `{}`, `recipes` null/array/string) returns `false` without throwing and without creating `recipes`. A junk recipe value (`recipes.r1 = 5`) must not throw (return value unspecified).
- F13 a deleted recipe (tombstone, absent from `recipes`) is NOT resurrected: returns `false`, `recipes` stays empty, tombstone value unchanged.
- F14 tombstones of other ids are never cleared.
- F15 `saveRecipe` keeps `favorite`; `deleteRecipe` still works.

Search
- F16 no `opts`, `{}` or `{favoritesOnly:false}` behave exactly as before (hand-ordered expectation, text matching on name/tags/ingredients).
- F17 `favoritesOnly:true` keeps only `favorite === true` (the string `'true'` in a hand-built state is NOT a favourite), same order.
- F18 combined with the text query (name, tag, ingredient words) as AND.
- F19 empty / missing recipe collection returns `[]`.
- F20 equal names order by id also under the filter.
- F21 no mutation of state.

Merge / backup / sync
- F22 merging the same recipe that differs only in `favorite`: newer `updatedAt` wins, both argument orders, both directions (on->off and off->on).
- F23 `setFavorite` (stamp 100) beats an older remote copy; a later remote edit (stamp 200) wins over it.
- F24 favourited recipe deleted later (tombstone newer than its stamp) stays deleted.
- F25 backup JSON round trip through `mergeRestore` into an empty state keeps `true` and `false`.
- F26 an old (schema 4) backup imports with `favorite:false`; the whole recipe deep-equals the hand-written expectation (nothing else changes).
- F27 restoring an old backup does not un-favourite a newer local favourite (tie-break/age rules unchanged); hostile `favorite` values in a backup file become `false`.
- F28 `toRecords` carries `favorite` inside the `recipe:<id>` record value, record `updatedAt` is the recipe stamp, no new record kinds; `applyRecords` round trip reproduces recipes exactly.
- F29 `applyRecords`: a remote record with a missing or hostile `favorite` yields `false`; a `true` yields `true`; no throw.
- F30 two devices through the real sync engine and memory adapter: favourite on the phone reaches the PC; a later un-favourite on the PC wins and settles on both.

UI wiring (weak static checks, see below)
- U1 `recipes-view.js`: a `<button ... aria-pressed=...>` and `aria-label` in the card markup; `esc(r.name)` still present.
- U2 `recipes-view.js` calls `setFavorite(`, `save()`, `emit('recipes:changed'`, and contains no `.favorite =` assignment.
- U3 `recipes-view.js` mentions `favoritesOnly`.
- U4 `recipe-editor.js`: a favourite `<button ... aria-pressed=...>` and `setFavorite`.
- U5 `index.html`: inside the `#v-recipes` section, after `#rcQ`, a `<button ... aria-pressed="false" ...>` whose text contains "Favourites" (or "Favorites").
- U6 neither UI file uses `role="button"` (must be real buttons).

## Existing assertions that must change (edited by the test designer, explain in the PR)
These were the only existing tests broken by the new field (the version tests use the `SCHEMA_VERSION` constant, so nothing asserts a literal 4):
1. `tests/recipes.test.js` line 11, `newRecipe / newIngredient shapes`: the `deepEqual` for `newRecipe('r1', 5)` now includes `favorite: false`. Reason: `newRecipe` gains the field.
2. `tests/planner-data.test.js` line 14, the `recipe()` test helper: now includes `favorite: false`. Reason: `toRecords/applyRecords round-trip` does `deepEqual(back.recipes, s.recipes)`, and `applyRecords` sanitises, so the round-tripped recipe now always has `favorite`. Without this the helper recipe lacks the field and the round trip can never be equal.
Both fail today and pass once the feature exists. Nothing else was weakened.

Not changed but worth knowing: `tests/store.test.js` asserts `migrate({schemaVersion: 7}).schemaVersion === 7` (future versions untouched); keep that behaviour (`if (v < 5)` only).

## Edge cases and hostile input
Covered: hostile `favorite` values from backups/sync (F4, F27, F29), hostile `on` argument (F10), prototype-key ids (F11), empty/odd state (F12, F19), deleted recipe and tombstones (F13, F14, F24), old data and old backups (F2, F26, F27), huge/odd types via the `HOSTILE` list, no pollution of `Object.prototype`. Imported/synced `favorite` can only ever be the boolean `true`/`false`, so rendering it into `aria-pressed` or a class cannot inject HTML; recipe names remain escaped (U1).

## How weak the automated UI tests are
U1-U6 are regex checks on source text. They show that markup and calls exist, not that the handlers run, the click does not also open the editor, the filter hides cards, `aria-pressed` tracks state, or the re-render happens. U2's "no `.favorite =`" is a crude proxy for "goes through `setFavorite`". U5 expects the filter button text to be on one line with the tag. No fake DOM was written. Wording regexes may need loosening if the implementer's markup is reasonable but different (say so in the PR).

## Manual checklist
- [x] Recipes tab: each card shows a star button; tapping it toggles filled/empty, does NOT open the editor, list re-renders, state survives a reload.
- [ ] (not tried; buttons with aria-pressed verified in the DOM only) Screen reader / keyboard: star and filter are focusable buttons, announce name plus pressed state, Space/Enter toggle.
- [x] "Favourites" filter next to the search box: pressed state visible; combined with a search text it narrows further; empty result shows a sensible message (not "No recipes yet" when recipes exist but none are favourites).
- [x] Editor: favourite toggle reflects the current state; for a NEW unsaved recipe it persists on Save; Cancel/discard of an existing recipe does not leave surprising state (see open question 1).
- [x] Recipe named `<img src=x onerror=alert(1)>` renders as text on card and in editor.
- [ ] (not tried by hand; covered by F30 in the engine test) Two devices signed in to sync: star on one, sync, appears on the other; unstar wins when later.
- [ ] (not tried by hand; covered by F25-F27) Export a backup, restore it on a fresh browser: stars preserved. Restore an old backup file: no stars, nothing else changed.
- [x] Upgrade from the previous version with existing recipes: all still present, none starred, schema version in saved data is 5, key still `macrodiary.v1`.
- [ ] (not tried; needs a real phone) After the update the phone picks up the new `CACHE` (reload twice).

*Ticked items were checked on 2026-11-10 in the desktop built-in browser against a seeded v4 save (desktop width only, not a phone).*

## Shipping checklist (implementer)
- `sw.js`: bump `CACHE` (no new shipped files expected; if one is added, add it to `SHELL`).
- Docs: docs/DECISIONS.md (flag on the recipe, strict boolean, re-stamp on same value), docs/ARCHITECTURE.md/ROADMAP.md as needed, the saved-shape/version note.

## Out of scope
Favourites for foods or plan items, ordering favourites first, a favourites count badge, a separate sync record.

## Open questions
1. Editor semantics: the editor works on a draft copy until Save, but the plan says toggles go through `setFavorite`. For an existing recipe, does the editor toggle apply immediately (bypassing Cancel), or set the draft and persist on Save (then the editor must still not overwrite a newer star with a stale draft)? U4 only requires `setFavorite` to appear in the editor. A new unsaved recipe has no state entry, so `setFavorite` returns `false`; the editor needs `draft.favorite` for that case. Not tested.
2. `setFavorite` when the stored recipe is itself frozen or not an object: unspecified (F12 only asserts no throw for a primitive junk value).
3. `searchRecipes(state, q, null)` and truthy non-boolean `favoritesOnly` (`'yes'`): unspecified; only `true` is tested to enable the filter and `false`/omitted to disable it.
4. Merge tie (equal `updatedAt`, different `favorite`): resolved by the existing canonical-string rule in `merge.js`; not tested (existing behaviour, deterministic).
5. Element ids/names for the new controls (filter button id, star class) are not fixed by the plan, so tests do not select by id. Is the filter state kept across tab switches / reloads? Not specified, not tested.
6. Whether "Favourites" is spelled British or American in UI text: U5 accepts both; U4 accepts both.
