# Spec: suggest food matches for a recipe's ingredients

## Purpose
After a recipe is imported its ingredients are text only; linking each to a food (so calories can be computed) is slow, one picker at a time. A per-recipe "Suggest matches" button looks up a likely food for every unlinked ingredient and shows it as a SUGGESTION the user confirms with one tap; nothing is ever linked without a tap, because a wrong silent link would give wrong calories.

Owner design (confirmed 2026-11-11): button in the recipe editor (not automatic on import); one tap per ingredient or "Accept all likely" (only confident ones); the user can always change a suggestion (existing Link food picker) or ignore it.

## Contract

### Domain: `js/domain/food-match.js` (pure)
Imports only `../core/format.js` and other `js/domain/` files. No DOM, network, clock, random. Never throws (null, non-objects, wrong types, hostile text). Reads OWN properties only (an inherited `name` or `food` is not seen). Returns fresh values; never mutates input.

- `searchQuery(ingredient) -> string`
- `scoreMatch(ingredient, food) -> { score: number, reasons: string[] }`
- `pickSuggestion(ingredient, candidates) -> { food, confidence: 'likely'|'check', score } | null`
- `shouldSuggest(ingredient) -> boolean`
- `suggestionFood(food) -> food object | null`

### Service: `js/services/food-suggest.js` (no DOM; everything injected)
`suggestMatches(ingredients, { search, loadPortions, delayMs = 250, sleep, isCancelled, onProgress }) -> Promise<{ suggestions, skipped, errors, stoppedEarly, reason }>`
- `search(query) -> Promise<{ results, errors }>` (the shape `searchAll` returns)
- `loadPortions(food) -> Promise` (mutates `food.portions`)
- `sleep(ms) -> Promise`, `isCancelled() -> boolean`, `onProgress({ done, total, current })`
- Result: `suggestions` is `{ [ingredientId]: { food, confidence, score } }`; `skipped` number; `errors` string[]; `stoppedEarly` boolean; `reason` string (`''`, `'cancelled'`, `'rate-limit'`, or text about the 60 cap).

### UI (`js/ui/recipe-editor.js`, `css/components.css`, `sw.js`)
Described in behaviours U1..U12. Class and id names fixed by this spec: `#reSuggest`, `#reAcceptAll`, `[data-accept]`, `[data-dismiss]`, `.sug` (suggestion text span), `.sug-check` (added for `check` confidence), `.sug-btn` (the two small buttons).

## Scoring definition (constants chosen by the test designer; the implementation must use them)
Tokens: lowercase, split on any run of non-letters (`/[^a-z]+/`), empty tokens dropped, duplicates collapsed (a set). Plural folding is applied to every token of length >= 4: `...ies` -> `...y`; else `...es` -> drop `es` when the character before is `s`, `x`, `z`, `o`, or the pair is `ch`/`sh`; else a trailing `s` (not `ss`) is dropped. So onions->onion, tomatoes->tomato, olives->olive, berries->berry, breasts->breast, broilers->broiler, eggs->egg. Tokens shorter than 4 are not folded (oil, or, raw).

Let `I` = tokens of `searchQuery(ingredient)`; `F` = tokens of `food.name`. A food brand word is a folded token of `food.brand` with length >= 3. If any brand word of the food appears in `I`, those brand-word tokens are removed from `I` (they match the brand, not the name) and the brand penalty is not applied.
- `m` = |I ∩ F| (after brand-word removal); `coverage` = m / |I|; `extra` = |F| - m.
- If |I| = 0, |F| = 0, or m = 0: score 0 and reasons includes a non-empty explanation.
- score = 0.8 x coverage
  + 0.10 if I and F are the same token set (exact)
  + 0.10 if food is generic (`source === 'USDA'` and brand empty after trim)
  - min(0.12, 0.02 x extra)
  - min(0.70, 0.50 x number of FORM words in F that are not in I)
  - 0.20 if the food is branded (non-empty brand) or `source === 'OFF'`, unless a brand word of the food appears in the ingredient
  then clamped to [0, 1].
- FORM words (folded): powder, juice, dried, canned, frozen, cooked, flour, sauce, soup, mix, flavored, breaded, candy, cereal, bar, drink.
- `reasons`: short strings, one per rule that applied (wording free; array of strings).

