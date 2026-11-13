# Spec: sync the USDA key (backlog item 14)

## Purpose
Let the owner store their USDA API key in the sync database so a second device picks it up without retyping it. It is stored plain (no encryption), is controlled by a switch, and the switch is OFF by default so nothing about the key leaves the device until the user turns it on. This reverses the "apiKey stays per-device" half of docs/DECISIONS.md D10 (theme and recent stay per-device).

Owner decisions (2026-11-13): the key may be stored in the sync database; plain; switchable. Default OFF is the plan's choice (the owner did not say).

## Contract (names decided here; the implementation must use them)

| Piece | Layer / file | Shape |
|---|---|---|
| `SCHEMA_VERSION` | `js/core/schema.js` | becomes `7` |
| `defaults().syncApiKey` | `js/core/schema.js` | `false` |
| `migrate(d)` | `js/core/schema.js` | v6 (and older) data gains `syncApiKey: false`; `schemaVersion` 7; `apiKey` and everything else untouched |
| `sanitize(d)` | `js/core/schema.js` | forces `d.syncApiKey` to a boolean: `true` only for the literal `true`, otherwise `false` |
| `toRecords(state)` | `js/domain/sync-records.js` | the `settings` record `value` gains `syncApiKey` (boolean, always present). It also has an `apiKey` property ONLY when `state.syncApiKey === true` (an empty key is sent as `apiKey: ''`, which is how a clear travels). When false the property does not exist at all |
| `applyRecords(state, records)` | `js/domain/sync-records.js` | the remote `settings` value is sanitised: `syncApiKey` must be literal `true` to count; `apiKey` must be a string, is trimmed, capped at 200 characters, control characters (U+0000-U+001F, U+007F) removed; anything else is dropped (never adopted as non-string) |
| `mergeStates(local, remote, opts)` | `js/domain/merge.js` | see behaviours 8-13 |
| Switch | `index.html` | `<input type="checkbox" id="syncApiKey">` in the "Food databases" card next to `#apiKey`, NOT checked by default, label text exactly `Sync my USDA key to my other devices`, one sentence under it exactly `The key is stored in your sync account, readable only by you.` |
| Wiring | `js/ui/settings-view.js` | `#syncApiKey` loads from and saves to `state.syncApiKey`; a change of the switch, or of the key while the switch is on, calls `touchSettings(state, Date.now())`; a change of the key while the switch is off does NOT |

Saved shape: `state.syncApiKey` (boolean). `STORAGE_KEY` unchanged.

## Behaviours (each has a test titled `B<n>` in `tests/sync-usda-key.test.js`)

