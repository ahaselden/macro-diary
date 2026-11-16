// Spec: docs/specs/google-health-sync.md (backlog item 20, step 2). Test-designer file, written BEFORE the implementation. All data is made up.
// Golden values are hand-computed (arithmetic in the comments) or taken from the owner's real run of 2026-11-16 (steps 1226 / 2919 / 12921, sleep 159+239 on the 16th).
// G1-G21 are pure domain tests; S1-S10 use fakes for fetch / google / storage; T1-T5 are WEAK source-text checks: they prove strings, imports and ids are
// present or absent, not that the screens work (the headless checklist in the spec is the real UI test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { sanitizeActivityDay, defaults } from '../js/core/schema.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { SYNC_KEY } from '../js/services/sync/config.js';
import { toRecords } from '../js/domain/sync-records.js';

const read = p => { assert.ok(existsSync(new URL('../' + p, import.meta.url)), 'missing file: ' + p); return readFileSync(new URL('../' + p, import.meta.url), 'utf8'); };
const D = () => import('../js/domain/google-health-api.js');
const S = () => import('../js/services/google-health-api.js');
const L = (y, m, d, h = 0, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s); // LOCAL time, so the tests do not depend on the machine's timezone
const NOW = L(2026, 11, 16, 12, 0, 0);
const clone = o => JSON.parse(JSON.stringify(o));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const SC1 = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
const SC2 = 'https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const SCOPE = SC1 + ' ' + SC2;
const HEALTH = 'https://health.googleapis.com/v4/users/me';
const ID = '123456-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com';
const SUFFIX = '.apps.googleusercontent.com';
const SECRET = 'GOCSPX-abcdefghij';
const TOKEN = 'ya29.test-token-abc';
const EMAIL = 'owner@example.com';

// the exact messages (spec "Error messages" and "Client ID rules")
const M = {
  empty: 'Enter a Client ID first.',
  secret: 'That looks like a client secret, which must never be pasted here. Use the Client ID, which ends in .apps.googleusercontent.com.',
  shape: 'That does not look like a Client ID. It should end in .apps.googleusercontent.com.',
  noSave: 'Could not save the Client ID on this device.',
  busy: 'A sync is already running.',
  script: 'Could not load Google sign-in. Check your connection and try again.',
  denied: 'Google did not allow access. While the app is in test mode, only accounts added as test users can sign in.',
  closed: 'The Google sign-in window was closed before it finished. Tap Sync Google Health to try again.',
  blocked: 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  origin: 'Google does not accept this web address for your Client ID. Add it under Authorized JavaScript origins in the Google Cloud console.',
  failed: 'Google sign-in failed.',
  noToken: 'Google sign-in did not return an access token.',
  notLinked: 'This Google account is not linked in the Google Health app yet. Open the app on your phone, sign in, then try again.',
  s401: 'Google rejected the sign-in. Tap Sync Google Health to sign in again.',
  s403: 'Google refused access to your health data. Check that both Health permissions were ticked on the consent screen and the Google Health API is enabled.',
  s429: 'Google says there were too many requests. Wait a minute and try again.',
  http: n => `Google Health answered with an error (HTTP ${n}). Try again later.`,
  network: 'Could not reach Google. Check your connection and try again.',
  unreadable: 'Google Health sent an answer this app could not read.',
};

// ================================================================ request builders (G1-G4)
const cdt = (y, m, d) => ({ date: { year: y, month: m, day: d }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } });
const rng = (a, b) => ({ start: cdt(...a), end: cdt(...b) });

test('G1. civilRange / buildDailyRollUpBody: local start (days-1 back), exclusive end (tomorrow), CivilDateTime objects; SYNC_DAYS is 7 and the default', async () => {
  const { civilRange, buildDailyRollUpBody, SYNC_DAYS } = await D();
  assert.equal(SYNC_DAYS, 7);
  assert.deepEqual(civilRange(NOW, 7), rng([2026, 11, 10], [2026, 11, 17])); // 16 - 6 = 10; end 17
  assert.deepEqual(civilRange(NOW), rng([2026, 11, 10], [2026, 11, 17]));    // default is 7
  assert.deepEqual(civilRange(NOW, 3), rng([2026, 11, 14], [2026, 11, 17]));
  assert.deepEqual(civilRange(NOW, 1), rng([2026, 11, 16], [2026, 11, 17]));
  assert.deepEqual(buildDailyRollUpBody(NOW), { range: rng([2026, 11, 10], [2026, 11, 17]), windowSizeDays: 1 });
});

test('G2. civilRange: month / year / leap-day boundaries, time of day never matters, days normalised (default 7, floor, clamp 1..31), invalid now -> null, now not mutated', async () => {
  const { civilRange } = await D();
  assert.deepEqual(civilRange(L(2026, 12, 3, 9), 7), rng([2026, 11, 27], [2026, 12, 4])); // 3 - 6 = -3 -> Nov 30 - 3 = Nov 27
  assert.deepEqual(civilRange(L(2026, 3, 1, 9), 3), rng([2026, 2, 27], [2026, 3, 2]));
  assert.deepEqual(civilRange(L(2028, 3, 1, 9), 3), rng([2028, 2, 28], [2028, 3, 2])); // 2028 leap year
  assert.deepEqual(civilRange(L(2026, 12, 31, 23, 59, 59), 3), rng([2026, 12, 29], [2027, 1, 1]));
  assert.deepEqual(civilRange(L(2027, 1, 1, 0, 0, 0), 3), rng([2026, 12, 30], [2027, 1, 2]));
  assert.deepEqual(civilRange(L(2026, 11, 16, 0, 0, 0), 7), civilRange(L(2026, 11, 16, 23, 59, 59), 7));
  for (const d of [undefined, NaN, '3', null, Infinity, -Infinity, {}, []]) assert.deepEqual(civilRange(NOW, d), rng([2026, 11, 10], [2026, 11, 17]), String(d));
  for (const d of [0, -5, 0.5, 1]) assert.deepEqual(civilRange(NOW, d).start, cdt(2026, 11, 16), String(d));
  assert.deepEqual(civilRange(NOW, 2.9).start, cdt(2026, 11, 15));
  for (const d of [31, 100, 1e9]) assert.deepEqual(civilRange(NOW, d).start, cdt(2026, 10, 17), String(d)); // 16 - 30 = -14 -> Oct 31 - 14 = Oct 17
  for (const n of [null, undefined, 'x', 0, 1763150400000, new Date(NaN), {}, []]) assert.equal(civilRange(n, 3), null, String(n));
  const t = NOW.getTime(); civilRange(NOW, 7); assert.equal(NOW.getTime(), t);
});

test('G3. buildDailyRollUpBody: { range: {start, end}, windowSizeDays: 1 } exactly; JSON-serialisable; null for an invalid now', async () => {
  const { buildDailyRollUpBody } = await D();
  const want = { range: { start: cdt(2026, 11, 10), end: cdt(2026, 11, 17) }, windowSizeDays: 1 };
  assert.deepEqual(buildDailyRollUpBody(NOW, 7), want);
  assert.deepEqual(JSON.parse(JSON.stringify(buildDailyRollUpBody(NOW, 7))), want);
  assert.equal(buildDailyRollUpBody(new Date(NaN), 7), null);
  assert.equal(buildDailyRollUpBody(undefined), null);
});

test('G4. buildSleepFilter / buildSleepUrl: quoted civil_end_time >= range start, page_size=25, percent-encoded, optional pageToken, "" for an invalid now', async () => {
  const { buildSleepFilter, buildSleepUrl } = await D();
  assert.equal(buildSleepFilter(NOW, 7), 'sleep.interval.civil_end_time >= "2026-11-10"');
  assert.equal(buildSleepFilter(NOW), 'sleep.interval.civil_end_time >= "2026-11-10"');
  assert.equal(buildSleepFilter(L(2026, 3, 1, 9), 3), 'sleep.interval.civil_end_time >= "2026-02-27"');
  const url = 'https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-11-10%22';
  assert.equal(buildSleepUrl(NOW, 7), url);
  assert.equal(buildSleepUrl(NOW), url);
  assert.equal(buildSleepUrl(NOW, 7, 'abc/def='), url + '&pageToken=abc%2Fdef%3D');
  for (const bad of ['', undefined, null, 5, {}, []]) assert.equal(buildSleepUrl(NOW, 7, bad), url, String(bad));
  for (const n of [null, undefined, 'x', new Date(NaN), 5]) { assert.equal(buildSleepFilter(n, 7), ''); assert.equal(buildSleepUrl(n, 7), ''); }
});