Hand-computed (tolerance 1e-9):
| ingredient | food | arithmetic | score |
|---|---|---|---|
| onion | Onions, raw (USDA) | 0.8 + 0.10 generic - 0.02 (1 extra: raw) | 0.88 |
| onion | Onion (USDA) | 0.8 + 0.1 exact + 0.1 generic = 1.0 | 1.0 |
| onion | Onion powder | 0.8 + 0.1 - 0.02 - 0.5 (powder) | 0.38 |
| onion | Onion rings, breaded, frozen | 0.8 + 0.1 - 0.06 (3 extra) - 0.70 (breaded, frozen = 1.0, capped 0.7) | 0.14 |
| olive oil | Oil, olive, salad or cooking | 0.8 + 0.1 - 0.06 (extra: salad, or, cooking) | 0.84 |
| chicken breasts | Chicken, broilers or fryers, breast, meat only, raw | 0.8 + 0.1 - 0.12 (6 extra = 0.12, at the cap) | 0.78 |
| chicken breasts | Chicken breast nuggets, brand "Acme Foods", USDA | 0.8 - 0.02 (nugget) - 0.20 (brand) | 0.58 |
| chicken breasts | Chicken breast nuggets, OFF, no brand | same as above | 0.58 |
| acme chicken breast | Chicken breast, brand "Acme", USDA | brand word acme removed from I: coverage 1 -> 0.8 + 0.1 exact; no generic bonus (branded), no brand penalty | 0.90 |
| onion | Onions, raw, brand "Acme" | 0.8 - 0.02 - 0.20 | 0.58 |

### `searchQuery` rules
Applied in this order to `ingredient.name` (own property, must be a string, else `''`): strip HTML-like tags (`<...>`), remove parenthesised text, lowercase, collapse whitespace, trim; remove LEADING filler words repeatedly: fresh, fresh-ground, freshly, large, medium, small, extra, boneless, skinless, chopped, minced, diced, sliced, optional, and `ground` only when another word remains after it; remove any stray `<` `>`; cap at 80 characters; trim again. Only leading fillers go (`garlic minced` is unchanged). `''` when nothing usable.