1. `SCHEMA_VERSION` is 7 and `defaults()` has `syncApiKey === false`.
2. `migrate` of v6 data gives schemaVersion 7, `syncApiKey` false, same `apiKey`, same days/goals; older fixtures (`tests/fixtures/state.json`, `backup.json`, a v1 object without `schemaVersion`) survive with their diary entries unchanged and `syncApiKey` false. Loading a stored v6 string through `createStore` does the same.
3. `sanitize` makes `syncApiKey` a strict boolean (`'true'`, `1`, `'yes'`, `{}`, `null`, `undefined` all become false; `true` stays true). A v6 object that wrongly carries `syncApiKey: 'x'` ends false.
4. `toRecords` with `syncApiKey` false: the `settings` value has `syncApiKey: false` and NO `apiKey` property (`'apiKey' in value` is false), and the key text appears nowhere in any record. Goals / weightUnit / useUSDA / useOFF / settingsUpdatedAt and the record's `updatedAt` are as before. `theme` and `recent` never appear.
5. `toRecords` with `syncApiKey` true: value has `syncApiKey: true` and `apiKey` equal to the key; with an empty key it has `apiKey: ''` (own property). Turning the switch off and calling `toRecords` again removes the property (so the next push removes the key from the database).
6. `applyRecords` sanitises a remote key: `'  KEY  '` becomes `'KEY'`; a string with control characters has them removed (`'ab\u0000c\u0007d'` becomes `'abcd'`); a 1,000,000-character key ends at most 200 characters long; HTML such as `<img src=x onerror=1>` is kept as that exact literal text (it is data; the UI sets it with `.value`).
7. Remote `syncApiKey` that is not literal `true` (`'true'`, `1`, `{}`) counts as false: the remote key is not adopted.
8. Merge, remote settings newer, `syncApiKey: true`: local adopts the remote `apiKey` and `syncApiKey: true`. Same result whichever argument order is used when the newer record is the one that wins.
9. Merge, winning settings has `syncApiKey: true` and `apiKey: ''`: the local key is cleared (clearing on one device clears it on the others).
10. Merge, winning settings has `syncApiKey: false`: local `syncApiKey` becomes false but the local `apiKey` value is KEPT. A stale `apiKey` field carried by such a record is never adopted.
11. An older settings record never overwrites a newer one: local newer (flag on or off) keeps its own key and flag against an older remote with a different key; both argument orders.
12. Equal `settingsUpdatedAt`, both flags true, different keys: `mergeStates(a, b).apiKey` equals `mergeStates(b, a).apiKey` (convergence), and with `{ preferLocal: true }` the first argument's key wins. Merging a state with itself changes nothing. `settingsUpdatedAt` is still the max of both. `theme` and `recent` are never taken from the remote, even when the remote wins and has the key.
13. End to end through records: device B turns the switch on at a later time; `applyRecords(deviceA, toRecords(deviceB))` makes A hold B's key and flag. Then A (state now flag true) receives a newer record with the switch off: A's flag becomes false, A keeps its key, and `toRecords(A)` has no `apiKey` property.
14. Hostile remote values never throw and never pollute: `apiKey` as number, object, array, null, boolean; value objects with `__proto__` / `constructor` / `prototype` keys; none make `state.apiKey` a non-string, none add a property to `Object.prototype`, and `applyRecords` returns a normal state.
15. Exports: the CSV/JSON report files (`exportFiles`) never contain the key text or `syncApiKey`. `mergeRestore` of a backup that carries `apiKey` and `syncApiKey: true` with an OLDER `settingsUpdatedAt` does not replace the local key or flag.
16. UI source checks (WEAK, see below): the switch exists in `index.html` with the exact label and sentence and no `checked` attribute; `settings-view.js` wires `#syncApiKey`, calls `touchSettings`, and keeps `#apiKey` outside the unconditional synced-settings comparison.

## Edge cases and hostile input
- Empty key with switch on (a deliberate clear that must propagate), whitespace-only key, key with leading/trailing spaces.
- Remote record from an older app version: no `syncApiKey` field, no `apiKey` field. Treated as switch off: the local key is kept, the local flag follows the winner (false) only if that record wins.
- A remote record whose value has `apiKey` but `syncApiKey` false (stale or malicious): the key is ignored.
- Remote `apiKey` of 1e6 characters, numbers, arrays, objects, HTML, control characters, `__proto__`.
- Imported backup files: `migrate` + `sanitize` run on them; a backup with `syncApiKey: 'true'` ends false.
- The key must never be written to the page as HTML (UI sets `#apiKey` via `.value`).

## Risks (written down, not decided)
- Backup file today: the "Backup to file" button writes `JSON.stringify(state)`, so the backup file ALREADY contains `apiKey` (and will contain `syncApiKey`). The plan said the key "stays out of exports and backups as today"; for the diary REPORT exports (CSV/JSON from the Export tab) that is true and tested (B15). For the full backup it is not true today. This spec does not change it; see open question Q5.
- A restore of an old backup (migrated to `syncApiKey: false`) with a higher `settingsUpdatedAt` than local would win the settings record and turn the local switch off (key kept). Plan behaviour; flagged.
- A key arriving while the local key is non-empty and different: remote wins when its settings are newer (plan). This can silently replace a working key with an expired one from another device.
- The plain key is readable by anyone with the sync account or database access.
- Existing tests that compare the whole `settings` record value or the exact key set (if any) will need `syncApiKey: false` added; the new behaviour is intentional.

