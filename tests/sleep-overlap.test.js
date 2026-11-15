// Spec: docs/specs/sleep-overlap.md. Test-designer file, written before the fix. All data is made up.
// Golden values are hand-computed (UTC arithmetic in the comments), never taken from the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const H = () => import('../js/domain/health-import.js');
const fixed = m => () => m;
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
// a parsed CSV row (all values are strings, like parseCsvTable gives)
const R = (id, asleep, start, end, extra = {}) => ({ sleep_id: id, sleep_type: 'STAGES', minutes_asleep: String(asleep), sleep_start: start, sleep_end: end, data_source: 'DERIVED', ...extra });
const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
const same = async (rows, tz, expected, msg) => {
  const { sleepByDay } = await H();
  for (const p of perms(rows)) assert.deepEqual(sleepByDay(p, tz), expected, msg);
};

// Device timezone UTC-6 (local = UTC - 6 h). Local 2026-11-13: night 01:11-08:03 = 07:11Z-14:03Z (412 min period), night 2 01:06-08:05 = 07:06Z-14:05Z (419),
// nap 09:52-11:01 = 15:52Z-17:01Z (69), nap 2 09:41-11:09 = 15:41Z-17:09Z (88). The night and the nap do not touch (14:05Z < 15:41Z).
const REAL = [
  R('n1', 386, '2026-11-13T07:11:00Z', '2026-11-13T14:03:00Z'),
  R('n2', 369, '2026-11-13T07:06:00Z', '2026-11-13T14:05:00Z'),
  R('p1', 56, '2026-11-13T15:52:00Z', '2026-11-13T17:01:00Z'),
  R('p2', 87, '2026-11-13T15:41:00Z', '2026-11-13T17:09:00Z', { sleep_type: 'CLASSIC' }),
];

test('1. the same sleep recorded twice counts once: 386 + 87 = 473 min (7 h 53), the main sleep is the larger night, in every row order', async () => {
  await same(REAL, fixed(-360), { '2026-11-13': { sleepMinutes: 473, sleepStart: '2026-11-13T07:11:00Z', sleepEnd: '2026-11-13T14:03:00Z' } });
});

test('2. a night and a real nap that do NOT overlap still add; touching ranges (end == next start) do not overlap; the main sleep is the largest kept record', async () => {
  // tz 0. A 00:00-08:00 (400), B 08:00-09:00 (50): touching, so 450.
  await same([R('a', 400, '2026-11-20T00:00:00Z', '2026-11-20T08:00:00Z'), R('b', 50, '2026-11-20T08:00:00Z', '2026-11-20T09:00:00Z')], fixed(0),
    { '2026-11-20': { sleepMinutes: 450, sleepStart: '2026-11-20T00:00:00Z', sleepEnd: '2026-11-20T08:00:00Z' } });
  // a gap, and the nap is the larger record: 300 + 350 = 650, times of the nap
  await same([R('c', 300, '2026-11-21T00:00:00Z', '2026-11-21T06:00:00Z'), R('d', 350, '2026-11-21T10:00:00Z', '2026-11-21T17:00:00Z')], fixed(0),
    { '2026-11-21': { sleepMinutes: 650, sleepStart: '2026-11-21T10:00:00Z', sleepEnd: '2026-11-21T17:00:00Z' } });
});

