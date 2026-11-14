// Spec: docs/specs/sleep-latest-update.md. Test-designer file, written before the change. Times are the owner's real pattern with the identity removed.
// Golden values are hand-computed (local = UTC - 6 h for tz -360), never taken from the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = () => import('../js/domain/health-import.js');
const fixed = m => () => m;
const R = (id, asleep, start, end, upd, extra = {}) => ({ sleep_id: id, sleep_type: 'STAGES', minutes_asleep: String(asleep), sleep_start: start, sleep_end: end, data_source: 'DERIVED', ...(upd === undefined ? {} : { sleep_last_updated: upd }), ...extra });
const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
const same = async (rows, tz, expected, msg) => {
  const { sleepByDay } = await H();
  for (const p of perms(rows)) assert.deepEqual(sleepByDay(p, tz), expected, msg);
};
const day = (d, mins, s, e) => ({ [d]: { sleepMinutes: mins, sleepStart: s, sleepEnd: e } });

test('1. real Nov 12: A 497 (updated 15:32Z) and B 491 (updated 19:34Z) overlap; the later updated B wins: 491 = 8 h 11, in every row order', async () => {
  // local 00:25-09:19 = 06:25Z-15:19Z; local 00:31-09:19 = 06:31Z-15:19Z
  await same([
    R('a', 497, '2026-11-12T06:25:00Z', '2026-11-12T15:19:00Z', '2026-11-12T15:32:33Z'),
    R('b', 491, '2026-11-12T06:31:00Z', '2026-11-12T15:19:00Z', '2026-11-12T19:34:34Z'),
  ], fixed(-360), day('2026-11-12', 491, '2026-11-12T06:31:00Z', '2026-11-12T15:19:00Z'));
});

test('2. real Nov 13: night 386 (upd 18:07Z) beats 369 (upd 14:19Z); nap 56 (upd 17:21:37Z) beats 87 (17:21:35Z); sum 442 = 7 h 22; main sleep is the kept night', async () => {
  await same([
    R('n2', 369, '2026-11-13T07:06:00Z', '2026-11-13T14:05:00Z', '2026-11-13T14:19:49Z'),
    R('n1', 386, '2026-11-13T07:11:00Z', '2026-11-13T14:03:00Z', '2026-11-13T18:07:31Z'),
    R('p2', 87, '2026-11-13T15:41:00Z', '2026-11-13T17:09:00Z', '2026-11-13T17:21:35Z', { sleep_type: 'CLASSIC' }),
    R('p1', 56, '2026-11-13T15:52:00Z', '2026-11-13T17:01:00Z', '2026-11-13T17:21:37Z'),
  ], fixed(-360), day('2026-11-13', 442, '2026-11-13T07:11:00Z', '2026-11-13T14:03:00Z'));
});

test('3. real Nov 11 (425 upd 14:52Z vs 454 upd 18:35Z -> 454 = 7 h 34) and Nov 10 (476 vs 506 -> 506); both rules agree on the first, the second pins the data', async () => {
  const exp = { ...day('2026-11-11', 454, '2026-11-11T06:40:00Z', '2026-11-11T14:12:00Z'), ...day('2026-11-10', 506, '2026-11-10T06:30:00Z', '2026-11-10T14:40:00Z') };
  await same([
    R('a', 425, '2026-11-11T06:30:00Z', '2026-11-11T14:10:00Z', '2026-11-11T14:52:06Z'),
    R('b', 454, '2026-11-11T06:40:00Z', '2026-11-11T14:12:00Z', '2026-11-11T18:35:20Z'),
    R('c', 476, '2026-11-10T06:35:00Z', '2026-11-10T14:38:00Z', '2026-11-10T15:36:00Z'),
    R('d', 506, '2026-11-10T06:30:00Z', '2026-11-10T14:40:00Z', '2026-11-10T19:39:00Z'),
  ].slice(0, 4), fixed(-360), exp);
});