## Cannot be tested automatically
Real two-device sync against the live backend, real phone Safari/Edge behaviour, the real Supabase table contents. The headless harness blocks all network (tools/browser-test/README.md), so the checklist covers only the local UI.

## Manual checklist (headless-runnable: tools/browser-test)

Seed used by every item unless stated: `localStorage['macrodiary.v1']` = a v6 state like the one in `tools/browser-test/scenarios/edit-quick-add.mjs` (`schemaVersion: 6`, `apiKey: ''`, `useUSDA: false`, `useOFF: false`, `settingsUpdatedAt: 1000`, empty `days`, `custom: []`), then reload. Sync is NOT set up. No network stubs are needed (the page makes no outside requests on these screens). "Stored" means `JSON.parse(localStorage.getItem('macrodiary.v1'))`. Open the Settings tab (the tab button labelled `Settings`).

**C1 Switch present and off by default**
- Setup: seed as above (stored has no `syncApiKey` field at all, schemaVersion 6).
- Steps: reload, open Settings.
- Expect: a checkbox `#syncApiKey` is visible in the "Food databases" card, below/next to the `USDA API key` field; it is NOT checked; its label text is `Sync my USDA key to my other devices`; the text `The key is stored in your sync account, readable only by you.` is visible. After the load, stored `schemaVersion` is 7 and `syncApiKey` is `false` once the app has saved (if the app has not saved yet, loading alone is enough; do not require the save).
- Covered by headless? yes

**C2 Toggling on persists and bumps the sync timestamp**
- Setup: seed as above (`settingsUpdatedAt: 1000`).
- Steps: open Settings; click `#syncApiKey`; reload; open Settings.
- Expect: toast `Saved` appears after the click. Stored `syncApiKey` is `true`; stored `settingsUpdatedAt` is within 60 seconds of now (greater than 1000). After reload `#syncApiKey` is checked.
- Covered by headless? yes

**C3 Typing a key while the switch is OFF does not bump the timestamp**
- Setup: seed as above.
- Steps: open Settings; fill `#apiKey` with `  abc123KEY  `; press Tab (fires change).
- Expect: toast `Saved`; stored `apiKey` is `abc123KEY` (trimmed); stored `syncApiKey` is `false` or absent; stored `settingsUpdatedAt` is still exactly `1000`.
- Covered by headless? yes

**C4 Typing a key while the switch is ON bumps the timestamp**
- Setup: seed with `syncApiKey: true`, `apiKey: 'old'`, `settingsUpdatedAt: 1000`.
- Steps: open Settings; fill `#apiKey` with `newKEY`; press Tab.
- Expect: stored `apiKey` is `newKEY`; stored `settingsUpdatedAt` is within 60 seconds of now. `#syncApiKey` is still checked.
- Covered by headless? yes

**C5 Clearing the key while the switch is ON bumps the timestamp (a clear must win a sync)**
- Setup: seed with `syncApiKey: true`, `apiKey: 'old'`, `settingsUpdatedAt: 1000`.
- Steps: open Settings; fill `#apiKey` with empty text; press Tab.
- Expect: stored `apiKey` is `''`; stored `settingsUpdatedAt` is within 60 seconds of now.
- Covered by headless? yes

**C6 Turning the switch off keeps the key on this device**
- Setup: seed with `syncApiKey: true`, `apiKey: 'keepME'`, `settingsUpdatedAt: 1000`.
- Steps: open Settings; click `#syncApiKey` (unchecks it); reload; open Settings.
- Expect: stored `syncApiKey` is `false`; stored `apiKey` is `keepME`; stored `settingsUpdatedAt` within 60 seconds of now; after reload `#syncApiKey` is unchecked and `#apiKey` has value `keepME`.
- Covered by headless? yes

