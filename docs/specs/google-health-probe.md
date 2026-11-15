# Spec: Google Health browser-only sign-in probe (backlog item 20, step 1)

## Purpose
The owner wants to learn whether Google lets a browser-only page (Google Identity Services token model, no backend, no client secret) obtain the Google Health API read scopes. A throwaway developer page plus a setup walk-through answer that question; nothing in the shipped PWA changes.

Written before the implementation by the test designer. Where the request left a rule open this spec FIXES it ("decided here") so tests can pin it; the owner can change it before the build, and the implementer must then ask for the test to be changed, not edit it. Tests: `tests/google-health-probe.test.js` (P1-P24).

**No shipped file changes**: `sw.js` is NOT touched, so no `CACHE` bump; the page is not in `SHELL` and nothing in `index.html` (repo root), `js/` or `css/` links to it. Docs: add a `## D<n>. Google Health probe ...` entry to `docs/DECISIONS.md` (the last number on this branch is D60, other PRs may add more, so the test matches the heading by CONTENT, not by number).

## Contract

### Files (all outside the shipped app)
- `tools/google-health-probe/index.html`: the single static page, vanilla JS, an inline `<script type="module">` that imports `./probe.js`. The ONLY external script is `https://accounts.google.com/gsi/client`.
- `tools/google-health-probe/probe.js`: PURE helpers, ES module, importable in Node with no DOM, no top-level side effects, no `document`/`window`/`fetch` use.
- `docs/GOOGLE-HEALTH-SETUP.md`: the owner's walk-through.

### Exports of `probe.js`
- `civilRange(now, days)` -> `{ start, end }` (each a CivilDateTime OBJECT, see below) or `null`
- `buildDailyRollUpBody(now, days)` -> `{ range: { start, end }, windowSizeDays: 1 }` or `null`
- `buildSleepFilter(now, days)` -> string or `''`
- `buildSleepUrl(now, days)` -> the full, percent-encoded reconcile URL string, or `''`
- `summariseDailyRollUp(json)` -> `{ count, days: [{ date, steps }], text }`
- `summariseSleep(json)` -> `{ count, records: [{ start, end, minutesAsleep }], text }`
- `describeError(e)` -> string
- `resultSummary(results, showNumbers)` -> string

None of them ever throws, whatever the input.