// ================================================================ parser (G5-G12)
const pt = (y, m, d, count) => ({
  civilStartTime: { date: { year: y, month: m, day: d }, time: {} },
  civilEndTime: { date: { year: y, month: m, day: d }, time: { hours: 23, minutes: 59, seconds: 59 } },
  ...(count === undefined ? {} : { steps: { countSum: count } }),
});
const stepsAns = { rollupDataPoints: [pt(2026, 11, 16, '1226'), pt(2026, 11, 15, '2919'), pt(2026, 11, 14, '12921'), pt(2026, 11, 13, undefined)] };
const rec = (start, end, mins, so = '-18000s', eo = '-18000s') => ({
  name: 'users/me/dataTypes/sleep/dataPoints/x',
  sleep: { interval: { startTime: start, startUtcOffset: so, endTime: end, endUtcOffset: eo }, type: 'CLASSIC', summary: { minutesAsleep: mins } },
});
const A16a = rec('2026-11-16T05:30:00Z', '2026-11-16T08:09:00Z', '159'); // 05:30 -> 08:09 = 2 h 39 = 159 min; local end 03:09 on the 16th
const A16b = rec('2026-11-16T09:00:00Z', '2026-11-16T13:00:00Z', '239'); // 4 h period, 239 asleep; local end 08:00 on the 16th
const A15a = rec('2026-11-15T04:00:00Z', '2026-11-15T05:10:00Z', '68');  // local end 00:10 on the 15th
const A15b = rec('2026-11-15T06:00:00Z', '2026-11-15T11:00:00Z', '268');
const A14 = rec('2026-11-14T03:30:00Z', '2026-11-14T11:30:00Z', '435');  // local 22:30 on the 13th to 06:30 on the 14th: belongs to the 14th
const sleepAns = { dataPoints: [A16b, A16a, A15b, A15a, A14], nextPageToken: '' };
const SLEEP_GOLD = {
  '2026-11-16': { sleepMinutes: 398, sleepStart: '2026-11-16T09:00:00Z', sleepEnd: '2026-11-16T13:00:00Z' }, // 159 + 239
  '2026-11-15': { sleepMinutes: 336, sleepStart: '2026-11-15T06:00:00Z', sleepEnd: '2026-11-15T11:00:00Z' }, // 68 + 268
  '2026-11-14': { sleepMinutes: 435, sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z' },
};
const STEPS_GOLD = { '2026-11-16': { steps: 1226 }, '2026-11-15': { steps: 2919 }, '2026-11-14': { steps: 12921 } };
const BOTH_GOLD = {
  '2026-11-16': { steps: 1226, ...SLEEP_GOLD['2026-11-16'] },
  '2026-11-15': { steps: 2919, ...SLEEP_GOLD['2026-11-15'] },
  '2026-11-14': { steps: 12921, ...SLEEP_GOLD['2026-11-14'] },
};

test('G5. parseHealthAnswers: steps from the real answer shape (12921 / 2919 / 1226; the day without a steps object is absent)', async () => {
  const { parseHealthAnswers } = await D();
  assert.deepEqual(parseHealthAnswers(stepsAns, null), STEPS_GOLD);
  assert.deepEqual(parseHealthAnswers(stepsAns, undefined), STEPS_GOLD);
});

test('G6. parseHealthAnswers steps values: "0" is data, string and number counts, 200000 kept, 200001 and huge ignored, non-digit text ignored', async () => {
  const { parseHealthAnswers } = await D();
  const one = c => parseHealthAnswers({ rollupDataPoints: [pt(2026, 11, 16, c)] }, null);
  assert.deepEqual(one('0'), { '2026-11-16': { steps: 0 } });
  assert.deepEqual(one('1226'), { '2026-11-16': { steps: 1226 } });
  assert.deepEqual(one(1226), { '2026-11-16': { steps: 1226 } });
  assert.deepEqual(one(0), { '2026-11-16': { steps: 0 } });
  assert.deepEqual(one('200000'), { '2026-11-16': { steps: 200000 } });
  for (const bad of ['200001', '99999999999999999999', 1e20, 200001, '1e3', '-5', -5, '12.5', 12.5, ' 12', '12 ', '', 'abc', NaN, Infinity, null, true, {}, [], ['5']]) {
    assert.deepEqual(one(bad), {}, 'ignored: ' + String(bad));
  }
  // a steps object without countSum, and a non-object steps, are "no data"
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [{ ...pt(2026, 11, 16), steps: {} }] }, null), {});
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [{ ...pt(2026, 11, 16), steps: 'x' }] }, null), {});
});

test('G7. parseHealthAnswers steps dates and shapes: impossible dates and wrong shapes ignored, duplicates keep the larger, empty / garbage answers give {}', async () => {
  const { parseHealthAnswers } = await D();
  const withDate = date => ({ civilStartTime: { date, time: {} }, steps: { countSum: '100' } });
  for (const date of [{ year: 2026, month: 2, day: 30 }, { year: 2026, month: 13, day: 1 }, { year: 2026, month: 0, day: 1 }, { year: 2026, month: 11, day: 0 }, { year: 2026, month: 11, day: 31 },
    { year: 2026.5, month: 11, day: 1 }, { year: '2026', month: 11, day: 1 }, { year: 2026, month: '11', day: 1 }, { year: 20260, month: 11, day: 1 }, { year: 0, month: 1, day: 1 }, {}, null, 'x', '2026-11-16', [2026, 11, 16]]) {
    assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [withDate(date)] }, null), {}, JSON.stringify(date));
  }
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [{ civilStartTime: '2026-11-16', steps: { countSum: '100' } }] }, null), {});
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [{ steps: { countSum: '100' } }] }, null), {});
  // a valid date is zero padded in the key
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [withDate({ year: 2026, month: 2, day: 3 })] }, null), { '2026-02-03': { steps: 100 } });
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [withDate({ year: 2028, month: 2, day: 29 })] }, null), { '2028-02-29': { steps: 100 } });
  // two points for one day: the larger count, whatever the order
  const a = pt(2026, 11, 16, '500'), b = pt(2026, 11, 16, '900');
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [a, b] }, null), { '2026-11-16': { steps: 900 } });
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: [b, a] }, null), { '2026-11-16': { steps: 900 } });
  for (const empty of [{}, { rollupDataPoints: [] }, { rollupDataPoints: 'x' }, { rollupDataPoints: null }, { rollupDataPoints: [null, 1, 'x', [], undefined] }]) assert.deepEqual(parseHealthAnswers(empty, null), {});
});

test('G8. parseHealthAnswers sleep golden: records on one day are ADDED (16th: 159 + 239 = 398), the main record gives start / end, any order', async () => {
  const { parseHealthAnswers } = await D();
  assert.deepEqual(parseHealthAnswers(null, sleepAns), SLEEP_GOLD);
  const all = [A16b, A16a, A15b, A15a, A14];
  for (const order of [[...all].reverse(), [A14, A15a, A16a, A15b, A16b], [A15a, A16a, A14, A16b, A15b]]) assert.deepEqual(parseHealthAnswers(null, { dataPoints: order }), SLEEP_GOLD);
  // the main record is the one with the most minutes asleep, not the earliest start / latest end (16th: 05:30Z start is NOT used)
  assert.equal(parseHealthAnswers(null, sleepAns)['2026-11-16'].sleepStart, '2026-11-16T09:00:00Z');
});

test('G9. sleep day = the LOCAL day it ENDS on: crossing midnight, negative / positive / zero offsets, the END offset decides, exactly local midnight is the new day', async () => {
  const { parseHealthAnswers } = await D();
  const one = r => parseHealthAnswers(null, { dataPoints: [r] });
  // crosses midnight: local 22:30 on the 13th to 06:30 on the 14th -> the 14th
  assert.deepEqual(Object.keys(one(A14)), ['2026-11-14']);
  // UTC day is the 14th but local (-5 h) it ends 21:30 on the 13th -> the 13th
  assert.deepEqual(one(rec('2026-11-13T22:00:00Z', '2026-11-14T02:30:00Z', '240')), { '2026-11-13': { sleepMinutes: 240, sleepStart: '2026-11-13T22:00:00Z', sleepEnd: '2026-11-14T02:30:00Z' } });
  // positive offset: ends 23:30Z on the 14th = 00:30 on the 15th at +1 h -> the 15th
  assert.deepEqual(one(rec('2026-11-14T16:00:00Z', '2026-11-14T23:30:00Z', '400', '3600s', '3600s')), { '2026-11-15': { sleepMinutes: 400, sleepStart: '2026-11-14T16:00:00Z', sleepEnd: '2026-11-14T23:30:00Z' } });
  // zero offset: the UTC day
  assert.deepEqual(Object.keys(one(rec('2026-11-14T16:00:00Z', '2026-11-14T23:59:00Z', '400', '0s', '0s'))), ['2026-11-14']);
  // exactly local midnight: 05:00Z at -5 h = 00:00:00 on the 15th -> the 15th
  assert.deepEqual(Object.keys(one(rec('2026-11-15T01:00:00Z', '2026-11-15T05:00:00Z', '200'))), ['2026-11-15']);
  // one second earlier is still the 14th
  assert.deepEqual(Object.keys(one(rec('2026-11-15T01:00:00Z', '2026-11-15T04:59:59Z', '200'))), ['2026-11-14']);
  // different offsets (a clock change): the END offset (-18000s) puts 04:30Z at 23:30 on 31 Oct; the start offset would say 1 Nov
  assert.deepEqual(one(rec('2026-11-01T00:00:00Z', '2026-11-01T04:30:00Z', '250', '-14400s', '-18000s')), { '2026-10-31': { sleepMinutes: 250, sleepStart: '2026-11-01T00:00:00Z', sleepEnd: '2026-11-01T04:30:00Z' } });
  // month and year rollover of the local day
  assert.deepEqual(Object.keys(one(rec('2026-12-31T20:00:00Z', '2026-12-31T23:30:00Z', '100', '3600s', '3600s'))), ['2027-01-01']);
});

