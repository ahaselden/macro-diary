# Spec: calories per serving on generic database rows (search-serving-calories)

## Purpose
In Add food > Search, generic USDA foods (Foundation / SR Legacy, e.g. "Bananas, raw") show only "NNN kcal /100g", because USDA's search answer carries no serving, while branded foods already show "100 kcal per 2 Tbsp". The first few database rows now fetch their household portions in the background and show "112 kcal per 1 medium (126 g) · 89 kcal /100g · P1.1 C22.8 F0.3" like branded rows.

Owner decision: lazy fetch of portions for the first few rows. Rate limits (USDA DEMO_KEY) make the caps below part of the contract.

## Contract

| Piece | Layer / file | Shape |
|---|---|---|
| `rowServingSummary(food)` | `js/domain/food.js` (new export, pure) | `string`, plain text (UI escapes). Never throws |
| `enrichWithPortions(foods, opts)` | `js/services/usda.js` (new export) | `opts = { apiKey, limit = 5, concurrency = 2, load = loadPortions, onUpdate, cancelled }` -> `Promise<number>`, never rejects |
| row rendering + wiring | `js/ui/add-food.js` | uses `rowServingSummary` for every row, calls `enrichWithPortions` after database results render |
| amount picker | `js/ui/amount-picker.js` | unchanged: `canLoad` is already false when `food.portions` exists |

No new saved-shape fields, no `SCHEMA_VERSION` change (`food.portions` already exists and is sanitised). No new shipped file, so no `SHELL` change; `sw.js` `CACHE` is bumped because shipped files change.

### rowServingSummary(food)
1. If `servingSummary(food)` is non-empty, return it unchanged (byte for byte).
2. Else take `food.portions` (array of `{label, g}`). Choose the first entry that is usable: `label` a non-empty string after tag-stripping and whitespace collapsing, `g` a finite number > 0, and the label is a count (not cups, spoons, fl oz, ml, oz, lb, g, kg etc.: the same test `startingUnit` uses for "the first household portion that is a count of something", e.g. "medium", "large", "slice", "NLEA serving"). Entries failing this are skipped, not fatal.
3. Return `"<Math.round(per100.k * g / 100)> kcal per <label> (<Math.round(g)> g)"`. Label: tags stripped like `servingSummary`, whitespace collapsed, trimmed, capped at 60 characters.
4. Return `''` when: no `portions`, no usable count-type portion, `per100` missing or `k` not finite, `food` null / array / non-object.

## Behaviours (tick-list; test numbers match)
1. `rowServingSummary` returns exactly `servingSummary(food)` for any food where that is non-empty (a branded food with servingG and label, with or without portions).
2. A food with only `per100` (no servingG, no portions) gives `''`. A food with `portions: []` gives `''`.
3. Generic food with a count portion: `{per100:{k:89}, portions:[{label:'medium', g:118}]}` gives `"105 kcal per medium (118 g)"` (89 * 118 / 100 = 105.02).
4. The first count-type portion is used; earlier cup / tbsp / oz / gram / ml portions are skipped (`[cup, mashed 225 g] [tbsp 14 g] [oz 28 g] [medium 118 g] [large 136 g]` gives the "medium" row).
5. Rounding: calories and grams both use `Math.round` (k=50, g=125 gives 63 kcal; g=126.4 shows "126 g"; g=126.5 shows "127 g").
6. A portion with `g` of 0, negative, NaN, Infinity or a non-number is skipped; the next usable one is used; if none, `''`.
7. Bad `per100` (missing, `k` NaN / Infinity / string "abc" / undefined) gives `''`.
8. A label with markup has the tags stripped (`'<b>large</b>'` shows `large`; result contains no `<` or `>`); a label over 60 characters is cut to 60.
9. A label that is empty or only tags/whitespace is not usable (see open question 1).
10. Hostile / junk input never throws and returns a string: `null`, `undefined`, `[]`, `'x'`, `5`, `portions` that is not an array (object, string, number), `portions` containing `null`/numbers/strings, throwing getters on `per100`, `portions`, `label` or `g`, huge numbers (result never contains `NaN` or `Infinity`), `__proto__` / `constructor` keys.
11. `enrichWithPortions` candidates: only foods with `source === 'USDA'`, a truthy `fdcId`, no `servingG > 0`, and no `portions` property (even `[]` counts as already loaded) are looked up. Branded rows with a serving, OFF rows, custom/recent rows, foods without fdcId and foods that already have portions cause no request.
12. At most `limit` (default 5) candidates are looked up, the first ones in list order. Non-candidates do not use up the limit. `limit: 0` makes no request.
13. At most `concurrency` (default 2) `load` calls are in flight at once, and two do run in parallel (not serial) when there is enough work.
14. `load` is called as `load(food, apiKey)` with the same food object; the portions end up on that same object; `onUpdate(food)` is called exactly once for each food that gained a NON-EMPTY portions list; the promise resolves to that count.
15. Empty result: when `load` leaves the food with `portions: []` or sets nothing at all, the food ends with `portions: []` (so it is not looked up again), `onUpdate` is not called for it.
16. Session cache keyed by `fdcId` (module level): a later call with a different food object of the same fdcId makes no `load` call, the object gains the cached portions, and `onUpdate` fires for it (it gained portions). The same `fdcId` twice in one list costs one request (also when both would start at the same time) and both rows get portions. A second search for the same foods costs no new requests.
17. A failed lookup (`load` rejects, or throws synchronously) leaves that food untouched (no `portions` property), does not call `onUpdate` for it, is not retried in the same call, and does not stop the other foods.
18. Rate limit: when a lookup fails with the error http.js produces for HTTP 429 (message `rate limited – add your own USDA key in Settings`), no further `load` call is started in that call (lookups already in flight may finish). The promise still resolves.
19. `cancelled`: optional function. Once it returns true, no new `load` starts and `onUpdate` is no longer called (even for a lookup that finishes later). With `cancelled` true from the start: zero `load` calls, resolves 0.
20. Never rejects: `foods` null / undefined / not an array / containing null, numbers, strings; `onUpdate` or `cancelled` throwing; `load` throwing or rejecting with non-Error values; missing options. Resolves to a number.
21. UI wiring (source-text, weak): `add-food.js` imports and calls `enrichWithPortions` and `rowServingSummary`; `resHTML` no longer calls `servingSummary` directly; the summary is passed through `esc`; the call is guarded by `state.useUSDA`; a `cancelled` check tied to the current search is passed; `amount-picker.js` still has `canLoad` false when `food.portions` exists and still calls `loadPortions` only under `canLoad`.
22. Security: a portion label `<img src=x onerror=alert(1)>` yields no `<` in `rowServingSummary` output; and after `esc` (the UI path) the string cannot contain `<img`. A label such as `a"onmouseover="x` / `'><script>` after `esc` contains no raw `<`, `"` or `'`.
23. Repeat search for the same food costs no new request (behaviour 16 at UI level; headless C6).

