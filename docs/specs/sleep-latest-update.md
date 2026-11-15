# Spec: of overlapping sleeps keep the LATEST UPDATED, not the one with most minutes (change to `sleep-overlap`)

## Purpose
Google reprocesses a sleep and keeps the older record in the export; the Google Health app shows the most recently updated one. `sleepByDay` must keep, from each group of overlapping records, the one with the latest `sleep_last_updated`, so the Diary matches the app.

## Real data (owner's Takeout, local UTC-6)
- Nov 12: A 497 asleep (upd 15:32:33Z) vs B 491 (upd 19:34:34Z) -> 491 (8 h 11). Old rule gave 497.
- Nov 13: nights 369 (upd 14:19:49Z) / 386 (18:07:31Z), naps 87 (17:21:35Z) / 56 (17:21:37Z) -> 386 + 56 = 442 (7 h 22). Old rule gave 473.
- Nov 11: 425 / 454 (later) -> 454. Nov 10: 476 / 506 (later) -> 506.

## Contract
No new export. `sleepByDay(rows, tz)` in `js/domain/health-import.js` (domain, pure): signature and return shape unchanged. Only rule 4 of `sleep-overlap.md` changes.

## New rule for the kept record of a cluster (clustering, exact-repeat drop, day = local day the KEPT record ends, per-day sum capped at 1440, main sleep gives start/end, invalid records ignored: all unchanged)
1. Latest `sleep_last_updated` (parsed instant) wins.
2. A record with a parseable update time beats one without. Missing, empty, whitespace and unparseable are all "without".
3. Ties (equal instants, or both without): most `minutes_asleep` (rounded), then longer period, then larger `sleep_id` as string, then later `sleep_end`.
4. The cluster has ONE winner chosen over all its members (not pairwise elimination); independent of row order.

## Behaviours (tests in `tests/sleep-latest-update.test.js`)
1. Real Nov 12 -> 491, every row order.
2. Real Nov 13 -> 442, start/end of the 386 night.
3. Real Nov 11 and Nov 10 -> 454 and 506.
4. Older record with more minutes and longer period loses to the newer.
5. Equal update times (also one instant written two ways) fall back to minutes, period, id.
6. No update times (absent/empty/whitespace): old order.
7. Dated beats undated even with fewer minutes; garbage counts as undated.
8. Both garbage: old order.
9. Three-record chain: the latest of the three wins wherever it sits.
10. Middle-of-chain latest wins; no pairwise elimination.
11. The day follows the kept record (midnight-spanning cluster).
12. Unchanged: separate sleeps add regardless of update times, exact repeats once, cap 1440, invalid records with a newest update do not win.
13. Pure and tolerant with hostile update values.
14. Shipping: `CACHE` > 60 (value on main now), D55 mentions `sleep_last_updated` and the latest-updated rule and no longer says "most minutes asleep (tie:".

Tests 12 and 13 largely guard unchanged behaviour and may pass before the change.

## Edited existing tests (tests/sleep-overlap.test.js)
Only test 5's title and one comment: it said the order is minutes first, then period, then later `sleep_last_updated`. Its assertions are unchanged and still hold (the `sleep_last_updated` cases have equal minutes and period). No other assertion pinned "most minutes wins over a later update": tests 1, 4, 6, 8, 10 have no update times, or equal ones (test 10), and fall under the tie rule. `tests/google-health-import.test.js` has no `sleep_last_updated`; untouched.

## D55 must say (implementer)
Replace "keeps one per group: the one with the most minutes asleep (tie: the longer period, the later `sleep_last_updated`, the larger `sleep_id`, the later end). A record that has a `sleep_last_updated` beats one without it in a tie." with: keeps the record with the latest `sleep_last_updated` (Google reprocesses a sleep and the app shows the newest version; real Takeout confirmed on 4 nights, e.g. 497 vs 491 -> 491); a record with a parseable update time beats one without; ties fall back to most minutes, longer period, larger `sleep_id`, later end. Add to Limits: if the export lacks `sleep_last_updated` the old minutes-first order applies; a manual edit in the app that does not touch the timestamp is not seen.

## Manual / not automatic
Owner on a real device: re-import the Takeout; Diary Nov 12 shows `Sleep 8 h 11 min`, Nov 13 `7 h 22 min`, Nov 11 `7 h 34 min`. Covered by headless? no: real data. A headless scenario may reuse the overlap CSV of `sleep-overlap.md` with `sleep_last_updated` added (column order is free as the file has a header): with n2 older and n1 newer and p1 newer than p2, expect `Sleep 7 h 22 min` for the Nov 13 pattern.

## Open questions
1. Is the column really named `sleep_last_updated` in the CSV header (taken from the owner's description and the existing tests)? Not verified here.
2. Timestamps without a zone (`2026-11-12 15:32:33`): the test does not pin how they parse; only ISO `Z` values are tested.