test('G10. sleep: invalid records are ignored one by one, fractions dropped, the day total is capped at 1440, ties go to the later end', async () => {
  const { parseHealthAnswers } = await D();
  const one = r => parseHealthAnswers(null, { dataPoints: [r] });
  const ok = rec('2026-11-14T03:30:00Z', '2026-11-14T11:30:00Z', '435');
  const withMins = m => rec('2026-11-14T03:30:00Z', '2026-11-14T11:30:00Z', m);
  for (const bad of ['0', '1441', 'abc', '-5', '12.5', '', ' 5', '1e2', '99999999999999999999', 0, 1441, 12.5, -3, NaN, null, undefined, {}, []]) assert.deepEqual(one(withMins(bad)), {}, 'minutes ' + String(bad));
  assert.deepEqual(one(withMins(435)), one(ok)); // a number works like its text
  assert.deepEqual(one(rec('2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z', '1440', '0s', '0s')), { '2026-11-14': { sleepMinutes: 1440, sleepStart: '2026-11-13T00:00:00Z', sleepEnd: '2026-11-14T00:00:00Z' } });
  for (const bad of ['not a time', '2026-11-14 11:30:00Z', '2026-11-14T11:30:00+01:00', '2026-11-14T11:30:00', '2026-13-14T11:30:00Z', '2026-02-30T11:30:00Z', '2026-11-14T25:30:00Z', '', 5, null, undefined])
    assert.deepEqual(one(rec('2026-11-14T03:30:00Z', bad, '435')), {}, 'end ' + String(bad));
  for (const bad of ['not a time', '2026-02-30T03:30:00Z', '', null]) assert.deepEqual(one(rec(bad, '2026-11-14T11:30:00Z', '435')), {}, 'start ' + String(bad));
  for (const bad of ['4h', '1.5s', '90000s', '-90000s', 'abc', '', '+3600s', 3600, null]) assert.deepEqual(one(rec('2026-11-14T03:30:00Z', '2026-11-14T11:30:00Z', '435', '-18000s', bad)), {}, 'end offset ' + String(bad));
  const noOffset = rec('2026-11-14T03:30:00Z', '2026-11-14T11:30:00Z', '435'); delete noOffset.sleep.interval.endUtcOffset;
  assert.deepEqual(one(noOffset), {}, 'a missing end offset is never guessed as 0');
  assert.deepEqual(one(rec('2026-11-14T11:30:00Z', '2026-11-14T11:30:00Z', '435')), {}, 'end equal to start');
  assert.deepEqual(one(rec('2026-11-14T12:30:00Z', '2026-11-14T11:30:00Z', '435')), {}, 'end before start');
  assert.deepEqual(one(rec('2026-11-13T00:00:00Z', '2026-11-14T00:00:01Z', '435', '0s', '0s')), {}, 'longer than 24 h');
  assert.deepEqual(Object.keys(one(rec('2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z', '435', '0s', '0s'))), ['2026-11-14'], 'exactly 24 h is fine');
  // fraction of a second dropped, never rounded
  assert.deepEqual(one(rec('2026-11-14T03:30:00.999Z', '2026-11-14T11:30:00.5Z', '435')), { '2026-11-14': { sleepMinutes: 435, sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z' } });
  // an invalid record does not remove its valid siblings, and junk items are skipped
  assert.deepEqual(parseHealthAnswers(null, { dataPoints: [null, 5, 'x', [], { sleep: 5 }, { sleep: { interval: 5 } }, rec('x', 'y', '1'), ok] }), { '2026-11-14': SLEEP_GOLD['2026-11-14'] });
  // total over 1440 is capped; tie on minutes -> the record that ends later gives the times
  const x = rec('2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z', '1000', '0s', '0s'); // 24 h period, ends 14th 00:00
  const y = rec('2026-11-14T00:00:00Z', '2026-11-14T23:00:00Z', '1000', '0s', '0s'); // 23 h period, ends 14th 23:00
  const want = { '2026-11-14': { sleepMinutes: 1440, sleepStart: '2026-11-14T00:00:00Z', sleepEnd: '2026-11-14T23:00:00Z' } };
  assert.deepEqual(parseHealthAnswers(null, { dataPoints: [x, y] }), want);
  assert.deepEqual(parseHealthAnswers(null, { dataPoints: [y, x] }), want);
});

test('G11. parseHealthAnswers merges steps and sleep per day; a day with one side keeps only that side', async () => {
  const { parseHealthAnswers } = await D();
  assert.deepEqual(parseHealthAnswers(stepsAns, sleepAns), BOTH_GOLD);
  const sleepOnly13 = rec('2026-11-13T03:00:00Z', '2026-11-13T09:00:00Z', '300');
  const got = parseHealthAnswers({ rollupDataPoints: [pt(2026, 11, 14, '10'), pt(2026, 11, 15, '20'), pt(2026, 11, 16, '30')] }, { dataPoints: [sleepOnly13, A16a, A16b] });
  assert.deepEqual(got, {
    '2026-11-13': { sleepMinutes: 300, sleepStart: '2026-11-13T03:00:00Z', sleepEnd: '2026-11-13T09:00:00Z' },
    '2026-11-14': { steps: 10 }, '2026-11-15': { steps: 20 },
    '2026-11-16': { steps: 30, ...SLEEP_GOLD['2026-11-16'] },
  });
  for (const v of Object.values(got)) for (const [k, x] of Object.entries(v)) assert.notEqual(x, undefined, k + ' must be absent, not undefined');
  assert.deepEqual(parseHealthAnswers({}, {}), {});
});

test('G12. parseHealthAnswers: hostile input never throws, gives {}, own properties only, inputs not mutated', async () => {
  const { parseHealthAnswers } = await D();
  const junk = [undefined, null, 'x', 1, true, [], {}, { rollupDataPoints: 'x' }, { dataPoints: 'x' }, { rollupDataPoints: [null, 1, 'x', []] }, { dataPoints: [null, 1, 'x', []] }];
  for (const j of junk) for (const k of junk) assert.deepEqual(parseHealthAnswers(j, k), {}, JSON.stringify([j, k]));
  // __proto__ parsed from JSON is an own key, never a source of data
  const proto = JSON.parse('{"__proto__":{"rollupDataPoints":[{"civilStartTime":{"date":{"year":2026,"month":11,"day":16}},"steps":{"countSum":"5"}}]}}');
  assert.deepEqual(parseHealthAnswers(proto, JSON.parse('{"__proto__":{"dataPoints":[]}}')), {});
  assert.equal(({}).steps, undefined);
  // inherited properties are not data
  const inherited = Object.create({ rollupDataPoints: [pt(2026, 11, 16, '5')] });
  assert.deepEqual(parseHealthAnswers(inherited, Object.create({ dataPoints: [A14] })), {});
  // a getter that throws
  const boom = Object.defineProperty({}, 'rollupDataPoints', { enumerable: true, get() { throw new Error('boom'); } });
  const boom2 = Object.defineProperty({}, 'dataPoints', { enumerable: true, get() { throw new Error('boom'); } });
  assert.deepEqual(parseHealthAnswers(boom, boom2), {});
  // many junk items
  assert.deepEqual(parseHealthAnswers({ rollupDataPoints: new Array(50000).fill({ x: 1 }) }, { dataPoints: new Array(50000).fill(null) }), {});
  // frozen inputs are fine and unchanged
  const s = deepFreeze(clone(stepsAns)), l = deepFreeze(clone(sleepAns));
  assert.deepEqual(parseHealthAnswers(s, l), BOTH_GOLD);
  assert.deepEqual(s, stepsAns); assert.deepEqual(l, sleepAns);
  // result is a plain object with only real date keys
  const out = parseHealthAnswers(stepsAns, sleepAns);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  for (const k of Object.keys(out)) assert.match(k, /^\d{4}-\d{2}-\d{2}$/);
});

// ================================================================ apply (G13-G18)
const W = { id: 'w1', name: 'Run', start: '2026-11-15T13:00:00Z', minutes: 30, kcal: 300 };
const TRIO15 = { sleepMinutes: 300, sleepStart: '2026-11-15T03:00:00Z', sleepEnd: '2026-11-15T08:00:00Z' };
const stored15 = () => ({ updatedAt: 1000, source: 'google-health', steps: 5000, ...TRIO15, workouts: [clone(W)] });

test('G13. applyHealthSync adds a new day: record shape, source, updatedAt = now, counts; only state.activity changes', async () => {
  const { applyHealthSync } = await D();
  const state = { activity: {}, days: { x: [1] }, goals: { k: 1 } };
  const res = applyHealthSync(state, { '2026-11-16': { steps: 1226, ...SLEEP_GOLD['2026-11-16'] } }, 5000);
  assert.deepEqual(res, { added: 1, updated: 0, unchanged: 0 });
  assert.deepEqual(state.activity['2026-11-16'], { updatedAt: 5000, source: 'google-health', steps: 1226, sleepMinutes: 398, sleepStart: '2026-11-16T09:00:00Z', sleepEnd: '2026-11-16T13:00:00Z' });
  assert.deepEqual(state.days, { x: [1] }); assert.deepEqual(state.goals, { k: 1 });
  // the full golden parse result, three days at once, and steps-only / sleep-only days
  const st2 = { activity: {} };
  assert.deepEqual(applyHealthSync(st2, BOTH_GOLD, 7000), { added: 3, updated: 0, unchanged: 0 });
  assert.deepEqual(Object.keys(st2.activity).sort(), ['2026-11-14', '2026-11-15', '2026-11-16']);
  const st3 = { activity: {} };
  applyHealthSync(st3, { '2026-11-14': { steps: 0 }, '2026-11-15': SLEEP_GOLD['2026-11-15'] }, 8000);
  assert.deepEqual(st3.activity['2026-11-14'], { updatedAt: 8000, source: 'google-health', steps: 0 });
  assert.deepEqual(st3.activity['2026-11-15'], { updatedAt: 8000, source: 'google-health', ...SLEEP_GOLD['2026-11-15'] });
  // state without an activity object gets one
  const st4 = {}; applyHealthSync(st4, { '2026-11-14': { steps: 5 } }, 9000);
  assert.deepEqual(st4, { activity: { '2026-11-14': { updatedAt: 9000, source: 'google-health', steps: 5 } } });
});

test('G14. merge: stored workouts are kept, steps and the sleep trio are replaced independently, a day without steps keeps its steps, new minutes with bad times drop the old times', async () => {
  const { applyHealthSync } = await D();
  const run = fields => { const state = { activity: { '2026-11-15': stored15() } }; const res = applyHealthSync(state, { '2026-11-15': fields }, 9000); return { rec: state.activity['2026-11-15'], res }; };
  const NEW_TRIO = { sleepMinutes: 420, sleepStart: '2026-11-15T02:00:00Z', sleepEnd: '2026-11-15T09:00:00Z' };
  let r = run({ steps: 6000 });
  assert.deepEqual(r.rec, { updatedAt: 9000, source: 'google-health', steps: 6000, ...TRIO15, workouts: [W] }); assert.deepEqual(r.res, { added: 0, updated: 1, unchanged: 0 });
  r = run(NEW_TRIO); // no steps in the answer: the stored steps stay (not zeroed)
  assert.deepEqual(r.rec, { updatedAt: 9000, source: 'google-health', steps: 5000, ...NEW_TRIO, workouts: [W] });
  r = run({ steps: 6000, ...NEW_TRIO });
  assert.deepEqual(r.rec, { updatedAt: 9000, source: 'google-health', steps: 6000, ...NEW_TRIO, workouts: [W] });
  r = run({ sleepMinutes: 420, sleepStart: 'bad', sleepEnd: 'bad' }); // minutes and times never mix
  assert.deepEqual(r.rec, { updatedAt: 9000, source: 'google-health', steps: 5000, sleepMinutes: 420, workouts: [W] });
  assert.equal('sleepStart' in r.rec, false); assert.equal('sleepEnd' in r.rec, false);
  // a day that has only workouts gains steps and keeps the workouts; a day with no workouts gets no workouts key
  const st = { activity: { '2026-11-15': { updatedAt: 1000, source: 'google-health', workouts: [clone(W)] } } };
  applyHealthSync(st, { '2026-11-15': { steps: 77 } }, 9000);
  assert.deepEqual(st.activity['2026-11-15'], { updatedAt: 9000, source: 'google-health', steps: 77, workouts: [W] });
  const st2 = { activity: {} }; applyHealthSync(st2, { '2026-11-15': { steps: 77 } }, 9000);
  assert.equal('workouts' in st2.activity['2026-11-15'], false);
});

test('G15. the API REPLACES a stored step total, lower or higher (zip total for a past day, partial total for today)', async () => {
  const { applyHealthSync } = await D();
  const go = (stored, api) => { const state = { activity: { '2026-11-14': { updatedAt: 1000, source: 'google-health', steps: stored } } }; applyHealthSync(state, { '2026-11-14': { steps: api } }, 9000); return state.activity['2026-11-14']; };
  assert.equal(go(14000, 12921).steps, 12921); // lower than the stored zip total: still replaced
  assert.equal(go(5000, 12921).steps, 12921);  // higher
  assert.equal(go(1226, 3000).steps, 3000);    // today's partial count grows
  assert.equal(go(3000, 1226).steps, 1226);    // same rule, no special case
  assert.equal(go(14000, 12921).updatedAt, 9000);
});

test('G16. idempotent: the same days twice write nothing the second time; a changed value bumps updatedAt; identical content with an older stamp is left alone', async () => {
  const { applyHealthSync } = await D();
  const state = { activity: { '2026-11-15': stored15() }, days: {} };
  const days = { '2026-11-14': { steps: 12921, ...SLEEP_GOLD['2026-11-14'] }, '2026-11-16': { steps: 1226 } };
  assert.deepEqual(applyHealthSync(state, days, 5000), { added: 2, updated: 0, unchanged: 0 });
  const before = clone(state), obj14 = state.activity['2026-11-14'];
  assert.deepEqual(applyHealthSync(state, clone(days), 9000), { added: 0, updated: 0, unchanged: 2 });
  assert.deepEqual(state, before); assert.equal(JSON.stringify(state), JSON.stringify(before));
  assert.equal(state.activity['2026-11-14'], obj14, 'the stored object is not replaced');
  assert.equal(state.activity['2026-11-14'].updatedAt, 5000);
  // an equal record with an older stamp and a different key order: unchanged, stamp NOT bumped
  const st = { activity: { '2026-11-15': { workouts: [clone(W)], sleepEnd: TRIO15.sleepEnd, sleepStart: TRIO15.sleepStart, sleepMinutes: 300, steps: 5000, source: 'google-health', updatedAt: 1000 } } };
  assert.deepEqual(applyHealthSync(st, { '2026-11-15': { steps: 5000, ...TRIO15 } }, 9000), { added: 0, updated: 0, unchanged: 1 });
  assert.equal(st.activity['2026-11-15'].updatedAt, 1000);
  // one value changes: written, stamp bumped, only that day
  const res = applyHealthSync(state, { '2026-11-14': { steps: 13000 }, '2026-11-16': { steps: 1226 } }, 11000);
  assert.deepEqual(res, { added: 0, updated: 1, unchanged: 1 });
  assert.equal(state.activity['2026-11-14'].steps, 13000); assert.equal(state.activity['2026-11-14'].updatedAt, 11000);
  assert.equal(state.activity['2026-11-16'].updatedAt, 5000);
});

test('G17. applyHealthSync reads only steps and sleep from days: nothing else is smuggled in; garbage fields write nothing and do not create state.activity', async () => {
  const { applyHealthSync } = await D();
  const state = { activity: {} };
  applyHealthSync(state, { '2026-11-16': { steps: 100, workouts: [{ id: 'evil', start: '2026-11-16T10:00:00Z', name: 'x', minutes: 1 }], source: 'evil', updatedAt: 1, junk: 1, name: 'x' } }, 5000);
  assert.deepEqual(state.activity['2026-11-16'], { updatedAt: 5000, source: 'google-health', steps: 100 });
  for (const fields of [{ steps: '5000' }, { steps: -1 }, { steps: 200001 }, { steps: NaN }, { steps: Infinity }, { steps: null }, { steps: true }, { steps: [5] },
    { sleepMinutes: 0 }, { sleepMinutes: 1441 }, { sleepMinutes: '400', sleepStart: SLEEP_GOLD['2026-11-14'].sleepStart, sleepEnd: SLEEP_GOLD['2026-11-14'].sleepEnd }, { sleepMinutes: NaN },
    { sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z' }, {}, { workouts: [W] }, { source: 'x' }, null, [], 5, 'x', undefined]) {
    const st = {}; const res = applyHealthSync(st, { '2026-11-16': fields }, 5000);
    assert.deepEqual(res, { added: 0, updated: 0, unchanged: 0 }, JSON.stringify(fields)); assert.deepEqual(st, {}, JSON.stringify(fields));
    const st2 = { activity: { '2026-11-16': stored15() } }; applyHealthSync(st2, { '2026-11-16': fields }, 5000);
    assert.deepEqual(st2.activity['2026-11-16'], stored15(), 'stored day untouched by garbage: ' + JSON.stringify(fields));
  }
});

test('G18. applyHealthSync hostile input: bad now / state / days, non-date and prototype keys; records are fixed points of sanitizeActivityDay; frozen days fine; nothing else in state changes', async () => {
  const { applyHealthSync } = await D();
  const ZERO = { added: 0, updated: 0, unchanged: 0 };
  const good = { '2026-11-16': { steps: 5 } };
  for (const now of [0, -1, NaN, Infinity, '5000', null, undefined, {}, []]) { const st = { activity: {} }; assert.deepEqual(applyHealthSync(st, good, now), ZERO, String(now)); assert.deepEqual(st, { activity: {} }); }
  for (const st of [null, undefined, [], 'x', 5]) assert.deepEqual(applyHealthSync(st, good, 5000), ZERO);
  for (const days of [null, undefined, [], 'x', 5, true]) { const st = { activity: {} }; assert.deepEqual(applyHealthSync(st, days, 5000), ZERO); assert.deepEqual(st, { activity: {} }); }
  // keys that are not real dates
  const keys = ['2026-02-30', '2026-13-01', '2026-11-1', '26-11-16', '', 'abc', 'constructor', 'prototype', '2026-11-16 ', ' 2026-11-16'];
  const bad = Object.fromEntries(keys.map(k => [k, { steps: 7 }]));
  const st = { activity: {} };
  assert.deepEqual(applyHealthSync(st, { ...bad, '2026-11-16': { steps: 9 } }, 5000), { added: 1, updated: 0, unchanged: 0 });
  assert.deepEqual(Object.keys(st.activity), ['2026-11-16']);
  const evil = JSON.parse('{"__proto__":{"steps":5,"polluted":true},"2026-11-15":{"steps":6}}');
  const st2 = { activity: {} };
  assert.deepEqual(applyHealthSync(st2, evil, 5000), { added: 1, updated: 0, unchanged: 0 });
  assert.deepEqual(Object.keys(st2.activity), ['2026-11-15']);
  assert.equal(({}).polluted, undefined); assert.equal(Object.prototype.polluted, undefined); assert.equal(({}).steps, undefined);
  // an activity that is not an object is replaced when something is written; a stored unusable day is replaced
  const st3 = { activity: 'x' }; applyHealthSync(st3, good, 5000); assert.deepEqual(st3.activity, { '2026-11-16': { updatedAt: 5000, source: 'google-health', steps: 5 } });
  const st4 = { activity: { '2026-11-16': 'garbage' } }; applyHealthSync(st4, good, 5000); assert.deepEqual(st4.activity['2026-11-16'], { updatedAt: 5000, source: 'google-health', steps: 5 });
  // every record written is a fixed point of sanitizeActivityDay; frozen days are fine and unchanged; the rest of state is untouched
  const days = deepFreeze(clone(BOTH_GOLD)), snap = clone(days);
  const rest = { days: { '2026-11-16': [{ id: 'e1', name: 'Egg', k: 70 }] }, goals: { k: 2000 }, water: { '2026-11-16': { updatedAt: 1, halves: 3 } }, apiKey: 'K', tombstones: { a: 1 }, settingsUpdatedAt: 77 };
  const st5 = { ...clone(rest), activity: { '2026-11-15': stored15() } };
  applyHealthSync(st5, days, 5000);
  assert.deepEqual(days, snap);
  const { activity, ...others } = st5; assert.deepEqual(others, rest);
  for (const r of Object.values(activity)) assert.deepEqual(sanitizeActivityDay(r), r);
  assert.deepEqual(activity['2026-11-15'].workouts, [W]);
  // huge map of junk keys does not hang or throw
  const many = {}; for (let i = 0; i < 20000; i++) many['k' + i] = { steps: 1 };
  assert.deepEqual(applyHealthSync({ activity: {} }, many, 5000), ZERO);
});

test('G19. healthSyncText: exact sentences', async () => {
  const { healthSyncText } = await D();
  assert.equal(healthSyncText(BOTH_GOLD), 'Synced 3 days: steps for 3, sleep for 3');
  assert.equal(healthSyncText({ '2026-11-14': { steps: 5 } }), 'Synced 1 day: steps for 1, sleep for 0');
  assert.equal(healthSyncText({ '2026-11-14': SLEEP_GOLD['2026-11-14'] }), 'Synced 1 day: steps for 0, sleep for 1');
  assert.equal(healthSyncText({ '2026-11-11': { steps: 1 }, '2026-11-12': { steps: 2, sleepMinutes: 3 }, '2026-11-13': { sleepMinutes: 4 }, '2026-11-14': { sleepMinutes: 5 } }), 'Synced 4 days: steps for 2, sleep for 3');
  assert.equal(healthSyncText({ '2026-11-14': { steps: 0 } }), 'Synced 1 day: steps for 1, sleep for 0'); // 0 steps is data
  const NOTHING = 'Nothing to sync: Google Health has no steps or sleep for the last 7 days.';
  for (const v of [{}, null, undefined, 'x', 5, [], { a: {} }, { a: null }]) assert.equal(healthSyncText(v), NOTHING, JSON.stringify(v));
});

// ================================================================ Client ID (G20, G21)
test('G20. checkClientId accepts real-looking IDs, returns the trimmed id, prefix length 10 to 100', async () => {
  const { checkClientId } = await D();
  assert.deepEqual(checkClientId(ID), { ok: true, id: ID });
  assert.deepEqual(checkClientId('  ' + ID + '\n'), { ok: true, id: ID });
  assert.deepEqual(checkClientId('\t' + ID), { ok: true, id: ID });
  const p = n => 'a1_-'.repeat(30).slice(0, n) + SUFFIX;
  assert.equal(checkClientId(p(10)).ok, true); assert.equal(checkClientId(p(100)).ok, true);
  assert.equal(checkClientId(p(9)).ok, false); assert.equal(checkClientId(p(101)).ok, false);
  assert.equal(checkClientId('ABCdef0123-xyz_' + SUFFIX).ok, true);
});

test('G21. checkClientId rejects empty / wrong types / secrets (anywhere) / bad shapes with the exact messages and never echoes the input', async () => {
  const { checkClientId } = await D();
  for (const v of ['', '   ', '\n', null, undefined, 123, {}, [], true]) assert.deepEqual(checkClientId(v), { ok: false, message: M.empty }, String(v));
  const secrets = [SECRET, '  ' + SECRET + '  ', SECRET.toLowerCase(), 'client_secret: ' + SECRET, ID + ' ' + SECRET, 'xx' + SECRET.slice(0, 20),
    '{"web":{"client_id":"' + ID + '","client_secret":"' + SECRET + '"}}', 'GOCSPX-', ID.replace('abcdefghij', 'GOCSPX-abc')];
  for (const s of secrets) {
    const r = checkClientId(s);
    assert.deepEqual(r, { ok: false, message: M.secret }, s);
    assert.equal(r.message.includes('GOCSPX-abc'), false);
  }
  const shapes = ['hello', 'not-a-client-id', ID.replace(SUFFIX, ''), ID + '.evil.com', 'https://evil.example/' + SUFFIX, '12345 6789012-abcdefghijklmnop' + SUFFIX, 'abcdefghij\nklmnop' + SUFFIX,
    '<img src=x onerror=alert(1)>' + SUFFIX, 'a'.repeat(500) + SUFFIX, 'abcde.fghijk' + SUFFIX, SUFFIX, 'short' + SUFFIX, ID.toUpperCase().replace('.APPS', '.apps'), ID.replace('googleusercontent', 'googleuser'), ID + '\u0000', ID.replace('-', '\u0000')];
  for (const s of shapes) {
    const r = checkClientId(s);
    assert.deepEqual(r, { ok: false, message: M.shape }, JSON.stringify(s));
    assert.deepEqual(Object.keys(r).sort(), ['message', 'ok']);
  }
});

// ================================================================ fakes for the service tests
const fakeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial)), log = [];
  return { m, log, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { log.push(['set', k, String(v)]); m.set(k, String(v)); }, removeItem: k => { log.push(['remove', k]); m.delete(k); } };
};
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const R = (body, status = 200) => () => jsonRes(body, status);
const lowerHeaders = h => { const out = {}; if (!h) return out; if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { out[k.toLowerCase()] = v; }); else for (const [k, v] of Array.isArray(h) ? h : Object.entries(h)) out[String(k).toLowerCase()] = v; return out; };
const kindOf = url => (url.includes('dailyRollUp') ? 'steps' : url.includes('dataTypes/sleep') ? 'sleep' : 'other');
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const call = { url: String(url), method: String(init.method || 'GET').toUpperCase(), headers: lowerHeaders(init.headers), body: init.body, init };
    calls.push(call);
    const kind = kindOf(call.url), r = routes[kind], n = calls.filter(c => kindOf(c.url) === kind).length;
    const out = typeof r === 'function' ? r(call, n) : r;
    if (out instanceof Error) throw out;
    if (out === undefined) throw new Error('no route for ' + call.url);
    return out;
  };
  f.calls = calls;
  return f;
}
const TOKEN_OK = { access_token: TOKEN, expires_in: 3599, scope: SCOPE, token_type: 'Bearer' };
function fakeGoogle(script = {}) {
  const g = { inits: [], requests: 0, release: null };
  g.google = { accounts: { oauth2: { initTokenClient(cfg) {
    g.inits.push(cfg);
    if (script.initThrows) throw new Error('init ' + TOKEN + ' ' + EMAIL);
    return { requestAccessToken() {
      g.requests++;
      if (script.requestThrows) throw new Error('request ' + TOKEN);
      const go = () => {
        if (script.errorCallback) cfg.error_callback(script.errorCallback);
        else { cfg.callback(Object.hasOwn(script, 'callback') ? script.callback : TOKEN_OK); if (script.twice) cfg.callback(TOKEN_OK); }
      };
      if (script.hold) g.release = go; else setTimeout(go, 0);
    } };
  } } } };
  return g;
}
const happy = () => ({ steps: R(stepsAns), sleep: R(sleepAns) });
async function harness({ google = fakeGoogle(), routes = happy(), loadGoogle, now = () => NOW } = {}) {
  const { createHealthSync } = await S();
  const f = fakeFetch(routes);
  let loads = 0;
  const sync = createHealthSync({ fetch: f, loadGoogle: async () => { loads++; if (loadGoogle) return loadGoogle(); return google.google; }, now });
  return { sync, f, google, loads: () => loads };
}
async function spyConsole(fn) {
  const calls = [], names = ['log', 'info', 'warn', 'error', 'debug', 'trace'], orig = {};
  for (const n of names) { orig[n] = console[n]; console[n] = (...a) => calls.push(a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); }
  try { await fn(); } finally { for (const n of names) console[n] = orig[n]; }
  return calls;
}

