# Spec: sync on launch

## Purpose
When "Sync automatically after changes" is on and the device is signed in, opening the app starts one sync by itself within about 2 seconds, so the owner never has to press "Sync now" just to get the other device's changes. The result (syncing, last synced time, or the error) is always visible, so if it does not happen the cause can be seen.

Owner request: "if Sync automatically is enabled, sync it on app launch so I don't have to click the button manually."

## Findings from reading the code (verified, not assumed)
- `initSync()` in `js/ui/sync-view.js` already calls `svc.schedule(1500)` once, plus `schedule(1000)` on `visibilitychange` to visible and on `online`. The cold-launch path is therefore wired, and the regression tests R1/R2/R4/R5 show the service runs a sync from it (built-in project or own project, `auto` undefined or true, expired access token refreshed first). Nothing at boot emits `diary:changed`.
- Real gaps, each pinned by a failing test below:
  1. The launch sync shares ONE timer with the 4 s debounce. Any `diary:changed` / `recipes:changed` / `plan:changed` within the first 1.5 s clears it and moves the sync to 4 s or later (R3 characterises this), and steady edits postpone it forever (no cap).
  2. The launch sync is not idempotent: a resume (`schedule(1000)`) right after launch makes a second sync.
  3. A failed launch sync is visible only if the owner opens Settings. A rejected refresh token silently signs the device out (session set to null).
- If, after the gaps are fixed, the owner still sees no launch sync, the remaining causes can only be checked on the real device: `auto` unchecked on that device; a stale service worker serving old JS (`CACHE` in `sw.js` must be bumped with the change); iOS suspending timers of a PWA that is resumed rather than cold started; browser storage cleared (the device is then signed out and shows the sign-in form); the session rejected by the server. The visible status line, toast and "Last synced" time are required so the cause can be seen next time.

## Contract (names decided here; the implementation must use them)
| Piece | Layer / file | Shape |
|---|---|---|
| `svc.launch()` | `js/services/sync/index.js` | Returns nothing, never throws. Same gating as `schedule()` (connection not 'none', signed in, `auto !== false`); if gated out it schedules nothing. Otherwise sets its OWN timer of about 1500 ms (at most 2000) that `schedule()` never clears. When it fires it re-checks the gating (auto switched off meanwhile cancels it) and runs `syncNow()` unless a sync has already started since `launch()` was called. Idempotent: a second call is a no-op. |
| `onLaunchFailure(error)` option | `createSyncService({...})` | Called exactly once, with the failure (an `Error` or the message string, containing the reason), only when the sync started by `launch()` ends not-ok (including "Signed out — please sign in again"). Never for automatic syncs after changes, `online`/visible retries, or manual syncs. Not called on success. Default is a no-op. |
| `maxWaitMs` option | `createSyncService({...})` | Default 30000. Debounce cap: repeated `schedule()` calls cannot postpone the pending automatic sync beyond `maxWaitMs` after the first call of the current window (the timer is set to min(now + delay, windowStart + maxWaitMs)). The window restarts after the sync fires. A single `schedule()` still waits the normal delay (4000 by default). Uses the injected `now`. |
| `status()` | unchanged | `{ state: 'unconfigured' | 'signed-out' | 'syncing' | 'error' | 'idle', email, auto, lastSyncAt, error }`. `lastSyncAt` is set by a successful sync and left unchanged by a failed one. |
| Wiring | `js/ui/sync-view.js` | `initSync()` calls `svc.launch()` instead of `svc.schedule(1500)` and passes `onLaunchFailure` which shows `toast('Sync failed: ' + reason)`. `visibilitychange` and `online` keep calling `schedule(1000)`. The Settings card keeps showing "Syncing…", "Last synced <ago>" and "Last sync failed — <error>". |
| Service worker | `sw.js` | bump `CACHE` (shipped JS changes). |

