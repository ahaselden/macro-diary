# Decisions log

Short records of non-obvious choices and **why**, in the order they were made. Anything marked **(made without the owner)** was decided while the owner was away and is the first thing to review or overrule. Format: context → decision → consequences.

---

## D1. Vanilla ES modules, no framework, no bundler
**Context:** The app was one 727-line HTML file; a meal planner is coming. **Decision:** split into native ES modules served as-is (no build step, no dependencies). **Why:** the app is small; a bundler/framework adds tooling, upgrade chores and a build in CI for little gain, and GitHub Pages serves static files fine. **Consequences:** `index.html` no longer works from `file://` (browsers block module loading) — use `npm start`. Revisit (Vite + TypeScript) if the UI layer grows past what hand-written render functions handle comfortably.

## D2. Strict layers: `ui → services → domain → core`
**Decision:** `core/` has no dependencies; `domain/` is pure logic that may import only `core/` (constants, format, dates) and itself; `services/` talks to the outside world and may import `domain/` and `core/`; `ui/` is the only layer that touches the DOM. **Why:** pure `domain/` code is trivially unit-testable in Node and reusable by features that don't exist yet (recipes and shopping lists reuse the units/density logic). Violations are checked in review (`.claude/agents/regression-reviewer.md`).

## D3. Golden-file tests captured from the original app
**Decision:** before moving any code, the *old* code was run in a browser against a deterministic fixture (`tests/fixtures/`) and its outputs saved (`tests/golden/`). New modules must reproduce them exactly. **Why:** a refactor's main risk is silently changing behaviour; the old code is the best specification we have, and capturing it mechanically beats re-deriving expectations by hand. **Consequences:** `tests/golden/reports.json` is large (~700 KB) because it holds full CSV outputs; acceptable for a byte-exact check. If behaviour is *intentionally* changed later, regenerate the affected golden file in the same commit and say why.

## D4. Application state is one mutable object (`state`), replaced via `replace()`
**Decision:** `core/store.js` exports a single `state` object that is mutated in place; whole-state swaps (restore/wipe) go through `replace()`, which keeps the same object identity. **Why:** every module can hold a reference without stale-copy bugs, and there is exactly one place that touches `localStorage`. `createStore(storage)` takes the storage as a parameter so tests use a fake.

## D5. Storage key stays `macrodiary.v1`; shape changes are versioned
**Decision:** the key never changes. A `schemaVersion` field plus `migrate()` handle shape changes. **Why:** the key is where existing users' phones/PCs keep their diary; changing it would orphan their data. Old data without `schemaVersion` is treated as v1 and stamped.

## D6. Domain functions return new state instead of mutating (`mergeBackup`)
**Decision:** `mergeBackup(state, backup)` returns a new object; the caller `replace()`s and saves. **Why:** pure functions are easier to test and reason about, and the caller decides when to persist.

## D7. Agents extract modules in parallel but only create *new* files
**Decision:** each extraction agent wrote only its own new module and test; the main session did all edits to `index.html`. **Why:** no merge conflicts, and the single integration point stays under one owner. Each agent's report was verified by re-running the whole suite and grepping the layer rule, not taken on trust.

## D8. Bugs found during a refactor are logged, not fixed
Reported by extraction agents/reviewer and kept as-is so behaviour stays identical; collected in `docs/KNOWN-ISSUES.md` for deliberate fixing later.

---

