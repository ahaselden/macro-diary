# Spec: USDA key safeguards (merge keeps the good key; Settings key area is collapsed behind Edit)

## Purpose
Stop a device with an empty or demo USDA key from overwriting a good key during sync, and let a good key reach a device that has none. Shrink the USDA key area in Settings to one line with an Edit button so the key and the sync switch cannot be changed by accident.

Owner request (2026-11-13): "On the syncing of the USDA keys, if one is empty or set to the demo key and the other looks legitimate, keep the legitimate one. Minimize that API key part and make it so that you have to click an edit button to change it so that it doesn't accidentally change."

Builds on D42 and docs/specs/sync-usda-key.md. Where this spec contradicts that one, this one wins (list in "Supersedes").

## Part 1: contract (logic)

| Piece | Layer / file | Shape |
|---|---|---|
| `isPlaceholderKey(v)` | `js/core/schema.js` (new export) | `true` when `v` is not a string, or is empty / whitespace only, or equals `DEMO_KEY` ignoring case after `trim()`. Otherwise `false` |
| `isLegitKey(v)` | `js/core/schema.js` (new export) | `true` only when `v` is a string and `t = v.trim()` has 20 to 200 characters, all matching `[A-Za-z0-9_-]`. Everything else `false` (non-strings, control characters anywhere inside, spaces or punctuation inside, under 20, over 200, huge) |
| `apiKeySummary(key)` | `js/domain/api-key.js` (NEW file; add to `SHELL` in `sw.js`, bump `CACHE`) | returns the exact compact line, see behaviours 8-11 |
| `mergeStates` | `js/domain/merge.js` | key rule below |
| `toRecords` | `js/domain/sync-records.js` | omits `apiKey` when the key is a placeholder |

Plausibility rule (decided here): a real api.data.gov / USDA key is about 40 letters and digits. "Legitimate" = 20 to 200 characters of letters, digits, `-`, `_` after trimming. It is a heuristic, not validation: a short or odd real key is simply not protected by the new rule and falls back to D42 last-writer-wins.

### Merge key rule
Let `cl` = local `apiKey`. Let `cr` = remote `apiKey` ONLY when remote `syncApiKey === true` and the value is a string, else "absent". (The key still only travels while the switch is on; an absent `cr` is a placeholder.)
1. `cl` legit and `cr` placeholder/absent: result is `cl`, whichever settings record wins by timestamp (this stops an empty or demo key, even one sent with the switch on and a newer timestamp, from clearing a good key).
2. `cl` placeholder and `cr` legit: result is `cr`, whichever record wins (the local switch value is NOT changed by this; `syncApiKey`, goals etc. still follow last-writer-wins).
3. Anything else (both legit, both placeholder, or one side neither placeholder nor legit such as `abc`): unchanged D42 rule (winner's key if the winner's switch is on, otherwise local).
Everything else about merge is unchanged.

### toRecords
The settings `value` has `apiKey` only when `syncApiKey === true` AND `!isPlaceholderKey(cleanApiKey(apiKey))`. An empty or demo key is never pushed. (Replaces "empty key travels as ''"; see Supersedes. Consequence: with the switch on you cannot clear a synced key from one device; turn the switch off, or replace it with another real key.)

### Remaining non-commutative cases (documented, like D42)
`mergeStates(a, b)` and `mergeStates(b, a)` give the same `apiKey` whenever both switches are on. When a switch is off, that device's key is not offered to the other side, so the result depends on which side is local (a device with the switch off keeps its own key). Specifically, with a legit key on a device whose switch is off and a placeholder on a device whose switch is on, each device keeps its own. This is intended: nothing leaves a device whose switch is off.

## Behaviours (tests `S<n>` in `tests/usda-key-safeguards.test.js`)

