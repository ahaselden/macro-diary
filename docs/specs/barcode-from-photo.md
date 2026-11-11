# Spec: barcode from a label photo (BACKLOG item 10, Part A)

Tests: `tests/barcode-from-photo.test.js`. Part B (more barcode sources) is out of scope.

## Purpose
When the user takes or chooses a photo in Add food > Custom, the same photo is also scanned for a product barcode; if a valid one is found and the lookup returns a product, the app offers "Use this product", which switches to the Search tab with that code searched (as a live scan does). Label reading (OCR) always carries on regardless, and nothing the user typed is ever overwritten.

## Contract
Domain, `js/domain/barcode.js` (pure; imports only `core/` or `domain/`; no DOM/storage/network):
- `normalizeBarcode(text) -> string`: trims; returns the digits only if 8, 12, 13 or 14 ASCII digits with a valid GTIN mod-10 check digit, else `''`. Not converted (UPC-A stays 12 digits, leading zeros kept). Never throws; non-strings give `''`.
- `pickBarcode(list) -> string`: first entry of an array that normalizes, else `''` (non-array, none, junk entries, sparse arrays).
- `barcodeOffer(code, results) -> object|null`: first result that is a plain object (prototype `Object.prototype` or `null`) with OWN `name` (non-empty string) and OWN `per100` having OWN `k` (finite number >= 0). Returns the same object (no copy), never mutates, `null` for non-array input, tolerates throwing getters.

Service, `js/services/barcode.js` (adds to existing `makeDecoder`, `startScan`...):
- `decodeImageBarcode(file, deps) -> Promise<string|null>`; `deps = { prepare(file, maxSide) -> Promise<frame>, decoders: [async (frame) => string|null], sizes: [numbers] }`. Defaults: real canvas downscale; native `BarcodeDetector` then ZXing via `makeDecoder`; `sizes = [1600, 900]`. Never throws, never rejects.

UI: `js/ui/custom-food.js` (`readLabel`), `js/ui/add-food.js`, `js/ui/ctx.js`, CSS if needed.

Shipping: `js/domain/barcode.js` added to `SHELL` in `sw.js`; `CACHE` bumped from v37.

