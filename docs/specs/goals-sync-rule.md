# Spec: one rule for newer settings when a record or backup comes from an older device (goals-sync-rule)

Tests: `tests/goals-sync-rule.test.js` (new) and tests 21 and 22 of `tests/dials.test.js` (edited, see "Changed assertions").

## Purpose
Today `goals.steps` and `goals.sleepH` reset to 10000 / 8 when a settings record or backup from an older device lacks them, while `goals.waterCups`, `waterTap` and `dials` leave this device's value alone (KNOWN-ISSUES 69, dials spec open question 1). By the owner's decision of 2026-11-14 all of them now follow one rule: a missing or unusable value in an incoming settings record or backup leaves THIS device's value untouched.

## Contract (no new exports)
Behaviour change only, in existing functions:
- `js/core/schema.js`: `sanitize()` and `migrate()` are UNCHANGED (a state loaded from disk still gets defaults for missing or unusable values). A small shared "is this value usable" helper for the three fields may be exported from here (name is the implementer's choice; tests do not import it).
- `js/domain/sync-records.js`: `applyRecords(state, records)` (via `toPartial` for key `settings`) drops `goals.steps`, `goals.sleepH`, `goals.waterCups` from the partial when the record's value is missing or unusable.
- `js/domain/merge.js`: `mergeStates(local, remote, opts)` falls back to `local.goals[field]` for any of the three fields that the winning settings record does not carry (today only `waterCups` has this fallback).
- `js/domain/backup.js`: `mergeRestore(state, backup)` judges usability on the RAW backup (migrate() fills defaults, so the raw value must be inspected, as already done for `waterCups`, `waterTap`, `dials`).
- `toRecords(state)` is UNCHANGED: the settings record carries `goals` exactly as the state has it.

**Usable** (checked on the incoming raw value):
- `steps`: finite number or numeric text, 0 to 1,000,000 inclusive; the stored value is whole after rounding (7500.6 -> 7501), like Settings.
- `sleepH`: finite number or numeric text, 0 to 24 inclusive; fractions kept.
- `waterCups`: a JS number that is an integer, 1 to 40 (unchanged: the text `"8"` is NOT usable).
- Not usable: null, `""`, booleans, objects/arrays, NaN/Infinity, negative, over range, non-numeric text, markup.
- `waterTap` (`'half'`/`'whole'` only) and `dials` (an array) keep their existing rules.

## Behaviours (tick off)
Tests are numbered as in the test file.
1. Sync: a NEWER settings record from an old device (no steps, sleepH, waterCups) takes k p c f, `settingsUpdatedAt`, and leaves this device's steps, sleepH, waterCups, waterTap, dials.
2. Sync: each of the three fields is judged on its own (one usable field is taken while the others stay).
3. Sync: unusable values (list above) leave this device's value.
4. Sync: usable values are taken when the record wins, including the edges 0 / 1,000,000, 0 / 24, 1 / 40 and numeric text.
5. Sync: older or equal-stamp records do not change goals; equal-stamp tie converges identically in both merge orders (unchanged).
6. Merge: when BOTH sides carry all three fields, both argument orders give the same goals (the newer side's) and the same `settingsUpdatedAt`.
7. Merge: `mergeStates` with a newer remote whose goals lack the fields (no sanitising first) keeps local's three, with and without `preferLocal`; a remote without `goals` at all does not throw.
8. Sync: hostile goals (`__proto__`, `constructor`, extra keys, non-object goals, non-object value) add no keys and keep local's three; goals keys stay exactly k p c f steps sleepH waterCups.
9. Sync: inputs (state and record) are not mutated (frozen objects).
10. Backup: a NEWER backup without the three fields (current schema or legacy without `schemaVersion`) takes k p c f and keeps this device's three, plus this device's `waterTap` and `dials` when the legacy backup has none.
11. Backup: per-field independence, unusable values keep ours, usable values (edges, text, rounding) are taken.
12. Backup: older, equal-stamp and untimestamped (0) backups keep this device's goals (unchanged).
13. Backup: hostile or missing goals (`__proto__`, `null`, text, number, array, undefined) never throw and keep ours; frozen inputs are not mutated.
14. Unchanged: `sanitize()`/`migrate()` still default missing or unusable fields; `toRecords` carries the state's goals as they are; the four older goals still fall back to 2000/150/200/65 when unusable in a winning record.
15. Docs and shipping: `docs/DECISIONS.md` has `## D59.` after D58 naming steps, sleepH, waterCups, waterTap, dials, the words "missing", "unusable" and "differ"; `docs/KNOWN-ISSUES.md` row 69 no longer says the goals fall back to 10,000 and 8; `sw.js` `CACHE` number is above 64 (never an exact number).

## Accepted divergence (owner-accepted)
If one side lacks a field (an older device), the RECEIVING device keeps its own value, so two devices can end with different steps, sleepH or waterCups goals until the older one is updated and syncs again. Test 6 covers only the case where both sides carry the fields, which must converge. This is the owner's explicit choice; it is not a bug to fix.

## Changed assertions (existing tests that pinned the old rule)
Only `tests/dials.test.js`; `npm test` on the unmodified code after the edit fails exactly these two (plus the new file). A throwaway prototype of the rule was run against the whole suite: no other existing test depends on the old rule.
- Test 21 (sync, old-device record):
  - Title reworded. The `o2` receiver (custom steps 7000, sleepH 7.5, receiving an old-device record): was "valid numbers only" (open question 1 accepted both outcomes); now `steps === 7000` and `sleepH === 7.5`. Why: the rule is now decided.
  - In the hostile-records loop, added a second receiver with custom goals that must keep 7000 / 7.5. The original assertions (receiver on defaults, 10000 / 8) are kept; they hold under both rules.
- Test 22 (backup): the legacy backup without steps/sleepH, newer stamp, receiver with 7000 / 7.5: was expected `steps: 10000, sleepH: 8`; now `steps: 7000, sleepH: 7.5`. Why: legacy backups now keep this device's values instead of resetting.
- Not changed because still true: tests W16/W17 in `tests/water.test.js` (waterCups already kept), `tests/store.test.js`, `tests/google-health-activity.test.js`, `tests/saved-food-ids.test.js`, `tests/page-nutrition.test.js` (migrations of stored data, where defaults still apply), `tests/sync-engine.test.js` and `tests/sync-records.test.js` (both sides carry the fields).
- Also: `docs/specs/dials.md` open question 1 gets a "resolved by goals-sync-rule" note (done in this change). The wording of tests 21 and 22 in that spec's behaviour list (lines 129-130) is left as written, it says "see open question 1".

## Edge cases and hostile input
Empty/missing goals, goals that are text/array/null, values `NaN` (arrives as `null` through JSON), `Infinity`, huge numbers, numeric text, markup in text, `__proto__`/`constructor` keys inside `goals` (JSON.parse own keys), a record or backup with only some of the fields, frozen inputs. Never throw; never add keys beyond the seven goal keys; never mutate inputs.

## What cannot be tested automatically
Two real devices on different app versions syncing through a real account; a real backup file from an old install. Manual (owner on a real device): set steps goal 7000, sleep 7.5, water 12 on the phone. Restore a backup file made before steps/sleep existed (Settings, Restore, Merge) whose timestamp is newer: the three goals must still read 7000, 7.5, 12 and the calorie/macro goals change to the backup's. No browser checklist item: no UI element or text changes (Settings fields keep their ids `#gSteps`, `#gSleep`, `#gWater`); the existing headless scenarios stay as they are.

## Text for `docs/DECISIONS.md` (implementer: paste as D59 after D58, adjust only wording)
```
## D59. A missing or unusable newer setting never overwrites this device's value (sync and restore)
**What.** When a settings record (device sync) or a backup (Restore, Merge) comes from an older device and has no value for `goals.steps`, `goals.sleepH` or `goals.waterCups`, or the value is unusable, this device keeps its own value for that field; the same already held for `waterTap` and `dials`. A usable value (steps: finite number or numeric text 0 to 1,000,000, rounded to whole; sleepH: 0 to 24; waterCups: whole number 1 to 40) is taken when that record wins by timestamp. Each field is judged on its own. The four older goals (calories, protein, carbs, fat) behave as before. A state loaded from disk is still sanitised to defaults (schema.js `sanitize`).
**Why.** Before this, steps and sleep reset to 10000 and 8 when an older device's newer settings record won, but the water goal, tap mode and dials did not (KNOWN-ISSUES 69, dials spec open question 1). One rule for every optional setting is easier to explain and never loses a goal someone typed.
**Limits.** If one side lacks a field, the receiving device keeps its own value, so two devices may differ in that field until the older one updates and syncs again; this is accepted. Where both sides carry the fields, merge order does not matter and devices converge. Supersedes the "Limits" sentence of D58 about steps and sleep goals resetting.
```

## Needed edits for the implementer (not made here)
- `docs/DECISIONS.md`: add D59 above; in D58 "Limits" the sentence "stricter than the steps and sleep goals, which reset to their defaults; spec open question 1" is now untrue, reword it to point to D59.
- `docs/KNOWN-ISSUES.md` row 69: delete the last sentence ("When an older device's settings win a sync, ... fall back to 10,000 and 8."), or mark the issue resolved by D59 / `docs/specs/goals-sync-rule.md`.
- `sw.js`: bump `CACHE` (currently `macro-diary-v64`); no new shipped files.
- `docs/ARCHITECTURE.md` / the comment block at the top of `js/domain/merge.js` and `sync-records.js`: mention the rule if they describe the old one.

## Open questions
1. A numeric array like `[5]` or `["8"]` as a value: JavaScript coerces `+[5]` to 5. The spec says arrays are unusable; tests only use `{}` for objects. Implementer should reject arrays and objects explicitly.
2. A backup with no `goals` object at all: this spec says the three fields stay ours (test 13); what happens to k p c f in that case is the existing behaviour and is not tested here.
3. `waterCups` given as numeric text (`"8"`) is unusable (existing rule) while steps and sleepH accept numeric text. Kept as is on purpose, as the owner said waterCups is unchanged.
