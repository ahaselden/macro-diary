# Spec: USDA barcode fallback (BACKLOG item 11)

Purpose. Today a scanned, typed or photographed barcode is looked up only in Open Food Facts (OFF); `searchAll` skips USDA when the query is a barcode. This feature asks USDA FoodData Central by the digits when OFF finds nothing (empty or failed) and accepts only a Branded record whose `gtinUpc` is the same product, shown as an ordinary food with source `USDA`. Research: `docs/research/barcode-sources.md`.

Tests: `tests/usda-barcode-fallback.test.js` (numbers below match the test titles).

## Contract

Domain, `js/domain/barcode.js` (pure, never throws; may import `sameBarcode` from `./food.js`):
- `usdaBarcodeQueries(code) -> string[]`
- `usdaBarcodeMatch(code, foods) -> object | null`

Service, `js/services/usda.js`:
- `searchUSDAByBarcode(code, apiKey) -> Promise<food[]>` (rejects with the request's error). `mapUSDA`, `searchUSDA`, `loadPortions` unchanged.

Service, `js/services/foods.js`:
- `searchAll(q, { useUSDA, useOFF, apiKey }) -> Promise<{ results, errors }>` (same shape as today).

UI (`js/ui/custom-food.js`, `js/ui/add-food.js`) and `sw.js` (CACHE bump, no new file).

## Behaviours

Domain
1. `usdaBarcodeQueries`: for a string that trims to 8-14 ASCII digits, lists the digits with leading zeros stripped while length > 12 FIRST (a 13/14-digit code starting with 0 becomes its 12-digit form), then the original if different; unique. `036000291452` -> `['036000291452']`; `0036000291452` -> `['036000291452','0036000291452']`; `00012345678905` -> `['012345678905','00012345678905']`; EAN-13 `4006381333931` and EAN-8 `96385074` unchanged.
2. It trims whitespace and needs no valid check digit (typed codes are looked up too).
3. It returns `[]` for everything else: empty/blank, 7 or 15 digits, letters, inner spaces, signs, decimals, HTML, NUL, Unicode digits, a 1e6-character string.
4. It never throws and returns `[]` for non-strings (numbers, null, objects with throwing `toString`, symbols, bigint, `String` objects).
5. `usdaBarcodeMatch` returns the first element of the RAW USDA `foods` array (the same object, not a copy) whose own `gtinUpc` is a string that `sameBarcode(code, gtinUpc)` accepts, else `null`.
   a. leading-zero forms match both ways (`0036000291452` vs `036000291452`); EAN-8 matches.
   b. a different product with the same trailing digits does not match (`136000291452`, `291452`, trailing junk, fewer than 6 digits after zero stripping).
   c. hostile `gtinUpc` (number, object with `toString`, array, null, boolean, huge string, missing) never matches; junk entries (null, strings, arrays) are skipped and later good records still found.
   d. plain objects only (`Object.prototype` or null prototype), own properties only: inherited `gtinUpc`, class instances, JSON-parsed `__proto__`/`constructor` keys do not match; a throwing getter is skipped.
   e. non-array `foods` (undefined, null, string, array-likes, Set) -> `null`; a code that is not a barcode -> `null`; input is not mutated (works on frozen data).

Service `searchUSDAByBarcode`
6. For a valid code it sends one GET to `https://api.nal.usda.gov/fdc/v1/foods/search` with `query=<digits>`, `dataType=Branded`, `api_key=<key>`, picks the match with `usdaBarcodeMatch`, and returns `[mapUSDA(match)]` (output exactly what `mapUSDA` gives today; hand-derived in the test).
7. `api_key` is the trimmed key; blank/missing -> `DEMO_KEY`; the key is URL-encoded (a key containing `&`, `=`, `#`, space must not create extra parameters).
8. Queries from `usdaBarcodeQueries` are tried in order, one request each; no second request after a hit; `[]` after the last one without a hit.
9. Only an equal-product record is accepted (different product, hostile `gtinUpc`, EAN-8 works).
10. Invalid code (not 8-14 digits, non-string) -> `[]` and NO request.
11. A 200 response with no `foods` key, `null` body, `[]` body, non-array `foods`, or a match without calories -> `[]` (no `null` entries). HTML in name/brand stays data (escaping is the UI's job).
12. A failing request makes the promise reject with that error message: `HTTP 500`, `rate limited ...` (429), `network error`, malformed JSON. (Whether the second query is still tried after a failure of the first is not specified; only the rejection is tested.)

`searchAll`, barcode queries (`isBarcode(q)`)
13. OFF empty and `useUSDA` -> `searchUSDAByBarcode(q, apiKey)`; `results` are the USDA match (source `'USDA'`), `errors` empty. Exactly one OFF request and one USDA request in the simple case.
14. OFF failed and `useUSDA` -> USDA is asked, its result is shown, the OFF error (`Open Food Facts: HTTP 500`) is still reported.
15. OFF returned results -> USDA is NOT asked (total requests = 1), results are the OFF ones only.
16. `useUSDA` false -> USDA never asked (OFF empty or failed). `useOFF` false with `useUSDA` true -> USDA is asked and OFF is not.
17. Nothing found (or only a different product) anywhere -> `{ results: [], errors: [] }` (this is what lets the UI say "not found"); a 200 with no `foods` key is also this.
18. USDA failure -> `USDA: <message>`; the OFF error is kept; order OFF then USDA; a USDA failure never hides an OFF result (see 15).
19. If the USDA error matches `/rate limit|429|too many/i` AND `apiKey` is empty/blank/undefined, append ` Add your own USDA key in Settings (the shared key is limited).` to that error text. Not appended with an own key, nor for other errors (HTTP 500).
20. An EAN-13 with leading 0 is found via the 12-digit form; OFF is still asked with the code as given.
21. NAME queries (including 7-digit numbers) are unchanged: same three requests (OFF + generic + branded), no fallback, `pageSize=8`; an OFF failure on a name search triggers no extra USDA request. (This test passes today: it is a regression guard. So are 15 and 17.)

UI and shipping (static text checks only; they prove wording and wiring exist, NOT that the UI works)
22. `barcodeFromPhoto` no longer gates on `state.useOFF` alone: it looks the code up when `useOFF || useUSDA`; when neither is on it says so plainly before any lookup; the `searchAll(code, { useUSDA: state.useUSDA, useOFF: state.useOFF, apiKey: state.apiKey })` call is kept (compatible with `tests/barcode-from-photo.test.js` check 8).
23. `add-food.js` not-found message (barcode, no results, no errors): says "Not found", names the sources tried (Open Food Facts and/or USDA by `state.useOFF` / `state.useUSDA`), still offers "Create a custom food" (`#mkBarcode`) and still `esc()`s the code. (The test only sees that those words and both switches appear near `mkBarcode`; "Not found" and "Create a custom food" already exist, so those two assertions alone prove nothing.)
24. `sw.js` `CACHE` is at least `macro-diary-v39` (currently v38). No new file, so the `SHELL` list needs no change.

## Edge cases and hostile input covered
Numbers/objects/arrays/huge strings/prototype keys as `gtinUpc`; throwing getters; HTML in `description`/`brandOwner` stays data; 200 without `foods`, `null` or `[]` body, non-array `foods`; malformed JSON, 429, 500, network failure; key with spaces or `&`; EAN-8; 13-digit code with leading 0 vs a 12-digit `gtinUpc`; a different product with the same trailing digits; both switches in every combination.

## Cannot be tested automatically (manual checklist, real phone)
- [ ] With your own USDA key in Settings: scan a product that Open Food Facts lacks but USDA has; it appears as an ordinary result with a USDA badge, kcal/macros sensible, and can be logged.
- [ ] Same product with the key field empty (shared DEMO_KEY): works, or if rate-limited the message tells you to add your own key.
- [ ] A product in neither database: the message names both sources and offers "Create a custom food" with the barcode pre-filled.
- [ ] Open Food Facts switched off, USDA on: scan works through USDA only; the not-found text names only USDA.
- [ ] USDA off, OFF on: behaviour as before; text names only Open Food Facts.
- [ ] Both off: the Search tab says to enable a database; a photo with a barcode (Custom food tab) says plainly that no database is on.
- [ ] Photo with a barcode (Custom food tab) for a USDA-only product: "Use this product" appears and leads to the Search tab result.
- [ ] A US product scanned as EAN-13 (leading 0) is found.
- [ ] Offline: the error reads as a network error, not "not found".
- [ ] Name searches (e.g. "apple") look exactly as before.

## Open questions
1. `usdaBarcodeMatch(code, ...)`: whether it trims `code` itself is not specified. The tests only pass trimmed codes to it and to `searchUSDAByBarcode` (queries are trimmed per contract; if the untrimmed code were passed to `sameBarcode`, a padded code would never match). Implementer: trim once, up front.
2. A matching record that `mapUSDA` cannot convert (no calories): test 11 expects `[]`; whether the next query is then tried is unspecified and not tested.
3. After a failed first request for a 13-digit code, is the second query still tried? Unspecified; only the rejection is tested (12).
4. `searchAll` with `useOFF` false and `useUSDA` true on a barcode: treated as "OFF empty" so USDA is asked (test 16). Derived from the photo behaviour (`useOFF || useUSDA`), not stated explicitly in the plan.
5. Test 11 expects a `null` JSON body to give `[]` (not a TypeError); the existing `searchUSDA` does not guard this. Reasonable but stricter than the plan.
6. Conflict check with `tests/barcode-from-photo.test.js`: none found. Its check 8 (flags passed to `searchAll`) and check 16 (`catch` around the lookup) remain satisfiable; the old `if (!state.useOFF)` gate is not pinned by that file. If the implementer needs the helper text "Barcode ... found in the photo." changed, nothing there pins the wording.

## Verification log (implementer, Windows, headless Edge via tools/browser-test, own port)
- 931 tests pass. The headless scenarios `usda-barcode-fallback` (Open Food Facts stubbed empty, USDA stubbed with an invented branded record: the product is listed with the USDA badge, no custom-food button) and `barcode-not-found` (both empty: the button reads "Not found in Open Food Facts and USDA. Create a custom food for ...") pass; the earlier scenarios still pass.
- NOT done: real USDA or Open Food Facts data with the owner's products, a real phone, the label-photo flow with only USDA enabled, the no-database message in the photo flow.
- The designer's final report was only the word "placeholder"; the files and failing tests were checked by the implementer (25 of 28 failing before the code, the 3 passing ones guard unchanged behaviour).
