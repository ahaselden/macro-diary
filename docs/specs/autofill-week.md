# Spec: auto-fill week

## Purpose
Propose meals for empty plan slots of a week (or any list of dates) from the user's existing recipes, fitting the calorie goal, avoiding repeats and preferring favourites (docs/VISION.md section 4.2). The proposal is only a preview; nothing changes until the user accepts, and accepting never overwrites planned meals.

Provenance: written red-first by the test designer from the plan, `domain/plan.js` and `domain/recipes.js`. No implementation was read (none exists). All golden values are hand computed in the test comments. Test helper: a recipe with one 100 g ingredient of a food with `per100.k = K` and `servings: 1` has exactly K kcal per serving.

## Contract
| Layer / file | Export | Shape |
|---|---|---|
| domain `js/domain/autoplan.js` (imports only `core/{constants,dates,format,schema}` and `domain/*`; no DOM/storage/network/`Math.random`) | `proposePlan(state, opts)` | PURE. Returns `{ days: { 'YYYY-MM-DD': { <Slot>: [ { recipeId, servings, why, complete } ] } }, notes: string[] }`. Each filled slot holds exactly one pick. A day appears only if at least one of its slots was proposed; unfilled slots are absent. |
| same | `applyProposal(state, proposal, now, idGen)` | MUTATES `state` through `plan.js` `addPlanItem(state, date, slot, recipeItem(idGen(), recipeId, servings), now)`; returns the number of items added. Never throws. |
| UI `js/ui/plan-view.js` | "Auto-fill week" button + preview dialog | see U1-U6 and the manual checklist. |

`opts` (all optional; only OWN properties are read, inherited ones are ignored): `dates` array of date keys (default none -> empty proposal); `slots` (default `['Lunch','Dinner']`); `goalK` (default `state.goals.k`); `seed` integer (default 1); `noRepeatDays` (default 3); `preferFavorites` (default true, only `false` disables); `includeIncomplete` (default false, only `true` enables).

No schema change, no new saved field. `sw.js` (SHELL + CACHE bump) is the implementer's job and is not tested here.

