# Spec: recipe import from a website or pasted text

## Purpose
Let the user turn a recipe page (schema.org JSON-LD) or pasted recipe text into a NEW recipe that opens in the existing editor for review, with the source link kept. Pages are fetched by one small serverless function on the user's own Supabase project (browsers cannot fetch other sites); parsing is pure and runs in the browser, and nutrition on the page is deliberately NOT imported (the user links foods, so the numbers stay honest).

Provenance: written red-first by the test designer from the task plan, `CLAUDE.md`, `core/schema.js` (`sanitizeRecipe`), `domain/recipes.js` / `ingredient-parse.js` public behaviour, `services/sync/config.js` (`effectiveConnection`) and the UI conventions of the plan-month specs. No implementation existed. Owner decisions (2026-11-10): one small serverless function is OK; a "private copy with a source link" is OK for imported recipes. No schema change: `SCHEMA_VERSION` stays 5, `STORAGE_KEY` never changes, recipes already have `source` (<= 500 chars).

Tests: `tests/recipe-import.test.js` (R*, domain), `tests/recipe-import-guard.test.js` (G* guard, F* weak handler checks), `tests/recipe-fetch.test.js` (S*), `tests/recipe-import-ui.test.js` (U*, weak). Fixtures: `tests/fixtures/recipe-import/` (`*.html`, `paste-recipe.txt`) with hand-written goldens in `expected/*.json`.

## Contract

### 1. `js/domain/recipe-import.js` (domain; imports only `./recipes.js`, `./ingredient-parse.js`, `../core/{constants,format,dates,schema}.js`; no DOM/DOMParser/fetch/storage/clock/random; every export never throws on any input)
| Export | Shape |
|---|---|
| `extractRecipeJsonLd(html)` | `object[]`: the raw parsed Recipe nodes from every `<script type="application/ld+json">` block in document order. Non-string input -> `[]`. |
| `parseDuration(v)` | whole minutes (number) or `null`. |
| `parseYield(v)` | servings (number) or `null`. |
| `importFromJsonLd(node)` | a **result** (below). Takes ONE node; anything that is not a plain object (null, string, array...) gives the empty result with warnings. |
| `importFromHtml(html)` | result for the FIRST Recipe found, or `null` (no Recipe, microdata-only page, non-string). |
| `importFromText(text)` | result for pasted plain text. Never `null`. |
| `toRecipe(result, id, now, sourceUrl)` | an app recipe (below). |

**Result** has EXACTLY these keys: `{ name, description, servings, totalTime, tags, steps, ingredients, warnings }` - `name`/`description` strings, `servings` number (never null: 4 when unknown), `totalTime` minutes or `null`, `tags`/`steps`/`ingredients`/`warnings` arrays of strings. `ingredients` are RAW lines (not parsed). There is no `source`, no nutrition field.

**Recipe** from `toRecipe`: `newRecipe(id, now)` shape (`id,name,description,source,servings,totalTime,tags,steps,ingredients,favorite,updatedAt`) with `favorite:false`, `updatedAt:now`, `ingredients` built with `newIngredient(line, <unique id <= 80 chars>)` (so `food:null`, `grams:null`), and `source` = `sourceUrl` only if it is a valid `http:`/`https:` URL without credentials and <= 500 chars, else `''`. It must satisfy `sanitizeRecipe(r, r.id)` deepEqual `r`. Empty/missing name becomes `'Imported recipe'` so the recipe is never silently dropped by sanitising. `toRecipe` does not mutate its input and never throws.

### 2. `supabase/functions/fetch-recipe/guard.js` (plain ESM, NO imports, no Deno/Node/browser APIs, so Node tests import it)
`checkUrl(str) -> {ok:true,url} | {ok:false,reason}`, `isPrivateAddress(ip) -> boolean`, `resolveRedirect(currentUrl, location) -> string | null`, constants `MAX_BYTES = 2*1024*1024`, `TIMEOUT_MS = 8000`, `MAX_REDIRECTS = 3`.