// ================================================================ client-id store (S1, S2)
test('S1. client-id store: own key (not the state key, not the sync key), plain string value, survives a new store, invalid / secret writes nothing, get re-validates, clear removes every copy, bad storage never throws', async () => {
  const { createClientIdStore, CLIENT_ID_KEY } = await S();
  assert.equal(CLIENT_ID_KEY, 'macrodiary.googleclient.v1');
  assert.notEqual(CLIENT_ID_KEY, STORAGE_KEY); assert.notEqual(CLIENT_ID_KEY, SYNC_KEY);
  const st = fakeStorage(), c = createClientIdStore(st);
  assert.equal(c.get(), '');
  assert.deepEqual(c.set('  ' + ID + ' '), { ok: true, id: ID });
  assert.equal(c.get(), ID);
  assert.deepEqual([...st.m.keys()], [CLIENT_ID_KEY]); assert.equal(st.m.get(CLIENT_ID_KEY), ID);
  assert.equal(createClientIdStore(st).get(), ID, 'survives a reload');
  // invalid and secret: nothing written, the previous ID stays
  const writes = st.log.length;
  assert.deepEqual(c.set('nope'), { ok: false, message: M.shape });
  assert.deepEqual(c.set(SECRET), { ok: false, message: M.secret });
  assert.deepEqual(c.set(''), { ok: false, message: M.empty });
  assert.equal(st.log.length, writes, 'no write at all'); assert.equal(c.get(), ID);
  const empty = fakeStorage(), c2 = createClientIdStore(empty);
  c2.set(SECRET); c2.set('{"client_secret":"' + SECRET + '"}');
  assert.equal(empty.m.size, 0); assert.equal(empty.log.length, 0);
  for (const v of empty.m.values()) assert.equal(v.includes('GOCSPX'), false);
  // get never returns something that no longer passes the rules
  for (const junk of [SECRET, 'hello', '<b>x</b>', '', '  ', JSON.stringify({ id: ID })]) assert.equal(createClientIdStore(fakeStorage({ [CLIENT_ID_KEY]: junk })).get(), '', JSON.stringify(junk));
  // clear
  c.clear(); assert.equal(c.get(), '');
  for (const v of st.m.values()) assert.notEqual(v, ID);
  assert.doesNotThrow(() => c.clear());
  // blocked, null and throwing storage
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  for (const bad of [null, undefined, blocked]) {
    const b = createClientIdStore(bad);
    assert.equal(b.get(), ''); assert.deepEqual(b.set(ID), { ok: false, message: M.noSave }); assert.doesNotThrow(() => b.clear());
  }
});

