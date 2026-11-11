# Spec: open the recipe from a planned meal (read-only popup)

## Purpose
Owner: "I want to pop up the recipe when I click the name of it for the meal." Tapping a planned recipe's name on the Plan page opens a read-only view of that recipe, scaled to the planned servings, in the shared bottom-sheet dialog, with an Edit button that opens the existing editor and a Close button.

## Contract

### Domain: `js/domain/recipes.js` (pure, no DOM)
`export function recipeSummary(recipe, plannedServings, measures)` returns a fresh object with exactly these 13 keys:

| key | type | value |
|---|---|---|
| `name` | string | recipe name, `''` if not a string; verbatim (not escaped) |
| `servings` | number | the recipe's yield as stored |
| `planned` | number | `plannedServings` if a finite number > 0, else the recipe's yield if > 0, else 1 |
| `factor` | number | `planned / yield`; 1 when the yield is not > 0 |
| `perServing` | `{k,p,c,f}` | from `recipeNutrition(recipe, measures).perServing` |
| `total` | `{k,p,c,f}` | `perServing x planned`, not rounded. **Key name chosen by the designer**: the plan only said "planned total {k,p,c,f}" (open question 1) |
| `source` | `'foods'|'stated'|'none'` | from `recipeNutrition` |
| `estimated` | boolean | from `recipeNutrition` |
| `ingredients` | string[] | `scaleIngredientText(ingredient, factor)` for each ingredient in order, empty strings dropped |
| `steps` | string[] | the non-empty string steps, in order |
| `tags` | string[] | the string tags |
| `time` | number or null | `totalTime` if a finite number > 0, else null |
| `link` | string | the recipe `source` ONLY if a plain http(s) URL without credentials, at most 500 characters, else `''` |

Never throws (null, `{}`, strings in arrays, NaN yields, non-array fields), never mutates (deep-frozen input works), returns new objects and arrays on every call. It does not escape: the view does.

### UI
- `js/ui/plan-view.js`: in `itemHtml`, a RECIPE item's name is `<button type="button" class="pl-nm link" data-open aria-label="Open recipe ${esc(name)}">${esc(name)}</button>`; food items keep `<div class="pl-nm">`. The `onClick` handler resolves `t.closest('[data-open]')` to the item (via its row's `data-id`) and calls `openRecipeView(it.recipeId, it.servings)`; a deleted recipe shows the toast "That recipe was deleted" (in the handler or in the view). Imports `openRecipeView` from `./recipe-view.js`.
- `css/components.css`: a rule for `.pl-nm.link` (or `button.pl-nm`): looks like a link (underline or accent colour), no button background or border.
- `js/ui/recipe-view.js` (new): `export function openRecipeView(recipeId, servings)`; imports only `../core/*`, `../domain/*` and `./recipe-editor.js`. Uses `head(title, false)`, `dialog()`/`showModal()`, `recipeSummary`. Shows: title = recipe name; a line "N servings planned . X kcal" with the nutrition source label ("from linked foods", "from the page (estimate)", or none) and per-serving kcal and macros; the scaled ingredient lines; the steps as an ordered list; tags; time; the source as `<a href target="_blank" rel="noopener noreferrer">` only when `link` is non-empty; buttons Edit and Close. Everything from the recipe goes through `esc()`. Edit closes the view and calls `openRecipeEditor(recipe)`; the plan already re-renders on `recipes:changed` after a save.
- `sw.js`: `js/ui/recipe-view.js` in `SHELL`, `CACHE` greater than `macro-diary-v31` (the value on main).

