# Import dev tools and a site corpus (spec)

## Purpose
Follow-up to recipe import (PR #16, `docs/specs/recipe-import.md`, D29). It lets a developer try import end-to-end locally without deploying `supabase/functions/fetch-recipe` (a local Node stand-in for that function), keeps per-site regression snapshots WITHOUT committing any third-party text (a git-ignored local folder plus a tiny corpus runner), and fixes two parser quirks found on a real page.

Owner constraint: no third-party or copyright-sensitive recipe text is ever committed. Every committed fixture is an invented recipe on a reserved domain (`example.*`, `*.test`); real snapshots live only in the git-ignored `tests/local-sites/`.

## Contract

### A. `scripts/lib/fetch-recipe-core.mjs` (dev only; plain ESM; imports only `node:` builtins and `../../supabase/functions/fetch-recipe/guard.js`)
`createFetchRecipeHandler({ fetchImpl = globalThis.fetch, resolveHost }) -> async handle({ method, bodyText }) -> { status:number, json:object }`.
`resolveHost(hostname) -> Promise<string[]>` (injected; the mock server passes `node:dns/promises` `lookup(h,{all:true})` mapped to addresses). It never throws out of `handle`.
It implements the same contract as `index.ts` (recipe-import spec section 3): answers are `{ok:true, finalUrl, contentType, html}` or `{ok:false, error}`.

### A2. `scripts/mock-supabase.mjs` (existing)
Gains `POST /functions/v1/fetch-recipe` served by the core with real `fetch` and `node:dns/promises`. OPTIONS stays answered. The server listens on `127.0.0.1` only.

### B. `scripts/lib/site-corpus.mjs` (dev only; plain ESM)
- `siteSlug(url) -> string`: from host + last path segment; only `a-z0-9-`; <= 60 chars; never empty; no path separators, no `..`; stable; anything that is not a usable URL (including non-strings) -> `'site'`.
- `buildFixture(url, html, nowMs) -> { sourceUrl, fetchedAt, node }`: `node` is the first Recipe from `extractRecipeJsonLd(html)` or `null`. Result is JSON-serialisable.
- `expectedFor(node) -> importFromJsonLd(node)` result.
- `checkSite(fixture, expected) -> { ok:boolean, diffs:string[] }`: runs `importFromJsonLd(fixture.node)` and compares with `expected`; `ok` is true exactly when deep-equal; `diffs` are human-readable, one or more per differing field and name the field (e.g. `tags`), `[]` when ok.
- `runCorpus(dir, fsApi = node:fs/promises) -> Promise<{ total, passed, failed:[{name,diffs}], skipped:string[] }>`: `fsApi` offers `readdir(dir)` and `readFile(path,'utf8')` like `node:fs/promises`. Each `<name>.json` (not `*.expected.json`) is one case. A missing `<name>.expected.json`, unreadable or invalid JSON is a failure entry (never a throw). A missing `dir` gives `total 0`, no error. `total = passed + failed.length`.

### B2. `scripts/site-corpus.mjs` (CLI) and `package.json`
- `add <url> [name]`: validates with the guard's `checkUrl` BEFORE any network, fetches, writes `tests/local-sites/<slug>.json` and `<slug>.expected.json` for human review, refuses to overwrite without `--force`, prints a summary. The file name always comes from `siteSlug` (also for a user-supplied `name`).
- `check`: runs the corpus on `tests/local-sites`; exit 1 on any failure; exit 0 with a friendly message when the folder is empty or missing.
- npm scripts: `"test:sites": "node scripts/site-corpus.mjs check"`, `"sites:add": "node scripts/site-corpus.mjs add"`. `npm test` is unchanged and does not touch the local folder or the network.
- `.gitignore` contains `tests/local-sites/`.

### C. `js/domain/recipe-import.js` (behaviour change)
- C1 `recipeCategory` / `recipeCuisine` strings (and each array element) are split on commas like `keywords`.
- C2 `recipeIngredient` lines (string form and array form) that end with `:` and contain no digit are dropped.

## Behaviours

Part A: fetch core (`tests/fetch-recipe-core.test.js`)
1. Any method other than POST answers 405 with `{ok:false,error}`; fetch is not called.
2. A body longer than 4096 chars answers 413; exactly 4096 chars is processed.
3. Garbage / non-object JSON / missing or non-string `url` / non-string body answers 400 `{ok:false,error}`; `__proto__` smuggling does not supply a url.
4. A url refused by `checkUrl` answers 400 with its reason as `error`; neither resolveHost nor fetch is called.
5. Host check: resolveHost throwing, returning `[]`, or returning ANY private address (even mixed with public ones) is refused (`ok:false`, status >= 400 and not 404), fetch not called. IP-literal hosts are not resolved.
6. A public page answers 200 `{ok:true, finalUrl, contentType, html}` with exactly those keys.
7. Redirects (301/302/303/307/308) are followed manually (`redirect:"manual"`); every hop re-runs the host check (resolveHost is called for each new host); a hop to a private literal or a hostname resolving privately is refused and never fetched; a missing Location is `ok:false`; 3 redirects then a page succeeds, 4 redirects fail.
8. A fetch that does not finish is aborted after `TIMEOUT_MS` through the `AbortController` signal passed to fetch, answering `ok:false`.
9. A page longer than `MAX_BYTES` is cut to `MAX_BYTES` and still `ok:true`.
10. Accepted content types: `text/html`, `application/xhtml+xml`, `application/ld+json`, `text/plain` (case and parameters ignored). Anything else, including no content type, is `ok:false`.
11. A non-2xx upstream answer is `ok:false`.
12. Outgoing headers are built from scratch: exactly `User-Agent` (non-empty) and `Accept`, whatever the caller's body contained.
13. Error strings are short fixed strings; they never contain page content or the text of a thrown error.
14. Static: the core imports only `node:` modules and the guard.

Part A2: mock server (`tests/fetch-recipe-core.test.js`, static source checks only)
15. Route string `/functions/v1/fetch-recipe` present; imports the core and `node:dns/promises`.
16. The listen call names `127.0.0.1` and nothing binds all interfaces.
17. The header comment says development only and mentions fetch-recipe; `sw.js` SHELL does not list anything under `scripts/`.

Part B: corpus (`tests/site-corpus.test.js`)
18. `siteSlug` rules: charset, length, never empty, stable, includes host and last segment for a normal URL.
19. `siteSlug` hostile: `../../etc/passwd`, `..\\..\\x`, unicode, 500-char host/path, empty, non-strings, percent-encoded traversal, never contains `/ \ ..` and is never empty.
20. `buildFixture` takes the first Recipe, records the url and a time, `null` node when no Recipe, JSON round-trips.
21. `expectedFor` equals `importFromJsonLd`.
22. `checkSite` passes on a hand-computed expectation and reports named per-field diffs when a field differs; `ok` false with a non-empty `diffs`.
23. `runCorpus` on a temp dir: counts a pass and a field difference with the case name.
24. `runCorpus`: missing expected file and invalid JSON (fixture or expected) are failures, not crashes.
25. `runCorpus`: empty dir and missing dir give `total 0`, no throw, no failures.
26. `.gitignore` lists `tests/local-sites/`; `git check-ignore` agrees and `git ls-files tests/local-sites` is empty (skipped if git is unavailable).
27. package.json scripts `test:sites` and `sites:add` exist exactly as in the contract; `npm test` script is unchanged.
28. CLI (behavioural, no network): `add` with a private/localhost/garbage/non-http address exits non-zero and creates nothing; an unknown command exits non-zero.
29. CLI (static, weak): source references `tests/local-sites` (via `local-sites`), `checkUrl`, `siteSlug`, `--force`, an exists/exclusive-write guard, and never builds a write path from raw `argv`.
30. Committed fixtures under `tests/fixtures/site-corpus/` are `.json` only, use reserved example/test hosts, and the committed corpus passes `runCorpus` end to end.

Part C: parser (`tests/import-dev-tools-parser.test.js`)
31. Category/cuisine strings split on commas ("Dinner, Meal Prep" -> "Dinner","Meal Prep"); array elements too; trimmed; no empty tags.
32. Split tags are still de-duplicated case-insensitively across category, cuisine and keywords, in the order category, cuisine, keywords; still at most 20 tags of at most 40 chars.
33. Ingredient sub-headings (ends with `:`, no digit) are dropped from array and string forms; trailing whitespace tolerated.
34. An ingredient ending with `:` that has a digit, or containing `:` mid-line, or a normal one, is kept; order of the rest is unchanged.
35. Existing behaviour unchanged: keywords handling, empty results and warnings (the old `tests/recipe-import*.test.js` must pass unchanged).
36. The synthetic committed fixture `synthetic-lentil-soup` produces its hand-written golden through `runCorpus`.

## Edge cases and hostile input
- The dev handler must refuse private targets exactly as the real one: literals (`127.0.0.1`, `[::1]`, `10.x`, `169.254.169.254`), names resolving to private addresses (nip.io style), redirects to either.
- Huge pages, non-HTML types, upstream error pages with secrets in the body: never echoed.
- Caller body trying to inject headers/extra fields: ignored.
- Slugs and CLI: no path traversal, nothing is written outside `tests/local-sites/`.
- Nothing real committed: committed fixtures use invented text and `.test`/`example` hosts (behaviour 30 enforces the host part; the "invented text" part is a review item).
- C: `"Optional Toppings:"`, `"For the sauce:"` dropped; `"salt:"` is also dropped (accepted, not special-cased); `"Dressing, 2 parts:"` kept.

## What cannot be tested automatically (manual checklist)
- [ ] `node scripts/mock-supabase.mjs`; in the app Settings -> Sync use `http://localhost:54321` and any 20+ character key.
- [ ] Recipes -> Import a real recipe address; the editor opens pre-filled. A private address (`http://192.168.1.1/`) shows a friendly refusal.
- [ ] Console shows no secrets; the dev server is reachable only from this machine (try the LAN IP from a phone: it must NOT connect).
- [ ] `npm run sites:add -- <url>` writes two files in `tests/local-sites/`; review the `.expected.json` by hand, then `npm run test:sites` passes; edit the expectation and it fails with a readable diff.
- [ ] `git status` shows nothing from `tests/local-sites/`.

## Honest limits
- Behaviours 15-17 and 29 are STATIC text checks: they prove strings exist, not that the server works or that the code path is reachable. Behaviour 28 exercises the CLI only up to the point of refusal.
- The dev server is not the real runtime: Node DNS vs Deno DNS (a name can resolve differently), no platform CPU/memory/time limits, CORS preflight and JWT checks of the real function are not reproduced, and redirects/streams may differ in edge cases. A pass locally does not prove the deployed function works.
- Part A tests use a fake fetch and fake resolver; real HTTP is never exercised. The timeout test uses mocked timers and assumes `setTimeout` (not `AbortSignal.timeout`).
- "Invented text" in committed fixtures is not machine-checkable.

## Open questions (not tested)
- `fetchedAt` format (ISO string vs number): test accepts either.
- `skipped` contents of `runCorpus` (assumed: directory entries that are not cases); only its type is tested. An `.expected.json` with no fixture is unspecified.
- Status codes for host-check and upstream failures are not fixed beyond "not 404 and >= 400" for host refusals.
- Whether `siteSlug` strips a leading `www`: not tested.
- Fetch-time details of the CLI `add` (UA, size cap): assumed to reuse the core with real fetch/dns.

## Verification log (implementer, Windows, desktop built-in browser)
- Manual checklist run against one real page (a public recipe site the owner named): the stand-in returned the page; private (169.254.169.254) and localhost targets were refused; `sites:add` saved a snapshot to the git-ignored folder, a second `add` was refused without `--force`, `test:sites` passed 1/1, `git status` did not list the folder; in the app (Settings -> own project `http://localhost:54321`) Import by web address filled the editor (name, 6 servings, 55 min, 7 tags with the category split, 15 ingredient lines without the "Optional Toppings:" label, source link, nutrition warning), saved-recipe count unchanged. Sync settings were restored afterwards.
- A test-designer test was changed after implementation: behaviour 10 had a "no content type" case that a `Response` with a string body could not produce (it adds `text/plain`); the designer rebuilt that case with a stream body. No other test was edited.
- Not verified: the real Deno function, a phone, Linux/macOS.