test('S2. the Client ID never reaches state, sync records, a backup (JSON.stringify(state)) or the sync result; state gains no top-level key', async () => {
  const { createClientIdStore } = await S();
  const { applyHealthSync } = await D();
  const state = defaults();
  state.days['2026-11-16'] = [{ id: 'e1', name: 'Egg', meal: 'Breakfast', grams: 50, per100: { k: 140, p: 12, c: 1, f: 10 } }];
  const keysBefore = Object.keys(state).sort();
  const st = fakeStorage(), store = createClientIdStore(st);
  assert.equal(store.set(ID).ok, true);
  const h = await harness();
  const res = await h.sync.run(store.get());
  assert.equal(res.ok, true);
  assert.equal(JSON.stringify(res).includes(ID), false);
  applyHealthSync(state, res.days, 5000);
  assert.deepEqual(Object.keys(state).sort(), keysBefore);
  assert.equal(JSON.stringify(state).includes('apps.googleusercontent.com'), false);
  assert.equal(JSON.stringify(state).includes(ID), false);
  assert.equal(JSON.stringify(toRecords(state)).includes('apps.googleusercontent.com'), false);
  assert.equal(st.m.has(STORAGE_KEY), false, 'the app-state key is never written by the client-id store');
  // the new activity DOES sync (it is a normal activity record)
  assert.ok(toRecords(state).some(r => r.key === 'activity:2026-11-16'));
  assert.equal(JSON.stringify(defaults()).toLowerCase().includes('client'), false, 'no client id field in the saved defaults');
});