## Behaviours
Behavioural (domain), `tests/plan-recipe-popup.test.js`, hand computed (flour 400 g at 100 kcal / 5 p / 20 c / 1 f per 100 g over 4 servings = 100/5/20/1 per serving):
- R1 4-serving recipe planned for 2: factor 0.5, ingredient lines `1 cup flour`, `1/2 onion, chopped`, `1/2 tsp salt`, per serving 100/5/20/1, total 200/10/40/2, source foods, estimated false, steps, tags, time 45, link; exactly the 13 keys.
- R2 Planned = yield or missing: factor 1, `2 cups flour`, total 400/20/80/4.
- R3 Planned 6 of 4: factor 1.5, `3 cups flour`, total 600/30/120/6; planned 1.5: total 150/7.5/30/1.5.
- R4 Planned that is 0, negative, NaN, Infinity, null, undefined, object, array, boolean, text, function falls back to the yield (numbers only; numeric strings are not accepted).
- R5 Yield 0, negative, NaN, text, missing: factor 1; planned = given servings else 1; per serving is the whole recipe (400/20/80/4), total x planned.
- R6 Stated nutrition: source stated, estimated true, per serving = page numbers, total = per serving x planned (300/20/30/10 x 3 = 900/60/90/30), `1 1/2 onion, chopped`.
- R7 Nothing linked or stated: source none, all zeros.
- R8 No steps, tags, time, ingredients (and a bare `{name}` recipe): empty arrays, time null, link `''`.
- R9 Steps keep only non-empty strings in order, tags only strings, junk ingredient entries and lines that come out empty are dropped; non-array fields give empty arrays.
- R10 time: finite > 0 else null.
- R11 Link validation: http/https URLs (query, fragment, port) kept; exactly 500 characters kept, 501 dropped; `javascript:` (any case, leading space), `data:`, `vbscript:`, `file:`, `ftp:`, `blob:`, URLs with credentials (user, user:pw, :pw), protocol-relative, bare hosts, prose, `https://`, markup, empty, whitespace, 5000 characters, non-strings all give `''`.
- R12 Hostile strings (markup, quotes, ampersands) come back verbatim from the helper; a 100,000 character name is kept; non-string names give `''`.
- R13 Malformed recipes/arguments (18 recipe shapes x 5 planned values x 4 `measures` values) never throw; full shape; finite positive planned and factor; finite per-serving numbers.
- R14 No mutation, fresh objects/arrays, mutating a result does not touch the input; own `__proto__` keys do not leak or pollute.
- R15 20,000 ingredients and steps in under 2 s.

Static, weak (read source text), same file:
- V1 `itemHtml` has `button type="button" class="pl-nm link" data-open` with `aria-label="Open recipe ${esc(...)}"` and `${esc(name)}` content; the food item keeps `<div class="pl-nm">`; no `role="button"`.
- V2 `plan-view.js` imports `openRecipeView` from `./recipe-view.js`; the click handler uses `closest('[data-open]')` and calls `openRecipeView(` with a recipe id and servings.
- V3 The toast "That recipe was deleted" is in the open handler or in `recipe-view.js`.
- V4 CSS rule for `.pl-nm.link` with underline or colour and no background.
- V5 `recipe-view.js` exists, exports `openRecipeView(recipeId, servings)`, imports only core/domain/`./recipe-editor.js`, uses `recipeSummary`, `dialog()`, `head(`, `showModal(`, no network or storage.
- V6 `esc(` used at least 5 times; after removing `esc(...)` and `rd(...)` calls no `${...}` reads `.name/.link/.source/.description` and no bare variable is interpolated.
- V7 Every `<a>` has `target="_blank"`, `rel="noopener noreferrer"` and an `href` built from `esc(...link...)`; every `href` is built from `link`; the anchor is guarded by `link` being non-empty; no `javascript:` in the file.
- V8 Real `<button>` Edit and Close; the view is closed before `openRecipeEditor(` is called; no `role="button"`.
- V9 The view mentions serving, kcal, planned, "from linked foods", "from the page (estimate)" and an `<ol>`.
- V10 `sw.js` SHELL contains `js/ui/recipe-view.js`; CACHE number greater than 31.

