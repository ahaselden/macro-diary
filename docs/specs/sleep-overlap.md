# Spec: sleep recorded twice must count once (bug fix `sleep-overlap`, follows `google-health-import.md`)

## Purpose
Google records the same sleep twice (two producers, nearly identical start and end), and `sleepByDay` added both, so a night of about 7 h 53 showed as `Sleep 14 h 58 min`. Sleep records whose time ranges overlap are now treated as one sleep reported more than once, and only one record of each such group counts.

## The bug, in numbers (made up from the real case, no identity)
Device timezone UTC-6, local day 2026-11-13. Four records end that day: night `n1` 01:11-08:03 asleep 386, night `n2` 01:06-08:05 asleep 369, nap `p1` 09:52-11:01 asleep 56, nap `p2` 09:41-11:09 asleep 87. Old result 386+369+56+87 = 898 min = 14 h 58. Required: 386 + 87 = 473 min = 7 h 53.

**Not part of this fix:** the STEPS number for that day (2,367) is correct. It is the watch's total up to the moment the export was taken (about 14:00 local on 2026-11-13), not an error. A later export and re-import fills the day, because a re-import replaces the day as a whole (D54). Nothing about steps changes.

## Contract
No new export and no new file. `sleepByDay(rows, tz)` in `js/domain/health-import.js` (domain, pure) keeps its signature and its return shape `{ 'YYYY-MM-DD': { sleepMinutes, sleepStart, sleepEnd } }`. `readTakeout`, `combineActivity`, storage, sync and UI are unchanged. The rows are the parsed `UserSleeps_*.csv` rows (string values). An optional column `sleep_last_updated` (an instant, any format `parseInstant` accepts) is read if present.

## The rule (what to implement)
1. Valid records only, as today: `sleep_start`/`sleep_end` parse, end after start, period at most 24 h, `minutes_asleep` a finite number. Others are ignored and take no part in any comparison. Minutes are rounded and capped at 1440 per record as today. A repeated non-empty `sleep_id` counts once (the first row wins, as today). Records with an empty id are never de-duplicated by id.
2. Two valid records are "the same sleep" when their ranges `sleep_start..sleep_end` (UTC instants, not the minutes asleep) overlap by at least 50% of the SHORTER record's period: `overlap >= 0.5 * min(periodA, periodB)` and `overlap > 0`. Touching ranges (end equals the other start) have overlap 0 and are NOT the same sleep. Reason: any overlap at all would swallow a real nap that starts as the night ends (a 1 minute overlap is not a duplicate).
3. The relation is applied transitively (A-B and B-C make one cluster even if A and C only touch).
4. Within a cluster ONE record is kept: most `minutes_asleep` (after rounding); tie: longer period; tie: later `sleep_last_updated` (both present); tie: larger `sleep_id` compared as strings; tie: later `sleep_end`. The choice must not depend on row order.
5. A cluster belongs to the local day its KEPT record ends (the existing day rule, using `tz`). The dropped records of a cluster count for nothing, on any day.
6. `sleepMinutes` of a day = sum of the kept records of the clusters on that day, capped at 1440 as today; a day of 0 is omitted. `sleepStart`/`sleepEnd` = the kept record of the cluster whose kept record has the most minutes (tie: ends later, as today), written as UTC text without milliseconds as today.
7. Pure: does not mutate the rows (they may be frozen), never throws for hostile rows or a hostile `tz`, same answer on every call.

## Behaviours (tests in `tests/sleep-overlap.test.js`; one edit in `tests/google-health-import.test.js`)
1. The real case: 473 min, start/end of `n1`, in all 24 row orders.
2. A night plus a non-overlapping nap adds; touching ranges add; the main sleep is the largest kept record.
3. Threshold: exactly 50% of the shorter period merges; 59 of 120 min separate; a 1 minute overlap separate; a record contained in another merges.
4. Transitive clusters keep one record.
5. Tie-breaks in the order of rule 4, for every row order.
6. A cluster spanning local midnight goes to the day its kept record ends, and nothing is counted on the other day.
7. Duplicate rows and a re-read of the same rows give the same result (idempotent); empty-id duplicates with equal times count once.
8. The 1440 cap still applies to the sum; rounding happens before comparing.
9. Invalid records are ignored and do not merge or suppress valid ones (already true today; kept as a guard).
10. Pure and tolerant: frozen input, hostile rows and `tz`, 3000 copies of one sleep make one sleep.
11. Shipping: `CACHE` in `sw.js` greater than 59 (the value on main when this spec was written; never an exact version), `docs/DECISIONS.md` has `## D55.` (next free number) mentioning sleep and overlap. The implementer also adds a KNOWN-ISSUES note (below).

Tests 2 and 9 already pass before the fix: they guard behaviour that must not change (non-overlapping sums, invalid rows), not the fix itself. Tests 1, 3-8, 10, 11 fail before the fix.

### Existing test edited (reason)
`tests/google-health-import.test.js`, test 10, the `many` case: it built five records `0i:00-1i:00` that overlap each other and expected the 5 x 400 sum to be capped at 1440. Under the new rule those are one sleep, so the five records were changed to 30 minute records `0i:00-0i:30` that do not overlap; the expectation (1440, cap) is unchanged. Test 9 (overlapping ids, nap 45 + night 420, 300 + 450) is not affected: none of its records overlap.