## Behaviours (tick off)
1. `normalizeBarcode` accepts valid EAN-13 `4006381333931`, EAN-8 `96385074`, UPC-A `036000291452`, GTIN-14 `10614141000415`, unchanged. (tests 1a)
2. It trims whitespace around the code but rejects inner whitespace. (1b)
3. It rejects every wrong last digit (bad check digit). (1c)
4. It rejects lengths other than 8/12/13/14. (1d)
5. It rejects letters, signs, decimals, full-width/Arabic digits, markup, NUL. (1e)
6. It never throws; non-strings (number, null, object with throwing toString, symbol, bigint, String object) give `''`. (1f)
7. A 1M-character string is handled without hanging. (1g)
8. `pickBarcode` returns the first valid code and skips junk. (1h)
9. `pickBarcode` returns `''` for none/empty/non-arrays (including array-likes and Sets). (1i)
10. `pickBarcode` survives sparse arrays and hostile entries and does not mutate. (1j)
11. `barcodeOffer` returns the first usable result, as the same object. (1k)
12. It skips results without a usable name or `per100.k` (null, strings, arrays, NaN, Infinity, negative, string number, null k). (1l)
13. `per100.k === 0` is usable; negative is not. (1m)
14. Non-array/empty input gives `null`; never throws. (1n)
15. Own properties and plain objects only (inherited name/per100/k, class instances rejected; null-prototype accepted). (1o)
16. Throwing getters are skipped; input (even frozen) is not mutated. (1p)
17. Hostile text is returned untouched (escaping is the UI's job). (1q)
18. `decodeImageBarcode` returns the normalized code (trimmed) from the first decoder that finds one. (2a)
19. Default sizes `[1600, 900]`, size outer loop, decoder inner loop, `prepare` once per size, each decoder gets that size's frame. (2b, 2c)
20. Stops calling anything once a code is found. (2d)
21. A code found only at a later size is returned. (2e)
22. Decoder output failing `normalizeBarcode` (bad check digit, wrong type, empty) is skipped; next decoder/size is tried; all junk gives `null`. (2f)
23. A decoder that throws (sync or async) or rejects is skipped. (2g, 2h)
24. A `prepare` that throws/rejects for one size is skipped; next size still tried. (2i)
25. Everything failing resolves `null`, never rejects. (2j)
26. Hostile args (no file, no decoders, empty sizes, non-array decoders, non-function prepare) resolve `null`. (2k)
27. With no deps in Node (no canvas/window) it resolves `null`. (2l)
28. Does not mutate frozen deps arrays. (2m)
29. Real ZXing on rendered EAN-13 pixels is decoded through `decodeImageBarcode`; blank frame gives `null`; a later size with the barcode wins; an EAN-13 with leading 0 (UPC-A) is accepted (either form). (3a-3c)
30. [static UI] imports present. (4)
31. [static UI] size cap before the decode call. (5)
32. [static UI] decode starts before OCR; OCR still called. (6)
33. [static UI] no `await` on decode/search before OCR starts (does not block). (7)
34. [static UI] lookup is `searchAll(code, {useUSDA: state.useUSDA, useOFF: state.useOFF, apiKey: state.apiKey})` and uses `barcodeOffer`. (8, 9)
35. [static UI] "Use this product" button text exists; offer name and brand go through `esc()`. (10, 11)
36. [static UI] `#cBar` set only when empty and not `data-user`; typing in `#cBar` sets `data-user`. (12, 13)
37. [static UI] barcode code never assigns `.value` to name/number fields. (14)
38. [static UI] `ocrRun` guard after the lookup; lookup wrapped in try/catch. (15, 16)
39. [static UI] Use handler references the search/tab hand-off. (17)
40. [static] domain module pure, in `SHELL`, `CACHE` >= v38. (18)

Hand-computed check digits (weights 3,1,3,1... from the right of the payload): EAN-13 4006381333931 sum 89 -> 1; EAN-8 96385074 sum 86 -> 4; UPC-A 036000291452 sum 58 -> 2; GTIN-14 10614141000415 sum 55 -> 5.

## Edge cases and hostile input
Empty/huge/NaN/wrong-type inputs, prototype pollution style objects (inherited `name`/`per100`/`k`), throwing getters/toString, HTML in product names (UI must `esc()` name and brand), full-width digits, sparse arrays, frozen inputs, stale runs (user re-renders the tab or takes a second photo while the lookup is in flight), offline lookup, 25 MB cap.

## What cannot be tested automatically
Tests 4-18 in the test file (UI) are STATIC TEXT checks: they prove identifiers and ordering exist in the source, not that the offer renders, the button works, or the fields behave. They can be satisfied by dead code or comments; a reviewer must read the diff. The default `prepare` (canvas), native `BarcodeDetector`, and ZXing loading via `loadScript` are browser-only and are not exercised; only injected fakes and the Node ZXing build are. Rendered test pixels are clean synthetic bars, not photos (blur, glare, skew, curved packs are untested).

### Manual checklist (real phone)
- [ ] Photo of a product barcode: offer appears with name, brand, kcal; "Use this product" opens Search with that code searched.
- [ ] Photo of a nutrition label only: no barcode message, OCR fills the fields as before.
- [ ] Photo containing both: offer appears AND OCR fields fill.
- [ ] Offline: no alarming message, OCR (if cached) still works, Barcode field behaviour sane.
- [ ] Barcode valid but product not found: nothing alarming, OCR continues.
- [ ] Typed a barcode / name / numbers first, then photo: typed values untouched.
- [ ] Take a second photo or switch tab while the lookup runs: no stale offer appears.
- [ ] Photo > 25 MB: still rejected with the size message.
- [ ] Product name containing `<` or `&`: shown literally.

## Open questions
1. Does `barcodeOffer` use `code`? Plan says only "first result with usable per100.k and name"; tests do not require the result to match `code` (searchAll may return fuzzy results). Should it require the result's own barcode to match (via `sameBarcode`)? Untested.
2. Is a whitespace-only name "non-empty"? Untested for `barcodeOffer` (the reference check used `trim`); tests only reject `''`, non-strings and missing names.
3. Frame type produced by default `prepare` and what the decoders accept is unspecified; tests use opaque frames.
4. Whether `decodeImageBarcode` returns a UPC-A found as a 13-digit EAN with leading 0 in 13-digit or 12-digit form: tests accept either.
5. Whether `data-user` is the mechanism for `#cBar` (currently only number fields set it); static tests assume it, as stated in the brief.
6. How "Use" switches tab (no named function in the plan); test 17 is a loose regex.
7. Whether barcodeOffer should accept results with `per100.k` present only via `perServing`; plan says per100 only.