### Date arithmetic (decided here)
- All dates are LOCAL (`getFullYear/getMonth/getDate`), done on civil dates (not by subtracting milliseconds, so DST changes cannot shift a day).
- `days` is normalised: not a finite number -> 3; finite -> `Math.floor`, then clamped to 1..31. (`0`, `-5`, `0.5` -> 1; `2.9` -> 2; `100` -> 31.)
- A CivilDateTime (Google's own shape, verified against the API pages) is an OBJECT, never a string: `{ date: { year, month, day }, time: { hours, minutes, seconds, nanos } }`, numbers, month 1..12.
- `civilRange(now, days)`: `end` = the day AFTER the local date of `now` at `00:00:00` (exclusive); `start` = the local date of `now` minus `(days - 1)` days at `00:00:00`; both with `time` `{ hours: 0, minutes: 0, seconds: 0, nanos: 0 }`. Example: now = 2026-11-14 20:00 local, days 3 -> start `{ date: { year: 2026, month: 11, day: 12 }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }`, end the same with day 15 (month 11). The time of day of `now` never matters. `now` that is not a valid `Date` -> `null`.
- `buildDailyRollUpBody` -> `{ range: civilRange(now, days), windowSizeDays: 1 }`; `null` when `civilRange` is `null`. This is exactly the documented request body.
- `buildSleepFilter(now, days)` -> `sleep.interval.civil_end_time >= "YYYY-MM-DD"` (DOUBLE quotes, as in the documented example) where the date is the date of `civilRange(...).start` (decided here, see open question 1); `''` for an invalid `now`.
- `buildSleepUrl(now, days)` -> `https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=` + `encodeURIComponent(buildSleepFilter(now, days))`. The query parameter is snake_case `page_size`. Example for 2026-11-14, 3 days: `...reconcile?page_size=25&filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-11-12%22`. `''` for an invalid `now`. (The next-page parameter is `pageToken`, response `nextPageToken`; the probe does not page.)

### Response shapes summarised (verified against Google's API pages)
- Daily roll-up: `{ rollupDataPoints: [ { civilStartTime: { date: { year, month, day }, time: {} }, civilEndTime: { date, time: { hours: 23, minutes: 59, seconds: 59 } }, steps: { countSum: "3822" } } ] }`. Civil times are OBJECTS; `time` may be `{}` (midnight); `steps` is OMITTED when the window had no worn data; `countSum` is a decimal STRING (a JS safe non-negative integer number is accepted too). `date` = `YYYY-MM-DD` built from `civilStartTime.date` (zero padded) when year, month (1..12) and day (1..31) are integer numbers, else `'?'` (a string `civilStartTime` is NOT accepted). `steps` = the integer, or `null` when `steps` is missing or not an object, or `countSum` is missing, not digits only, or above `Number.MAX_SAFE_INTEGER`. `text` per item: `<date>: <steps>`, or `<date>: no data` when `steps` is missing / not an object, or `<date>: ?` when `steps` is an object with an unusable `countSum`; items joined by `; `, or `no data points` when none. Only object items are kept; at most 31; `count` = `days.length`.
- Sleep: `{ dataPoints: [ { name, sleep: { interval: { startTime: "2026-04-20T22:30:00Z", startUtcOffset: "-14400s", endTime: "2026-04-21T06:30:00Z", endUtcOffset: "-14400s" }, type, summary: { minutesInSleepPeriod: "480", minutesAsleep: "455", minutesAwake: "25" }, metadata } } ], nextPageToken: "" }`. The response has UTC times plus separate UTC offsets and NO civil times. Records keep `start`/`end` (the UTC strings, only if they match `YYYY-MM-DDTHH:MM:SS[.fraction]Z` AND are a real calendar date-time, else `'?'`), and add `localStart`, `localEnd` (`YYYY-MM-DDTHH:MM:SS`, fraction dropped) and `endDay` (the date part of `localEnd`). Arithmetic: local = UTC time + offset seconds, calendar rollover applied (done in UTC with `Date.UTC`, so the machine timezone never matters). An offset is valid only as `^-?\d+s$` (Google's duration form, e.g. `-14400s`, `3600s`, `0s`) with absolute value <= 86400; otherwise (missing, wrong type, `4h`, `1.5s`) `localStart`/`localEnd`/`endDay` are `'?'` (never guessed as 0). Example: end `2026-04-21T06:30:00Z` with `-14400s` -> `2026-04-21T02:30:00`, endDay `2026-04-21`; end `2026-04-21T00:30:00Z` with `-3600s` -> `2026-04-20T23:30:00`, endDay `2026-04-20`. `minutesAsleep` = integer from `sleep.summary.minutesAsleep` (digit string, or safe non-negative integer number), else `null`. Object items only; at most 25. `text` per record: `<localStart> -> <localEnd> (ends <endDay>), <n or ?> min asleep`, joined by `; `, or `no sleep records` when none.
- Anything that is not that shape (null, string, array, wrong types, `__proto__` keys from `JSON.parse`) gives the empty result (`count: 0`, empty list, the "no ..." text). Only own properties of plain parsed JSON are read.

### `describeError(e)` (decided here)
Returns a short string, never empty, never contains `undefined`, `NaN`, `[object`.
- GIS error object (`error` is a string): the present fields in this order among `error`, `error_description`, `type`, as `name=value` joined by `; `. `{ error: 'invalid_scope', error_description: 'Bad scope', type: 'token_failed' }` -> `error=invalid_scope; error_description=Bad scope; type=token_failed`. `{ type: 'popup_closed' }` -> `type=popup_closed`.
- Google HTTP error body (`error` is an object `{ code, message, status, details }`): `STATUS (code): message`, then `; reason=<reason>` for the FIRST `details[]` entry that is an object with a string `reason` (e.g. `ErrorInfo`). `{ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }` -> `PERMISSION_DENIED (403): The caller does not have permission`. The documented not-linked case `{ error: { code: 400, message: 'Account not linked', status: 'FAILED_PRECONDITION', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCOUNT_NOT_LINKED', domain: 'health.googleapis.com' }] } }` -> `FAILED_PRECONDITION (400): Account not linked; reason=ACCOUNT_NOT_LINKED`. With only status and message -> `UNAUTHENTICATED: Invalid token`; with only a message -> the message (a reason is appended the same way). Missing/non-array `details`, or no usable reason -> nothing appended.
- `Error` instance -> `Name: message` (`Error: boom`).
- non-empty string -> the string (cleaned as below).
- everything else (null, undefined, numbers, booleans, `{}`, `[]`, symbols, objects with throwing getters, circular objects) -> `unknown error`.
- Cleaning of the final text, in this order: any `ya29.` access-token-looking run (`ya29\.[A-Za-z0-9._-]+`) becomes `[token removed]`; anything email-shaped becomes `[email removed]`; control characters (including newline, tab, NUL) become a space and runs of spaces collapse to one, trimmed; then clipped to 200 characters: longer than 200 -> the first 199 characters plus `…` (total exactly 200). Angle brackets are NOT altered (the page writes with `textContent`).

### `resultSummary(results, showNumbers)` (decided here)
`results` (all parts optional): `{ token: { ok, expiresIn, hasRefreshToken, scope }, gisError, checks: [ { name, status, ok, message, numbers } ] }`. Lines joined with `\n`, no trailing newline, in this order:
1. `Google Health probe result`
2. `Sign-in: ok` when `token.ok === true`, else `Sign-in: failed` (also when `token` is missing)
3. only when `token.ok === true`: `expires_in: <n>` (finite number >= 0, else `unknown`); `refresh_token present: yes` only when `hasRefreshToken === true`, else `no`; `scope granted: <scope>` (string via the cleaning above, else `none`)
4. only when `gisError` is given (not null/undefined): `GIS error: ` + `describeError(gisError)`
5. one line per check, in order: `<name>: HTTP <status> - ok` when `ok === true`, else `<name>: HTTP <status> - failed: <describeError(message)>`. `status` counts only when an integer 100..599; otherwise `HTTP <status>` is replaced by `no response` (so `sleep: no response - failed: Failed to fetch`). `name` not a non-empty string -> `?`. Non-array `checks`, and non-object items, are ignored (non-object items skipped).
6. only when `showNumbers === true`: for each check with a non-empty string `numbers`, in order, `<name> numbers: <numbers cleaned/clipped>`.
Never included, whatever is in `results`: the access token (fields `accessToken`/`access_token` are ignored; `ya29.` runs in text are removed), email addresses, and any `numbers` when `showNumbers` is not exactly `true`. Garbage input (null, undefined, string, number, `{}`) still returns the header and `Sign-in: failed`, with no `undefined`/`NaN`/`null`/`Infinity`/`[object`.

### The page (decided here, ids so a headless run can drive it)
- `#clientId` text input (kept in memory only), `#signIn` button with the exact text `Sign in with Google`, `#showNumbers` checkbox with a label whose text contains `show the numbers`, `#copySummary` button with the exact text `Copy result summary`, `#status` (messages such as `Enter a Client ID first`), `#tokenInfo` (the token lines of the summary, one per line), `#gisError` (the `GIS error: ...` line, empty when none), `#check-identity`, `#check-steps`, `#check-sleep` (one verdict line each, same format as in the summary, and the numbers line when the box is ticked), `#summary` (the full `resultSummary` text).
- `#signIn` with an empty Client ID does not call Google; `#status` says `Enter a Client ID first`.
- With an ID it calls `google.accounts.oauth2.initTokenClient({ client_id, scope, callback, error_callback })` where `scope` is exactly `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly` and then `.requestAccessToken()`. No other scope (no `openid`, no `email`).
- Token response with `access_token`: kept in a JS variable only; the three checks run in order with `Authorization: Bearer <token>`: (a) `GET https://health.googleapis.com/v4/users/me/identity`; (b) `POST https://health.googleapis.com/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp` with `buildDailyRollUpBody(new Date(), 3)`, JSON; (c) `GET https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile` built by `buildSleepUrl(new Date(), 3)`. (a) is also the account-link check: Google answers `400 FAILED_PRECONDITION` with reason `ACCOUNT_NOT_LINKED` when the account is not linked in the Google Health app. A failed check does not stop the next. A non-JSON body or a network failure is a failed check with `message` from `describeError`, never a thrown error.
- Token response with an `error` field, or `error_callback` called: the object is shown through `#gisError`, `Sign-in: failed`, no checks run.
- All output via `textContent`. Nothing is saved (no `localStorage`, `sessionStorage`, cookies, IndexedDB). No `console.*` calls (a token must never reach a console).
- `#copySummary` copies the `#summary` text via `navigator.clipboard.writeText`.

### `docs/GOOGLE-HEALTH-SETUP.md`
Plain language, numbered steps, a `##` heading for each of: create a Google Cloud project; enable the Google Health API; configure the OAuth consent screen (External, Testing, own email as test user); add the scopes; create the OAuth client (Web application, origins `http://localhost:8080` and `https://ahaselden.github.io`, copy only the Client ID); link the account in the Google Health phone app; run the probe (`npm start`, open `http://localhost:8080/tools/google-health-probe/`); what to expect (the "app is not verified" warning, click Continue; tokens last 1 hour; no refresh token); what to send back; delete the project and revoke access (`https://myaccount.google.com/permissions`). States that a client secret is never needed for this test and must never be pasted into the repo, the page or a chat. Contains both scope URLs in full. Contains no `GOCSPX-`, no `ya29.`.

## Behaviours (tick list; tests P1-P24)
1. `civilRange` gives local start (days-1 back) and exclusive end (tomorrow) at 00:00:00; the example above is exact.
2. `civilRange` crosses month, year and leap-day boundaries and ignores the time of day (23:59:59 and 00:00:00 of the same date give the same result).
3. `days` is normalised (default 3, floor, clamp 1..31); an invalid `now` gives `null`.
4. `buildDailyRollUpBody` = `{ range: {start, end} as CivilDateTime objects, windowSizeDays: 1 }`; `null` for an invalid `now`; JSON-serialisable.
5. `buildSleepFilter` = `sleep.interval.civil_end_time >= "YYYY-MM-DD"` (double quotes) with the range start date; `buildSleepUrl` = reconcile URL with `page_size=25` and the percent-encoded filter; `''` for an invalid `now`.
6. `summariseDailyRollUp` on a response with object civil times gives exact `days` and `text`; a window with `steps` omitted reads `no data`.
7. `summariseDailyRollUp` empty/garbage/missing/huge/negative/decimal values: never throws, no NaN/undefined in `text`, bad `countSum` -> `steps: null` shown as `?`.
8. `summariseSleep` converts UTC start/end plus UTC offsets to local civil time and the local day it ends on, including day rollover either way.
9. `summariseSleep` garbage/missing/hostile (bad offsets, impossible dates, non-UTC strings): never throws, no NaN/undefined, bad parts shown as `?`, never guessed.
10. `describeError` GIS error objects (`invalid_scope`, `access_denied`, `popup_closed`) exact strings.
11. `describeError` Google HTTP error bodies exact strings, including the first `details[].reason` (`ACCOUNT_NOT_LINKED`).
12. `describeError` junk input -> `unknown error`; never throws (throwing getters, circular, `__proto__` JSON, symbols).
13. `describeError` cleaning: control chars, HTML kept as text, token and email removed, clipped to exactly 200 with `…`, 200 exactly is untouched.
14. `resultSummary` exact text for a mixed result with `showNumbers` false.
15. `resultSummary` with `showNumbers` true adds the `numbers` lines and nothing else; only exactly `true` counts.
16. `resultSummary` for a failed sign-in shows the verbatim GIS error and no token lines.
17. `resultSummary` never contains the token, an email, or hidden numbers; hostile input never throws and never yields NaN/undefined/null/Infinity/[object.
18. `probe.js` imports in Node with no DOM and exports exactly the eight functions.
19. Source: only Google hosts (`accounts.google.com`, `health.googleapis.com`, `www.googleapis.com`, `*.gstatic.com`); the only `<script src>` besides `./probe.js` is `https://accounts.google.com/gsi/client`; no stylesheet/import from other hosts.
20. Source: no `client_secret`, no `GOCSPX-`; no `localStorage`/`sessionStorage`/cookie/IndexedDB use; no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function`; no `console.`; uses `textContent`.
21. Source: exactly the two readonly scopes (full URLs) and no other `/auth/` scope; uses `initTokenClient`, `requestAccessToken`, `error_callback`; no `initCodeClient`.
22. Source: page has the ids and exact labels of the contract, the three endpoints, `windowSizeDays`, `page_size`, `Bearer`.
23. The page is not in `sw.js` and not referenced from the root `index.html`, `js/` or `css/`.
24. The setup doc and the DECISIONS entry exist with the required headings and content.

## Edge cases and hostile input
`now` invalid (`null`, `'x'`, `new Date(NaN)`, a number); `days` `NaN`, `'3'`, `Infinity`, `-1`, `1e9`; JSON that is `null`, an array, a string, a number; `rollupDataPoints`/`dataPoints` not arrays; items `null`; `countSum` `'1e3'`, `'-5'`, `'12.5'`, `' 12'`, `'99999999999999999999'`, `NaN`; `civilStartTime` missing or an object; error messages with `<img onerror>` HTML, newlines, NUL, 5000 characters, a `ya29.` token, an email; `__proto__` key parsed from JSON; getters that throw; circular objects.

## What cannot be tested automatically
- Whether Google accepts these scopes for a browser-only token flow, the consent screen, the "app is not verified" page, token lifetime and the missing refresh token: needs a real Google account and a real Cloud project. Nothing can be tested headless against Google; that is the whole point of the experiment. The `tests/google-health-probe.test.js` static checks read source text only (weak: they prove the strings are or are not there, not that the page behaves; a page could build a forbidden call at run time from pieces and pass them).
- The `Copy result summary` clipboard write (real clipboard permission).

### Headless scenario outline (browser-tester; Google stubbed, page logic only)
Stub, via request interception: `https://accounts.google.com/gsi/client` answers a script that sets `window.google = { accounts: { oauth2: { initTokenClient(cfg) { window.__cfg = cfg; window.__requests = (window.__requests||0); return { requestAccessToken() { window.__requests++; } }; } } } }`. `https://health.googleapis.com/v4/**` answers per scenario and the tester records each request (method, URL, headers, body). Fix the browser clock to 2026-11-14 20:00 local. Serve the repo with `npm start` and open `/tools/google-health-probe/`.
- **H1 Renders.** Expect: `#clientId`, `#signIn` (text `Sign in with Google`), `#showNumbers`, `#copySummary` present; no request to any host other than localhost and `accounts.google.com`; no page error. Covered by headless? yes (stubbed).
- **H2 Empty ID.** Steps: click `#signIn`. Expect `#status` contains `Enter a Client ID first`; `window.__cfg` undefined. Covered by headless? yes.
- **H3 Sign-in call.** Steps: type `stub-client.apps.googleusercontent.com` in `#clientId`, click `#signIn`. Expect `window.__cfg.client_id` equals that text, `window.__cfg.scope` equals the two scope URLs joined by one space (and nothing else), `window.__requests` is 1; `localStorage` and `sessionStorage` empty. Covered by headless? yes.
- **H4 200 / 200 / 403.** Setup: tick `#showNumbers`; Health stub: identity 200 `{"name":"users/me/identity"}`; dailyRollUp 200 `{"rollupDataPoints":[{"civilStartTime":{"date":{"year":2026,"month":11,"day":12},"time":{}},"civilEndTime":{"date":{"year":2026,"month":11,"day":12},"time":{"hours":23,"minutes":59,"seconds":59}},"steps":{"countSum":"6120"}}]}`; reconcile 403 `{"error":{"code":403,"message":"Insufficient scope","status":"PERMISSION_DENIED"}}`. Steps: as H3, then in the page run `window.__cfg.callback({access_token:'stub-token', expires_in:3599, scope:'s1 s2', token_type:'Bearer'})`. Expect: `#check-identity` text `identity: HTTP 200 - ok`; `#check-steps` contains `steps: HTTP 200 - ok` and `2026-11-12: 6120`; `#check-sleep` text `sleep: HTTP 403 - failed: PERMISSION_DENIED (403): Insufficient scope`; `#tokenInfo` contains `expires_in: 3599`, `refresh_token present: no`, `scope granted: s1 s2`; `#summary` does not contain `stub-token`. Requests seen: GET `https://health.googleapis.com/v4/users/me/identity` with header `Authorization: Bearer stub-token`; POST `.../v4/users/me/dataTypes/steps/dataPoints:dailyRollUp` whose JSON body deep-equals `{"range":{"start":{"date":{"year":2026,"month":11,"day":12},"time":{"hours":0,"minutes":0,"seconds":0,"nanos":0}},"end":{"date":{"year":2026,"month":11,"day":15},"time":{"hours":0,"minutes":0,"seconds":0,"nanos":0}}},"windowSizeDays":1}`; GET whose raw URL is `https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-11-12%22`. Covered by headless? yes.
- **H5 Numbers hidden.** Same as H4 with `#showNumbers` unticked: `6120` appears nowhere in `#check-steps` or `#summary`. Covered by headless? yes.
- **H6 GIS error.** Steps: as H3, then `window.__cfg.callback({error:'invalid_scope', error_description:'Bad scope'})`. Expect `#gisError` text `GIS error: error=invalid_scope; error_description=Bad scope`; no request to `health.googleapis.com`; `#summary` first two lines `Google Health probe result` and `Sign-in: failed`. Covered by headless? yes.
- **H7 Popup closed.** Steps: as H3, then `window.__cfg.error_callback({type:'popup_closed'})`. Expect `#gisError` text `GIS error: type=popup_closed`. Covered by headless? yes.
- **H8 Network failure and HTML.** Health stub aborts the identity request and answers steps 500 with body `<h1>oops</h1>` (not JSON) and sleep 200 `{}`. Expect `#check-identity` starts `identity: no response - failed:`; `#check-steps` starts `steps: HTTP 500 - failed:` and the page contains no `h1` element created from the body (`document.querySelector('h1')` is null); `#check-sleep` is `sleep: HTTP 200 - ok`. Covered by headless? yes.

### Owner with a real Google account (follow `docs/GOOGLE-HEALTH-SETUP.md`)
- **C1 Normal sign-in.** Setup: project, consent screen (Testing, owner as test user), both scopes, Web client with both origins, account linked in the Google Health app; `npm start`. Steps: open `http://localhost:8080/tools/google-health-probe/`, paste the Client ID, click `Sign in with Google`, accept the "app is not verified" warning with Continue. Expect: `Sign-in: ok`; `refresh_token present: no`; `expires_in` about 3599; `scope granted` lists both scopes; then three verdict lines. Covered by headless? no: real Google account.
- **C2 Scopes refused.** If Google refuses, copy `#gisError` text verbatim (for example `error=invalid_scope`, `error=access_denied`); that is the result. Covered by headless? no: real Google.
- **C3 Popup closed.** Close the Google popup: `type=popup_closed`. Covered by headless? no: real browser popup.
- **C4 Health checks.** With `show the numbers` ticked then unticked: the steps line shows daily numbers only when ticked; compare with the Google Health app. Covered by headless? no: real data.
- **C5 Copy.** Click `Copy result summary`, paste into a note: no token, no email, no numbers unless ticked. Covered by headless? no: real clipboard.
- **C6 Origin on Pages.** Optional: confirm `https://ahaselden.github.io` is accepted as an origin (the page is not deployed there; only the origin entry is checked by the setup screen). Covered by headless? no.
- **C7 Clean-up.** Follow the delete and revoke section; `https://myaccount.google.com/permissions` no longer lists the project. Covered by headless? no: real account.

## Open questions
1. The request said the sleep filter uses "3 days ago date"; literally that is 2026-11-11 for now = 2026-11-14, but the steps range starts 2026-11-12. This spec uses the range start (2026-11-12) so both checks cover the same three days. Owner to confirm.
2. `error_callback` is added to `initTokenClient` (needed to see `popup_closed`); the request listed only `callback`.
3. Whether ticking `#showNumbers` after the checks have run should refresh the display without refetching is left to the implementer (`#summary` must follow the box when it is changed); tests tick before signing in.
4. Resolved: the field names, CivilDateTime objects, `page_size`, quoted filter and error `details` were checked against Google's pages (research section 8, PR #70). The sleep response has no civil times, so the probe converts UTC time + offset itself. The sleep `startUtcOffset` form (`"-14400s"`) is taken from the same pages; any other form is shown as `?`.