## Behaviours (tests in `tests/sync-on-launch.test.js`)
Guards R1-R5 pass today and must keep passing; L1-L18 fail until built, except L14 which also passes today (it guards that the cap does not shorten the normal debounce).
- R1 `schedule(1500)` with the built-in project, `auto` unset, runs one sync; `lastSyncAt` 1500.
- R2 `auto` undefined and true are on; false is off.
- R3 characterisation: a later plain `schedule()` postpones an earlier one (why launch has its own timer).
- R4 expired access token refreshed before the first data request; new session stored.
- R5 after a failed sync, `status()` shows the error; `schedule(1000)` recovers.
- L1 launch, signed in, own project, `auto: true`: nothing at once, exactly one sync within 2 s, `lastSyncAt` set, no repeat.
- L2 built-in project, `auto` never set: runs.
- L3 `auto` false: no timer, no sync; manual `syncNow` still works.
- L4 not signed in or not configured: nothing scheduled, no throw, status 'signed-out' / 'unconfigured'.
- L5 change events (`schedule()`) at 300 ms and 600 ms do not push the launch sync past 2 s.
- L6 `launch()` twice: one sync.
- L7 `auto` switched off before the timer fires: no sync.
- L8 a resume `schedule(1000)` while launch pending: still exactly one sync.
- L9 a manual sync running when the timer fires: never two in parallel, and the launch sync runs afterwards.
- L10 status goes through 'syncing' to 'idle' with `lastSyncAt`.
- L11 failed launch: state 'error', error text kept, `lastSyncAt` unchanged, UI notified; a later `schedule(1000)` recovers.
- L12 expired token refreshed before the launch sync; a 400 on refresh ends 'signed-out', session null, error contains "Signed out", no data request made.
- L13 debounce cap: `schedule()` every 3 s with `maxWaitMs` 10000 syncs exactly at 10000 ms, not before.
- L14 single `schedule()` still waits 4 s; the cap window restarts after a sync.
- L15 hostile stored config (`null`, `[]`, string, garbage session, invalid JSON): `launch()` neither throws nor schedules.
- L16 (weak, source check) `sync-view.js` uses `svc.launch(`, no longer `svc.schedule(1500)`, has `onLaunchFailure` and the text `Sync failed: `.
- L17 `onLaunchFailure` once, with the reason, for the launch sync only; not for later automatic or manual failures; silent on success.
- L18 a rejected refresh token at launch calls `onLaunchFailure` with the signed-out reason.

## Edge cases and hostile input
`auto` stored as `undefined`/`true` (on), `false` (off), `"no"` (a non-false value counts as on, as today); no session; session that is a string; corrupt `macrodiary.sync.v1` JSON; error messages containing HTML (the toast must use `textContent`, as `toast` does, and the Settings line uses `esc()`); launch during a manual sync; sign-out or `auto` off while the launch timer is pending; resume or `online` event while pending; very frequent edits; the refresh token rotating (never reuse a stale one: the adapter already dedupes refreshes).

## Cannot be tested automatically
Real Supabase, real phone behaviour (PWA resume, iOS timer suspension, service-worker cache), real clock. The headless harness blocks all network except stubs (tools/browser-test/README.md); `scripts/mock-supabase.mjs` cannot be used there because only the app's own origin is allowed on localhost, so the built-in project host is stubbed instead.

## Headless checklist
Stubbed host for every item: `https://rblowifmbeokvwengabb.supabase.co` (the built-in project in `js/services/sync/defaults.js`). Count requests with `page.on('request')`, since stubs keep no log. Seed before the final load, as other scenarios do: `localStorage.setItem('macrodiary.sync.v1', JSON.stringify({...}))` then `page.reload()` and wait for `.tabs`. A "valid session" is `{ access_token: 'acc_seed', refresh_token: 'ref_seed', expires_at: <now in seconds + 3600> }` with `email: 'me@example.test'`, no `url`, no `anonKey`. Default stubs: `GET .../rest/v1/records` answers `[]`; `POST .../rest/v1/rpc/push_record` answers `[{"accepted":true,"rev":1}]`. To read Settings: click `[data-tab="more"]`, then `#moreSettings`; the sync card is `#syncBox`, its status line `#syncMsg`, the switch `#syncAuto`.