## Edge cases and hostile input
- Empty rows, non-arrays, non-objects, prototype ids (`__proto__`, `constructor`), array/object ids, HTML in `sleep_last_updated`, numbers in time columns, `1e308` minutes, NaN/negative minutes, 3000 identical rows: no throw, no mutation, no change to other days.
- An invalid record with a huge range must not absorb or merge with valid ones.
- Performance: clustering must stay fine for a year of rows (a few thousand); sort by start and sweep, no work that is quadratic in the whole file is needed beyond clusters.

## What cannot be tested automatically
The real export and the owner's phone. Owner on a real device: re-import the same Takeout zip (the Diary line of 2026-11-13 reads `Sleep 7 h 53 min`, not `14 h 58 min`); look at three other nights that were doubled (for example 454+425 and 491+497) and confirm the larger one is shown; confirm Steps for that day are unchanged until a newer export is imported.

## Headless checklist (browser-tester; zip built in the scenario as in `tools/browser-test/scenarios/google-health-import.mjs`, page timezone America/Chicago, days relative to today as `D(n)`)
Times are chosen so each record ends on the same Chicago day whether Chicago is UTC-5 or UTC-6. Sleep file `Takeout/Google Health/Health Fitness Data_GoogleData/UserSleeps_2026.csv`, header as in the import spec, columns `sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source`. Rows for day D(1) (all `-06:00`, data_source `DERIVED`):
- `n1`, STAGES, asleep 386, start `D(1)T07:00:00Z`, end `D(1)T13:52:00Z`
- `n2`, STAGES, asleep 369, start `D(1)T06:55:00Z`, end `D(1)T13:54:00Z`
- `p1`, STAGES, asleep 56, start `D(1)T17:00:00Z`, end `D(1)T18:09:00Z`
- `p2`, CLASSIC, asleep 87, start `D(1)T16:50:00Z`, end `D(1)T18:18:00Z`

**C1. Duplicate sleeps count once.** Setup: Settings, fresh data (schema as in the import scenario), scope `Last year`, the zip with the four rows above (no other sleep rows; one steps row is optional). Steps: choose the zip in `#ghFile`, click `#ghStart`, wait until `#ghStatus` no longer starts with `Reading`; open the Diary, click `#prev` once (D(1)). Expect: `#activityLine` visible and its text contains `Sleep 7 h 53 min` and does NOT contain `14 h 58`; `JSON.parse(localStorage.getItem('macrodiary.v1')).activity[D(1)].sleepMinutes` equals `473`; `#ghStatus` reports `1 day of sleep`. Covered by headless? yes.

**C2. Re-import is idempotent.** Setup: after C1. Steps: read `activity[D(1)].updatedAt`, wait two seconds, choose the same zip again, click `#ghStart`, wait for the status. Expect: the same `#ghStatus` text as in C1; `activity[D(1)].updatedAt` unchanged; `activity[D(1)].sleepMinutes` still `473`; `#activityLine` still contains `Sleep 7 h 53 min`. Covered by headless? yes.

**C3. A night plus a non-overlapping afternoon nap still adds.** Setup: fresh data; zip whose sleep file has only: `a1` asleep 400 start `D(1)T07:00:00Z` end `D(1)T14:00:00Z`, and `a2` asleep 45 start `D(1)T19:00:00Z` end `D(1)T20:00:00Z`. Steps: import, open the Diary on D(1). Expect: `#activityLine` contains `Sleep 7 h 25 min` (445 min); `activity[D(1)].sleepMinutes` is `445`. Covered by headless? yes.

**C4. A one-minute overlap does not merge.** Setup: fresh data; sleep rows `b1` asleep 420 start `D(1)T06:00:00Z` end `D(1)T14:00:00Z`, `b2` asleep 45 start `D(1)T13:59:00Z` end `D(1)T15:00:00Z`. Steps: import, Diary on D(1). Expect: `#activityLine` contains `Sleep 7 h 45 min` (465 min). Covered by headless? yes.

### Owner on a real device
- O1. Re-import the real Takeout: Diary 2026-11-13 shows `Sleep 7 h 53 min`; steps for that day unchanged (2,367) until a newer export; no other day got larger.
- O2. Spot-check two other doubled nights against the Google app.

## Docs the implementer must update (same commit)
`docs/DECISIONS.md` D55 (rule above and the 50% threshold choice and why; the limit that two real naps that overlap by half or more would merge); `docs/KNOWN-ISSUES.md` a note (the Steps number on the export day is the watch total up to the export time and is correct; the duplicate-sleep heuristic is based on one person's export); `sw.js` CACHE bump.

## Open questions
1. A record WITH `sleep_last_updated` against one WITHOUT in a tie: not pinned (not tested); the implementer may choose, then the id rule applies if still tied.
2. The 50%-of-shorter threshold is my choice (the plan said "suggest"); it is easy to change in one place. It could merge two genuinely different sleeps that overlap by half, which is not expected in real data.
3. Which record is kept for a duplicate row with the same `sleep_id` but different data: the first row wins, as before (not changed).
4. Exact wording of `#activityLine` when only sleep exists is taken from the import spec (`From Google Health: ...`); the checklist checks `contains` only.
