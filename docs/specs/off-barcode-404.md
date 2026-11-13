# Spec: off-barcode-404 (bug fix)

## Purpose
Open Food Facts answers an unknown barcode with HTTP 404 and a JSON body such as `{"code":"0810030528814","status":0,"status_verbose":"product not found"}`. The app showed "Open Food Facts: HTTP 404" for barcode 810030528814; it must treat that as "no product" (empty result) so the existing not-found path (D39) and USDA fallback run.

## Contract
- `searchOFF(q)` in `js/services/off.js` (unchanged signature, returns `Promise<Food[]>`). For `isBarcode(q)`: an HTTP 404 from `/api/v2/product/<code>.json` resolves `[]`, whatever the body (JSON with status 0, other JSON, HTML, empty).
- `getJSON` in `js/services/http.js` may be extended or bypassed by `searchOFF` (implementer's choice); its behaviour for all other callers must not change (404 elsewhere still throws `HTTP 404`).
- `searchAll` in `js/services/foods.js`: no signature change.
- Layers: services only (may use domain/core).

## Behaviours (tests/off-barcode-404.test.js, numbers match titles)
1. Barcode, OFF 404 with the JSON not-found body -> `[]`, no throw, one request to the v2 product URL.
2. Barcode, OFF 404 with a non-JSON body (HTML or empty) -> `[]`.
3. Barcode, OFF 404 with any odd JSON (null, {}, [], status 1, status 0) -> `[]`.
4. Barcode, 500/502/503 still reject with exactly `HTTP <n>`, even if the body is the not-found JSON.
5. Barcode: network failure -> `network error`; 429 -> `rate limited...`; 400/403/410 -> `HTTP <n>`. Unchanged.
6. Barcode 200 status 1 maps as before; 200 status 0 -> `[]`.
7. Name search: a 404 still rejects `HTTP 404`; 500 and 200 unchanged.
8. `searchAll(barcode)` with OFF 404: `errors: []`, USDA branded fallback still requested, its match returned.
9. `searchAll(barcode)` OFF 404 and USDA empty -> `{results: [], errors: []}` (also with non-JSON 404, and with USDA switched off).
10. OFF 404 does not hide a real USDA error; OFF 500 still reported as `Open Food Facts: HTTP 500`.
11. `searchAll(name)` with OFF 404 -> `errors: ['Open Food Facts: HTTP 404']`, no barcode fallback.

## Edge cases
Non-JSON 404 body (the test stubs offer both `json()` and `text()`; json throws SyntaxError, so the implementation must not depend on parsing a 404 body). 404 with null/array body. A 500 carrying the not-found JSON stays an error. 404 on the name-search endpoint stays an error. Only the OFF product endpoint is relaxed; USDA behaviour is untouched.

## Not testable automatically
Real phone / real OFF. Manual (headless-runnable):

**C1** Setup: add-food screen, Open Food Facts and USDA switches on, nothing saved needed. Stub fetch: any URL containing `world.openfoodfacts.org/api/v2/product/810030528814` -> status 404, body `{"code":"0810030528814","status":0,"status_verbose":"product not found"}`; USDA `api.nal.usda.gov` -> 200 `{"foods":[]}`. Steps: type `810030528814` in the search box, run the search (Search button / Enter). Expect: the existing not-found message ("Not found" with the "Create a custom food" button) is visible; the text "HTTP 404" and "Open Food Facts: HTTP" appear nowhere on the page. Headless: yes.

**C2** Same as C1 but USDA answers one branded food with gtinUpc `810030528814`, description COCA COLA, 42 kcal. Expect: one result "Coca cola" listed, no error text, no "HTTP 404". Headless: yes.

**C3** Same as C1 but OFF answers 500. Expect: the error text "Open Food Facts: HTTP 500" is shown. Headless: yes.

**C4** Name search "apple" with OFF 404 on `cgi/search.pl`: "Open Food Facts: HTTP 404" is still shown. Headless: yes.

Owner on a real device: scan/type 810030528814 on the phone; expect "not found" wording, no HTTP error. Headless: no (real data).

## Open questions
- Whether a 404 on a barcode with a body that is NOT status 0 should also be empty: the brief says "or any 404 on that product endpoint", so tests require `[]`.
- Exact not-found wording is owned by D39/usda-barcode-fallback tests; C1 relies on "Not found" and "Create a custom food".