// ================================================================ the sync service (S3-S10)
test('S3. no usable Client ID (empty, secret, bad shape): no script load, no initTokenClient, no fetch, the exact message', async () => {
  for (const [id, message] of [['', M.empty], [undefined, M.empty], [null, M.empty], ['   ', M.empty], [SECRET, M.secret], ['nope', M.shape], [{}, M.empty]]) {
    const h = await harness();
    const res = await h.sync.run(id);
    assert.deepEqual(res, { ok: false, message }, String(id));
    assert.equal(h.loads(), 0); assert.equal(h.google.inits.length, 0); assert.equal(h.google.requests, 0); assert.equal(h.f.calls.length, 0);
  }
});

test('S4. success flow: initTokenClient gets the client id, the exact scope, callback and error_callback; two requests with the exact 7-day body and URL, bearer token, only Google Health URLs; result is the golden', async () => {
  const { SCOPE: scope, GIS_URL } = await S();
  assert.equal(scope, SCOPE); assert.equal(GIS_URL, 'https://accounts.google.com/gsi/client');
  const h = await harness();
  const res = await h.sync.run(ID);
  assert.deepEqual(res, { ok: true, days: BOTH_GOLD });
  assert.equal(h.loads(), 1); assert.equal(h.google.inits.length, 1); assert.equal(h.google.requests, 1);
  const cfg = h.google.inits[0];
  assert.equal(cfg.client_id, ID); assert.equal(cfg.scope, SCOPE);
  assert.equal(typeof cfg.callback, 'function'); assert.equal(typeof cfg.error_callback, 'function');
  assert.equal(h.f.calls.length, 2);
  const steps = h.f.calls.find(c => kindOf(c.url) === 'steps'), sleep = h.f.calls.find(c => kindOf(c.url) === 'sleep');
  assert.equal(steps.method, 'POST'); assert.equal(steps.url, HEALTH + '/dataTypes/steps/dataPoints:dailyRollUp');
  assert.deepEqual(JSON.parse(steps.body), { range: { start: cdt(2026, 11, 10), end: cdt(2026, 11, 17) }, windowSizeDays: 1 });
  assert.match(steps.headers['content-type'], /application\/json/);
  assert.equal(sleep.method, 'GET');
  assert.equal(sleep.url, 'https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-11-10%22');
  for (const c of h.f.calls) { assert.equal(c.headers.authorization, 'Bearer ' + TOKEN); assert.ok(c.url.startsWith(HEALTH + '/'), c.url); assert.equal(c.url.includes(TOKEN), false); assert.equal(String(c.body || '').includes(TOKEN), false); }
});