## Edge cases and hostile input
- Empty list, huge list (1000 candidates: still at most 5 requests).
- `fdcId` as number, as string, `0` (falsy: not a candidate), duplicated.
- `portions` as `__proto__`-style or non-array on a candidate: a non-array `portions` property counts as "has portions" only if it is an array; otherwise treat as none (see open question 3). Tests avoid relying on this.
- Labels from USDA may contain `<`, `&`, quotes: `rowServingSummary` returns plain text, the UI escapes it (`esc`).
- Prototype keys in food objects (`__proto__`, `constructor`) never change results.
- Imported or synced data: `food.portions` on saved foods / recents may be junk; `rowServingSummary` must cope (behaviour 10).

## Cannot be tested automatically
- Visual layout of the longer row at 375 px width, scroll position feel, real USDA data, a real DEMO_KEY rate limit, real network timing. UI behaviour is covered by the headless checklist (network stubbed) and the owner list below. The UI node test (behaviour 21) only reads source text; it proves wiring words exist, not that the screen works.

## Headless checklist (browser-tester; all network calls stubbed with invented data)
Common stub data. USDA search (Foundation,SR Legacy) answers two foods: "Banana test, raw" (fdcId 910001, kcal 89 per 100 g, protein 1.1, carbs 22.8, fat 0.3, no serving) and "Apple test, raw" (fdcId 910002, kcal 52, protein 0.3, carbs 13.8, fat 0.2). USDA search (Branded) answers one food "Test Bar" (fdcId 910003, brand "Acme", 400 kcal per 100 g, servingSize 50 g, householdServingFullText "1 bar"). Open Food Facts answers status 0 / no products. USDA food detail 910001: foodPortions `[{amount:1, measureUnit:{name:'cup'}, modifier:'sliced', gramWeight:150}, {amount:1, measureUnit:{name:'undetermined'}, modifier:'medium', gramWeight:118}]`. Detail 910002: `[{amount:1, measureUnit:{name:'undetermined'}, modifier:'large', gramWeight:200}]`. Settings: USDA on, Open Food Facts as in the default, no saved foods.

