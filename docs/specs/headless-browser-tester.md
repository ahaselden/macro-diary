# Headless browser tester (spec)

## Purpose
A dev-only tool that lets an agent drive the PWA in its own headless Edge/Chrome (Playwright via `playwright-core`, system browser channel, no browser download) without touching the user's browser pane. It is never shipped, never needed by CI's `npm test`, and can never reach the live internet.

## Contract

Everything lives in `tools/browser-test/` with its own `package.json` (dependency `playwright-core` only). The root `package.json` stays dependency-free.

### `tools/browser-test/stubs.mjs` (PURE; no Playwright import; node built-ins or nothing; never throws)
- `routeFor(url, { appOrigin, stubs }) -> {action:'continue'} | {action:'fulfill', status, contentType, body} | {action:'abort'}`
  - URL on `appOrigin` (e.g. `'http://127.0.0.1:5123'`; `localhost` and `127.0.0.1` with the same port count as the same origin) -> continue.
  - `stubs`: array of `{ match: string|RegExp, status?: number (default 200), json?: any, body?: string, contentType?: string }`. First stub that matches wins (string = substring of the full URL; RegExp = `.test`). `json` -> `JSON.stringify`, contentType default `application/json`; otherwise `body` string, contentType default `text/plain`.
  - Any other URL -> abort (a test can never reach Open Food Facts, USDA, Supabase, fonts, ...). `data:`, `blob:`, `about:` -> continue.
- `summarize(results) -> { passed, failed, ok, text }`; results are `[{ name, ok, error?, consoleErrors?: string[], screenshot?: string }]`.
- `isLocalUrl(u) -> boolean`: true only for http(s) URLs whose host is `localhost`, `127.0.0.1` or `[::1]`.

### Other files (not unit-testable here)
`lib.mjs` (starts `scripts/serve.mjs` on a free port, launches the browser with a throwaway profile, collects console errors, applies stubs, device emulation), `run.mjs` (CLI `node tools/browser-test/run.mjs [scenario files]`, prints a report, non-zero exit on failure), `scenarios/smoke.mjs`, `scenarios/barcode-from-photo.mjs` (each `export default` an async function), `README.md`, and `.claude/agents/browser-tester.md`.

## Behaviours
Pure logic (`tests/headless-browser-tester.test.js`):
1. `routeFor` continues for the app origin, including the localhost / 127.0.0.1 alias with the same port, but not a different port.
2. A matching string stub fulfils; the first matching stub wins.
3. `json` is serialised, status defaults to 200, content type defaults to `application/json`; `status`/`contentType` overrides are honoured.
4. A `body` stub defaults to `text/plain`; a RegExp match works.
5. Any unmatched external URL aborts (OFF, USDA, Supabase, fonts examples).
6. `data:`, `blob:`, `about:` continue.
7. Hostile input never throws: undefined/non-string/huge url -> abort; bad `stubs` (non-array, null entries, throwing getters, invalid RegExp-like objects) are ignored; a later good stub still works; missing options object -> abort for externals.
8. A stub cannot make the app origin be intercepted (app origin wins over stubs) and a stub with a substring of the app URL does not fulfil app URLs.
9. `summarize` counts, `ok` only when at least one scenario ran and none failed, text has PASS/FAIL lines with error and console errors, and a final `N passed, M failed` line.
10. `summarize` of an empty list or a non-array -> `ok:false`, text says no scenarios ran; malformed entries are tolerated; error text truncated to 500 chars.
11. `isLocalUrl` true for localhost/127.0.0.1/[::1] over http(s), false for other hosts, look-alikes (`localhost.evil.com`, `127.0.0.1.evil.com`, userinfo tricks), other schemes and non-strings.

Static checks (weak: they read files; they cannot show the tool works):
12. Root `package.json` has no `dependencies` / `devDependencies`.
13. `tools/browser-test/package.json` exists, is private, depends on `playwright-core` only.
14. `.gitignore` ignores `tools/browser-test/node_modules`.
15. No file under `tools/` (excluding `node_modules`) nor the agent file contains `Co-Authored-By`.
16. `sw.js` SHELL does not mention `tools/`.
17. Agent file has frontmatter `name: browser-tester` and a description; its `tools:` line has no `Edit`; its body says it never edits `js/`, `css/`, `sw.js`, never pushes or merges, uses its own port and stops its server.
18. Scenario files and `run.mjs`, `lib.mjs` exist; each scenario has `export default async`.
19. README mentions `npm install` in that folder, the Windows/Edge note, and that real-phone camera, wake lock and real food-database data are NOT covered.

## Edge cases and hostile input
Covered in 7, 8, 10, 11. Also: stub `match` of empty string (matches everything) is allowed only because stubs are test-author supplied; it still cannot override the app origin (8).

## Cannot be tested automatically (manual checklist)
- [ ] Run `node tools/browser-test/run.mjs` on Windows with Edge installed: smoke and barcode scenarios pass.
- [ ] Run it while the user is also using the browser pane: the user's pane is unaffected (throwaway profile, own port).
- [ ] Run with no Edge/Chrome installed: a clear message saying so, non-zero exit.
- [ ] A deliberately failing scenario gives exit code 1 and a FAIL line.
- [ ] Server is stopped and no node/msedge process remains after the run.
- [ ] A scenario that tries a real external fetch is aborted, not sent.
- [ ] `npm test` in the repo root still passes without installing the tool's dependencies.

## Open questions
- Is a stub's `status` outside 100-599 clamped or ignored? Not tested.
- Does `summarize` list screenshot paths? Format unspecified; not tested.
- Exact wording of "no scenarios ran" is not fixed; tests match `/no scenarios/i`.
