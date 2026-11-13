# Spec: sw-fresh-files (service worker must never mix app versions)

## Purpose
After the Settings tidy-up shipped, Firefox showed the new index.html with old CSS and JavaScript. `sw.js` fetched its precache (`cache.addAll(SHELL)`) and its network-first replies through the browser's HTTP cache, and GitHub Pages sends `Cache-Control: max-age=600`, so stale copies were stored under the new cache name. The worker must always take files from the network (revalidated) so a cache version is internally consistent.

## Contract
Only `sw.js` (root, not a module; no new files, SHELL unchanged) changes. No saved-shape change, `STORAGE_KEY` untouched. `CACHE` becomes `macro-diary-v56` (main is v54; the open Settings-tab PR uses v55). Tests: `tests/sw-fresh-files.test.js` (source checks `S*`, sandbox runs `B*`), existing `tests/sw.test.js` must stay green.

## Behaviours
1. (S1, B1) Install fetches every SHELL entry with `cache: 'reload'` (e.g. `new Request(url, { cache: 'reload' })`), not through plain `addAll(SHELL)`, and stores all of them in the new cache, then `skipWaiting()`.
2. (B2) Install stores the fresh network copy even when the HTTP cache holds an old copy of css/js/index.html.
3. (B3) Install is atomic: a network failure for any one file rejects the install; the previous cache is untouched; `skipWaiting` is not called; a partial new cache never looks complete.
4. (B4) A non-ok status (404/500) for any SHELL file also fails the install (the error page must not be stored as an app file; `cache.put` does not check `ok`, so the implementation must).
5. (S2, B5) Same-origin GET network-first fetches use `cache: 'no-cache'` (or `'reload'`), so a stale HTTP-cache copy is never returned or stored while online. Covers css, js, `index.html` and navigations (`./`, mode `navigate`).
6. (B6) Offline fallback unchanged: cached file, else cached `index.html`.
7. (B7) The `/vendor/tesseract/` branch stays cache-first on `OCR_CACHE` (hit: no network; miss: one fetch, stored in OCR cache only).
8. (B8) Non-GET and cross-origin requests are not intercepted (no `respondWith`, worker makes no fetch).
9. (B9) Activate deletes every cache except `CACHE` and `OCR_CACHE`, then `clients.claim()`.
10. (S3) `CACHE` version number is at least 56 (greater than main's v54; never pinned exactly).

B6 to B9 and the unchanged-branch checks in S2 describe existing behaviour and PASS before the fix; they are regression guards, not proof of the fix.

## Edge cases and hostile input
- Server returns 404 or 500 for one file during install (B4); network drops for one file (B3).
- HTTP cache holds a stale copy of only some files: the mixed-version scenario itself (B2, B5).
- Cross-origin APIs (USDA, Open Food Facts) and POSTs must pass through (B8).
- Not tested: a fetch for a path outside SHELL is still cached on success (existing behaviour, kept).

## How strong the tests are
- Source checks (S1 to S3) are weak: they prove only that certain text exists. They would pass if the text sat in dead code.
- Sandbox tests (B1 to B9) are strong for logic: the real `sw.js` text runs in a Node `vm` with fakes for `self`, `caches`, `fetch`, `Request`, `Response`. The fake `fetch` simulates an HTTP cache: it returns an OLD body for chosen URLs unless the request's cache mode is `reload`/`no-cache`, so the mixed-version bug reproduces in Node. Limits: the fakes are my model of the Cache API and HTTP-cache semantics; the sandbox does not model real browser behaviour (Firefox revalidation, `Request` with `mode: 'navigate'`, worker lifetime). The fake `Request` accepts any init; a real browser might reject some combinations.
- Assumption: the implementation uses `fetch(Request|url, {cache})` or `new Request(..., {cache})`; the fake reads the mode from either.

## Not testable automatically
`tools/browser-test` blocks the service worker, so the headless runner cannot test any of this: install, activation, HTTP-cache interaction, offline fallback, update flow. Also not covered: real GitHub Pages headers, Firefox vs Edge differences.

Already-installed old workers keep the old behaviour (stale-prone install and fetch) until the new worker installs and activates. The browser checks `sw.js` itself (it bypasses the HTTP cache for the worker script in current browsers), installs v56, and after it activates the page needs one more reload to be served by it. Until then a user can still see a mixed version; the fix prevents new mixed caches, it cannot repair a cache already built from stale files except by the v56 install replacing it (the old cache is deleted on activate).

## Owner on a real device (not run headless)
- O1 Firefox desktop. Setup: app already open with the old worker. Steps: reload the page twice (first loads the new worker, second is served by it); open DevTools, Network, tick "Disable cache" off. Expect: in Application/Storage the cache `macro-diary-v56` exists and `macro-diary-v54` is gone; Network rows for `css/*.css` and `js/**/*.js` show status 200 or 304, never "(from cache)" or "cached" via HTTP cache; Settings Appearance button is styled and expands. Headless: no (service worker).
- O2 Firefox, mixed-version check. Steps: with DevTools Storage open, inspect `macro-diary-v56` entries `index.html`, `css/components.css`, `js/ui/settings-view.js`; compare with the live site files (open each URL with a hard refresh). Expect: contents identical. Headless: no.
- O3 Phone (installed PWA). Steps: open the app online, close it fully, reopen, then close and reopen once more. Expect: new Settings layout works; then switch to airplane mode and reopen: app opens from cache and works. Headless: no (real phone, Safari/Chrome service worker).
- O4 Edge: repeat O1 quickly; expect same result (it was fine before; confirm no regression).

## Open questions
- Should navigations use `reload` or `no-cache`? Tests accept either for fetches.
- Should the worker also fall back to the cache when the network returns 5xx? Existing behaviour caches and returns the error response; left unchanged and untested.
