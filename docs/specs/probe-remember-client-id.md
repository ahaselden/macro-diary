# Spec: the Google Health probe page pre-fills the built-in Client ID

Tests: `tests/google-health-probe-client-id.test.js` (R1-R13). Status: written before the implementation.

## Purpose
The developer probe page (`tools/google-health-probe/index.html`) makes the owner retype the Google OAuth Client ID on every visit. The page now pre-fills the box with the app's built-in public Client ID (D64) and checks whatever is in the box before it starts a sign-in. Nothing in the shipped app changes.

## Decision (owner, option a)
The page keeps its "nothing is saved" rule: **no localStorage, sessionStorage, indexedDB or cookie**. The device-saved Client ID (`macrodiary.googleclient.v1`, written by Settings) is deliberately **not read** by the probe. A Client ID typed over the default is therefore not remembered across visits (accepted: the owner changes the one default instead). There is one place to change at go-public time: `DEFAULT_CLIENT_ID` in `js/services/google-health-api.js`, and the page takes it by import, never as a literal.

## Contract
No new exported function. Layers: this is a dev page under `tools/`, outside the shipped layers; it may import from `js/` (read-only use).
- `tools/google-health-probe/index.html`, `<script type="module">`, imports exactly:
  - `{ DEFAULT_CLIENT_ID }` from `'../../js/services/google-health-api.js'`
  - `{ checkClientId }` from `'../../js/domain/google-health-api.js'`
  - the existing named helpers from `'./probe.js'` (unchanged list).
  No other import, no new external script, no new host. `probe.js`, `sw.js`, `js/`, `css/` do not change.
- On load: `document.getElementById('clientId').value = DEFAULT_CLIENT_ID` (set by script; the `<input id="clientId">` has no `value` attribute).
- `#signIn` click handler: `checkClientId($('clientId').value)`; `ok: false` means set `#status` with `textContent` to the returned `message`, start no sign-in (no `initTokenClient`, no `requestAccessToken`), and when the box held a secret also set the box to `''`. `ok: true` means sign in with the returned `id` (trimmed).
- `checkClientId` (existing, domain) returns `{ ok: true, id }` or `{ ok: false, message }`; messages are fixed text and never echo the input:
  - empty or only spaces: `Enter a Client ID first.`
  - contains `GOCSPX-` (any case): `That looks like a client secret, which must never be pasted here. Use the Client ID, which ends in .apps.googleusercontent.com.`
  - not `^[A-Za-z0-9_-]{10,100}\.apps\.googleusercontent\.com$`: `That does not look like a Client ID. It should end in .apps.googleusercontent.com.`
- The `<label for="clientId">` text says the box is pre-filled with the app's built-in ID, can be replaced, and that the ID ends in `.apps.googleusercontent.com` and is never a secret (exact wording is the implementer's; the test needs the words "pre-filled", "built-in", "replace", "secret" and ".apps.googleusercontent.com").
- The page never contains a client secret literal, so the secret test goes through `checkClientId` only (keeps P20 green).

## Behaviours (tick-list; test ids in brackets)
1. [R1] After load, `#clientId` holds `DEFAULT_CLIENT_ID`, set by the script.
2. [R2] Clicking Sign in unchanged starts sign-in with exactly the built-in ID.
3. [R3] Empty or whitespace-only box: status `Enter a Client ID first.`, no sign-in.
4. [R4] A value containing `GOCSPX-` (any case, with spaces, or after a valid-looking prefix): the secret message, no sign-in, the box is cleared to `''`.
5. [R5] A malformed value (no suffix, too short, spaces, URL, markup, `__proto__`, 5000 characters): the shape message, no sign-in, the box left as typed.
6. [R6] No refusal message, summary or error element echoes the typed text.
7. [R7] A valid ID typed over the default is trimmed and used; it is not echoed in `#status`, `#summary`, `#tokenInfo`, `#gisError` or the check lines.
8. [R8] No storage anywhere: not used by any code path, no reference to `macrodiary.googleclient`, `createClientIdStore` or `CLIENT_ID_KEY`.
9. [R9] (weak) Exactly the three imports above; the only `<script src>` is Google Identity Services.
10. [R10] (weak) The page has no `value=` on `#clientId`, no `*.apps.googleusercontent.com` literal, not the real default's text, no `GOCSPX-`, `client_secret` or `ya29.`; the script assigns `#clientId.value`.
11. [R11] (weak) The label wording above; every id in the page contract stays (`clientId`, `days`, `signIn`, `showNumbers`, `copySummary`, `status`, `tokenInfo`, `gisError`, `check-identity`, `check-steps`, `check-sleep`, `check-exercise`, `summary`).
12. [R12] `docs/BACKLOG.md` has exactly one item numbered 28, unticked, titled `Before making the app public: replace the built-in Google Client ID and finish Google's requirements`, mentioning `DEFAULT_CLIENT_ID`, `100 users`, `verification`, `privacy policy`, `Authorized JavaScript origins`, and that the default in the probe page (`tools/google-health-probe`) must change with it.
13. [R13] `docs/KNOWN-ISSUES.md` has a row about the probe Client ID (pre-filled, typed one not remembered); `docs/DECISIONS.md` has a `## D66.` heading about the probe Client ID.