## Edge cases and hostile input
- Recipe deleted after planning: the toast, no dialog, no error (V3 only checks the text exists).
- Recipe with no ingredients, steps, tags, time, source: the view shows only what exists (R8; the layout is manual).
- Imported or synced recipe text with HTML, quotes, `<script>`: escaped in the view (V6, weak) and in `aria-label` (V1, weak: `esc` must escape quotes, it does).
- `source` such as `javascript:...`, `data:...`, with credentials, or 5000 characters: never an `href` (R11, V7); whether the source text is shown as plain text is open question 4.
- Huge planned servings (1e300): no throw (R13); display not checked.
- Planned servings 0 or garbage in a saved plan: view falls back to the recipe's yield (R4).
- Keyboard: the name is a real `<button>`, focusable, activated by Enter/Space (manual).
- Prototype keys in imported recipes (R14).

## Changes to earlier tests
None expected. Checked: `tests/plan-month-ui.test.js` and `tests/autofill-week-ui.test.js` read `plan-view.js` (they look for month grid buttons, the Auto-fill buttons, `esc(` around `why`, `role="button"`); the new button adds no `role="button"` and no raw `why`. `tests/sw.test.js` requires every `js/` file in `SHELL`, which the new module needs anyway (it passes today and must keep passing once the new file exists and is listed). If any earlier test breaks, explain it in the PR.

## What cannot be tested automatically (manual checklist)
- [ ] Plan: a planned recipe's name looks like a link (underline or accent colour), food items do not.
- [ ] Tab to the name with the keyboard, press Enter and Space: the view opens; Esc closes it.
- [ ] The view shows the recipe name, "N servings planned . X kcal", the source label, per-serving kcal and P/C/F, and ingredients scaled to the planned servings (a 4-serving recipe planned for 2 shows half the amounts).
- [ ] Change the planned servings in the plan, reopen: amounts follow.
- [ ] Steps are numbered; tags and time show only when present; a recipe without steps shows no empty heading.
- [ ] A recipe with an http(s) source shows a link that opens in a new tab; one with a `javascript:` or non-URL source shows no link.
- [ ] Recipe with stated nutrition shows "from the page (estimate)".
- [ ] Edit closes the view and opens the editor for the same recipe; saving returns to the Plan and the name/kcal update; Close just closes.
- [ ] Delete the recipe, then tap its name in an existing plan: "That recipe was deleted".
- [ ] A recipe with `<b>x</b>` in the name, a step and an ingredient shows the characters literally.
- [ ] 375px wide phone: the name button wraps long names, tap target comfortable, dialog scrolls.
- [ ] After deploy an installed phone gets the new module (CACHE bump).

## Honest limits
R1..R15 are real behaviour tests of the helper. V1..V10 read source text only: they prove markup, imports and calls exist, not that the popup opens, looks right, escapes at runtime or that Edit works; the escaping check (V6) is crude (balanced `esc(` removal, no string-literal awareness) and may fail an unusual but correct implementation for the wrong reason, in which case say so in the PR rather than weaken it silently. The CSS test checks that a rule exists, not how it looks. V3 accepts the toast in either file because the plan did not say which.

## Open questions
1. Key name for the planned total: the plan lists "planned total {k,p,c,f}" without a name; tests use `total`.
2. Numeric-string planned servings (`'2'`): untested (R4 asserts only that non-numbers fall back; `'abc'` is included, `'2'` is not).
3. Whitespace-only steps or tags, `totalTime` of 0 or negative: untested except that NaN/Infinity/text give null.
4. Whether `source` text that is not a valid link is shown as plain text, or not at all: untested.
5. Case and whitespace of the scheme (`HTTPS://...`, ` https://...`): only a leading-space `javascript:` is tested; leading/trailing spaces on a valid URL are untested.
6. Inherited (non-own) properties on a recipe: untested.
7. Exact wording of the nutrition line and of the label for source `none`: V9 pins only "from linked foods" and "from the page (estimate)".
8. Does `openRecipeView` itself or the click handler show the deleted-recipe toast? Either is accepted (V3).
9. Edit passes the stored recipe object to `openRecipeEditor`, which deep-copies it; not tested.