1. `isPlaceholderKey`: true for `''`, `'   '`, `'DEMO_KEY'`, `'demo_key'`, `' Demo_Key '`, `undefined`, `null`, `7`, `{}`, `[]`; false for a 40-character real-looking key, for `'abc'`, for `'DEMO-KEY'`.
2. `isLegitKey` true: a 40-character letters+digits key, 20-character key, 200-character key, key with `-` and `_`, a legit key padded with spaces. False: 19 characters, 201 characters, `DEMO_KEY`, `''`, non-strings, a key with an inner space, a key with `.` or `<`, a legit key with an embedded `\u0000` or `\u0007` or newline, a 1,000,000-character key, non-ASCII letters, a prototype name string like `__proto__` (too short).
3. Merge, local legit + remote placeholder (every one of empty, DEMO_KEY, absent) with the remote winning by timestamp and its switch on: local legit key kept; the flag and other settings still follow the winner.
4. Merge, local placeholder (empty, DEMO_KEY, absent) + remote legit with remote switch on: result is the remote key, whichever side is newer; the local `syncApiKey` flag follows last-writer-wins, not the key rule.
5. Remote legit but remote switch OFF: its key is never adopted by a placeholder local key (stays placeholder).
6. Both legit and different, both switches on: winner's key by timestamp, same in both argument orders; equal timestamps converge (same result in both orders).
7. Commutativity matrix: for every pair from {empty, DEMO_KEY, legit A, legit B, absent} x {switch on, off} for each side, with newer / older / equal timestamps: (a) the result key is the local key or, when the remote switch is on, the remote key; (b) if either side's offered key is legit the result is legit; (c) when both switches are on the result key is the same in both argument orders; (d) when exactly one offered key is legit and the other is a placeholder the result is the legit one.
8. `apiKeySummary`: key not set (`''`, whitespace, non-string) gives `USDA key: not set`.
9. `apiKeySummary`: `DEMO_KEY` in any case, trimmed, gives `USDA key: using the shared demo key`.
10. `apiKeySummary`: a key whose cleaned, trimmed text has 12 or more characters gives `USDA key: set (ends …XXXX)` where XXXX is exactly its last 4 characters and `…` is U+2026; shorter non-placeholder keys give `USDA key: set` (no characters of the key). Never more than 4 characters of the key appear; control characters are removed first; a 1,000,000-character key gives a line shorter than 60 characters. Characters like `<` are returned as is (the UI shows the line with `textContent`; escaping is the UI's job).
11. `toRecords`: switch on and key legit: `apiKey` present. Switch on and key empty, `DEMO_KEY`, whitespace: no `apiKey` property. Switch on and key `abc` (short, non-placeholder): present. Switch off: absent (unchanged).
12. End to end through records: (a) device with `''`, switch on, newer settings receives a record from a device with a legit key: ends up with the legit key; (b) device with legit key receives a newer record from a device with `''`/DEMO_KEY (switch on): keeps its key, and `toRecords` of the result still carries the legit key; (c) a record from a placeholder device carries no `apiKey` property at all.
13. Hostile remote values (non-string, huge, control characters, `__proto__`) are never legit and never replace a local legit key; `applyRecords` never throws and never pollutes `Object.prototype`.
14. UI source (WEAK): `index.html` has the collapsed structure; `settings-view.js` no longer saves the key through the all-fields `change` handler, has Edit/Save/Cancel handlers, focus and `aria-expanded`, and sets the line with `textContent`.

### Source-structure contract for behaviour 14 (element ids)
- `#keyLine`: `<span>`/`<p>` showing the compact line. Set with `textContent`.
- `#keyEdit`: `<button type="button">`, text exactly `Edit`, `aria-expanded="false"` initially, `aria-controls="keyEditor"`.
- `#keyEditor`: container with the `hidden` attribute initially, containing in this order `#apiKey` (existing id, existing label `USDA API key`), `#syncApiKey` (existing id, existing label and sentence unchanged), then `<button type="button" id="keySave">Save</button>` and `<button type="button" id="keyCancel">Cancel</button>`.
- `#keyLine` and `#keyEdit` are outside `#keyEditor`; all inside the Food databases card before `#syncCard`. The paragraph about DEMO_KEY (`The built-in DEMO_KEY is heavily rate-limited...`) stays.

## Part 2: Settings UI behaviour (headless checklist covers it)
- Default (collapsed): the card shows `#keyLine` and the `Edit` button; `#apiKey`, `#syncApiKey`, its label and sentence, Save and Cancel are hidden. Line text from `apiKeySummary(state.apiKey)` only.
- Edit: loads `#apiKey` and `#syncApiKey` from saved state, shows `#keyEditor`, hides the `Edit` button, sets `aria-expanded="true"` on it, moves focus to `#apiKey`.
- Save: `state.apiKey = #apiKey.value.trim()`, `state.syncApiKey = #syncApiKey.checked`; `touchSettings(state, Date.now())` only if the synced snapshot changed (same rule as D42: switch change always; key change only while the switch is on); then `save()`, `emit('diary:changed')`, toast `Saved`, collapse, update `#keyLine`, focus back on `#keyEdit`, `aria-expanded="false"`.
- Cancel: restores both inputs from saved state, collapses, focus back on `#keyEdit`, no save, no toast, no timestamp change.
- The key and the switch are changed ONLY by Save. They are removed from the all-fields `change` listener (`#gK #gP #gC #gF #wUnit #srcUSDA #srcOFF` keep it unchanged), and that handler must not read `#apiKey` / `#syncApiKey` or assign `state.apiKey` / `state.syncApiKey`. So a goal change while the editor is open or closed never saves typed key text.
- Opening the Settings tab always shows the collapsed state with the inputs reset to saved values (typed, unsaved text is discarded). A `settings:changed` refresh (for example a sync pull) updates `#keyLine` and must not overwrite text being typed while the editor is open.
- Escaping: the key is only ever written with `.value` (inputs) or `textContent` (line), never through innerHTML.
- Schema: no bump needed (no saved-shape change). `STORAGE_KEY` unchanged. New file `js/domain/api-key.js` goes into `SHELL` in `sw.js` and `CACHE` is bumped (tests/sw.test.js enforces).

## Supersedes / existing tests that will need updating
- `tests/sync-usda-key.test.js` B5: "empty key travels as `apiKey: ''`" is replaced by behaviour 11. The empty-key assertion at lines 75-76 must change (this is the only one that must fail after the change). Test B9 title ("empty clears the local key") stays true only for non-legit keys; its fixtures use `'OLD'` (not legit) so it still passes, but its comment should say so. B16 checks the old visible-switch markup: still expected to pass if the switch stays between `#apiKey` and `#syncCard` within 600 characters of `id="apiKey"` (the new markup puts only a label between them), the implementer may need to adjust that window and must explain it in the PR.
- `tests/sync-usda-key-extra.test.js` X1 uses non-legit keys, still valid.
- `tools/browser-test/scenarios/sync-usda-key.mjs` (C1-C11 of the old spec): `openSettings` waits for `#syncApiKey` visible and all steps type into `#apiKey` directly; every step needs `Edit` first and `Save` instead of Tab. Not under `tests/`, so not edited by the test designer; the browser-tester agent rewrites it from the checklist below.
- docs/specs/sync-usda-key.md: C1 to C8 (key and switch visible, change on Tab) and the toRecords "empty string travels" line are superseded.

## Edge cases and hostile input
- Key is whitespace only, DEMO_KEY in lower case, key with leading/trailing spaces.
- Remote record from an older app (no `syncApiKey`, no `apiKey`): absent, a placeholder.
- Remote `apiKey` non-string, 1e6 characters, HTML, control characters, `__proto__`: never legit.
- Local `apiKey` itself non-string (corrupt storage): treated as a placeholder.
- A synced key cannot be cleared while the switch is on (see toRecords). Documented consequence, not a bug.
- Imported backup (`mergeRestore` uses `mergeStates`): the same key rule applies, so restoring a backup with an empty key never wipes a legit local key and a backup with a legit key fills an empty one. (Flagged in the owner on a real device list R3.)

## Cannot be tested automatically
Real two-device sync against Supabase, real phone Safari focus/keyboard behaviour, screen reader announcements of `aria-expanded`.

## Manual checklist (headless, tools/browser-test)

Seed (every item unless stated): `localStorage['macrodiary.v1']` = `{schemaVersion: 8, theme: 'auto', weightUnit: 'g', measures: {}, goals: {k:2000,p:150,c:200,f:65}, apiKey: <per item>, syncApiKey: <per item, default false>, useUSDA: false, useOFF: false, recent: [], custom: [], tombstones: {}, settingsUpdatedAt: 1000, recipes: {}, plan: {}, shopping: {checks:{},extras:{}}, days: {}}`, then reload. No network stubs needed. `LEGIT` = `abcdefghijklmnopqrstuvwxyz0123456789f3a9` (40 characters, last 4 `f3a9`). Open Settings: click `[data-tab="more"]`, then `#moreSettings`. "Stored" = `JSON.parse(localStorage.getItem('macrodiary.v1'))`. "Near now" = within 60 seconds.

**C1 Collapsed line, key set**
- Setup: apiKey `LEGIT`.
- Steps: open Settings.
- Expect: `#keyLine` text is exactly `USDA key: set (ends …f3a9)`; `#keyEdit` visible with text `Edit` and `aria-expanded="false"`; `#apiKey`, `#syncApiKey`, `#keySave`, `#keyCancel` all NOT visible; the page's visible text (`document.body.innerText`) does not contain `LEGIT` and does not contain `ghijklmnopqrstuvwxyz`.
- Covered by headless? yes

**C2 Collapsed line, not set**
- Setup: apiKey `''`. Steps: open Settings. Expect: `#keyLine` text exactly `USDA key: not set`; editor hidden. Covered by headless? yes

**C3 Collapsed line, demo key**
- Setup: apiKey `demo_key`. Steps: open Settings. Expect: `#keyLine` text exactly `USDA key: using the shared demo key`. Covered by headless? yes

**C4 Collapsed line, short key shows no characters**
- Setup: apiKey `abc123`. Steps: open Settings. Expect: `#keyLine` text exactly `USDA key: set`; page text does not contain `abc123`. Covered by headless? yes

**C5 Edit opens the editor**
- Setup: apiKey `LEGIT`, syncApiKey `true`.
- Steps: open Settings; click `#keyEdit`.
- Expect: `#keyEditor` visible; `#apiKey` value is `LEGIT`; `#syncApiKey` checked; label `Sync my USDA key to my other devices` and the sentence `The key is stored in your sync account, readable only by you.` visible; `#keySave` (text `Save`) and `#keyCancel` (text `Cancel`) visible; `#keyEdit` not visible and its `aria-expanded` is `true`; `document.activeElement.id` is `apiKey`.
- Covered by headless? yes

**C6 Typing then Cancel leaves the key alone**
- Setup: apiKey `LEGIT`, syncApiKey false.
- Steps: open Settings; click `#keyEdit`; fill `#apiKey` with `zzzzzzzzzzzzzzzzzzzzzzzz`; press Tab; click `#keyCancel`; read; click `#keyEdit` again.
- Expect after Cancel: `#keyEditor` hidden; `#keyLine` still `USDA key: set (ends …f3a9)`; stored `apiKey` is `LEGIT`; stored `settingsUpdatedAt` is exactly `1000`; the toast does not read `Saved` (hidden or other text); `document.activeElement.id` is `keyEdit`; `#keyEdit` `aria-expanded` is `false`. After the second Edit: `#apiKey` value is `LEGIT` (typed text discarded).
- Covered by headless? yes

**C7 Save stores the key**
- Setup: apiKey `LEGIT`, syncApiKey false.
- Steps: open Settings; click `#keyEdit`; fill `#apiKey` with `  NEWKEYabcdefghij1234567890WXYZ  `; click `#keySave`.
- Expect: toast `Saved`; stored `apiKey` is `NEWKEYabcdefghij1234567890WXYZ` (trimmed); stored `settingsUpdatedAt` exactly `1000` (switch off, so no sync bump); `#keyLine` is `USDA key: set (ends …WXYZ)`; `#keyEditor` hidden; focus on `#keyEdit`; `aria-expanded` `false`.
- Covered by headless? yes

**C8 Save with the switch on bumps the sync timestamp; clearing**
- Setup: apiKey `LEGIT`, syncApiKey true.
- Steps: open Settings; Edit; fill `#apiKey` with empty text; Save.
- Expect: stored `apiKey` `''`; stored `settingsUpdatedAt` near now (greater than 1000); `#keyLine` is `USDA key: not set`; stored `syncApiKey` still `true`.
- Covered by headless? yes

**C9 Other fields never save the key**
- Setup: apiKey `LEGIT`, syncApiKey false.
- Steps (a): open Settings (collapsed); fill `#gK` with `2100`; press Tab. (b): reload; open Settings; Edit; fill `#apiKey` with `typedButNotSaved123456`; (do not press Tab) fill `#gK` with `2200`; press Tab.
- Expect (a): toast `Saved`; stored `goals.k` is `2100`; stored `apiKey` is `LEGIT`. Expect (b): stored `goals.k` is `2200`; stored `apiKey` is still `LEGIT`; `#apiKey` still holds `typedButNotSaved123456` and the editor is still open (the goal change did not close or reset it).
- Covered by headless? yes

**C10 The switch changes only through Edit and Save**
- Setup: apiKey `LEGIT`, syncApiKey false.
- Steps: open Settings; assert `#syncApiKey` not visible; Edit; click `#syncApiKey`; click `#keyCancel`; read stored; Edit; click `#syncApiKey`; click `#keySave`; read stored; reload; open Settings; Edit.
- Expect: after Cancel stored `syncApiKey` is `false` (or absent), `settingsUpdatedAt` exactly `1000`; after Save stored `syncApiKey` is `true`, `settingsUpdatedAt` near now, toast `Saved`, `apiKey` still `LEGIT`; after reload and Edit `#syncApiKey` is checked.
- Covered by headless? yes

**C11 Opening Settings again discards unsaved text**
- Setup: apiKey `LEGIT`.
- Steps: open Settings; Edit; fill `#apiKey` with `unsavedTextUnsavedText12`; click a tab button other than `More` (the first tab button in `.tabs`); then `[data-tab="more"]`, `#moreSettings`.
- Expect: `#keyEditor` hidden; `#keyLine` is `USDA key: set (ends …f3a9)`; stored `apiKey` `LEGIT`; after Edit, `#apiKey` value is `LEGIT`.
- Covered by headless? yes

**C12 Keyboard: Edit is a real button**
- Setup: apiKey `LEGIT`.
- Steps: open Settings; `page.focus('#keyEdit')`; press `Enter`.
- Expect: `#keyEdit` element's tag name is `BUTTON` with `type="button"`; after Enter `#keyEditor` visible and `document.activeElement.id` is `apiKey`. Then focus `#keyCancel` and press `Enter`: editor hidden and `document.activeElement.id` is `keyEdit`.
- Covered by headless? yes

**C13 Demo key saved shows the demo line**
- Setup: apiKey `''`. Steps: open Settings; Edit; fill `#apiKey` with `DEMO_KEY`; Save. Expect: stored `apiKey` `DEMO_KEY`; `#keyLine` `USDA key: using the shared demo key`. Covered by headless? yes

**C14 Hostile key text stays text**
- Setup: apiKey `<img src=x onerror=window.__x=1>`.
- Steps: open Settings; read; Edit.
- Expect: `#keyLine` text equals `USDA key: set (ends …x=1>)`; `window.__x` undefined; no `img` element inside the Settings tab (`#v-settings img` count 0); after Edit `#apiKey` value is exactly `<img src=x onerror=window.__x=1>`.
- Covered by headless? yes

**C15 Layout and errors**
- Setup/Steps: viewport 375 wide; collapsed Settings.
- Expect: the Food databases card has no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`); `#keyLine` and `#keyEdit` do not overlap; the card is shorter than before only by the hidden fields (no numeric assertion). No page error and no console error across C1-C14.
- Covered by headless? yes

### Owner on a real device
- R1 PC has a real key and the switch ON, the phone has no key: sync both; the phone's Settings line shows `USDA key: set (ends …xxxx)` with the PC key's last 4. Covered by headless? no: live backend.
- R2 Phone has the demo key or no key with the switch ON and has edited a goal more recently than the PC: sync both; the PC keeps its key (its line still shows its ending). no: live backend.
- R3 Restore a backup that has an empty key onto a device with a real key: the key stays. no: real data.
- R4 iPhone Safari: tapping Edit moves focus to the key field and the keyboard opens; Save returns to the line. no: real Safari.
- R5 Scroll through Settings with a thumb: nothing about the key changes without pressing Edit and Save. no: real phone.

## Open questions
- Q1 Enter in `#apiKey` = Save and Escape = Cancel? Not specified, not tested.
- Q2 Should the compact line say whether the key is synced (for example `, synced`)? Not specified; the line texts above are exact, so any addition would break them.
- Q3 Key vs a short non-placeholder key such as `abc` (neither legit nor placeholder): falls to last-writer-wins, so a typo can replace a good key. Accepted for now.
- Q4 Remote legit key adopted while the local switch is off: the key is stored locally while the flag stays off (follows last-writer-wins). Tested (behaviour 4) as specified; owner may prefer to require the local switch on.
- Q5 With the switch on, a clear cannot propagate any more (a legit key beats an empty one). Owner may want an explicit "remove the synced key" action later.
- Q6 Keys shorter than 12 characters show `USDA key: set` with no ending; the 12 threshold is a choice.
- Q7 `#keyEdit` is hidden while the editor is open (spec C5). If the implementer keeps it visible but disabled, C5's visibility expectation and the aria-expanded wording need agreement.
