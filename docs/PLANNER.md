# Recipes, meal plan and shopping lists — how they work and why

The planner turns the diary into a loop: **recipes → weekly plan → shopping list → (cook) → log to diary**. Everything shares the same food data, units logic, storage and sync as the diary; nothing here has a server of its own.

```
Recipes ──(ingredients linked to foods)──▶ nutrition per serving
   │                                              │
   ▼                                              ▼
 Plan (a week of recipe/food items) ──▶ per-day calories vs your goal ──▶ "Log" ──▶ Diary entries
   │
   ▼
 Shopping list (derived from the plan; you only tick things off and add extras)
```
Code map: pure logic in `js/domain/` (`ingredient-parse.js`, `ingredient-tokens.js`, `recipes.js`, `plan.js`, `shopping.js`), screens in `js/ui/` (`recipes-view.js`, `recipe-editor.js`, `plan-view.js`, `shop-view.js`). Data shapes: [ARCHITECTURE.md](ARCHITECTURE.md#data-shape-schema-v4). Why the data is stored the way it is: [D13](DECISIONS.md).

## Recipes

**Ingredients are parsed from text.** You can type or paste ingredient lines ("1 1/2 cups flour, sifted"); `parseIngredient` splits them into quantity (`1.5`), a canonical unit (`cup`), a normalised name (`flour`) and a preparation note (`sifted`). It is a JavaScript port of the *behaviour* of your MealPlannerPC parser (`IngredientParser`, `IngredientNormalization`, `IngredientTokens`), including its vocabulary file `tokens.json` (unit aliases, synonyms, packaging words). Where the C# was ambiguous the JS chose a sensible behaviour and documents it in comments in `ingredient-parse.js`.

**Nutrition comes from linking ingredients to real foods.** Each ingredient can be linked to a food from the same USDA / Open Food Facts search the diary uses (or one of your custom foods). `resolveGrams` then converts "1.5 cup" into grams for *that* food using the diary's units logic (`unitsFor`): weights convert directly; cups/spoons need a density, which only exists when the food has a volume measure in the database (or one you saved); counted items ("2 eggs") use the food's portions ("1 large = 50 g") or serving. If it can't be converted the editor says so and lets you type the grams.

**Incomplete is shown, never hidden.** A recipe's calories are the sum of its *linked and convertible* ingredients. The recipe shows "N of M ingredients linked" and an *incomplete* badge, and lists what's missing, rather than silently counting unknown ingredients as zero. A few ingredients aren't worth linking (water, salt, pepper, "to taste") and are skipped in that count — the list is documented in `recipes.js`.

**Deleting is a tombstone** (like diary entries), so a recipe deleted on one device is removed everywhere; editing it afterwards elsewhere brings it back.

## Meal plan

A plan is a week of days; each day has Breakfast / Lunch / Dinner / Snacks, each holding **items**: a recipe (with servings) or a plain food (with grams). The week view shows each day's planned calories and macros against your goals, and flags days whose numbers are incomplete.

**Log to diary** turns a planned item into a normal diary entry (so totals, export, sharing and sync all just work). A recipe is logged as "N servings" using the recipe's real serving weight when it is known, so the calories are exactly the planned ones. Logging is **idempotent**: the item remembers the diary entry it created (`entryId`), so tapping again does nothing — unless you deleted that diary entry, in which case it can be logged again. A recipe with *no* linked ingredients has no nutrition to log, so the app asks you to link foods first instead of logging a meaningless 0-kcal entry. A partly linked recipe logs what is linked (an underestimate, flagged as incomplete).

**One sync record per planned day** (D13): simple and provably convergent; the trade-off is that two devices editing *different meals of the same day* while offline keep only the newer device's version of that day.

## Shopping list

**The list is derived, not stored.** It is recomputed from the plan and recipes for a date range every time, so it can never go stale when you change the plan. The only saved state is what you *do* to it: ticking items and adding extras (`state.shopping`), which sync like everything else. Ticks are keyed by the range start + ingredient + unit family, so they survive quantity changes but belong to one shopping trip (next week's list starts un-ticked).

**Aggregation is conservative.** The same ingredient from several recipes is summed when units are compatible: weights in grams, volumes in millilitres, counts per unit word. Quantities scale by *planned servings ÷ recipe servings*. Weight and volume of the same ingredient are **not** converted into each other (it needs a density we don't have for arbitrary items) — they appear as separate lines, because a wrong merge in a shopping list is worse than two lines. Amounts are shown in a sensible unit (cups/tbsp/tsp, g/kg or oz/lb according to your weight-unit setting); names are grouped with a naive singulariser ("tomatoes" = "tomato").

**Aisles** come from a keyword table (`aisleOf`) matched on whole words with the more specific aisles checked first ("frozen peas" → Frozen, "garlic powder" → Spices, "eggplant" is not "eggs"). It is a heuristic; anything unrecognised lands in *Other*. Adding words is a one-line change in `shopping.js`.

**Sharing:** copy/share as text (grouped by aisle with `[ ]` boxes) or download CSV (spreadsheet formula injection is neutralised).

## What is not here (yet)

- **Importing a recipe from a URL.** Browsers can't fetch other sites' pages (CORS), so it needs a small serverless proxy; your Python scraper would be ported there. For now: paste ingredient text.
- **Store integrations** (Kroger/Walmart/H-E-B carts) — see [ROADMAP.md](ROADMAP.md), part 4.
- **Per-ingredient pantry tracking** ("I already have flour") beyond ticking items off.
- **Unit conversion between weight and volume without a density**, and metric-only volume display.
- Meal-plan *templates*, drag-and-drop, and a month view.