test('4. the older record has MORE minutes and is longer, the newer is shorter: the newer still wins (update beats minutes and period)', async () => {
  await same([
    R('old', 450, '2026-12-01T00:00:00Z', '2026-12-01T08:00:00Z', '2026-12-01T09:00:00Z'),
    R('new', 300, '2026-12-01T01:00:00Z', '2026-12-01T07:00:00Z', '2026-12-01T10:00:00Z'),
  ], fixed(0), day('2026-12-01', 300, '2026-12-01T01:00:00Z', '2026-12-01T07:00:00Z'));
});

test('5. equal update times (even to the second, different formats of one instant): fall back to most minutes, then longer period, then larger id, then later end', async () => {
  const U = '2026-12-02T12:00:00Z';
  await same([R('z', 380, '2026-12-02T01:00:00Z', '2026-12-02T08:30:00Z', U), R('a', 400, '2026-12-02T01:00:00Z', '2026-12-02T08:00:00Z', U)], fixed(0),
    day('2026-12-02', 400, '2026-12-02T01:00:00Z', '2026-12-02T08:00:00Z'), 'minutes');
  await same([R('z', 400, '2026-12-03T01:00:00Z', '2026-12-03T08:00:00Z', U), R('a', 400, '2026-12-03T01:00:00Z', '2026-12-03T08:30:00Z', U)], fixed(0),
    day('2026-12-03', 400, '2026-12-03T01:00:00Z', '2026-12-03T08:30:00Z'), 'period');
  await same([R('b10', 400, '2026-12-04T01:00:00Z', '2026-12-04T08:00:00Z', U), R('b9', 400, '2026-12-04T02:00:00Z', '2026-12-04T09:00:00Z', U)], fixed(0),
    day('2026-12-04', 400, '2026-12-04T02:00:00Z', '2026-12-04T09:00:00Z'), 'id as string');
  // same instant written two ways: still equal, so the 450 wins on minutes
  await same([R('a', 450, '2026-12-05T01:00:00Z', '2026-12-05T08:00:00Z', '2026-12-05T12:00:00Z'), R('b', 300, '2026-12-05T01:00:00Z', '2026-12-05T08:00:00Z', '2026-12-05T12:00:00.000Z')], fixed(0),
    day('2026-12-05', 450, '2026-12-05T01:00:00Z', '2026-12-05T08:00:00Z'), 'same instant');
});

test('6. missing update times on both: the old order (most minutes, longer period, id, later end); the column absent, empty or whitespace is "missing"', async () => {
  for (const u of [undefined, '', '  ']) {
    await same([R('a', 300, '2026-12-06T01:00:00Z', '2026-12-06T07:00:00Z', u), R('b', 410, '2026-12-06T01:00:00Z', '2026-12-06T08:00:00Z', u)], fixed(0),
      day('2026-12-06', 410, '2026-12-06T01:00:00Z', '2026-12-06T08:00:00Z'), JSON.stringify(u));
  }
});

test('7. a record WITH a parseable update time beats one WITHOUT, even when the one without has more minutes; garbage counts as without', async () => {
  const withU = R('w', 300, '2026-12-07T01:00:00Z', '2026-12-07T06:00:00Z', '2026-12-07T05:00:00Z');
  const exp = day('2026-12-07', 300, '2026-12-07T01:00:00Z', '2026-12-07T06:00:00Z');
  for (const bad of [undefined, '', 'not a date', '<img onerror=alert(1)>', '2026-13-45T99:99:99Z', 'null'])
    await same([withU, R('wo', 450, '2026-12-07T01:00:00Z', '2026-12-07T08:00:00Z', bad)], fixed(0), exp, JSON.stringify(bad));
  // a very old but valid update still beats none
  await same([R('w', 300, '2026-12-08T01:00:00Z', '2026-12-08T06:00:00Z', '1999-01-01T00:00:00Z'), R('wo', 450, '2026-12-08T01:00:00Z', '2026-12-08T08:00:00Z')], fixed(0),
    day('2026-12-08', 300, '2026-12-08T01:00:00Z', '2026-12-08T06:00:00Z'));
});