**C7 Persisted key and flag load into the fields**
- Setup: seed with `syncApiKey: true`, `apiKey: 'loadedKEY'`.
- Steps: open Settings.
- Expect: `#syncApiKey` checked; `#apiKey` value is `loadedKEY`.
- Covered by headless? yes

**C8 HTML in the key stays plain text**
- Setup: seed as above; the page sets `window.__x` only if an injected `onerror` ran.
- Steps: open Settings; fill `#apiKey` with `<img src=x onerror=window.__x=1>`; press Tab; reload; open Settings.
- Expect: `#apiKey` value after reload is exactly `<img src=x onerror=window.__x=1>`; `window.__x` is undefined; there is no `img` element inside the Settings tab.
- Covered by headless? yes

**C9 Report exports contain no key**
- Setup: seed with one diary entry today (copy the entry shape from `edit-quick-add.mjs`), `apiKey: 'SECRETKEY999'`, `syncApiKey: true`.
- Steps: open the Export tab; capture the downloads from the export buttons (the scenario listens for `page.on('download')` and reads each file's text).
- Expect: no downloaded file contains `SECRETKEY999`, `apiKey` or `syncApiKey`.
- Covered by headless? yes

**C10 Backup file content (documents today's behaviour, see Q5)**
- Setup: same as C9.
- Steps: Settings tab; click `Backup to file`; read the downloaded file.
- Expect (current behaviour, NOT a requirement): the file is the whole saved state, so it contains `"syncApiKey":true`. The scenario must REPORT whether it also contains `SECRETKEY999` and must not fail on it until the owner answers Q5.
- Covered by headless? yes

**C11 No page errors**
- Setup/Steps: all of the above in one run.
- Expect: no page error, no console error.
- Covered by headless? yes

### Owner on a real device
- R1 Two devices (phone and PC), sync set up on both. On the PC: Settings, paste a real USDA key, switch ON `Sync my USDA key to my other devices`, wait for the sync status to settle. On the phone: sync now; Settings shows the same key and the switch ON. Covered by headless? no: live sync backend.
- R2 On the phone clear the key (switch still ON); sync; the PC shows an empty key after its next sync. no: live backend.
- R3 On the PC switch OFF; sync; in the Supabase dashboard Table Editor, row `settings`: the `value` JSON has no `apiKey` field. On the phone the key is still there (kept) and the switch is OFF after sync. no: live backend, real database.
- R4 With the switch OFF from the start, check the `settings` row in the dashboard never contained an `apiKey` field. no: real database.
- R5 Search a food by name on the phone using the synced key (not DEMO_KEY rate limit message). no: real USDA.
- R6 iPhone Safari: toggle persists across closing and reopening the installed app. no: real Safari.

## Open questions
- Q1 Is the switch visible before sync is set up? This spec's checklist assumes it is ALWAYS visible (headless cannot set sync up). A note such as "turn on sync first" when sync is not set up is allowed but its wording is not tested.
- Q2 A passphrase-encrypted option later (the stored key would then be ciphertext).
- Q3 Show the key masked (password-type field or "show" toggle)? Not specified; `#apiKey` stays a plain text input for now.
- Q4 A key arriving while the local key is non-empty and different: plan is "remote wins when its settings are newer". Not changed here; risk listed above.
- Q5 The full backup file already includes `apiKey` (JSON.stringify(state)). Strip it (and `syncApiKey`) from backups, or leave as is? Owner decision needed; not tested either way except C10 which only reports.
- Q6 Remote record with `syncApiKey: true` but no `apiKey` field, or an `apiKey` of the wrong type: is that "clear the key" or "keep the local key"? Tests only require the result is a string and is never the junk value; they do not say which.
- Q7 Exact order of trim and control-character stripping for a key such as `' \u0001 k '` is not specified; tests avoid it.