### 3. `supabase/functions/fetch-recipe/index.ts` (Deno handler; cannot run under Node)
Contract (verified only by the weak static checks F1-F4 and the manual checklist):
- `POST` with JSON `{url}`. `OPTIONS` preflight answers CORS, allowing request headers `authorization, apikey, content-type, x-client-info`.
- Every response is JSON: `{ok:true, finalUrl, contentType, html}` or `{ok:false, error}` (`error` is a short, fixed, user-readable string; it never contains page content). Page-level failures use a non-404 status or `ok:false`; a 404 WITHOUT the `{ok:false}` shape therefore means "function not deployed" (see S7).
- Validates with `checkUrl`, follows redirects MANUALLY (`redirect:"manual"`, at most `MAX_REDIRECTS`, each hop through `resolveRedirect`), resolves DNS and refuses if ANY resolved address satisfies `isPrivateAddress` (this is what stops `127.0.0.1.nip.io`-style names; `checkUrl` alone cannot), aborts after `TIMEOUT_MS`, stops reading after `MAX_BYTES`, accepts only `text/html`, `application/xhtml+xml`, `application/ld+json`, `text/plain`, sends a generic `User-Agent`, builds outgoing headers from scratch (never forwards the caller's `Authorization`/`apikey`), does not log URLs or page bodies, stores nothing, uses no secrets and never the `service_role` key.

### 4. `js/services/recipe-fetch.js` (services; injectable fetch; no DOM)
`recipeImportAvailable(conn) -> boolean` (`conn` = `effectiveConnection()` result: non-empty `url` and `anonKey`, `source !== 'none'`); `fetchRecipePage(conn, pageUrl, fetchImpl = fetch) -> Promise<{html, finalUrl}>`. Failures are `Error`s with friendly messages (<= 300 chars) and always arrive as a rejected promise, never a synchronous throw.

### 5. UI
`index.html` button `#rcImport` beside `#rcNew`; new `js/ui/recipe-import.js` exporting `initRecipeImport` (wired from `js/main.js`); `openRecipeEditor(recipe, notes)` in `js/ui/recipe-editor.js` accepts a pre-filled draft plus notes (warnings). New shipped files go in `sw.js` `SHELL` and `CACHE` is bumped (the implementer's job; U11 checks it).

## Decisions made in this spec (the plan left them open)
- D-dur: `parseDuration` accepts ISO-8601 `PnDTnHnM` (days = 1440 min); seconds are not needed. **Bare numbers are NOT accepted** (unit would be a guess). Zero, empty, trailing junk, negatives -> `null`. Values above 30 days (43200 min, inclusive) -> `null`.
- D-yield: `parseYield` takes the FIRST number in a string, or the first parseable element of an array (so `"2-3 servings"` -> 2, `"6 to 8"` -> 6); a finite number > 0 is used as is. `null` for 0, negative, NaN/Infinity, no number, or above 1000 (1000 itself is valid).
- D-clean: text cleaning order is: block tags (`p`, `li`, `br`, `div`, headings) act as a line/space break, remaining tags are removed, then entities are decoded ONCE (so `&amp;lt;` -> `&lt;`, `&lt;` -> `<`), then whitespace (including nbsp) is collapsed and trimmed. Decoded `<` is NOT re-stripped; entity-encoded markup (`&lt;script&gt;`) stays inert text and the UI's `esc()` is the defence. Unknown entities stay literal. Named entities required: `amp lt gt quot apos nbsp frac12`; numeric decimal and hex required; invalid code points must not throw or produce NUL.
- D-steps: a string `recipeInstructions` is split into steps on newlines and block-level HTML; leading bullets (`- * bullet en-dash`) and numbering (`1.` `2)`, followed by whitespace) are stripped, but `1.5 cups...` / `2 eggs...` are kept. `HowToSection` is flattened; section names are NOT steps (open question below). A `HowToStep` uses `text`, falling back to `name`.
- D-ing: `recipeIngredient` string is split on newlines only (never commas); each line cleaned and trimmed, blanks/non-strings dropped, duplicates kept, each line <= 300 chars (the `sanitizeIngredient` bound), at most 200.
- D-tags: tags = `recipeCategory` + `recipeCuisine` + `keywords` (string split on commas, or array), cleaned, de-duplicated case-insensitively, each <= 40, at most 20.
- D-own: only OWN properties of a node are read (`__proto__`, `constructor`, inherited `name` are ignored).
- D-warn: warnings are non-empty, de-duplicated strings. Triggers: no ingredients (mentions "ingredient"), no steps (mentions step/instruction/method/direction), servings unknown (mentions "serving" and "4"), no name (mentions title/name), nutrition object present on the page (mentions "nutrition"; nothing is imported). A complete recipe without nutrition has `warnings` equal to `[]`.
- D-text: pasted text: first non-empty line is the title (leading `#`/bullets stripped; if that line is itself a section header there is no title and `name` is `''` with a warning). Headers match case-insensitively with optional `#`s and trailing colon: Ingredients; Instructions / Method / Directions / Steps; either order; a section runs until the next header or end. `Serves`/`Servings`/`Yield` (optional colon, first number wins) and `Total time`/`Total` (`45 minutes`, `1 hour 15 minutes`, `1 hr`, `2 hours`, `45 mins`) are meta lines and never end up in ingredients/steps. CR, CRLF and LF are all line breaks. With no headers it returns the title plus warnings (it may or may not guess ingredient lines; tests only require the matching warnings when a list is empty).
- D-url: `toRecipe` keeps `source` only when the string is already a valid http(s) URL <= 500 chars without credentials (not truncated: a cut link is a broken link). It is stored exactly as given (tests use URLs with a path, so URL normalisation does not matter).
- D-guard: `checkUrl` returns the `new URL(...).href`-style normalised absolute string. Public IP literals are allowed; private/reserved ones are rejected AFTER URL parsing (so decimal/hex/octal/short IPv4 spellings are caught). `isPrivateAddress` fails CLOSED: anything that is not a valid IPv4/IPv6 address returns `true`. `resolveRedirect` allows an `https` -> `http` hop (http is a valid scheme here) but refuses anything `checkUrl` refuses; unresolvable input -> `null`.
- D-client: a 404 whose body is NOT `{ok:false,error}` means "import service is not set up on your project yet"; a body with `{ok:false,error:string}` (any status) shows that string (markup stripped, cut to the 300-char message bound). `html` and `finalUrl` are both required strings in a success answer; `finalUrl` must be a plain http(s) URL (it becomes the source link); `html` longer than `MAX_BYTES` characters is refused as too large.

## Behaviours
Domain (`tests/recipe-import.test.js`)
- R1 `extractRecipeJsonLd` reads a bare Recipe object.
- R2 arrays, `@graph`, an `@graph` inside an array; only Recipe nodes returned, several recipes in order.
- R3 `@type` as string or array; non-Recipe types (`Article`, `HowTo`, `RecipeCollection`, none) excluded.
- R4 script attribute order/quoting/case any; `data-type=` look-alike, `application/json`, plain scripts ignored.
- R5 HTML-comment, CDATA (three styles), BOM and whitespace wrappers tolerated.
- R6 several blocks, document order, malformed JSON skipped while others still read.
- R7 never throws; `[]` for non-strings, empty, garbage, throwing `toString`.
- R8 `parseDuration` ISO table (hand computed). R9 garbage/zero/numbers/over-cap -> `null`.
- R10 `parseYield` table. R11 never 0/negative/NaN/absurd.
- R12-R15 goldens from fixtures: `@graph` page (also checks exact result keys and the nutrition warning), array form with `Serves 6` and entities, HowToSection flattening, one-string instructions/ingredients (no warnings).
- R16 instruction shapes. R17 string instructions: HTML to steps, numbering stripped, quantities kept.
- R18 ingredients array/string/blank handling. R19 tags merge/dedupe.
- R20 text cleaning (tags, entities once, whitespace). R21 bounds equal `sanitizeRecipe`. R22 servings/time defaults. R23 warnings (each trigger, none for complete, nutrition not imported). R24 hostile shapes and no mutation (deep-frozen input).
- R25 `importFromHtml` first-Recipe/null.
- R26 text golden (+CRLF, CR). R27 header variants/order/ingredients-only/header-first. R28 line cleanup. R29 meta lines. R30 no-header and junk text, bounds.
- R31 `toRecipe` shape, parser equivalence, `sanitizeRecipe` round trip. R32 `source` validation. R33 hostile/empty results.
- R34 hostile fixture. R35 prototype safety. R36 pasted markup inert. R37 resource bounds (huge, nested 100000 deep, cyclic, unterminated). R38 purity (static source check).

Guard (`tests/recipe-import-guard.test.js`)
- G1 constants. G2 accepts public http(s) (including public IP literals). G3 non-strings/empty/length 2048 boundary. G4 schemes. G5 credentials. G6 ports. G7 localhost/.local/.internal/single-label/trailing dot. G8 private IPv4 literals incl. 169.254.169.254. G9 IPv6/mapped literals. G10 odd IPv4 spellings (each hand-checked against the WHATWG parser). G11 `isPrivateAddress` range edges both sides. G12 fails closed. G13-G14 `resolveRedirect`. G15 `guard.js` is import-free pure ESM.
- F1-F4 WEAK static checks of `index.ts` (below).

Client service (`tests/recipe-fetch.test.js`)
- S1 availability. S2 request shape and nothing else sent (no session, no diary). S3 success. S4 default `fetch`. S5 validation before any request. S6 network/timeout messages. S7 404 handling. S8 401/403/429/5xx. S9 `{ok:false,error}`. S10 non-JSON/wrong shape. S11 `finalUrl` must be http(s). S12 2 MiB limit. S13 no DOM/storage/ui imports.

UI (`tests/recipe-import-ui.test.js`, WEAK)
- U1 `#rcImport` button. U2 `initRecipeImport` exported and wired. U3 imports/layering. U4 URL field only if available + paste textarea + labels. U5 busy state, inline errors, no `alert`. U6 `esc()` on all data interpolations. U7 opens editor unsaved with draft and notes; never saves. U8 source URL passed; only the service touches the network. U9 editor signature. U10 notes escaped in editor. U11 `SHELL` and `CACHE` bump. U12 no schema/storage change (passes today; it is a regression guard, not a red test).

## Edge cases and hostile input covered
Empty/whitespace/NUL/non-string/huge input everywhere; `__proto__`/`constructor` keys and inherited properties; `<script>`, `<img onerror>`, `javascript:` hrefs, entity tricks and invalid numeric entities in recipe text; absurd yield; 1e6-element arrays; 100000-deep and cyclic structures; unterminated and repeated `<script` (ReDoS-style) pages; `javascript:`/`data:`/`file:`/credential URLs as page URL, redirect target and source link; private, metadata, mapped and obscure IP spellings; server error text containing markup or 5000 chars; caller diary/session never sent.

## What cannot be tested automatically (manual checklist)
Nothing here is verified by any test. The handler's real behaviour is UNVERIFIED until the owner deploys (`supabase functions deploy fetch-recipe`).
1. Deploy; from the app (own or default project) tap Recipes > Import, paste a real recipe URL with JSON-LD (e.g. a large recipe site); the editor opens pre-filled, unsaved, Source shows the URL, warnings visible, ingredients unlinked.
2. Cancel/close the editor: nothing is saved. Tap Save: it appears in the list and syncs.
3. Without a backend configured: no URL field, a short note, paste still works. With the function undeployed: message says the import service is not set up.
4. Paste the page source (View Source) of a recipe page and plain text (fixture `paste-recipe.txt`); both import.
5. Hostile checks against the deployed function (curl with the anon key): `http://127.0.0.1/`, `http://169.254.169.254/`, `http://localhost/`, `http://[::1]/`, a URL on a public host that redirects to `http://127.0.0.1/`, a hostname that resolves to a private address (e.g. `127.0.0.1.nip.io`), `file:///etc/passwd`, a 50 MB page, a server that never answers, a non-HTML content type (PDF/image): each returns `{ok:false,error}` quickly and the function logs contain no URLs or bodies.
6. CORS: works from the GitHub Pages origin and `localhost:8080`; a wrong or missing anon key returns 401 and the app says to check the key.
7. A page with microdata only, a paywalled/bot-protected page, and a JS-rendered page fail with a clear message and the user can fall back to paste.
8. A recipe with `<b>`/`&amp;`/emoji in names shows correctly and no HTML is interpreted anywhere (editor fields, notes, list).
9. Offline: Import dialog opens (service worker), URL fetch fails with the network message, paste still works.
10. Service worker: after deploy the new files are cached (CACHE bumped), app still loads offline.

## Honest limits
- Sites without JSON-LD (old microdata-only blogs), behind bot protection/paywalls, or rendered client-side will fail and fall back to paste. No real site is fetched in tests; fixtures are anonymised and hand written.
- The F* and U* tests only read source text: they cannot show that CORS, DNS re-checking, redirects, timeouts, streaming limits, the dialog or escaping work at runtime. A handler that mentions `redirect: "manual"` but never calls it would pass F1. Treat them as tripwires against regressions (a banned word appearing), not as proof.
- S6 verifies the abort/timeout error mapping and that a signal is passed, not the actual client timeout length.
- `checkUrl` cannot see what a hostname resolves to; the DNS re-check in `index.ts` is therefore essential and untested here. DNS rebinding between the check and the connection is not fully closable from a Deno edge function; the manual hop and MAX_BYTES/timeout limits reduce, not remove, that risk.
- Importing copies third-party recipe text into the user's private store with a source link (owner-approved); nothing is republished.

## Open questions (not tested; implementer's choice must be recorded in docs/DECISIONS.md)
1. `totalTime` fallback: when JSON-LD has no `totalTime` but has `prepTime`/`cookTime` (and text has `Prep`/`Cook` but no `Total`), should the sum be used? Untested either way.
2. `HowToSection` names: dropped (tested) vs kept as a heading step. Dropping loses "For the sauce" context.
3. `@type` spelled `http://schema.org/Recipe` or `schema:Recipe`, and `mainEntity`/`mainEntityOfPage` wrappers: not required, not tested.
4. Legacy `ingredients`/`recipeInstructions` as a single `<ul>` blob: only the HTML-list-in-a-string case is tested.
5. URLs containing tabs/newlines/control characters: the WHATWG parser silently strips them; should `checkUrl` reject them outright? Untested.
6. `fec0::/10` (deprecated site-local), NAT64/6to4 embeddings of private IPv4: not required, not tested; a stricter guard is welcome.
7. Text paste: sub-headings inside Ingredients ("For the sauce:"), a lone "Makes 12", `Step 1:` prefixes, and Prep/Cook-only times are unspecified.
8. `verify_jwt` for the function: Supabase's new publishable keys are not JWTs; the owner may need `--no-verify-jwt` if the app key format does not pass the gateway. Deployment/config (`supabase/config.toml`) is not tested and not touched by the test designer.
9. Whether a result with only a name and no ingredients and no steps should be importable at all (currently allowed with warnings).

## Verification log (implementer, desktop built-in browser only; the deployed function was NOT exercised)
- Checklist 3 (partly): with the built-in default project the URL field shows; a mocked 404 from the function shows "Recipe import is not set up on your project yet. Paste the recipe instead."; the button re-enables. Not checked: the no-project note (the default project is always present in this build).
- Checklist 4 (partly): pasted recipe text and pasted page source both open the editor pre-filled, unsaved (saved-recipe count unchanged); a mocked successful function answer fills the name, servings and the Source field with the final URL. Not checked: a real page, View Source of a real site.
- Checklist 8 (partly): a hostile page source (`<img onerror>`, `<b onmouseover>`, `javascript:` link, `<script>` text) produced plain text in the editor fields and the notes, no injected element and no script run. The recipe list was not re-checked.
- Checklists 1, 2 (real URL), 5, 6, 7, 9, 10: NOT done (need the deployed function, a phone or offline mode).
- Decisions on the open questions are recorded in DECISIONS D29 (totalTime falls back to prep + cook; HowToSection names dropped; the guard also checks NAT64 and 6to4 embedded addresses and site-local fec0::/10).