## Decisions made in this spec (the plan left them open)
- D-valid-date: a date key is valid only if it is a string that round-trips through `fmt(parse(s))` (so `'2025-02-30'`, `'nope'`, `'2025-11-17 '` are ignored). Duplicates are merged. Dates are processed in ascending order whatever the input order; within a day slots are processed in `MEALS` order (Breakfast, Lunch, Dinner, Snacks).
- D-slots: `slots` that is not an array -> default. Array: unknown names and duplicates ignored (`[]` or only unknown names -> nothing to fill -> empty proposal). Slot names are matched against `MEALS` exactly (never `'__proto__'`/`'constructor'`).
- D-goal: `goalK` must be a finite number > 0, otherwise the default `state.goals.k` is used (NaN, Infinity, 0, negative, strings, null).
- D-target: day budget = goalK minus the kcal already planned that day (ALL existing items of the day, including slots that are not being filled; via `dayNutrition`/`itemNutrition`). Target of a slot = budget x weight / (sum of weights of the slots being filled for that day), weights Breakfast .25, Lunch .30, Dinner .35, Snacks .10. Slots already non-empty are not "being filled". The target is NOT recomputed from what earlier slots of the same proposal picked.
- D-fit: for each eligible recipe, the best servings is the multiple of 0.5 in [0.5, 4] minimising `|servings x perServing.k - target|`; a tie goes to the smaller serving count. The recipe's `diff` is that minimum.
- D-near: let `best` be the smallest diff among candidates. With `preferFavorites`, a favourite whose `diff <= best + 0.10 x target` is "near"; if any near favourite exists, the pick is the near favourite with the smallest diff. Otherwise the overall best diff wins. (Favourites outside the band lose to a better non-favourite.) Remaining exact ties are broken by the seeded PRNG only.
- D-repeat: a recipe is blocked for a slot on date D if it occurs in the plan (already planned items, any slot) or in picks made earlier in this proposal on a date D' with `|D - D'| < noRepeatDays` days (real calendar days, same day = distance 0, so the same recipe is not used twice on one day). `noRepeatDays` not a finite number >= 0 -> 3; `0` disables the rule. If every eligible recipe is blocked, the rule is relaxed for that slot (best fit among all eligible) and a note containing the word "repeat" is added. Otherwise no such note exists.
- D-eligible: a recipe is a candidate only if it is an own entry of `state.recipes` (key = `recipeId`), `recipeNutrition(...).linked > 0` and `perServing.k` is finite and > 0. Incomplete (`complete === false`) recipes are candidates only with `includeIncomplete: true`; their pick has `complete: false` and a note containing "incomplete". Pick `complete` is otherwise `true`.
- D-budget: budget <= 0 -> every slot of that day gets the eligible, non-blocked recipe with the lowest kcal per serving at 0.5 servings, and a note containing "goal" or "budget" is added.
- D-why: non-empty plain text, contains "kcal", no recipe name, no `<` or `>`.
- D-apply: `applyProposal` skips (adds nothing, stamps nothing, creates no day record) for: a slot that already has any item at apply time, a `recipeId` that is not an own key of `state.recipes`, an invalid date key (D-valid-date), a slot not in `MEALS`, a pick that is not an object, or whose `servings` is not a finite number > 0, or whose `recipeId` is not a string. Only the first pick of a slot is meaningful for fit, but all valid picks of an empty slot are added (proposePlan only emits one). A missing/non-function `idGen`, or bad `state`/`proposal`, returns 0.

## Behaviours
Domain tests: `tests/autofill-week.test.js` (ids match titles). UI: `tests/autofill-week-ui.test.js`.

- A1 No dates, no opts / null opts, or no recipes: `days` is `{}`, `notes` an array; with no recipes at least one note.
- A2 One slot, target = whole budget; servings are the closest multiple of 0.5 (280 kcal at 600 -> 2; 400 -> 1.5; 600 -> 1).
- A3 Servings clamp to 4 (100 kcal at 600) and 0.5 (2000 kcal at 600).
- A4 Weights renormalised: Lunch+Dinner at 1300 -> 600/700; Breakfast+Snacks at 3500 -> 2500/1000; default slots are exactly Lunch and Dinner.
- A5 Planned kcal of other slots reduce the budget (Dinner 1200 of 2000 -> Lunch target 800); default goal is `state.goals.k`; `opts.goalK` overrides.
- A6 Budget <= 0: lowest-kcal recipe at 0.5 servings plus a goal/budget note.
- A7 Only empty slots are filled; a planned slot is absent from the proposal; its recipe is blocked that day; a fully planned day is absent; state untouched.
- A8 Repeat window across a month end by real day distance (a,b,c,a), input order irrelevant, `noRepeatDays: 2` honoured, no repeat note when avoidable.
- A9 Recipes planned on neighbouring days (before/after) and in another slot of the same day block repeats.
- A10 `noRepeatDays: 0` disables; relaxation only when all are blocked, with a repeat note; a single recipe still fills the plan.
- A11 Favourite within the band beats a better fit; closest favourite wins among favourites; all-favourites = plain best fit.
- A12 Favourite outside the band (120 kcal off at 600) loses.
- A13 `preferFavorites:false` ignores favourites.
- A14 Recipes with nothing linked, 0, NaN, Infinity or negative kcal are never picked (also with `includeIncomplete`).
- A15 Incomplete recipes: excluded by default (empty + note), included with the flag (`complete:false`, "incomplete" note); complete picks have `complete:true` and no such note.
- A16 No eligible recipes (empty map, junk entries, null/odd state): empty proposal, note, no throw.
- A17 Determinism: same state+opts+seed deep-equal; omitted seed = seed 1; across seeds 1..30 at least two different proposals on 8 equal candidates; variety does not cost fit or break the repeat rule; no `Math.random`.
- A18 `why` rules (D-why) for every pick.
- A19 Pure: a deep-frozen state does not throw and is unchanged.
- A20 Hostile opts (goalK, slots, seed, noRepeatDays, dates types, non-object opts, inherited opts) never throw and fall back to defaults.
- A21 Invalid dates ignored; duplicates proposed once.
- A22 Hostile recipe data (servings 1e308, 0, negative, NaN, Infinity, strings; kcal 1e308/1e-300; huge goal): every servings is finite, in [0.5, 4], a multiple of 0.5.
- A23 31 days x 4 slots x 60 recipes in < 2 s, every slot filled.
- A24 Layering of `autoplan.js` (import specifiers, no DOM/storage/network globals).
- A25 `applyProposal` adds recipe items (shape of `recipeItem`), ids from `idGen` in order, day `updatedAt = now`, returns the count, proposal untouched.
- A26 Round trip propose -> apply; a second apply adds nothing and changes nothing (not even a timestamp).
- A27 Never overwrites a slot that became non-empty; skipped-only days get no new stamp or record.
- A28 Deleted recipes, inherited keys (`toString`, `constructor`, `__proto__`), bad dates and bad slots are ignored.
- A29 Malformed proposals/state/idGen return 0 without throwing and without creating plan records.
- A30 Other planned days and slots are intact after apply.
- U1 `plan-view.js` imports `proposePlan` and `applyProposal` from `../domain/autoplan.js`.
- U2 A real `<button>` with text "Auto-fill week"; no `role="button"`.
- U3 Preview dialog has Accept, Reroll, Cancel as `<button>`s.
- U4 `why` goes through `esc()`.
- U5 Accept uses `applyProposal` then `save()`; a `seed` exists; slot toggles are checkbox/`aria-pressed`; `proposePlan` is called.
- U6 No direct `state.plan[...] =` assignment after the `proposePlan` call site (crude proxy for "nothing saved before Accept").

## Edge cases and hostile input covered
Empty/one recipe, all favourites, goal exceeded, month crossing, partial plans, duplicate/bad/unsorted dates, 31 dates, prototype-key recipe ids and slot names, NaN/Infinity/huge/negative numbers, wrong types everywhere, frozen state, inherited opts. Recipe names are never put into `why`; escaping of names in the dialog is a manual check.

## Cannot be tested automatically (manual checklist)
- [ ] (button seen and opened by click; keyboard Enter/Space not tried) Week view shows an "Auto-fill week" button; keyboard focus + Enter/Space opens the preview.
- [x] Preview lists every proposed day and slot with recipe name, servings, kcal and the why text; Lunch and Dinner toggles are on by default, Breakfast/Snacks off; toggling regenerates.
- [x] Nothing is saved until Accept: close the app/Cancel and reload, plan unchanged.
- [x] Accept adds items, the week view re-renders, state survives reload; Accept twice (or Accept after planning a slot by hand) never overwrites.
- [x] Reroll gives a different proposal (with enough recipes) and Cancel closes without changes.
- [x] A recipe named `<img src=x onerror=alert(1)>` shows as text in the preview.
- [ ] (UI never offers incomplete recipes; n/a) Incomplete recipes are not offered by default; if a toggle exists for them the pick is flagged.
- [x] No recipes / all slots full: the dialog says so instead of showing an empty list.
- [ ] (not tried; needs a real phone) After update the phone picks up the new `CACHE` (reload twice); works offline; sync of the new plan days to a second device.

*Ticked items checked 2026-11-10 in the desktop built-in browser with a seeded 4-recipe library (keyboard use, the `<img onerror>` name and a second device were not tried; the escaped recipe name `<b>` was checked).*

## How weak the UI tests are
U1-U6 are regexes over source text: they show markup and calls exist, not that the dialog opens, that Reroll changes the seed, that Cancel discards, or that save/re-render happen. U6 passes today (vacuous before implementation: there is no `proposePlan` in the file) and only becomes meaningful once the feature exists. Wording regexes may need loosening for reasonable different markup (say so in the PR).

## Open questions
1. With `includeIncomplete: true`, should complete recipes be preferred over incomplete ones when both fit (VISION 4.2 says "prefer complete")? Not specified in the plan; not tested (A15 only tests an incomplete-only and a complete-only library).
2. Should later slots of a day adapt to what earlier slots actually picked (remaining-budget approach)? This spec says no (D-target); changing it would alter A4.
3. Relaxation picks the best fit among all eligible recipes, not the "least recently used"; a smarter relaxation is out of scope.
4. The 10% band uses `diff <= best + 0.10 x target` inclusive; the exact boundary is not tested (floating point).
5. `applyProposal` does not clamp absurd but finite servings (e.g. 1e9) from a hand-built proposal; not tested.
6. Whether the dialog should also offer Breakfast/Snacks and a month range is a UI choice; only the Lunch+Dinner default is specified.

## Shipping checklist (implementer)
`sw.js`: add `js/domain/autoplan.js` to `SHELL` and bump `CACHE`; docs: DECISIONS.md (rule-based, seeded, bands), ARCHITECTURE.md, ROADMAP/VISION status.