## Edge cases and hostile input
Empty, spaces, tabs and newlines; a secret in upper or lower case, padded, or following a valid-looking ID; a 5000-character string (the domain check caps the length at 100 before the suffix); markup (`<img onerror>`) and `__proto__` (shown only through `textContent`, and never echoed anyway); a URL; a legacy ID such as `stub-client.example` (now refused: shape); a valid ID with surrounding spaces (trimmed). Pasting a secret must leave nothing of it in the box or on the page.

## Docs deliverables (the implementer adds them; the designer does not write them)
- `docs/BACKLOG.md` item 28, after item 27 (workouts items 24-27 come from another PR): **Before making the app public: replace the built-in Google Client ID and finish Google's requirements.** It must say: change `DEFAULT_CLIENT_ID` (services/google-health-api.js) and, with it, the page default in `tools/google-health-probe` (it follows by import; confirm); the 100 users cap for an unverified client; Google's verification; a privacy policy page; the Authorized JavaScript origins list of the OAuth client.
- A `docs/KNOWN-ISSUES.md` row (next number, 76): the probe is pre-filled with the built-in ID and does not remember a different one (no storage by design); unit tests with a fake DOM and the headless scenarios only.
- `D66` in `docs/DECISIONS.md` (`## D66. Google Health probe: pre-fill the built-in Client ID, store nothing`): what, why (one place to change; keep "nothing is saved"), limits.
- A project memory file (owner's memory, outside the repo; not tested).

## Existing tests this change will touch
- `tests/google-health-probe.test.js` **P22**: it required the literal `Enter a Client ID first` in the page or probe source. The page now gets that text from `checkClientId`, so the test designer has **already removed that one string** from P22's list (comment in place); R3 pins the text instead. Needs the designer's `Test fix (designer)` commit note in the PR.
- **P19** (hosts, the `<script src>` list, `from './probe.js'`): read and checked, no change needed. The new imports are relative paths that the test does not scan (it scans `https?://` URLs and `src=` attributes). The exact import list is pinned by R9 instead.
- **P20** (no `GOCSPX-`/`client_secret`/`ya29.`, no storage, textContent): unchanged; it keeps the page free of the secret literal, so the implementer must not write `GOCSPX-` into the page.
- **P23**, **P21**, `tests/google-health-workouts-probe.test.js` **B16** (probe.js purity: unchanged file) and **B17** (ids, `import {...} from './probe.js'` regex finds the first import; ids; no `googlehealth.` scope other than the two; no `localStorage`): read and checked, no change needed. The page must keep matching them.
- Headless scenarios (in `tools/browser-test/scenarios/`; the designer may not edit them, so these are requested edits):
  - `google-health-probe.mjs` **H2** (line about 62): it clicks `#signIn` straight after load and expects `Enter a Client ID first`. The box is now pre-filled, so it must first `await page.fill('#clientId', '')`. Also H1's expectations stay (only localhost and accounts.google.com hosts; module imports come from localhost).
  - `google-health-workouts-probe.mjs` line 11: `const ID = 'stub-client.example'` is refused by `checkClientId` (shape). It must become a valid shape such as `stub-client-id.apps.googleusercontent.com` (at least 10 characters before `.apps.googleusercontent.com`). Check its C-items that compare `client_id` to `ID`.
  - `google-health-probe.mjs` line 11 `ID = 'stub-client.apps.googleusercontent.com'` is already valid (11 characters before the suffix); no change.
  - Add a headless item (below, C2) for the pre-fill if the owner wants it automated.
- `docs/specs/google-health-probe.md` text (`Enter a Client ID first`, "kept in memory only") stays true; no edit needed.

## What cannot be tested automatically
The fake-DOM tests (R1-R8) run the page's real script with a tiny fake `document`, the real `checkClientId` and the real `DEFAULT_CLIENT_ID`; they do not test layout, the real Google script, the label's look, or that an `<input>` really shows the value. R9-R13 are source-text and word checks: they prove strings are present or absent, not behaviour, and R12-R13 cannot judge whether the backlog text is good. A real Google sign-in needs a real account.

## Headless checklist (browser-tester; Google stubbed as in `tools/browser-test/scenarios/google-health-probe.mjs`: `accounts.google.com/gsi/client` is replaced by a stub that records the config of `initTokenClient` in `window.__cfg`)
- **C1 Pre-filled.** Setup: open `http://localhost:8080/tools/google-health-probe/`, nothing saved. Steps: read `#clientId`. Expect: its value equals the app's `DEFAULT_CLIENT_ID` (the headless test reads it from `/js/services/google-health-api.js`); the label for `#clientId` contains `pre-filled` and `built-in`; `localStorage` and `sessionStorage` have no keys. Covered by headless? yes.
- **C2 Default signs in.** Steps: click `#signIn` without typing. Expect: `window.__cfg.client_id` equals that default; `#status` does not contain the Client ID. Covered by headless? yes.
- **C3 Empty refused.** Steps: select all in `#clientId`, delete, click `#signIn`. Expect: `#status` is exactly `Enter a Client ID first.`; `window.__cfg` is undefined. Covered by headless? yes.
- **C4 Secret refused and cleared.** Steps: type `GOCSPX-not-a-real-secret-value` into `#clientId`, click `#signIn`. Expect: `#status` is exactly `That looks like a client secret, which must never be pasted here. Use the Client ID, which ends in .apps.googleusercontent.com.`; `#clientId` value is empty; no text on the page contains `not-a-real-secret`; `window.__cfg` undefined. Covered by headless? yes.
- **C5 Malformed refused.** Steps: type `hello` into `#clientId`, click `#signIn`. Expect: `#status` is exactly `That does not look like a Client ID. It should end in .apps.googleusercontent.com.`; the box still says `hello`; `window.__cfg` undefined. Covered by headless? yes.
- **C6 Typed ID used, not echoed, not remembered.** Steps: type `fake-test-client-123.apps.googleusercontent.com` (padded with a space each side), click `#signIn`. Expect: `window.__cfg.client_id` equals it without spaces; the stub then answers the token; `#summary` and `#status` do not contain `fake-test-client-123`; after reloading the page, `#clientId` is back to the default and `localStorage` has no keys. Covered by headless? yes.
- **C7 Nothing new loaded.** Expect: requests only to localhost and `accounts.google.com` (and the stubbed Google hosts after sign-in); the module requests `/js/services/google-health-api.js` and `/js/domain/google-health-api.js` return 200. Covered by headless? yes.

### Owner on a real device
- **O1.** Run `npm start`, open `http://localhost:8080/tools/google-health-probe/`: the box shows the built-in ID. Click Sign in with Google and complete it as before: the checks run.
- **O2.** Clear the box, click Sign in: status says to enter a Client ID.
- **O3.** Paste a `GOCSPX-` value (made up is fine): it is refused and the box is emptied.

## Open questions
1. **Numbering (resolved).** Item 24 is the workouts feature (items 24-27, in another PR), so the go-public item is number 28, placed after item 27. R12 assumes 28. If that PR is not yet merged, item 28 may sit after item 23 until it is.
2. Whether the page default should be visible to the owner as "built-in" only in the label, or also in `#status` on load (the plan does not say; the tests require no new status text on load).
3. Exact label wording is open; R11 pins only keywords.