- **C1 Generic row gains a serving figure.** Covered by headless? yes. Setup: stubs above; Add food (any meal) > Search tab. Steps: type `test` in `#q`, click `#goSearch`, wait for the rows. Expect: the "Test Bar" row text contains `200 kcal per 1 bar · 400 kcal /100g` immediately. The "Banana test, raw" row ends with `89 kcal /100g · P1.1 C22.8 F0.3` and after the detail calls answer reads `105 kcal per medium (118 g) · 89 kcal /100g · P1.1 C22.8 F0.3`. The "Apple test, raw" row reads `104 kcal per large (200 g) · 52 kcal /100g · P0.3 C13.8 F0.2`. Rows keep their order (Banana, Apple, Test Bar) and `#q` still holds `test`.
- **C2 No second request on pick.** Covered by headless? yes. Setup: as C1, wait until the Banana row shows its figure. Steps: click the Banana row. Expect: the amount screen opens with no text "Loading cups, tablespoons and other measures…" visible and the unit list contains `medium (118 g)`; the stub log shows exactly one request for `/food/910001` in total (from the row, none from the picker).
- **C3 Request caps.** Covered by headless? yes. Setup: USDA search answers 8 generic foods, fdcIds 920001..920008, no serving; detail calls delayed ~300 ms each. Steps: search `test`. Expect: stub log shows detail requests for 920001..920005 only (5 requests, never more), never more than 2 outstanding at once; rows 6-8 stay at `/100g` only.
- **C4 Repeat search costs nothing.** Covered by headless? yes. Setup: C1 done. Steps: clear `#q`, type `test` again, click `#goSearch`. Expect: no new `/food/910001` or `/food/910002` request (stub log count unchanged); rows show the figures as before.
- **C5 Superseded search.** Covered by headless? yes. Setup: C3 stubs with detail 920001 delayed 2 s. Steps: search `test`, immediately change `#q` to `other` and click `#goSearch`; the `other` search answers one food "Other test" (fdcId 930001, no serving, detail 930001 `[{amount:1, measureUnit:{name:'undetermined'}, modifier:'slice', gramWeight:30}]`, 100 kcal per 100 g). Expect: the list shows only "Other test"; after 3 s no row from the first search appears; the Other row reads `30 kcal per slice (30 g) · 100 kcal /100g · P0 C0 F0`.
- **C6 Rate limit stops the lookups.** Covered by headless? yes. Setup: 8 generic foods as C3; the first detail request answers HTTP 429. Steps: search `test`. Expect: no more than 2 detail requests in total (those already started), no further ones; rows still show `/100g` only; the list is still usable (click a row opens the amount screen); no error banner is shown for the background lookups.
- **C7 Failure leaves the row alone.** Covered by headless? yes. Setup: C1 stubs but detail 910001 answers HTTP 500. Expect: Banana row stays `89 kcal /100g · P1.1 C22.8 F0.3`, Apple row still gains its figure, no toast.
- **C8 USDA switched off.** Covered by headless? yes. Setup: Settings: USDA source off, Open Food Facts on and answering one product with no serving. Steps: Add food > Search `test`. Expect: stub log has zero requests to api.nal.usda.gov.
- **C9 Escaping.** Covered by headless? yes. Setup: C1 but detail 910001 has modifier `<img src=x onerror=alert(1)>` (measureUnit undetermined, gramWeight 118). Steps: search `test`. Expect: no `<img>` element exists inside `#results`; if the label was a count label the row text shows the characters as text or the markup stripped (no `alert` dialog in either case); no JS dialog fired.
- **C10 Typing during enrichment.** Covered by headless? yes. Setup: C1 with detail delays of 1 s. Steps: after rows appear, type `x` into `#q` (no search). Expect: the typed text is kept, the figures still arrive, no row order change.
- **C11 Recent / Your foods rows.** Covered by headless? yes. Setup: a saved custom food "Home Bar" with portions `[{label:'slice', g:40}]` and per100 k 250 (inject via localStorage `macrodiary.v1` before load). Steps: Add food > Search, type `home`. Expect: the "Home Bar" row reads `100 kcal per slice (40 g) · 250 kcal /100g · ...` (and, as before, a custom food with servingG shows its serving text).

## Owner on a real device
- **R1** Real USDA, own key: search `banana`; within a couple of seconds the "Bananas, raw" row gains a "kcal per 1 medium ..." figure that matches the amount screen's starting serving.
- **R2** Real DEMO_KEY (Settings key empty): search several foods in a row until USDA rate limits; the list stays usable, rows without a figure show only `/100g`, nothing shows an error for the background lookups.
- **R3** 375 px wide phone: the longer second line wraps without pushing the badge or Edit button off screen; the list does not jump or lose scroll position when figures arrive.
- **R4** Search the same food twice: second time the figure is there at once.
- **R5** Airplane mode after a first search: figures already loaded stay; no error appears for the missing ones.

## Open questions
1. A portion whose label is empty or tags-only: skipped (tested: no crash, no markup) versus chosen by `startingUnit`. The spec says skipped; the exact fallback to the next portion is not tested hard.
2. Is a cache hit counted against `limit`? Not specified, not tested (tests use one food per cache case). Is the returned count only non-empty gains? The spec says yes (same as `onUpdate` calls); tests only check the count where all lookups gain or none do.
3. `portions` present but not an array on a food passed to `enrichWithPortions`: undefined behaviour, not tested.
4. `concurrency` or `limit` of NaN / negative / 0 for concurrency: not specified (0 must not hang, but no test because a failing implementation would hang). `limit: 0` is tested.
5. Cache has no exported reset; tests use unique fdcIds per test so they do not interfere. Failed lookups are assumed not cached (a later call may retry); not tested.
6. A saved food whose per-100 g `k` is negative: summary computed as-is (as `servingSummary` does); not tested.