## D9. Last-writer-wins per record, with tombstones, for merging (restore now, sync later) — *made without the owner*
**Context:** the old "Merge" only *added* entries missing locally. That can't carry an edit ("I fixed the grams on my phone") or a deletion ("I removed that entry") from one device to another, and sync needs both. **Decision:** every record (diary entry, custom food, saved measure; settings as one record) carries `updatedAt`; the newer one wins; a deletion writes a **tombstone** `state.tombstones[id] = deletedAt`, which beats any version of the entry last edited before it. Implemented in `js/domain/merge.js` as a pure `mergeStates(a, b)`; entry changes go through `js/domain/entries.js` (`addEntry/updateEntry/removeEntry`) so they are always stamped. **Why LWW per record rather than per day or per field:** a day is edited from several devices (breakfast on the phone, lunch on the PC) so day-level LWW would lose entries; per-field LWW adds bookkeeping with no real benefit for records this small. **Why tombstones:** without them a deleted entry reappears from whichever device hasn't heard of the deletion yet. **Guarantees (property-tested over 300 random state triples):** commutative, associative, idempotent — devices converge in any sync order. **Trade-offs:** device clocks are trusted (a phone with a wrong clock can win or lose edits unfairly; acceptable for one person's devices); tombstones accumulate until `pruneTombstones` (not yet called automatically); equal timestamps are broken by comparing the serialised records (arbitrary but identical everywhere).

## D10. What does *not* sync — *made without the owner*
`theme`, `apiKey` and `recent` stay per-device. Theme is a per-device preference (dark on the phone, light on the PC). The USDA key is a credential the owner should paste per device rather than have copied to a cloud store. `recent` is derived convenience data whose list order would otherwise make every sync "change" something and never settle. Goals, weight unit and database toggles sync as one settings record. Revisit if the owner wants the key or theme synced.

## D11. Schema v3 and sanitising on every load/restore
`core/schema.js` (pure, so `domain/` can use it) holds `defaults`, `migrate`, `sanitize`. v3 adds `tombstones` and `settingsUpdatedAt`; **existing entries are not rewritten** — a missing `updatedAt` simply means 0 ("older than any real edit"), so upgrading changes nothing a user can see and cannot lose data (tested against the original fixture). `sanitize` forces untrusted fields (goals, units, theme, tombstones…) to safe types because a restored file reaches the HTML through them (KNOWN-ISSUES #1).

## D12. "Restore → Merge" prefers this device on a tie
Old backups have no timestamps, so every record ties. For *restore* (a human deliberately importing a file) the device keeps its own version on a tie (`preferLocal`), matching the old behaviour; for *sync* the symmetric tie-break is used because it must not depend on which device runs the merge. The test suite proves a restore-merge still brings in exactly the data the original merge did (golden), and that it now also applies newer edits and deletions found in the backup.

## D13. One schema bump (v4) for all planner data, added before any planner feature — *made without the owner*
**Decision:** `recipes`, `plan` and `shopping` were added to the schema, sanitiser, merge and sync records **in one step, before** the recipe/plan/shopping features, so those features never need their own migration and are *born syncable*. **Shapes:** `recipes: {id: recipe}` (record = one recipe, tombstones apply); `plan: {YYYY-MM-DD: {updatedAt, slots:{Breakfast,Lunch,Dinner,Snacks:[item]}}}` (record = one planned *day*; the newer edit replaces the whole day, and clearing a day counts as an edit so it beats older content); `shopping: {checks:{itemKey:{on,updatedAt}}, extras:{id:{text,on,updatedAt}}}`. **Why one record per planned day, not per slot:** a day is small, edited by one person at a time, and whole-day replacement keeps merge trivial and provably convergent (property-tested); the cost is that two devices editing *different slots of the same day* offline will keep only the newer device's day. Acceptable for one user; the alternative (per-item records) can be adopted later without changing the UI. **Why the shopping *list* itself is not stored:** it is derived from the plan + recipes (so it can never go stale); only what the user does to it (ticking items, adding extras) is saved. **Sanitising:** recipe/plan/shopping data arrives from backups and from the cloud, so it is forced to safe types and capped in size (200 ingredients, 100 steps…) on every load, restore and sync (`sanitizeRecipe/PlanDay/Shopping`).

## D14. Recipe nutrition: "incomplete" is reported, never hidden — *made without the owner*
A recipe's calories are the sum of its **linked and convertible** ingredients; the UI shows "N of M linked" with the missing names and an *incomplete* badge (also on plan days that contain such a recipe). **Why:** silently counting an unknown ingredient as 0 kcal makes the numbers look precise while being wrong, which is the worst failure for a calorie tracker. Water, salt, pepper, ice and "to taste"/pinch items are not counted as "missing" because linking them adds noise, not accuracy (`recipes.js#isIgnorable`). **Cups/spoons need a density:** `resolveGrams` only converts volume units when the linked food has a volume measure in its database record (or a measure the user saved); otherwise the UI asks for grams instead of guessing that everything weighs like water.

## D15. Logging a planned recipe to the diary — *made without the owner*
A planned recipe becomes ONE diary entry "N servings" whose grams are the recipe's real serving weight × servings (so weights/units in the diary stay meaningful), or "100 g per serving" when the weight is unknown. **Idempotent:** the plan item stores the `entryId` it created; logging again does nothing unless that diary entry was deleted. A recipe with *no* linked ingredients is not logged (nothing meaningful to record) and the UI says why; a partly linked recipe logs what is linked (flagged incomplete). **Alternative considered:** logging each ingredient as its own entry — rejected because it floods the diary and breaks "I ate 1 serving".

## D16. Shopping list aggregation is conservative — *made without the owner*
Same ingredient is summed only across compatible units (weight→g, volume→ml, counts per unit word); weight and volume of the same ingredient stay as separate lines. **Why:** a wrong merge in a shopping list (buying 1 cup when you need 500 g) is worse than two lines. Grouping ignores size words ("large eggs" = "eggs") and plurals; names shown are as written in the first recipe. Ticks are keyed by `range start | normalised name | unit family`: they survive quantity changes, but belong to ONE shopping trip (a reviewer found that ticking onions this week also ticked them next week when ticks were keyed by name alone). Old ticks from past weeks accumulate as tiny records until "Untick all"; a rename orphans a tick (harmless). Aisles come from a keyword table, most specific aisle first; unknown → *Other*.

## D17. Navigation: Diary | Plan | Recipes | Shop | More — *made without the owner*
Five bottom tabs fit a 360 px phone; Export and Settings moved under **More** (with a "‹ More" back button) rather than shrinking the bar. `showTab('export'|'settings')` still works and highlights *More*.

## D18. Sync is scheduled by any data event, and sync results refresh every screen
`diary:changed`, `recipes:changed` and `plan:changed` all schedule a debounced sync; applying received data emits all of them (with an `applying` guard so a sync cannot trigger another sync by itself).

## D19. The ingredient parser keeps MealPlannerPC's vocabulary but not all of its choices
Ported: unit aliases, synonyms, descriptors, packaging words (the `tokens.json` file — parsing vocabulary only, no credentials). Changed on purpose: preparation words go to a `prep` field instead of being thrown away (the planner shows them), sizes like "(14 oz)" are kept in `prep` and used to resolve canned goods, ranges ("2-3") use the upper bound so shopping lists don't come up short, and names are **not** singularised at parse time so food search still finds "tomatoes" (the shopping list singularises only for grouping).