- **C1** Setup: default stubs; sync config = valid session, `auto` property absent. Steps: load the app, click nothing, wait 3 s. Expect: exactly one `GET .../rest/v1/records` was requested, with header `Authorization: Bearer acc_seed`, and zero requests to any other host. Then open Settings: `#syncMsg` text starts with `Last synced just now`; `#syncAuto` is checked. Covered by headless? yes.
- **C2** Setup: as C1 but `auto: false`. Steps: load, wait 4 s. Expect: zero requests to the Supabase host; Settings shows `#syncAuto` unchecked. Then click the "Sync now" button: one `GET .../records` follows and `#syncMsg` starts with `Last synced just now`. Covered by headless? yes.
- **C3** Setup: default stubs plus `POST .../auth/v1/token?grant_type=refresh_token` answering `{"access_token":"acc_new","refresh_token":"ref_new","expires_in":3600}`; session `expires_at: 1`. Steps: load, wait 3 s. Expect: the first Supabase request is the refresh POST, then the records GET with `Authorization: Bearer acc_new`; `localStorage` `macrodiary.sync.v1` has `session.refresh_token === 'ref_new'`; Settings `#syncMsg` starts with `Last synced`. Covered by headless? yes.
- **C4** Setup: session `expires_at: 1`; the refresh POST answers status 400 with `{"error_description":"Invalid Refresh Token"}`. Steps: load, wait 3 s, observe the toast, open Settings. Expect: no records GET at all; the `#toast` text is `Sync failed: Signed out — please sign in again`; Settings shows the sign-in form (`#syncEmail` visible, `#syncPass` visible) and `#syncMsg` contains `Signed out — please sign in again`; stored `session` is null. Covered by headless? yes (Chromium logs a console error for the 400; treat it as expected).
- **C5** Setup: valid session; `GET .../records` answers status 500 with `{"message":"boom"}`. Steps: load, wait 3 s, open Settings. Expect: `#toast` was `Sync failed: boom (HTTP 500)`; Settings `#syncMsg` is `Last sync failed — boom (HTTP 500)`; the "Sync now" button is enabled (not stuck on "Syncing…"). Covered by headless? yes (expected console error for the 500).
- **C6** Setup: no session at all (sync config `{ "email": "me@example.test" }`). Steps: load, wait 3 s. Expect: zero Supabase requests, no toast containing `Sync failed`; Settings shows the sign-in form. Covered by headless? yes.
- **C7** Setup: as C1. Steps: load; about 300 ms later run `document.dispatchEvent(new Event('visibilitychange'))` in the page; wait 4 s. Expect: still exactly one `GET .../records` (no second sync from the resume). Covered by headless? yes.
- **C8** Setup: as C5 but the 500 only for the first records GET, then 200 `[]` (stubs per scenario may use a counter in the scenario code). Steps: load, wait 3 s (toast appears), then in the page run `window.dispatchEvent(new Event('online'))`, wait 3 s. Expect: a second records GET; Settings `#syncMsg` starts with `Last synced just now`; no second `Sync failed` toast. Covered by headless? yes.
- **C9** Setup: as C1. Steps: after the launch sync (wait 3 s), reload the page, wait 3 s. Expect: each load makes exactly one records GET (two in total over the two loads). Covered by headless? yes.
- **C10** Setup: any of the above. Expect: no page errors and no console errors other than the stubbed 400/500 responses. Covered by headless? yes.

## Owner on a real device
- O1 Phone installed PWA, signed in, auto on: force close, reopen, do not tap anything; within a few seconds Settings -> Sync reads "Last synced just now".
- O2 Same, but only resume the app from the background (do not force close): after a moment "Last synced" updates.
- O3 Turn "Sync automatically after changes" off, reopen: no sync happens; "Sync now" still works.
- O4 Airplane mode, open the app: a toast `Sync failed: …` appears; switching the network back on triggers a sync within seconds.
- O5 After the update ships, confirm the new version is running (service worker cache updated) before judging the result.

## Open questions
- Q1 Names `launch()`, `onLaunchFailure`, `maxWaitMs` (30000) and the 1500 ms launch delay are this spec's decisions; change them with the tests together.
- Q2 The toast shows the raw error reason; the exact reason texts come from the adapter ("Network error — check your connection (…)", "Signed out — please sign in again", server messages).
- Q3 No automatic timed retry after a failed launch sync; retry happens on the next `online`/visible event or the next change. Confirm this is enough.
- Q4 A resume from the background (as opposed to a cold start) is not a "launch": it keeps using `schedule(1000)` and is not toasted on failure.