test('3. threshold: overlap must be at least 50% of the SHORTER period (by start..end, not minutes asleep); less stays separate', async () => {
  const A = R('a', 400, '2026-11-22T02:00:00Z', '2026-11-22T10:00:00Z');                        // 480 min period
  // exactly 50%: B 09:00-11:00 (120 min), overlap 09:00-10:00 = 60 min = 50% -> same sleep, A kept
  await same([A, R('b', 90, '2026-11-22T09:00:00Z', '2026-11-22T11:00:00Z')], fixed(0),
    { '2026-11-22': { sleepMinutes: 400, sleepStart: '2026-11-22T02:00:00Z', sleepEnd: '2026-11-22T10:00:00Z' } }, '50% merges');
  // 59 of 120 min = 49.2% -> separate, both count: 400 + 90
  await same([A, R('b', 90, '2026-11-22T09:01:00Z', '2026-11-22T11:01:00Z')], fixed(0),
    { '2026-11-22': { sleepMinutes: 490, sleepStart: '2026-11-22T02:00:00Z', sleepEnd: '2026-11-22T10:00:00Z' } }, '49% stays separate');
  // a 1 minute overlap between a night and a nap that starts as the night ends: separate
  await same([R('n', 420, '2026-11-23T06:00:00Z', '2026-11-23T14:00:00Z'), R('p', 45, '2026-11-23T13:59:00Z', '2026-11-23T15:00:00Z')], fixed(0),
    { '2026-11-23': { sleepMinutes: 465, sleepStart: '2026-11-23T06:00:00Z', sleepEnd: '2026-11-23T14:00:00Z' } }, '1 minute overlap');
  // the shorter record decides, not the longer: B (60 min) lies fully inside A (480 min) = 100% of the shorter -> same sleep
  await same([A, R('b', 55, '2026-11-22T04:00:00Z', '2026-11-22T05:00:00Z')], fixed(0),
    { '2026-11-22': { sleepMinutes: 400, sleepStart: '2026-11-22T02:00:00Z', sleepEnd: '2026-11-22T10:00:00Z' } }, 'contained record');
});

test('4. overlap is transitive: A-B and B-C overlap (A-C only touch), so all three are one cluster and only the largest counts', async () => {
  // A 00:00-04:00, B 02:00-06:00 (overlap 120 of 240 = 50%), C 04:00-08:00 (overlap with B 120 of 240); A and C touch at 04:00 only.
  await same([R('a', 200, '2026-11-24T00:00:00Z', '2026-11-24T04:00:00Z'), R('b', 210, '2026-11-24T02:00:00Z', '2026-11-24T06:00:00Z'), R('c', 220, '2026-11-24T04:00:00Z', '2026-11-24T08:00:00Z')], fixed(0),
    { '2026-11-24': { sleepMinutes: 220, sleepStart: '2026-11-24T04:00:00Z', sleepEnd: '2026-11-24T08:00:00Z' } });
});

test('5. the kept record of a cluster WHEN sleep_last_updated does not decide (see sleep-latest-update.test.js): most minutes, then the longer period, then the larger sleep_id (string compare), then the later end; never the row order', async () => {
  const day = '2026-11-25';
  const exp = (mins, s, e) => ({ [day]: { sleepMinutes: mins, sleepStart: `${day}T${s}:00Z`, sleepEnd: `${day}T${e}:00Z` } });
  const t = (h, m) => `${day}T${h}:${m}:00Z`;
  // minutes first, even when the other record is longer
  await same([R('z', 380, t('01', '00'), t('08', '30')), R('a', 400, t('01', '00'), t('08', '00'))], fixed(0), exp(400, '01:00', '08:00'));
  // same minutes: the longer period (B 450 > A 420) wins even though its id is smaller
  await same([R('z', 400, t('01', '00'), t('08', '00')), R('a', 400, t('01', '00'), t('08', '30'))], fixed(0), exp(400, '01:00', '08:30'));
  // same minutes, same period (420), different position: the later sleep_last_updated wins (now the first rule; still true)
  const lu = (id, s, e, u) => R(id, 400, t(s, '00'), t(e, '00'), { sleep_last_updated: u });
  await same([lu('b', '01', '08', '2026-11-26T01:00:00Z'), lu('a', '02', '09', '2026-11-26T02:00:00Z')], fixed(0), exp(400, '02:00', '09:00'));
  await same([lu('b', '01', '08', '2026-11-26T03:00:00Z'), lu('a', '02', '09', '2026-11-26T02:00:00Z')], fixed(0), exp(400, '01:00', '08:00'));
  // same minutes, same period, no sleep_last_updated: the larger id as a STRING ('b9' > 'b10')
  await same([R('b10', 400, t('01', '00'), t('08', '00')), R('b9', 400, t('02', '00'), t('09', '00'))], fixed(0), exp(400, '02:00', '09:00'));
  // nothing left to compare (no ids): the later end
  await same([R('', 400, t('01', '00'), t('08', '00')), R('', 400, t('02', '00'), t('09', '00'))], fixed(0), exp(400, '02:00', '09:00'));
});

