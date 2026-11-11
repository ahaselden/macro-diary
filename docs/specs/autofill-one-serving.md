# Spec: auto-fill proposes one serving per recipe (and manual add starts at 1 serving)

## Purpose
Owner decision of 2026-11-11, which changes D27: "Keep it to the serving the recipe suggests. The user can adjust it later." Auto-fill stops scaling servings to the calories left in the day: every proposed item is exactly 1 serving, and the recipe is still chosen by how well ONE serving fits the meal's calorie target. The same decision applies to adding a recipe to a meal by hand: the servings box starts at 1, not at the recipe's full yield.

## Contract
No new exports. Layers as before.

- `js/domain/autoplan.js` `proposePlan(state, opts)` returns `{ days, notes }` as before; every pick `{ recipeId, servings, why, complete }` now has `servings === 1` (a number, exactly 1). `applyProposal(state, proposal, now, idGen)` is unchanged.
- Slot target is computed exactly as before: `budget = goalK - kcal already planned that day`; target = `budget x slotWeight / sum of weights of the slots being filled` (Breakfast .25, Lunch .30, Dinner .35, Snacks .10).
- Recipe choice: distance `|kcalPerServing - target|` (one serving, no scaling); smallest distance wins; then the favourite rule (a favourite whose distance is within `best + 10% of target` wins, the closest favourite among favourites); then the existing tie-break (seeded mulberry32 choice among exact ties; recipes are visited in id order). No-repeat window (default 3 calendar days, existing plan included, relaxed with a "repeat" note when nothing else is eligible), `includeIncomplete`, stated-nutrition recipes (`source 'stated'` counts as complete), never overwriting a filled slot: all unchanged.
- Goal already used up (`budget <= 0`): the lowest-kcal eligible recipe (fixed tie-break, lowest id), at 1 serving.
- `why` (plain text, no recipe name, no markup): `About N kcal for 1 serving, close to the T kcal target for this meal` plus `; a favourite` when the pick is a favourite, ending with a full stop (N = rounded kcal of one serving, T = rounded slot target). Used-up case: a text that says the day's goal is already used up and gives the kcal of the 1 serving, e.g. `About N kcal for 1 serving; the day's kcal goal is already used up.`. It must not talk about fitting servings, portions or "smallest portion".
- Notes: the used-up note must still mention the goal/budget but no longer say "smallest portion is proposed" (open question 2).
- `js/ui/plan-view.js` (UI, weak tests only): the auto-fill dialog intro no longer says it uses recipes "to fit your calorie goal"; it says one serving per meal and keeps "Nothing changes until you press Accept". The recipe picker's `qtyStep(r.name, 'How many servings?', 'Servings', <default>, ...)` default is the literal `1` and no longer reads `r.servings`; the food branch (`Number(f.servingG) > 0 ? Number(f.servingG) : 100`) is unchanged.

## Behaviours
Group A: auto-fill (behavioural, `tests/autofill-one-serving.test.js`, titles O1..O12).
- O1 `servings === 1` for every pick across several recipe sizes, goals (300..5000), slot sets and favourites on/off.
- O2 Goal `1e300`, `1e-300`, `1`, `0.5` still give 1 serving; with a huge goal the biggest one-serving recipe is the closest to the target.
- O3 Goal used up (budget below zero, and exactly zero): lowest-kcal recipe, 1 serving, a goal/used-up note and `why` (with its kcal), no "smallest portion" wording.
- O4 Recipe choice by one-serving distance (hand computed: Lunch 600 picks the 590 kcal recipe, Dinner 700 picks the 750 kcal recipe over 400; a 450 kcal recipe beats a 100 kcal one that the old rule could scale to 600).
- O5 A stated-nutrition recipe is judged by its stated kcal per serving (280, not the 100 its foods say) and is complete.
- O6 Favourite within 10% wins, outside it does not, both at 1 serving; `why` says "favourite".
- O7 `includeIncomplete`: proposed at 1 serving with `complete:false` and the incomplete note; not proposed without the flag.
- O8 `why` wording (hand computed numbers: About 580 / 690 kcal for 1 serving, 600 / 700 kcal target, "favourite" only for the favourite; no "fit", "servings", "portion", recipe name or markup; kcal is for ONE serving of a 4-serving recipe).
- O9 Determinism: same state+options+seed same proposal, default seed 1, seeds vary exact ties, no repeat within 3 days, no `Math.random` in the source.
- O10 Repeat window counts planned items (the planned amount is irrelevant); relaxed with a "repeat" note when only one recipe exists; still 1 serving.
- O11 Hostile recipe yields (`1e308`, 0, negative, text, NaN, Infinity), hostile goals/seeds/options never throw and never give a servings value other than 1.
- O12 `applyProposal` unchanged: adds `servings` 1 through `plan.js`, never overwrites a filled slot.

Group B: dialog wording (WEAK static, same file, G1, G2).
- G1 The dialog intro does not say "fit ... calorie/kcal/goal" and does say "one serving"; the Accept promise stays.
- G2 The preview row still shows `p.servings` and the `why` text through `esc()`.

Group C: manual add starts at 1 serving (WEAK static, same file, G3, G4).
- G3 In the recipe branch of the picker's click handler the `qtyStep` default is the literal `1` and `r.servings` is not read in that branch.
- G4 The food branch default is unchanged (serving size, else 100 g).

## Edge cases and hostile input
- A recipe with a yield of 0, negative, NaN, text or `1e308`: its `perServing` already uses 1 serving (`recipeNutrition`); the pick is still 1 serving (O11).
- Goal `1e300`: the old rule hit the 4-serving cap; now the target is huge and the biggest one-serving recipe wins, 1 serving (O2).
- Tiny goal / budget just above zero: target tiny, the lowest-kcal recipe is closest, 1 serving (O2). Budget exactly 0: treated as used up (O3).
- Recipe whose one serving is 3000 kcal against a 600 target: still proposed at 1 serving; nothing is scaled down (not separately tested beyond O1/A3).
- Imported or synced recipes with HTML in names: `why` never contains the name (O8); the UI escapes `why` (G2).
- A planned item with servings 5 or 0.5 in the plan: irrelevant to the proposal except through the day's planned kcal (O10).
- Manual add with a recipe that makes 6 servings, 0, negative or no yield: the box starts at 1 in every case (G3, manual).

## Changes to earlier tests
Owner decision, not a regression. Everything not listed is untouched and passes before and after. The implementer must not edit these further.
- `tests/autofill-week.test.js` (header comment added):
  - A2 (servings 2 / 1.5 / 1 for 280 / 400 / 600 kcal at a 600 target): now servings is 1 for any single recipe, plus a hand-computed closest-one-serving choice (280/400/550 -> 550; 450/700 -> 700).
  - A3 (clamped to [0.5, 4]: 100 kcal gave 4, 2000 kcal gave 0.5): now both give 1.
  - A4 second half (Breakfast+Snacks 3500, recipes 1250 / 500 at 2 servings each): replaced by recipes 2400 / 1000 / 1500 (Breakfast target 2500 picks 2400, Snacks target 1000 picks 1000, both 1 serving) so the weights are still exercised; the Lunch+Dinner half only had its title extended (it already asserted 1).
  - A5 second half (default goal 800 gave 2 servings, goalK 1200 gave 3): servings cannot show the goal any more, so it now checks recipe choice (m 400 vs n 1900: goal 800 picks m, goalK 1200 picks n; schema default 2000 would pick n).
  - A6 (budget used up gave 0.5 servings): now 1.
  - A22 (servings within [0.5, 4] and a multiple of 0.5; goal 1e300 gave 4): now exactly 1, goal 1e300 gives 1.
- `tests/page-nutrition.test.js` N20: expected 2 servings for a stated 280 kcal recipe at a 600 kcal goal; now 1 (comment updated). The "stated kcal rather than foods kcal" proof the old servings value gave is kept by new test O5.
- `tests/plan-month.test.js` (M27 to M31) and `tests/plan-month-ui.test.js`, `tests/autofill-week-ui.test.js`: checked, no assertion depends on computed servings (M31 asserts only 300 <= k <= 2500 per day, true for 600 to 630 kcal at 1 serving). Unchanged.
- No existing test asserted the old manual-add default (searched `tests/` for `How many servings` and `qtyStep`: none). No change.
- Not edited by me: `docs/specs/autofill-week.md` still describes D-fit (nearest half-serving) and is superseded by this spec; the PR should add a one-line pointer there and update D27 in `docs/DECISIONS.md`.

## What cannot be tested automatically (manual checklist)
- [ ] Plan > Auto-fill week: every proposed row reads "1 serving" and the grey line reads "About N kcal for 1 serving, close to the T kcal target for this meal".
- [ ] A favourite shows "; a favourite"; Reroll still changes picks when several recipes fit equally well.
- [ ] A day whose goal is already used up still gets a meal at 1 serving, with the goal-used-up text.
- [ ] The dialog intro no longer promises to fit your calorie goal and still says nothing changes until Accept.
- [ ] After Accept, the plan shows 1 serving per meal and the servings box can be changed to e.g. 2.
- [ ] Add a recipe that makes 6 servings by hand (Plan > + Add > recipe): the servings box starts at 1, not 6. Add a food: the grams box still starts at the serving size (or 100).
- [ ] Recipe with 1 serving, with 0 or no yield: the box starts at 1.

## Honest limits
Only the domain behaviours O1..O12 are real behaviour tests. G1..G4 read source text: they prove the wording and the literal `1` exist, not that the dialog or picker works. The exact `why` sentence is pinned in O8 because the owner gave it as the format; wording around it can still vary (open question 1). Tests O6, O9, O10 and G2, G4 already pass before implementation (regression guards for rules that do not change), they prove nothing about the new rule.

## Open questions
1. `why` wording: the owner wrote "something like"; O8 pins `About N kcal for 1 serving` and `T kcal target` (and "favourite"), not the comma, full stop or the used-up sentence beyond "goal", "used" and the kcal.
2. The used-up note in `notes` currently says the smallest portion is proposed; the test only requires it to mention goal/budget and not say "smallest portion". The final text is the implementer's.
3. When the goal is used up, should the pick be the lowest-kcal recipe (as before) or still the one closest to a zero target (the same thing)? Treated as the same; no test distinguishes them.
4. The preview row and the old spec D-fit/D27 text are not updated by tests; docs are the implementer's job.
5. If `state.goals.k` is invalid the goal falls back to 2000 (unchanged, A20).
6. The dialog title and button still say "Auto-fill week" (unchanged, D28).

## Verification log (implementer, Windows, desktop built-in browser)
- 728 tests pass. In the app with a demo recipe: the Auto-fill preview listed 10 picks, each "1 serving" with "About 172 kcal for 1 serving, close to the N kcal target for this meal", and the dialog intro now says one serving; adding an 8-serving recipe to Snacks by hand started the servings box at 1.
- Not done: accepting a proposal and then changing amounts by hand, a phone, a household of many recipes (the demo data had one recipe, so repeats were allowed).
- D27 in docs/DECISIONS.md and docs/specs/autofill-week.md carry a pointer to D33.