test('S5. the token and any email never appear in a result, message, storage value, URL, body or console call, on success and on every failure', async () => {
  const { createClientIdStore } = await S();
  const hostile = { error: { code: 500, message: 'oops ' + TOKEN + ' ' + EMAIL, status: 'INTERNAL', details: [{ reason: TOKEN + EMAIL }] } };
  const scenarios = [
    {}, // success
    { google: fakeGoogle({ callback: { error: 'access_denied', error_description: EMAIL + ' ' + TOKEN } }) },
    { google: fakeGoogle({ callback: { error: 'invalid_scope', error_description: TOKEN } }) },
    { google: fakeGoogle({ errorCallback: { type: 'popup_closed', message: EMAIL + TOKEN } }) },
    { google: fakeGoogle({ initThrows: true }) },
    { google: fakeGoogle({ requestThrows: true }) },
    { routes: { steps: R(hostile, 401), sleep: happy().sleep } },
    { routes: { steps: R(hostile, 500), sleep: happy().sleep } },
    { routes: { steps: happy().steps, sleep: R(hostile, 403) } },
    { routes: { steps: happy().steps, sleep: () => new Response(TOKEN + EMAIL + '<h1>', { status: 200 }) } },
    { routes: { steps: () => new Error('Failed to fetch ' + TOKEN + ' ' + EMAIL), sleep: happy().sleep } },
    { loadGoogle: () => { throw new Error('script ' + TOKEN + EMAIL); } },
  ];
  for (const [i, sc] of scenarios.entries()) {
    const h = await harness(sc), st = fakeStorage(), store = createClientIdStore(st);
    store.set(ID);
    let res;
    const out = await spyConsole(async () => { res = await h.sync.run(store.get()); });
    const seen = [JSON.stringify(res), ...out, ...[...st.m.values()], ...h.f.calls.map(c => c.url + '|' + String(c.body || ''))];
    for (const s of seen) { assert.equal(s.includes(TOKEN), false, `scenario ${i}: token in ${s.slice(0, 80)}`); assert.equal(s.includes('ya29'), false); assert.equal(s.includes(EMAIL), false, `scenario ${i}: email`); }
    if (res.ok === false) { assert.equal(typeof res.message, 'string'); assert.ok(res.message.length > 0); assert.doesNotMatch(res.message, /undefined|NaN|\[object|ya29|@/); }
    for (const c of h.f.calls) for (const [k, v] of Object.entries(c.init)) if (k !== 'headers') assert.equal(JSON.stringify(v ?? '').includes(TOKEN), false);
  }
});

test('S6. each token-flow failure gives its exact message and makes no Google Health request', async () => {
  const cases = [
    ['access_denied', { callback: { error: 'access_denied' } }, M.denied],
    ['access_denied with an email in the description', { callback: { error: 'access_denied', error_description: EMAIL + ' is not a test user' } }, M.denied],
    ['popup_closed', { errorCallback: { type: 'popup_closed' } }, M.closed],
    ['popup_failed_to_open', { errorCallback: { type: 'popup_failed_to_open' } }, M.blocked],
    ['origin_mismatch as error', { callback: { error: 'origin_mismatch' } }, M.origin],
    ['origin_mismatch in the description', { callback: { error: 'invalid_request', error_description: 'Error 400: origin_mismatch' } }, M.origin],
    ['other code', { callback: { error: 'invalid_scope' } }, 'Google sign-in failed (invalid_scope).'],
    ['hostile code', { callback: { error: TOKEN } }, M.failed],
    ['uppercase code', { callback: { error: 'INVALID' } }, M.failed],
    ['too long code', { callback: { error: 'a'.repeat(41) } }, M.failed],
    ['unknown error_callback type', { errorCallback: { type: 'unknown' } }, M.failed],
    ['init throws', { initThrows: true }, M.failed],
    ['requestAccessToken throws', { requestThrows: true }, M.failed],
    ['no token, no error', { callback: {} }, M.noToken],
    ['empty token', { callback: { access_token: '' } }, M.noToken],
    ['token of the wrong type', { callback: { access_token: 123 } }, M.noToken],
    ['null response', { callback: null }, M.noToken],
    ['token and an error together', { callback: { access_token: TOKEN, error: 'access_denied' } }, M.denied],
  ];
  for (const [name, script, message] of cases) {
    const h = await harness({ google: fakeGoogle(script) });
    assert.deepEqual(await h.sync.run(ID), { ok: false, message }, name);
    assert.equal(h.f.calls.length, 0, name + ': no request');
  }
  // the script could not be loaded
  for (const lg of [() => { throw new Error('offline'); }, () => Promise.reject(new Error('offline')), () => undefined, () => ({}), () => ({ accounts: {} }), () => ({ accounts: { oauth2: {} } })]) {
    const h = await harness({ loadGoogle: lg });
    assert.deepEqual(await h.sync.run(ID), { ok: false, message: M.script });
    assert.equal(h.f.calls.length, 0);
  }
});

const ERR = (code, status, extra = {}) => ({ error: { code, message: 'text with ' + TOKEN + ' and ' + EMAIL, status, ...extra } });
const NOT_LINKED = { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCOUNT_NOT_LINKED', domain: 'health.googleapis.com' }] };

test('S7. each HTTP / network failure gives its exact message (ACCOUNT_NOT_LINKED first); the first failure stops the run; error bodies are never echoed', async () => {
  const cases = [
    ['401', () => jsonRes(ERR(401, 'UNAUTHENTICATED'), 401), M.s401],
    ['403', () => jsonRes(ERR(403, 'PERMISSION_DENIED'), 403), M.s403],
    ['429', () => jsonRes(ERR(429, 'RESOURCE_EXHAUSTED'), 429), M.s429],
    ['400 not linked', () => jsonRes(ERR(400, 'FAILED_PRECONDITION', NOT_LINKED), 400), M.notLinked],
    ['403 not linked (reason wins over the status)', () => jsonRes(ERR(403, 'PERMISSION_DENIED', NOT_LINKED), 403), M.notLinked],
    ['not linked as the second detail', () => jsonRes(ERR(400, 'FAILED_PRECONDITION', { details: [{ reason: 'OTHER' }, { reason: 'ACCOUNT_NOT_LINKED' }] }), 400), M.notLinked],
    ['400 other', () => jsonRes(ERR(400, 'INVALID_ARGUMENT'), 400), M.http(400)],
    ['404', () => jsonRes(ERR(404, 'NOT_FOUND'), 404), M.http(404)],
    ['500', () => jsonRes(ERR(500, 'INTERNAL'), 500), M.http(500)],
    ['503 with an HTML body', () => new Response('<h1>' + EMAIL + '</h1>', { status: 503 }), M.http(503)],
    ['401 with no body', () => new Response('', { status: 401 }), M.s401],
    ['200 with a body that is not JSON', () => new Response('<html>nope', { status: 200 }), M.unreadable],
    ['fetch rejects', () => new TypeError('Failed to fetch'), M.network],
  ];
  for (const [name, bad, message] of cases) {
    // failing on the steps request: the sleep request is never made
    let h = await harness({ routes: { steps: bad, sleep: happy().sleep } });
    assert.deepEqual(await h.sync.run(ID), { ok: false, message }, 'steps ' + name);
    assert.equal(h.f.calls.length, 1, 'steps ' + name + ': the run stops at the first failure');
    // failing on the sleep request after steps worked: still a failure and no days
    h = await harness({ routes: { steps: happy().steps, sleep: bad } });
    const res = await h.sync.run(ID);
    assert.deepEqual(res, { ok: false, message }, 'sleep ' + name);
    assert.equal('days' in res, false, 'all-or-nothing: no days are returned');
  }
});

test('S8. sleep paging follows nextPageToken (at most 4 pages), merges the pages, and a failure on a later page fails the whole run', async () => {
  const pages = {
    1: { dataPoints: [A16a, A15a, A15b], nextPageToken: 'tok2' },
    2: { dataPoints: [A16b, A14], nextPageToken: '' },
  };
  let h = await harness({ routes: { steps: happy().steps, sleep: (c, n) => jsonRes(pages[n]) } });
  const res = await h.sync.run(ID);
  assert.deepEqual(res, { ok: true, days: BOTH_GOLD }, 'records of both pages are combined (16th: 159 + 239 = 398)');
  const sleeps = h.f.calls.filter(c => kindOf(c.url) === 'sleep');
  assert.equal(sleeps.length, 2);
  assert.equal(sleeps[0].url.includes('pageToken'), false);
  assert.equal(sleeps[1].url, sleeps[0].url + '&pageToken=tok2');
  // a token that never ends: stop after 4 sleep pages, still a success with what was read
  h = await harness({ routes: { steps: happy().steps, sleep: () => jsonRes({ dataPoints: [A14], nextPageToken: 'again' }) } });
  const res2 = await h.sync.run(ID);
  assert.equal(res2.ok, true);
  assert.equal(h.f.calls.filter(c => kindOf(c.url) === 'sleep').length, 4);
  assert.deepEqual(res2.days['2026-11-14'], { steps: 12921, sleepMinutes: 1440, sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z' }); // 4 x 435 = 1740, capped at 1440
  // a failure on page 2 fails everything
  h = await harness({ routes: { steps: happy().steps, sleep: (c, n) => (n === 1 ? jsonRes({ dataPoints: [A14], nextPageToken: 'tok2' }) : jsonRes(ERR(429, 'RESOURCE_EXHAUSTED'), 429)) } });
  assert.deepEqual(await h.sync.run(ID), { ok: false, message: M.s429 });
  // an empty-string or missing token ends paging
  for (const tok of ['', undefined, null, 5]) {
    h = await harness({ routes: { steps: happy().steps, sleep: () => jsonRes({ dataPoints: [A14], nextPageToken: tok }) } });
    assert.equal((await h.sync.run(ID)).ok, true); assert.equal(h.f.calls.filter(c => kindOf(c.url) === 'sleep').length, 1, String(tok));
  }
});

test('S9. concurrent taps: a second run while one is pending is ignored (busy result, no extra calls); the flag is released after success and after failure', async () => {
  const g = fakeGoogle({ hold: true });
  const h = await harness({ google: g });
  const first = h.sync.run(ID);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(g.requests, 1);
  const second = await h.sync.run(ID);
  assert.deepEqual(second, { ok: false, busy: true, message: M.busy });
  const third = await h.sync.run('');           // even an invalid tap while busy changes nothing
  assert.equal(third.ok, false);
  assert.equal(h.loads(), 1); assert.equal(g.inits.length, 1); assert.equal(g.requests, 1); assert.equal(h.f.calls.length, 0);
  g.release();
  assert.equal((await first).ok, true);
  assert.equal(h.f.calls.length, 2, 'only the first run fetched');
  // released after success
  g.release = null;
  const again = h.sync.run(ID);
  await new Promise(r => setTimeout(r, 5));
  assert.equal(g.inits.length, 2); g.release(); assert.equal((await again).ok, true);
  // released after a failure
  const g2 = fakeGoogle({ hold: true }), h2 = await harness({ google: g2, routes: { steps: R(ERR(500, 'INTERNAL'), 500), sleep: happy().sleep } });
  const a = h2.sync.run(ID); await new Promise(r => setTimeout(r, 5)); g2.release();
  assert.deepEqual(await a, { ok: false, message: M.http(500) });
  const b = h2.sync.run(ID); await new Promise(r => setTimeout(r, 5));
  assert.equal(g2.inits.length, 2, 'a new sign-in was started after the failure'); g2.release(); assert.equal((await b).ok, false);
  // released after a sign-in failure
  const g3 = fakeGoogle({ errorCallback: { type: 'popup_closed' } }), h3 = await harness({ google: g3 });
  assert.equal((await h3.sync.run(ID)).message, M.closed); assert.equal((await h3.sync.run(ID)).message, M.closed); assert.equal(g3.inits.length, 2);
});

test('S10. edge: 200 answers of {} or null are a successful empty sync; a token callback fired twice (or after an error) is harmless', async () => {
  for (const body of [{}, null, [], { rollupDataPoints: [] }]) {
    const h = await harness({ routes: { steps: () => new Response(JSON.stringify(body), { status: 200 }), sleep: () => new Response(JSON.stringify(body), { status: 200 }) } });
    assert.deepEqual(await h.sync.run(ID), { ok: true, days: {} }, JSON.stringify(body));
  }
  const h = await harness({ google: fakeGoogle({ twice: true }) });
  assert.deepEqual(await h.sync.run(ID), { ok: true, days: BOTH_GOLD });
  assert.equal(h.f.calls.length, 2, 'the second callback does not start a second round of requests');
  // the real run keeps working with the clock injected: another "today" gives another range
  const h2 = await harness({ now: () => L(2026, 12, 3, 9) });
  await h2.sync.run(ID);
  assert.deepEqual(JSON.parse(h2.f.calls.find(c => kindOf(c.url) === 'steps').body).range, { start: cdt(2026, 11, 27), end: cdt(2026, 12, 4) });
});

// ================================================================ static source checks (WEAK, T1-T5)
const NEW_FILES = ['js/domain/google-health-api.js', 'js/services/google-health-api.js', 'js/ui/health-sync-view.js'];
const code = p => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1'); // source without comments (URLs in strings survive)
const importsOf = src => [...src.matchAll(/^\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);
const HOSTS = new Set(['accounts.google.com', 'health.googleapis.com', 'www.googleapis.com']);
const hostsOf = src => [...new Set([...src.matchAll(/https?:\/\/([^\s/'"`)\\]+)/g)].map(m => m[1]))];

test('T1. (weak) the three new files exist; layering holds; no forbidden APIs; only Google hosts', () => {
  const [dom, svc, ui] = NEW_FILES.map(code);
  for (const i of importsOf(dom)) assert.match(i, /^(\.\.\/core\/(constants|format|dates|schema)\.js|\.\/[a-z-]+\.js)$/, 'domain import: ' + i);
  for (const i of importsOf(svc)) assert.match(i, /^(\.\.\/(core|domain)\/[a-z-]+\.js|\.\/[a-z-]+(\/[a-z-]+)*\.js)$/, 'services import: ' + i);
  assert.equal(importsOf(svc).some(i => /core\/store\.js|\/ui\//.test(i)), false, 'the service neither reads state nor imports a ui module');
  for (const i of importsOf(ui)) assert.doesNotMatch(i, /^\.\.\/\.\.|\/tools\//, 'ui import: ' + i);
  assert.ok(importsOf(ui).some(i => /services\/google-health-api\.js$/.test(i)) && importsOf(ui).some(i => /domain\/google-health-api\.js$/.test(i)));
  assert.doesNotMatch(dom, /\b(document|window|localStorage|sessionStorage|fetch|XMLHttpRequest|navigator)\b|Date\.now|Math\.random|\bconsole\.(log|info|warn|error|debug|trace)\b/, 'the domain file is pure');
  for (const [name, src] of [['service', svc], ['ui', ui]]) {
    assert.doesNotMatch(src, /\bconsole\.(log|info|warn|error|debug|trace)\b/, name + ': no console output (a token must never reach a console)');
    assert.doesNotMatch(src, /sessionStorage|document\.cookie|indexedDB|client_secret|\beval\(|new Function/, name);
    assert.doesNotMatch(src, /\binnerHTML|outerHTML|insertAdjacentHTML|document\.write/, name + ': text from Google is written with textContent only');
  }
  for (const [name, src] of [['domain', dom], ['service', svc], ['ui', ui]]) for (const h of hostsOf(src)) assert.ok(HOSTS.has(h), `${name}: host ${h} is not one of Google's`);
  assert.ok(hostsOf(svc).includes('accounts.google.com'), 'GIS_URL lives in the service');
  assert.ok(hostsOf(svc + dom).includes('health.googleapis.com'));
  assert.doesNotMatch(svc, /localStorage\s*\.\s*(getItem|setItem|removeItem)/, 'storage is injected, the service never calls localStorage directly');
  assert.match(svc, /accounts\.google\.com\/gsi\/client/); assert.match(svc, /initTokenClient/); assert.match(svc, /error_callback/); assert.match(svc, /requestAccessToken/);
  assert.doesNotMatch(svc, /initCodeClient/);
  assert.equal([...(svc + dom).matchAll(/\/auth\/[a-z._]+/g)].map(m => m[0]).filter(s => !/googlehealth\.(activity_and_fitness|sleep)\.readonly$/.test(s)).length, 0, 'only the two read-only Health scopes');
});

test('T2. (weak) index.html: the Google Health sync card, its ids, order, labels, note phrases, and the Diary button', () => {
  const html = read('index.html');
  const count = (s, n) => s.split(n).length - 1;
  const tag = (src, id) => { const m = src.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>')); assert.ok(m, 'missing #' + id); return m[0]; };
  const settings = html.slice(html.indexOf('id="v-settings"'), html.indexOf('</section>', html.indexOf('id="v-settings"')));
  for (const id of ['ghSyncCard', 'ghSyncClientId', 'ghSyncSave', 'ghSyncRemove', 'ghSyncBtn', 'ghSyncStatus', 'ghSyncDiary']) assert.equal(count(html, `id="${id}"`), 1, '#' + id + ' exactly once');
  const a = settings.indexOf('id="ghCard"'), b = settings.indexOf('id="ghSyncCard"'), c = settings.indexOf('id="syncCard"');
  assert.ok(a > -1 && b > a && c > b, 'order: ghCard, ghSyncCard, syncCard');
  const card = settings.slice(b, c);
  assert.match(card, /<h2>\s*Google Health sync\s*<\/h2>/);
  assert.equal(count(settings.slice(a, b), 'ghSync'), 0, 'the new card is not inside the import card');
  const input = tag(card, 'ghSyncClientId'); assert.match(input, /^<input\b/); assert.match(input, /type="text"/); assert.match(input, /autocomplete="off"/); assert.doesNotMatch(input, /type="password"/);
  assert.match(card, /<label[^>]*for="ghSyncClientId"[^>]*>\s*Google Client ID\s*<\/label>/);
  assert.match(card, /id="ghSyncSave"[^>]*>\s*Save\s*<\/button>/); assert.match(card, /id="ghSyncRemove"[^>]*>\s*Remove\s*<\/button>/);
  const btn = tag(card, 'ghSyncBtn'); assert.match(btn, /^<button\b/); assert.doesNotMatch(btn, /\bdisabled\b/);
  assert.match(card, /id="ghSyncBtn"[^>]*>\s*Sync Google Health\s*<\/button>/);
  assert.match(tag(card, 'ghSyncStatus'), /aria-live="polite"/);
  const text = card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  for (const phrase of ['sign in', 'about 1 hour', 'no background sync', 'test mode']) assert.ok(text.includes(phrase), 'note must say: ' + phrase);
  const diary = html.slice(html.indexOf('id="v-diary"'), html.indexOf('</section>', html.indexOf('id="v-diary"')));
  const x = diary.indexOf('id="activityLine"'), y = diary.indexOf('id="ghSyncDiary"'), z = diary.indexOf('id="water"');
  assert.ok(x > -1 && y > x && z > y, 'Diary order: activityLine, ghSyncDiary, water');
  const d = tag(diary, 'ghSyncDiary'); assert.match(d, /^<button\b/); assert.match(d, /type="button"/); assert.match(d, /\bhidden\b/);
  assert.match(diary, /id="ghSyncDiary"[^>]*>\s*Sync Google Health\s*<\/button>/);
  assert.equal(count(html, 'id="ghCard"'), 1, 'the import card is still there once');
});

test('T3. (weak) sw.js lists the new files in SHELL and still has a numbered CACHE (bumping it is a reviewer check: an exact number is never tested)', () => {
  const sw = read('sw.js');
  const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of NEW_FILES) assert.ok(shell.includes(f), 'SHELL must list ' + f);
  assert.match(sw, /const CACHE = 'macro-diary-v\d+'/);
});

test('T4. (weak) health-sync-view.js wiring: main.js starts it, apply + save + diary:changed, textContent, no token storage, manual only', () => {
  const ui = code('js/ui/health-sync-view.js'), main = read('js/main.js');
  assert.match(main, /import\s*\{[^}]*\binitHealthSync\b[^}]*\}\s*from\s*'\.\/ui\/health-sync-view\.js'/); assert.match(main, /\binitHealthSync\(\)/);
  assert.match(ui, /export function initHealthSync\b|export const initHealthSync\b/);
  for (const id of ['ghSyncClientId', 'ghSyncSave', 'ghSyncRemove', 'ghSyncBtn', 'ghSyncStatus', 'ghSyncDiary']) assert.ok(ui.includes(id), 'the view must use #' + id);
  assert.match(ui, /applyHealthSync\(/); assert.match(ui, /\bsave\(\)/); assert.match(ui, /emit\(\s*'diary:changed'\s*\)/); assert.match(ui, /healthSyncText\(/);
  assert.match(ui, /createClientIdStore\(/); assert.match(ui, /createHealthSync\(/);
  assert.match(ui, /textContent/);
  assert.match(ui, /disabled/);
  assert.match(ui, /Date\.now\(\)/);
  for (const text of ['Client ID saved on this device.', 'Client ID removed.', 'Syncing with Google Health…']) assert.ok(ui.includes(text), 'status text: ' + text);
  assert.doesNotMatch(ui, /localStorage\s*\.|access_token|accessToken|\.setItem\(|\.getItem\(/, 'the view never reads or writes storage or a token itself (it hands storage to the store)');
  assert.doesNotMatch(main, /\.run\(\s*\)|syncGoogleHealth\(\)/, 'main.js does not start a sync');
});

test('T5. (weak) docs: a DECISIONS entry, a KNOWN-ISSUES row, and the setup guide says where the Client ID goes', () => {
  const dec = read('docs/DECISIONS.md'), ki = read('docs/KNOWN-ISSUES.md'), setup = read('docs/GOOGLE-HEALTH-SETUP.md');
  const m = dec.match(/^## D\d+\. Google Health sync[^\n]*\n([\s\S]*?)(?=\n## D\d+\.|(?![\s\S]))/m);
  assert.ok(m, 'DECISIONS.md needs "## D<n>. Google Health sync ..."');
  assert.match(m[1], /Client ID/); assert.match(m[1], /token/i); assert.match(m[1], /macrodiary\.googleclient\.v1/); assert.match(m[1], /replace/i);
  assert.match(ki, /\|\s*\d+\s*\|\s*Google Health sync\b/);
  assert.match(setup, /Google Health sync/); assert.match(setup, /ahaselden\.github\.io/);
  assert.doesNotMatch(setup, /GOCSPX-[A-Za-z0-9_-]{8,}|ya29\.[A-Za-z0-9_-]{8,}/);
});