test('6. a cluster that spans local midnight belongs to the local day its KEPT record ends', async () => {
  // tz -360. X 16:00-23:30 local on the 12th (22:00Z-05:30Z), Y 17:00-00:30 local (23:00Z-06:30Z); overlap 6.5 h of 7.5 h.
  const X = m => R('x', m, '2026-11-12T22:00:00Z', '2026-11-13T05:30:00Z'), Y = m => R('y', m, '2026-11-12T23:00:00Z', '2026-11-13T06:30:00Z');
  await same([X(410), Y(380)], fixed(-360), { '2026-11-12': { sleepMinutes: 410, sleepStart: '2026-11-12T22:00:00Z', sleepEnd: '2026-11-13T05:30:00Z' } });
  await same([X(380), Y(410)], fixed(-360), { '2026-11-13': { sleepMinutes: 410, sleepStart: '2026-11-12T23:00:00Z', sleepEnd: '2026-11-13T06:30:00Z' } });
});

test('7. identical duplicate rows (same sleep_id) count once; a second read of the same rows gives the same result (re-import is idempotent)', async () => {
  const { sleepByDay } = await H();
  const once = sleepByDay(REAL, fixed(-360));
  assert.deepEqual(sleepByDay([...REAL, ...REAL], fixed(-360)), once);
  assert.deepEqual(sleepByDay([...REAL, REAL[0], REAL[3]], fixed(-360)), once);
  assert.deepEqual(sleepByDay(REAL, fixed(-360)), once);
  // two rows without an id and with the same times are one sleep, not two
  assert.equal(sleepByDay([R('', 100, '2026-11-27T01:00:00Z', '2026-11-27T03:00:00Z'), R('', 100, '2026-11-27T01:00:00Z', '2026-11-27T03:00:00Z')], fixed(0))['2026-11-27'].sleepMinutes, 100);
});

test('8. the day total (sum of the kept records) is still capped at 1440; minutes are rounded before they are compared', async () => {
  const { sleepByDay } = await H();
  const four = [0, 1, 2, 3].map(i => R('m' + i, 400, `2026-11-28T0${i * 2}:00:00Z`, `2026-11-28T0${i * 2}:30:00Z`));   // four separate 30 min records: 1600 -> 1440
  assert.equal(sleepByDay(four, fixed(0))['2026-11-28'].sleepMinutes, 1440);
  // 90.4 rounds to 90 and 89.6 rounds to 90: a tie, then the longer period (B) wins, the total is 90 once
  const out = sleepByDay([R('a', '90.4', '2026-11-29T01:00:00Z', '2026-11-29T03:00:00Z'), R('b', '89.6', '2026-11-29T01:00:00Z', '2026-11-29T03:30:00Z')], fixed(0));
  assert.deepEqual(out, { '2026-11-29': { sleepMinutes: 90, sleepStart: '2026-11-29T01:00:00Z', sleepEnd: '2026-11-29T03:30:00Z' } });
});

