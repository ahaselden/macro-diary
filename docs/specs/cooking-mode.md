# Spec: cooking mode (backlog item 8)

## Purpose
A "Cook" button on each recipe card and in the planned-meal recipe popup opens a large-text, read-only view to leave open while cooking (tick-off ingredients, tap-to-mark steps, a display-only servings scaler, an optional "Keep screen on" switch using the Screen Wake Lock API). It never changes saved data: no schema change, `STORAGE_KEY` untouched, the saved recipe is never mutated.

## Contract

### `js/domain/cooking.js` (domain, pure: no DOM, storage, globals; may import only `./recipes.js`, `./ingredient-parse.js`, `../core/{constants,format,dates,schema}.js`)
- `MIN_SERVINGS = 0.25`, `MAX_SERVINGS = 100` (exported constants).
- `scaleFactor(recipeServings, wantedServings) -> number`: `wanted / recipe` when both are finite numbers > 0 (typeof number, strings are NOT coerced); otherwise `1`.
- `clampServings(value) -> number`: a finite number is clamped to [0.25, 100]; anything else (NaN, Infinity, string, null, undefined, object) returns `1`. No rounding.
- `halveServings(v)` = `clampServings(clampServings(v) / 2)`; `doubleServings(v)` = `clampServings(clampServings(v) * 2)`; `stepServings(v, delta)` = `clampServings(clampServings(v) + delta)` for a finite number `delta` (else `delta` is treated as 0).
- `cookingIngredients(recipe, wantedServings) -> string[]`: the ingredient display lines scaled to `wantedServings`. If `wantedServings` is a finite number > 0 it is first clamped with `clampServings`; otherwise the recipe's own yield is used (factor 1). Uses `scaleIngredientText` (via `recipeSummary`) so wording matches the planned-meal popup. Never throws; strings verbatim (the UI escapes).
- `cookingSteps(recipe) -> string[]`: the steps that are strings and not blank, verbatim (not trimmed), in order; everything else dropped. `[]` for a non-object recipe or non-array `steps`.
- `toggleTick(ticks, index, count) -> number[]`: `ticks` is the set of ticked ingredient indexes as an array. Returns a NEW array (input never mutated, may be frozen), sanitised to unique integers in `[0, count)` sorted ascending (junk in `ticks` is dropped; a non-array `ticks` counts as empty), with `index` added if absent or removed if present. If `index` is not an integer in `[0, count)` (NaN, negative, fractional, string, null) or `count` is not a positive integer, nothing is toggled (the sanitised set is returned; `[]` when `count` is invalid).
- `setCurrentStep(current, index, stepCount) -> number|null`: `current` is the marked step index or `null`. Tapping index returns `index`; tapping the current step again returns `null`; an out-of-range or non-integer `index` is ignored (returns `current`). The result is always `null` or an integer in `[0, stepCount)`: an invalid `current` (out of range, non-integer, undefined) is treated as `null`, and `stepCount` not a positive integer gives `null`.
- `safeSourceLink(url) -> string`: the same string unchanged if it is a string of at most 500 chars with no leading/trailing whitespace, parses with `new URL`, has protocol `http:` or `https:` and no username/password; otherwise `''`. (Same rule as the private `plainLink` in `recipes.js`.)

### `js/services/wakelock.js` (service; takes the browser objects as arguments, never reads `navigator`/`document`/`window`/`globalThis` itself)
`createWakeLock(nav, doc) -> { isSupported(), enable(), disable(), status() }`
- `isSupported() -> boolean`: true only when `nav` is an object whose `wakeLock.request` is a function.
- `status() -> 'off'|'on'|'unsupported'|'failed'`, initially `'off'`.
- `enable() -> Promise<'on'|'unsupported'|'failed'>`: never rejects/throws. Unsupported: resolves `'unsupported'` and requests nothing. Otherwise calls `nav.wakeLock.request('screen')`; on success `'on'`; on rejection or synchronous throw `'failed'`. Records that the lock is *wanted*, and (if `doc` has `addEventListener`) adds exactly one `visibilitychange` listener. Calling `enable()` while a sentinel is already held does not request again and does not add a second listener.
- `disable() -> Promise<void>`: never rejects. Marks the lock not wanted, removes the `visibilitychange` listener, releases the held sentinel (`sentinel.release()`), status becomes `'off'`. Safe to call when never enabled or twice. If an `enable()` request is still pending, the sentinel it later resolves with is released immediately (no leaked lock).
- While wanted: on `visibilitychange` with `doc.visibilityState === 'visible'`, if no sentinel is currently held (the browser releases it when the page is hidden and fires `release` on the sentinel), request again; failures are swallowed (status `'failed'`). Hidden state does nothing. A `release` event from an old (replaced) sentinel is ignored and must not clear the current one.
- `doc` may be missing/`undefined`: enable/disable still work, there is just no re-request.