### `pickSuggestion` rules
Candidates without a usable `per100.k` (own `per100` object whose own `k` is a finite number >= 0 of type number) are skipped and do not count as runner-up. Best by score, ties to the earlier candidate. `likely` when best >= 0.75 and (it is the only usable candidate or it beats the runner-up's score by >= 0.15); `check` when best >= 0.45 and not likely; `null` below 0.45, with no usable candidate, or when `candidates` is not an array.

### `suggestionFood` rules
Returns `null` unless the input is a plain object with a non-empty string `name` and a plain-object `per100` (same as `sanitizeFood` in `js/core/schema.js`). Otherwise a FRESH object with exactly: `name` (200 chars max), `brand` (200, `''` when absent), `source` (40, `''`), `per100 {k,p,c,f}` (numbers, non-finite or negative become 0), `servingG` (number, 0 when absent/invalid), `servingLabel` (100, `''`); plus `fdcId` only when it is a number or string; plus `portions` only when it is an array: at most 30 entries `{label (100 chars), g}` with `g > 0`. No other key is copied (no `barcode`, `id`, `__proto__`, ...).

## Behaviours (the reviewer ticks these off)
Domain, `searchQuery`
1. `searchQuery` follows the hand-computed table (filler words, parentheses, tags, case, whitespace, 80-char cap, `''` for non-usable or non-object input).
2. `searchQuery` keeps `ground` unless another word remains, and removes only LEADING fillers.

Domain, `scoreMatch`
3. Scores match the hand-computed table above (onion vs Onions raw 0.88; exact 1.0; powder 0.38; rings 0.14; olive oil 0.84; chicken breast 0.78 and nuggets 0.58).
4. Plural folding: tomatoes/tomato, berries/berry, onions/onion score as the same word; score is always within [0, 1] and `reasons` is an array of strings.
5. Generic beats branded and OFF; a brand word in the ingredient text lifts the penalty (0.90 case); no token overlap scores 0.
6. `scoreMatch` is deterministic and never throws on hostile input (null, wrong types, huge strings, HTML).

Domain, `pickSuggestion`
7. A lone strong candidate is `likely`; a strong candidate that beats the runner-up by >= 0.15 is `likely`.
8. Two equally strong candidates (a tie or a near-duplicate) give the earlier one with `check`.
9. A candidate between 0.45 and 0.75 is `check`; below 0.45 (powder only) or no candidates is `null`.
10. Candidates without a usable `per100.k` are skipped (never chosen, never the runner-up); `k: 0` is usable.
11. Generic chicken (0.78) over branded nuggets (0.58) is `likely` (beats by 0.20); nuggets alone are `check`.
12. `pickSuggestion` never throws and never mutates (deep-frozen input).

Domain, `shouldSuggest`, `suggestionFood`
13. `shouldSuggest` is true for an unlinked ingredient with a usable name; false when linked, when the name is empty or only fillers, and for ignorable lines (salt, water, black pepper, "to taste", "optional", pinch/dash); false for non-objects and inherited-only properties.
14. `suggestionFood` copies only the whitelisted fields, returns a fresh object (and fresh `per100`/`portions`), caps string lengths, drops other keys, returns `null` for invalid input, and does not mutate or throw.

Service, `suggestMatches`
15. Ingredients are processed strictly sequentially, in order; searches and portion loads never overlap; each search receives `searchQuery(ingredient)`.
16. Only `shouldSuggest` ingredients are looked up; the rest (including null items) are counted in `skipped`.
17. A `likely`/`check` pick appears as `suggestions[id] = { food, confidence, score }` (food is a `suggestionFood` copy, not the search result object); no pick means no key.
18. `loadPortions(food)` is called once for a pick whose ingredient unit is not g/kg/oz/lb; never for weight units or when there is no pick; its portions end up on the suggested food; a rejecting or throwing `loadPortions` keeps the suggestion.
19. `sleep(delayMs)` is called between looked-up ingredients, not after the last, default 250, custom `delayMs` honoured.
20. `onProgress({done, total, current})` is called after each looked-up ingredient; `total` is the number of ingredients that will be looked up (after the cap); `done` counts 1..total; `current` is the ingredient id.
21. Cancellation: `isCancelled()` is checked before each ingredient; once true no further search happens, `stoppedEarly` is true, `reason` is `'cancelled'`, and earlier suggestions are kept.
22. A rate limit (rejection or `errors` with no results matching `/rate limit|429|too many/i`) stops the run (`stoppedEarly` true, `reason` `'rate-limit'`), keeps earlier suggestions, and does not search later ingredients; the message is also in `errors`.
23. Any other search failure (rejected promise, thrown synchronously, or `errors` with no results) adds ONE short message to `errors` (deduplicated, each <= 200 chars, no whole page text) and the run continues; `stoppedEarly` false, `reason` `''`.
24. More than 60 eligible ingredients: only the first 60 are looked up and `reason` or `errors` contains "only the first 60" (any case).
25. Ingredient objects are never mutated (deep-frozen input works); the result has exactly the keys `errors`, `reason`, `skipped`, `stoppedEarly`, `suggestions`.
26. Hostile input never throws: non-array `ingredients`, null items, missing options, ids like `__proto__`, names like `<img src=x onerror=alert(1)>` or 100,000 characters (query <= 80 chars), search results without `per100`, `undefined` results.

UI (WEAK static source-text checks; see the limits below)
U1. `js/ui/recipe-editor.js` has `<button ... id="reSuggest" type="button">` (either attribute order) with the text `Suggest matches`.
U2. The button is conditional on `shouldSuggest` and on `useUSDA` / `useOFF` being enabled.
U3. It imports `suggestMatches` from `../services/food-suggest.js` and `shouldSuggest`, `suggestionFood` from `../domain/food-match.js`, and wires `searchAll` and `loadPortions` (from services).
U4. Progress text `Looking up` with `aria-live="polite"`, a Cancel button, and an `isCancelled` callback.
U5. The info line shows `Suggested:` with the food name through `esc()`, the confidence, and Accept / Dismiss buttons `data-accept` / `data-dismiss` with class `sug-btn`; `check` suggestions get class `sug-check`.
U6. Accept reuses `resolveGrams` (as the picker does) and `suggestionFood`; `#reAcceptAll` exists and filters on `'likely'`.
U7. The rate-limit outcome mentions the user's own USDA key and Settings.
U8. Suggestions live in a module variable (not written onto the recipe draft and not saved).
U9. Layering: the two new modules import only allowed layers and use no `document`, `fetch`, `localStorage`, `Date.now`, `Math.random`.
U10. Earlier compact-row tests must still pass unchanged: the buttons are built by a separate helper (NOT inside `ingInfo`, whose source may not contain `<button`) and styled with `.sug-btn` / `.sug-check` selectors (NOT a `.ing-info button` selector, which the compact-ingredients tests forbid).
U11. CSS: `.sug-btn` has `min-height:32px`; `.sug-check` has a rule distinct from `.sug`; the `.ing-info` rule (13px, `overflow-wrap:anywhere`) is unchanged.
U12. `sw.js`: SHELL lists `js/domain/food-match.js` and `js/services/food-suggest.js`; `CACHE` is greater than v35 (v35 is on main).

## Edge cases and hostile input
- Ingredient/candidate/food values: `null`, `undefined`, numbers, arrays, `{}`; `name` as number or object; empty and whitespace-only; 100,000-character names; `<img src=x onerror=alert(1)>`; `__proto__` and `constructor` as names, ids and JSON-parsed own keys; foods with `per100` null or `k: NaN`; inherited properties.
- Imported/synced data reaches here (names, brands, food names come from files and databases): all outputs are plain data; escaping is the UI's job (`esc()`), and the UI test checks `esc(` is used for the suggestion text.
- Service: sync throw from `search`, rejection with a non-Error (`undefined`, string), 5,000-character error text, many ingredients, an ingredient whose `id` is `__proto__`.
- Prototype pollution: `suggestions` must stay a normal key/value map and `Object.prototype` must not gain keys.

## What cannot be tested automatically
UI behaviour (button visibility, tapping, progress text, layout, escaping at runtime), real USDA/OFF responses and the shared-key rate limit, real timing of the delay, and how good the matches are on real recipes. Static source-text tests only prove strings, imports and CSS rules exist.

Manual checklist:
1. Import a real recipe page; open the draft. Confirm "Suggest matches" shows (a database is enabled). Turn both databases off in Settings: the button is hidden.
2. Tap it: "Looking up 3 of 12..." updates; nothing is linked while it runs; the link icons stay grey.
3. Each unlinked ingredient shows ` · Suggested: <food> (likely|check)` with Accept and Dismiss; the row stays one muted 13px line and nothing overflows on a 360px-wide phone.
4. Accept one: it links with grams filled where possible, the suggestion disappears, the summary updates.
5. Dismiss one: it disappears; nothing linked.
6. Tap the link icon on a suggested row: the picker opens and the suggestion is dropped.
7. "Accept all likely": links exactly the likely ones, shows how many; every `check` suggestion is still unlinked and still shown.
8. Cancel mid-run: stops; suggestions found so far stay.
9. Use the shared demo key until a rate-limit: the run stops, earlier suggestions stay, the message tells you to add your own USDA key in Settings.
10. Turn the network off: a short muted error, no crash, nothing linked.
11. Close the editor without saving, reopen: suggestions are gone; after Save nothing about suggestions is stored (export a backup and search it).
12. Switch to another recipe: old suggestions do not appear.
13. A recipe with only salt/water/"to taste" lines: the button is hidden.

## Honest limits
Matching is a text heuristic and will sometimes be wrong (that is why every link needs a tap, and why `check` suggestions are never bulk-accepted). Coverage depends on what USDA and Open Food Facts return. Each looked-up ingredient costs a search request, plus a portions request for count/volume units; with the shared demo key this can hit the rate limit on a long recipe. English names only. Suggestions are not saved or synced.

## Open questions
1. `ground` removal: by the stated rule `ground beef` becomes `beef`; this loses information (USDA has `Beef, ground, raw`). Not tested; owner may want `ground` kept.
2. A duplicated food in the results (same name in two databases) makes the best candidate only `check` (tie, margin 0). Accepted as safe; not changed.
3. Total for progress and the 60 cap: spec says the first 60 ELIGIBLE ingredients; tests only use all-eligible lists, so first-60-items vs first-60-eligible is not pinned. `skipped` for items past the cap and `stoppedEarly` when the cap hits are not pinned.
4. A search that returns BOTH results and an `errors` entry (one database down): not treated as a failure here; whether to report it is not pinned.
5. Ingredients with a missing or non-string `id` cannot be keyed: behaviour (skip vs count) is not pinned except that it never throws.
6. Numeric strings for `per100.k` (`'52'`) are treated as unusable by this spec; `ingredientStatus` accepts them. Not tested.
7. Whether `isCancelled` is polled for skipped items too is not pinned (tests flip the flag during a search).
8. Compact-ingredients tests U8/U10 forbid a `.ing-info button` selector and `<button` in `ingInfo`; U10 above works around that. If the owner prefers buttons in `ingInfo`, those two earlier tests must be changed deliberately and explained in the PR.
