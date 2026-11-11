# Spec: start food amounts in servings, not weight

Purpose: when a food is opened in the amount picker, start from the most natural unit (the user's own measure, the product serving, or a countable household portion such as "1 large") instead of always 4 oz / 100 g. Owner report 2026-11-11: eggs open at 4 oz and a protein powder with "1 scoop (37 g)" also opens at 4 oz.

## Contract

| Function | Layer / file | Signature |
|---|---|---|
| `parseServingText(text)` | domain `js/domain/units.js` | `string -> { g:number, label:string } \| null`; pure, never throws |
| `startingUnit(food, units, savedMeasures, weightPref)` | domain `js/domain/units.js` | `-> { key:string, amount:number }`; pure, never throws |
| `servingSummary(food)` | domain `js/domain/food.js` | `-> string`; pure, never throws, does not escape |
| `mapOFF(p)` | services `js/services/off.js` | changed: serving fallback from `serving_size` text |
| amount picker / result rows | ui `js/ui/amount-picker.js`, `js/ui/add-food.js` | wiring only |

`units` is what `unitsFor` returns. `savedMeasures` is the array `[{label,g,updatedAt?}]` the user saved for this food (or undefined). `weightPref` is `'w:g'` or `'w:oz'`.

## Behaviours (tests B-numbers match `tests/serving-amounts.test.js`)

1. B1 `parseServingText` returns grams for: '37 g', '37g', '1 scoop (37 g)', '1 scoop (37g)', '30 g (1 scoop)', '2 tbsp (30g)', '1 bar (60 g)', '100 grams', '1.5 oz (42 g)' (42), '3/4 cup (30 g)' (30), '28.4 g', '5000 g'.
2. B1b `label` is the cleaned text (tags stripped, whitespace collapsed, max 60 chars); a bare weight gives '37 g' / '28.4 g'.
3. B2 With no gram value, oz is converted at 28.3495 ('1 oz' -> 28.3495). A gram value beats oz.
4. B3 Volume-only text (ml, cl, l, litre, cup, tbsp, tsp, fl oz, 'fl. oz') gives null; 'fl oz' must never be read as ounces.
5. B4 Empty, garbage, 'N/A', '0 g', '-5 g', '1e999 g', > 5000 g, a unit with no number -> null.
6. B5 Non-strings (null, numbers, objects, arrays, Symbol, BigInt, objects whose `toString` throws, `Object.create(null)`) and '__proto__' -> null, no throw.
7. B6 HTML tags never reach the label; 100,000-character and pathological inputs return quickly (no catastrophic backtracking) and any result is within bounds.
8. B7 `mapOFF`: a finite `serving_quantity` > 0 (number or numeric string) still wins.
9. B8 `mapOFF`: otherwise servingG is the grams from `serving_size`; servingLabel stays the serving_size text.
10. B9 `mapOFF`: both missing -> servingG 0, servingLabel ''.
11. B10 `mapOFF`: quantity 0, negative, NaN, 'abc', Infinity, '1e999' is ignored: text grams if parseable, else 0.
12. B11 `mapOFF`: unparseable or volume-only serving_size -> servingG 0, label is the text (unchanged behaviour).
13. B12 `mapOFF` other fields unchanged; the existing golden tests in `tests/mappers.test.js` still pass unchanged.
14. B13 `startingUnit`: a user-saved measure present in `units` (key `p:<label>`) beats the serving and household portions; amount 1.
15. B14 Several saved measures: largest `updatedAt` wins; with no `updatedAt`, the last.
16. B15 Else the serving unit `s`, amount 1 (beats household portions).
17. B16 Else the first non-user `p:` portion with a countable label, amount 1.
18. B17 Labels containing a whole word from the volume/weight list (cup(s), tbsp, tsp, tablespoon, teaspoon, fl oz, fluid, ml, milliliter, litre, liter, quart, pint, gallon, oz, ounce, lb, pound, g, gram, kg; case-insensitive) are not countable; 'large', 'medium', 'slice', 'egg, large', 'scoop', 'bag', 'package' are.
19. B18 A `p:` unit that is not in `savedMeasures` is a household portion (rule c applies to it). A user measure is chosen by rule (a) even when its label is a volume word.
20. B19 Otherwise the weight default: 'w:oz' -> amount 4, 'w:g' -> 100.
21. B20 A saved measure whose key is not in `units` falls through; empty/null/odd arguments never throw.
22. B21 Hostile labels (HTML, '__proto__', 'constructor', 100,000 chars) are plain data and work as keys.
23. B22 `servingSummary` -> `${round(k*servingG/100)} kcal per ${label}`: 400 kcal/100 g, 37 g, '1 scoop (37 g)' -> '148 kcal per 1 scoop (37 g)'.
24. B23 Without a label: '<round(g)> g' ('148 kcal per 37 g'); `Math.round` half-up ('3 kcal per 3 g' for 100 kcal, 2.5 g; '167 kcal per 50 g' for 333 kcal).
25. B24 servingG not finite > 0, or food null/undefined/non-object -> ''.
26. B25 Label cleaned, tags stripped, capped at 60 chars; never throws on missing/NaN per100 or hostile label; output is not HTML-escaped.
27. B26 Regression: a food with no serving and no portions starts at 4 oz / 100 g.
28. B27 Integration: `unitsFor` + `startingUnit` give 'p:large' for an egg with portions [cup chopped, large], the user's measure when saved, and `s` for a branded serving.
29. B28 (WEAK, static) `amount-picker.js` uses `startingUnit` (at open and after portions load), has a `touched` flag, and the old inline serving branch is gone.
30. B29 (WEAK, static) `add-food.js` appends `esc(servingSummary(...))`.
31. B30 `sw.js` `CACHE` is above v32.

## Edge cases and hostile input

Empty, whitespace, 100k-character strings, nested parentheses, prototype keys, HTML in OFF/USDA text and in user measure labels, numeric strings, NaN/Infinity/negative quantities, `savedMeasures` that is not an array, `units` entries without keys. All values from search APIs and synced data are untrusted; the UI escapes `servingSummary` output.

## Cannot be tested automatically (manual checklist, desktop browser only)

- [ ] Search 'egg' (USDA key set): opens at weight, and when the household measures arrive and nothing was touched, switches to '1 large' (not 4 oz).
- [ ] Branded product with a serving: opens at 1 serving.
- [ ] Product whose serving text has grams but no `serving_quantity` (OFF): opens at 1 serving.
- [ ] Food with nothing known: still 4 oz / 100 g; use 'Add your own measure'; next time the food opens at that measure, amount 1.
- [ ] Touch the amount (or unit) before portions load: after loading the choice is kept, only the list refreshes.
- [ ] Result rows show 'N kcal per ...' and nothing for foods without a serving; no HTML injection from a product name or serving text.
- [ ] Editing an existing diary entry keeps its own unit.

## Honest limits

- Cannot know a serving for foods whose data has none.
- Household labels vary: the first countable USDA portion is used, which may not be the user's usual one.
- The picker wiring (B28, B29) is only checked by static source-text matching; real behaviour is the manual list. Network APIs are not probed; phones are not covered.

## Open questions

1. Label of a bare gram weight with no space ('37g', '100 grams'): `<g> g` or the cleaned text? Tests only check '37 g' and '28.4 g'.
2. Does `servingSummary` strip tags from the label itself or rely on `parseServingText`/the UI? B25 expects tags stripped ('<b>1 scoop</b>' -> '1 scoop'); the plan says "cleaned".
3. `startingUnit` when `units` lacks the weight key (e.g. empty list): tests expect `{key: weightPref, amount: 4|100}` (today's behaviour). An invalid `weightPref` is untested.
4. `mapOFF`: servingLabel when serving_size is empty but serving_quantity exists stays '' (parser only sees serving_size); the plan's "use the parser's label" clause is therefore unreachable and untested.
5. Plain number text such as '37' (no unit) is expected to be null.