### `js/ui/cook-view.js` (ui)
`openCookView(recipeId, servings?)`: opens the shared dialog (`dialog()`), read-only. Looks the recipe up with `Object.hasOwn(state.recipes, id)`; unknown id -> toast "That recipe was deleted". Initial servings = `servings` if valid else the recipe's yield, clamped. Shows: name, ingredients as `<input type="checkbox">` rows (text escaped), numbered steps as an ordered list where tapping a step marks it with `aria-current="true"` (tap again clears), a servings control (minus, plus, halve, double buttons, calling the domain helpers) that re-renders the scaled ingredients and keeps ticks, a "Keep screen on" checkbox/switch, the source link (only via `safeSourceLink`, `target="_blank" rel="noopener noreferrer"`), Close. Closing the dialog (any way, including Esc) disables the wake lock. Switch text: `Keep screen on`; when `isSupported()` is false the switch is disabled and the text "Keep screen on is not supported on this device" (must contain "not supported on this device") is shown; on `'failed'` a short note that it could not be kept on.
`openCookView` is wired from a `data-cook` "Cook" `<button>` on each card in `js/ui/recipes-view.js` (clicking it must NOT open the editor) and from a "Cook" button in `js/ui/recipe-view.js` (passes the planned servings).

### Shipped files
`js/domain/cooking.js`, `js/services/wakelock.js`, `js/ui/cook-view.js` in `SHELL` in `sw.js`, `CACHE` bumped above `macro-diary-v32`. CSS for large text goes in the existing CSS files (if a new css file is added it is also in SHELL).

## Behaviours (tick off)
Domain, `tests/cooking.test.js`:
1. `scaleFactor` returns wanted/recipe for valid pairs (4,8 -> 2; 4,2 -> 0.5; 2,3 -> 1.5; 4,4 -> 1).
2. `scaleFactor` returns 1 for zero, negative, NaN, Infinity, strings, null/undefined in either argument.
3. `clampServings` clamps to [0.25, 100] and returns 1 for non-finite/non-number input.
4. `halveServings`, `doubleServings`, `stepServings` follow the clamp (halve 4 -> 2, 0.25 stays 0.25; double 4 -> 8, 80 -> 100; step 4,+1 -> 5; 1,-1 -> 0.25).
5. `cookingIngredients` scales by hand-computed values (yield 4, wanted 8 / 2 / 1) and keeps un-scalable lines (qty null) verbatim.
6. `cookingIngredients` with invalid wanted uses the recipe yield (unscaled); wanted outside the clamp range equals the clamped result.
7. `cookingIngredients` / `cookingSteps` are safe on hostile recipes (null, array, non-array lists, junk entries, inherited properties, `__proto__` keys), return strings verbatim (HTML not escaped or altered), and never mutate a deep-frozen recipe.
8. `cookingSteps` keeps non-blank string steps in order, drops the rest.
9. `toggleTick` adds, removes, sorts, does not mutate (frozen input), sanitises junk, ignores out-of-range/invalid indexes and invalid counts.
10. `setCurrentStep` selects, clears on re-tap, ignores out-of-range/invalid, always returns null or a valid index.
11. `safeSourceLink` accepts plain http/https URLs only and rejects `javascript:`, `data:`, `ftp:`, `file:`, credentials, padded/long/non-string/empty/invalid values.
12. Scaling for display never mutates the state: after running all helpers against a deep-frozen state's recipe the state deep-equals its JSON snapshot.
13. Layer rules: `js/domain/cooking.js` imports only allowed modules and uses no DOM/storage/network globals; `js/services/wakelock.js` imports nothing from `ui/` and uses no `navigator`/`document`/`window`/`globalThis` globals (comments ignored).

Wake lock, `tests/wakelock.test.js` (fake `nav` and `doc`):
14. `isSupported` false for missing nav / no `wakeLock` / `request` not a function; true with a fake.
15. `enable` unsupported -> `'unsupported'`, no request, no throw, `status()` `'unsupported'`.
16. `enable` supported calls `request('screen')` exactly once and returns `'on'`.
17. `enable` rejection (NotAllowedError) and synchronous throw -> `'failed'`, never rejects.
18. `disable` releases the sentinel, status `'off'`, removes the visibility listener; safe when never enabled, twice, or when `release()` rejects/throws.
19. After the browser releases the lock (page hidden), becoming visible re-requests; hidden does nothing; visible with the lock still held does not request again.
20. After `disable`, visibility changes never request.
21. A stale (old sentinel) `release` event is ignored: it does not clear the new sentinel nor trigger an extra request.
22. `enable` twice requests once and registers one listener.
23. `disable` while `enable`'s request is pending releases the sentinel when it resolves, status stays `'off'`.
24. A failed re-request on visible does not throw/reject unhandled; status `'failed'`.
25. Works with `doc` undefined.