test('8. both updates garbage (different garbage): fall back to the old order, never throw, never prefer by the garbage text', async () => {
  await same([R('a', 300, '2026-12-09T01:00:00Z', '2026-12-09T06:00:00Z', 'zzz'), R('b', 410, '2026-12-09T01:00:00Z', '2026-12-09T08:00:00Z', 'aaa')], fixed(0),
    day('2026-12-09', 410, '2026-12-09T01:00:00Z', '2026-12-09T08:00:00Z'));
  await same([R('a', 410, '2026-12-10T01:00:00Z', '2026-12-10T08:00:00Z', 'aaa'), R('b', 300, '2026-12-10T01:00:00Z', '2026-12-10T06:00:00Z', 'zzz')], fixed(0),
    day('2026-12-10', 410, '2026-12-10T01:00:00Z', '2026-12-10T08:00:00Z'));
});

test('9. three-record chain (A-B and B-C overlap, A-C only touch): the latest updated of the three is kept, wherever it sits in the chain; one record counts', async () => {
  const A = u => R('a', 400, '2026-12-11T00:00:00Z', '2026-12-11T04:00:00Z', u), B = u => R('b', 210, '2026-12-11T02:00:00Z', '2026-12-11T06:00:00Z', u), C = u => R('c', 220, '2026-12-11T04:00:00Z', '2026-12-11T08:00:00Z', u);
  const t = h => `2026-12-11T${h}:00:00Z`;
  await same([A(t('11')), B(t('10')), C(t('09'))], fixed(0), day('2026-12-11', 400, t('00'), t('04')), 'end of chain, most minutes');
  await same([A(t('09')), B(t('11')), C(t('10'))], fixed(0), day('2026-12-11', 210, t('02'), t('06')), 'middle, fewest minutes');
  await same([A(t('09')), B(t('10')), C(t('11'))], fixed(0), day('2026-12-11', 220, t('04'), t('08')), 'other end');
  // only some have an update: the one that has it wins
  await same([A(undefined), B('2026-12-11T01:00:00Z'), C(undefined)], fixed(0), day('2026-12-11', 210, t('02'), t('06')), 'single dated record');
});

test('10. a chain where the middle record is the latest: records are not eliminated pairwise (A beats B? B beats C? is not the rule), the whole cluster has one winner', async () => {
  // A newer than B, B newer than C would pick A; here A < B > C but A newer than C: the winner must still be B, not "A beats C by transitivity".
  const t = h => `2026-12-12T${h}:00:00Z`;
  await same([
    R('a', 200, t('00'), t('04'), '2026-12-12T20:00:00Z'),
    R('b', 205, t('02'), t('06'), '2026-12-12T21:00:00Z'),
    R('c', 500, t('04'), t('08'), '2026-12-12T19:00:00Z'),
  ], fixed(0), day('2026-12-12', 205, t('02'), t('06')));
});

test('11. the day follows the KEPT record: a cluster spanning local midnight moves to the later updated record\'s day', async () => {
  // tz -360. X ends 05:30Z on the 13th = 23:30 local on the 12th; Y ends 06:30Z = 00:30 local on the 13th.
  const X = (m, u) => R('x', m, '2026-11-12T22:00:00Z', '2026-11-13T05:30:00Z', u), Y = (m, u) => R('y', m, '2026-11-12T23:00:00Z', '2026-11-13T06:30:00Z', u);
  await same([X(410, '2026-11-13T01:00:00Z'), Y(380, '2026-11-13T02:00:00Z')], fixed(-360), day('2026-11-13', 380, '2026-11-12T23:00:00Z', '2026-11-13T06:30:00Z'));
  await same([X(380, '2026-11-13T02:00:00Z'), Y(410, '2026-11-13T01:00:00Z')], fixed(-360), day('2026-11-12', 380, '2026-11-12T22:00:00Z', '2026-11-13T05:30:00Z'));
});