test('9. invalid records are ignored and never merge, suppress or bridge anything', async () => {
  const good = R('g', 100, '2026-11-30T01:00:00Z', '2026-11-30T03:00:00Z');
  const bad = [
    R('b1', 'abc', '2026-11-30T01:00:00Z', '2026-11-30T05:00:00Z'),            // not a number: would win on length if it counted
    R('b2', 500, '2026-11-30T05:00:00Z', '2026-11-30T01:00:00Z'),              // ends before it starts
    R('b3', 500, 'x', '2026-11-30T03:00:00Z'), R('b4', 500, '2026-11-30T01:00:00Z', ''),
    R('b5', 500, '2026-11-30T00:00:00Z', '2026-12-01T06:00:00Z'),              // longer than 24 hours
    R('b6', -5, '2026-11-30T01:00:00Z', '2026-11-30T05:00:00Z'),
  ];
  await same([good, bad[0], bad[1], bad[4]], fixed(0), { '2026-11-30': { sleepMinutes: 100, sleepStart: '2026-11-30T01:00:00Z', sleepEnd: '2026-11-30T03:00:00Z' } });
  const { sleepByDay } = await H();
  assert.deepEqual(sleepByDay([good, ...bad], fixed(0)), { '2026-11-30': { sleepMinutes: 100, sleepStart: '2026-11-30T01:00:00Z', sleepEnd: '2026-11-30T03:00:00Z' } });
});

test('10. pure and tolerant: rows are not changed (frozen input), no throw on hostile rows, same answer on a second call', async () => {
  const { sleepByDay } = await H();
  const frozen = deepFreeze(REAL.map(r => ({ ...r, sleep_last_updated: '2026-11-14T00:00:00Z' })));
  const snap = JSON.stringify(frozen);
  const a = sleepByDay(frozen, fixed(-360));
  assert.equal(JSON.stringify(frozen), snap);
  assert.deepEqual(sleepByDay(frozen, fixed(-360)), a);
  assert.equal(a['2026-11-13'].sleepMinutes, 473);
  const hostile = [undefined, null, 'x', 5, {}, [], [null, 1, 'x', [], {},
    { sleep_id: {}, sleep_start: 5, sleep_end: 6, minutes_asleep: {} },
    R('__proto__', 60, '2026-11-19T11:00:00Z', '2026-11-19T12:00:00Z', { sleep_last_updated: {} }),
    R('constructor', 60, '2026-11-19T11:30:00Z', '2026-11-19T12:30:00Z', { sleep_last_updated: '<img onerror=alert(1)>' }),
    R(['a'], 60, '2026-11-19T11:00:00Z', '2026-11-19T12:00:00Z', { sleep_last_updated: 5 }),
    R('h', 1e308, '2026-11-19T11:00:00Z', '2026-11-19T12:00:00Z')]];
  for (const rows of hostile) for (const tz of [undefined, null, () => { throw new Error('x'); }, () => NaN, fixed(-360)]) assert.doesNotThrow(() => sleepByDay(rows, tz));
  assert.doesNotThrow(() => sleepByDay(Array.from({ length: 3000 }, (_, i) => R('h' + i, 60, '2026-11-19T11:00:00Z', '2026-11-19T12:00:00Z')), fixed(0)));
  const big = sleepByDay(Array.from({ length: 3000 }, (_, i) => R('h' + i, 60, '2026-11-19T11:00:00Z', '2026-11-19T12:00:00Z')), fixed(0));
  assert.equal(big['2026-11-19'].sleepMinutes, 60, '3000 copies of one sleep are one sleep');
});

test('11. shipping: sw.js CACHE is bumped past v59, and DECISIONS.md has D55 about the overlapping sleeps', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const v = Number((sw.match(/const CACHE = 'macro-diary-v(\d+)'/) || [])[1]);
  assert.ok(v > 59, `CACHE is v${v}, must be greater than the previous main value 59`);
  const dec = readFileSync(new URL('../docs/DECISIONS.md', import.meta.url), 'utf8');
  const m = dec.match(/^## D55\.[^\n]*\n([\s\S]*?)(?=^## D\d+\.|$(?![\s\S]))/m);
  assert.ok(m, 'D55 is missing');
  assert.match(m[0], /overlap/i); assert.match(m[0], /sleep/i);
});