UI, `tests/cook-view-ui.test.js` (WEAK source-text checks, see below):
26. `js/ui/cook-view.js` exists, exports `openCookView`, imports from `../domain/cooking.js` and `../services/wakelock.js`.
27. Text is escaped: `esc(` used; the source link comes only from `safeSourceLink`; `target="_blank"` is paired with `rel="noopener noreferrer"`; no `javascript:`; no raw `innerHTML +=` of unescaped values detectable by the patterns in the test.
28. Read-only: the module does not import `save`, `saveRecipe`, `updatedAt` writes, `localStorage`, or assign into `state`.
29. Ingredient tick boxes are `type="checkbox"`; steps carry `aria-current`; uses `toggleTick` and `setCurrentStep`.
30. Servings scaler uses `clampServings`, halve/double/step helpers and `cookingIngredients`.
31. "Keep screen on" control, the text "not supported on this device", `createWakeLock`, `enable(` and `disable(`, and a dialog `close` listener that disables.
32. `recipes-view.js` has a real `<button ... data-cook ...>Cook</button>` per card, imports `openCookView`, and the click handler handles `[data-cook]` before the editor opens.
33. `recipe-view.js` has a Cook `<button>` and imports `openCookView`.
34. `sw.js` lists the three new files in SHELL and `CACHE` is at least `macro-diary-v33`.
35. No `role="button"` in the new/changed UI.

## Edge cases and hostile input
Empty recipe (no ingredients/steps): the view shows "No ingredients." / "No steps." and still opens. Recipes from import/sync may have non-array `ingredients`/`steps`, non-numeric `servings`, `servings` 0, huge `servings` (1e308), ingredient names containing `<img src=x onerror=...>`, `"`, `&`, step text with `</li><script>`, `source` of `javascript:alert(1)`, `data:text/html,...`, `https://user:pw@host/`, 10 000-char URLs, recipes with `__proto__`/`constructor` keys, a recipe id like `__proto__` or `constructor` (must be "deleted" toast, not a crash). Scaler at limits (0.25, 100) must not go beyond. Tick/step state is UI-local and is lost on close (acceptable, see open questions).

## Cannot be tested automatically
- The visual result (large text, tap targets, layout in the shared dialog).
- The wake lock on real hardware: whether the screen actually stays on, release when the phone locks or the app is backgrounded, re-acquire on return, and installed iOS home-screen apps (historically unreliable) and older browsers. The fakes only prove our logic reacts correctly to the API as specified, not that browsers behave like the fakes.
- `https`/localhost requirement (the API is absent on plain http).
- The UI tests (26-35) read source text only: they prove markup and calls exist, NOT that taps work, ticking persists across re-renders, or that escaping works at runtime.

### Manual checklist (owner, on a phone and a desktop)
- [ ] Cook on a recipe card opens the view; tapping the card elsewhere still opens the editor; the star still works.
- [ ] Cook from the planned-meal popup starts at the planned servings.
- [ ] Text is large and readable at arm's length; scrolls for long recipes.
- [ ] Ticking ingredients works; tapping a step highlights it, tapping again clears it.
- [ ] Servings minus/plus/halve/double rescale the ingredients; ticks stay on the same ingredients; the recipe in the Recipes tab is unchanged afterwards (reopen the editor).
- [ ] Source link opens in a new tab only for http/https sources.
- [ ] "Keep screen on": screen stays awake past the normal timeout; lock the phone and return: still on; close the view: the screen may sleep again.
- [ ] On a browser/device without the API the switch is disabled with "not supported on this device".
- [ ] Installed iPhone home-screen app: note whether it works.
- [ ] Offline after update: new files are precached (SW v33+).

## Open questions
- Should ticks and the current step survive closing and reopening, or a rescale? Specified: UI-local only, reset on reopen; ticks survive a rescale (same indexes).
- Max 100 servings and min 0.25 are my choices; the owner may want different limits.
- After the browser releases a lock for a reason other than hiding (battery saver) the spec only requires a re-request on the next `visibilitychange`; the visible status in that gap is not specified.
- Exact CSS class names and wording of the failure note are left to the implementer.

## Verification log
(for the implementer: record here what was run and the result, including anything verified on a real device)

### Implementer's log (2026-11-11, automated backlog run)
- `npm test`: 763 tests, all pass (35 new tests from the test-designer, commit d5d3b34). One OLDER test changed: `tests/plan-recipe-popup.test.js` V5 listed the only modules `recipe-view.js` may import; `./cook-view.js` was added to that list because the spec (behaviour 33) requires the import. No designer test was edited.
- Browser (desktop built-in browser, localhost, Chromium): seeded a recipe with HTML in its name and steps; the Cook button opens the view, the name and steps show as text, ticks survive a rescale, double and half rescale the ingredient lines (2 cups flour -> 4 cups), tapping a step marks it, the source link shows, the saved recipe's servings stay 4, Close works. The wake-lock switch was enabled (not disabled) there.
- NOT verified: real wake-lock behaviour on phones, installed iOS apps and older browsers; the unsupported-device text path in a real browser (only tested with fakes); visual size and tap targets on a phone; the Cook button inside the planned-meal popup was not clicked in the browser; Edit/star still working on the card was not clicked.