test('12. unchanged: separate sleeps still add, exact repeats count once, the 1440 cap holds, the update time never merges non-overlapping records', async () => {
  const { sleepByDay } = await H();
  // night and later nap, the nap updated much earlier: both count (not one cluster)
  await same([R('n', 400, '2026-12-13T00:00:00Z', '2026-12-13T07:00:00Z', '2026-12-13T20:00:00Z'), R('p', 45, '2026-12-13T12:00:00Z', '2026-12-13T13:00:00Z', '2026-12-13T08:00:00Z')], fixed(0),
    day('2026-12-13', 445, '2026-12-13T00:00:00Z', '2026-12-13T07:00:00Z'));
  const r = R('a', 100, '2026-12-14T01:00:00Z', '2026-12-14T03:00:00Z', '2026-12-14T05:00:00Z');
  assert.equal(sleepByDay([r, { ...r }, { ...r }], fixed(0))['2026-12-14'].sleepMinutes, 100);
  const four = [0, 1, 2, 3].map(i => R('m' + i, 400, `2026-12-15T0${i * 2}:00:00Z`, `2026-12-15T0${i * 2}:30:00Z`, `2026-12-15T1${i}:00:00Z`));
  assert.equal(sleepByDay(four, fixed(0))['2026-12-15'].sleepMinutes, 1440);
  // an invalid record (end before start) with the newest update must not win or absorb anything
  assert.deepEqual(sleepByDay([R('g', 100, '2026-12-16T01:00:00Z', '2026-12-16T03:00:00Z', '2026-12-16T05:00:00Z'), R('bad', 500, '2026-12-16T05:00:00Z', '2026-12-16T01:00:00Z', '2030-01-01T00:00:00Z')], fixed(0)),
    day('2026-12-16', 100, '2026-12-16T01:00:00Z', '2026-12-16T03:00:00Z'));
});

test('13. pure and tolerant: frozen input, hostile update values never throw', async () => {
  const { sleepByDay } = await H();
  const rows = Object.freeze([Object.freeze(R('a', 100, '2026-12-17T01:00:00Z', '2026-12-17T03:00:00Z', {})), Object.freeze(R('b', 90, '2026-12-17T01:00:00Z', '2026-12-17T03:00:00Z', ['x'])),
    Object.freeze(R('c', 80, '2026-12-17T01:00:00Z', '2026-12-17T03:00:00Z', 5)), Object.freeze(R('d', 70, '2026-12-17T01:00:00Z', '2026-12-17T03:00:00Z', null))]);
  assert.doesNotThrow(() => sleepByDay(rows, fixed(0)));
  assert.deepEqual(sleepByDay(rows, fixed(0)), sleepByDay(rows, fixed(0)));
});

test('14. shipping: sw.js CACHE is bumped past v60, and D55 in DECISIONS.md says the latest-updated record is kept', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const v = Number((sw.match(/const CACHE = 'macro-diary-v(\d+)'/) || [])[1]);
  assert.ok(v > 60, `CACHE is v${v}, must be greater than the previous main value 60`);
  const dec = readFileSync(new URL('../docs/DECISIONS.md', import.meta.url), 'utf8');
  const m = dec.match(/^## D55\.[^\n]*\n([\s\S]*?)(?=^## D\d+\.|$(?![\s\S]))/m);
  assert.ok(m, 'D55 is missing');
  assert.match(m[0], /sleep_last_updated/);
  assert.match(m[0], /latest|most recent|newest|later/i);
  assert.doesNotMatch(m[0], /one with the most minutes asleep \(tie/i, 'old "most minutes first" wording must be gone');
});
