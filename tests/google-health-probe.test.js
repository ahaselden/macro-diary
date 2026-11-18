// Spec: docs/specs/google-health-probe.md (backlog item 20, step 1). Test-designer file, written BEFORE the implementation. All data is made up.
// Golden values are hand-computed (arithmetic in the comments). P18-P24 are WEAK source-text checks: they prove strings are present or absent,
// not that the page behaves; the page itself is covered by the headless outline and the owner checklist in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const exists = p => existsSync(new URL('../' + p, import.meta.url));
// dynamic import so a missing module fails only the tests that need it, not the static checks
const load = () => import('../tools/google-health-probe/probe.js');
const L = (y, m, d, h = 0, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s); // LOCAL time, so the tests do not depend on the machine's timezone
const NOW = L(2026, 11, 14, 20, 0, 0);
const BAD = /NaN|undefined|\[object|Infinity/;
const SC1 = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
const SC2 = 'https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const PAGE = 'tools/google-health-probe/index.html', PROBE = 'tools/google-health-probe/probe.js', DOC = 'docs/GOOGLE-HEALTH-SETUP.md';

// ================================================================ pure helpers
// CivilDateTime is an OBJECT in Google's API: { date: {year, month, day}, time: {hours, minutes, seconds, nanos} }
const cdt = (y, m, d) => ({ date: { year: y, month: m, day: d }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } });
const rng = (a, b) => ({ start: cdt(...a), end: cdt(...b) });
test('P1. civilRange: local start (days-1 back) and exclusive end (tomorrow) at 00:00:00, as CivilDateTime objects', async () => {
  const { civilRange } = await load();
  // 14 Nov minus 2 days = 12 Nov; end = 15 Nov
  assert.deepEqual(civilRange(NOW, 3), rng([2026, 11, 12], [2026, 11, 15]));
  assert.deepEqual(civilRange(NOW, 1), rng([2026, 11, 14], [2026, 11, 15]));
  assert.deepEqual(civilRange(NOW, 7), rng([2026, 11, 8], [2026, 11, 15])); // 14-6 = 8
});

test('P2. civilRange: month, year and leap-day boundaries; time of day never matters', async () => {
  const { civilRange } = await load();
  assert.deepEqual(civilRange(L(2026, 3, 1, 9), 3), rng([2026, 2, 27], [2026, 3, 2])); // Feb 27, 28, Mar 1
  assert.deepEqual(civilRange(L(2028, 3, 1, 9), 3), rng([2028, 2, 28], [2028, 3, 2])); // 2028 is a leap year: Feb 28, 29, Mar 1
  assert.deepEqual(civilRange(L(2026, 12, 31, 23, 59, 59), 3), rng([2026, 12, 29], [2027, 1, 1]));
  assert.deepEqual(civilRange(L(2027, 1, 1, 0, 0, 0), 3), rng([2026, 12, 30], [2027, 1, 2]));
  assert.deepEqual(civilRange(L(2026, 3, 30, 12), 3), rng([2026, 3, 28], [2026, 3, 31])); // spans the EU clock change of 29 Mar: still whole civil days
  assert.deepEqual(civilRange(L(2026, 10, 26, 12), 3), rng([2026, 10, 24], [2026, 10, 27])); // spans the EU change of 25 Oct
  assert.deepEqual(civilRange(L(2026, 11, 14, 0, 0, 0), 3), civilRange(L(2026, 11, 14, 23, 59, 59), 3));
});

test('P3. civilRange: days is normalised (default 3, floor, clamp 1..31); an invalid now gives null', async () => {
  const { civilRange } = await load();
  const three = rng([2026, 11, 12], [2026, 11, 15]);
  for (const d of [undefined, NaN, '3', null, Infinity, -Infinity, {}, []]) assert.deepEqual(civilRange(NOW, d), three, String(d));
  for (const d of [0, -5, 0.5, 1]) assert.deepEqual(civilRange(NOW, d).start, cdt(2026, 11, 14), String(d));
  assert.deepEqual(civilRange(NOW, 2.9).start, cdt(2026, 11, 13));
  assert.deepEqual(civilRange(NOW, 31).start, cdt(2026, 10, 15)); // 14 Nov minus 30 days
  assert.deepEqual(civilRange(NOW, 100).start, cdt(2026, 10, 15));
  assert.deepEqual(civilRange(NOW, 1e9).start, cdt(2026, 10, 15));
  for (const n of [null, undefined, 'x', 0, 1763150400000, new Date(NaN), {}, []]) assert.equal(civilRange(n, 3), null, String(n));
});

test('P4. buildDailyRollUpBody: { range: {start, end} as CivilDateTime objects, windowSizeDays: 1 }; null for an invalid now', async () => {
  const { buildDailyRollUpBody } = await load();
  const want = { range: { start: { date: { year: 2026, month: 11, day: 12 }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } }, end: { date: { year: 2026, month: 11, day: 15 }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } } }, windowSizeDays: 1 };
  assert.deepEqual(buildDailyRollUpBody(NOW, 3), want);
  assert.deepEqual(JSON.parse(JSON.stringify(buildDailyRollUpBody(NOW, 3))), want);
  assert.equal(buildDailyRollUpBody(new Date(NaN), 3), null);
  assert.equal(buildDailyRollUpBody(undefined), null);
});

test('P5. buildSleepFilter and buildSleepUrl: quoted date, snake_case page_size, percent-encoded; empty string for an invalid now', async () => {
  const { buildSleepFilter, buildSleepUrl } = await load();
  assert.equal(buildSleepFilter(NOW, 3), 'sleep.interval.civil_end_time >= "2026-11-12"');
  assert.equal(buildSleepFilter(L(2026, 3, 1, 9), 3), 'sleep.interval.civil_end_time >= "2026-02-27"');
  assert.equal(buildSleepFilter(NOW, 1), 'sleep.interval.civil_end_time >= "2026-11-14"');
  assert.equal(buildSleepFilter('x', 3), ''); assert.equal(buildSleepFilter(null, 3), '');
  // encodeURIComponent: space %20, > %3E, = %3D, " %22; . _ - stay as they are
  assert.equal(buildSleepUrl(NOW, 3), 'https://health.googleapis.com/v4/users/me/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=sleep.interval.civil_end_time%20%3E%3D%20%222026-11-12%22');
  assert.equal(buildSleepUrl('x', 3), ''); assert.equal(buildSleepUrl(undefined), '');
});

const rp = (y, m, d, steps) => { const o = { civilStartTime: { date: { year: y, month: m, day: d }, time: {} }, civilEndTime: { date: { year: y, month: m, day: d }, time: { hours: 23, minutes: 59, seconds: 59 } } }; if (steps !== undefined) o.steps = { countSum: steps }; return o; };
test('P6. summariseDailyRollUp: three days, countSum as text, civil times as objects, steps omitted = no data', async () => {
  const { summariseDailyRollUp } = await load();
  const json = { rollupDataPoints: [rp(2026, 11, 12, '6120'), rp(2026, 11, 13, '0'), rp(2026, 11, 14, '2350'), rp(2026, 12, 5)] };
  assert.deepEqual(summariseDailyRollUp(json), { count: 4,
    days: [{ date: '2026-11-12', steps: 6120 }, { date: '2026-11-13', steps: 0 }, { date: '2026-11-14', steps: 2350 }, { date: '2026-12-05', steps: null }],
    text: '2026-11-12: 6120; 2026-11-13: 0; 2026-11-14: 2350; 2026-12-05: no data' });
  assert.equal(summariseDailyRollUp({ rollupDataPoints: [rp(2026, 11, 12, 77)] }).days[0].steps, 77); // a safe integer number is accepted too
});

test('P7. summariseDailyRollUp: empty, garbage and hostile input never throws and never prints NaN/undefined', async () => {
  const { summariseDailyRollUp } = await load();
  const empty = { count: 0, days: [], text: 'no data points' };
  for (const j of [{}, null, undefined, 'x', 42, [], { rollupDataPoints: [] }, { rollupDataPoints: 'x' }, { rollupDataPoints: {} }, JSON.parse('{"__proto__":{"rollupDataPoints":[{}]}}')])
    assert.deepEqual(summariseDailyRollUp(j), empty, JSON.stringify(j));
  // steps object present but countSum unusable -> '?'
  for (const c of ['1e3', '-5', '12.5', ' 12', '99999999999999999999', NaN, Infinity, -3, 1.5, {}, [], null, undefined, true, ''])
    assert.deepEqual(summariseDailyRollUp({ rollupDataPoints: [{ ...rp(2026, 11, 12), steps: { countSum: c } }] }), { count: 1, days: [{ date: '2026-11-12', steps: null }], text: '2026-11-12: ?' }, String(c));
  // steps missing or not an object -> no data
  for (const s of [undefined, null, 5, 'x', []]) assert.equal(summariseDailyRollUp({ rollupDataPoints: [{ ...rp(2026, 11, 12), steps: s }] }).text, '2026-11-12: no data', String(s));
  // items that are not objects are skipped; an empty object is kept with unknown parts
  assert.deepEqual(summariseDailyRollUp({ rollupDataPoints: [null, 1, 'a', {}] }), { count: 1, days: [{ date: '?', steps: null }], text: '?: no data' });
  // date missing, wrong type, a string (the old guess), or not a real date -> ?
  const bad = [undefined, 5, 'yesterday', '2026-11-12T00:00:00', {}, { date: null }, { date: { year: 2026, month: 13, day: 1 } }, { date: { year: 2026, month: 0, day: 1 } }, { date: { year: 2026, month: 11, day: 0 } }, { date: { year: '2026', month: 11, day: 1 } }, { date: { year: 2026, month: 1.5, day: 1 } }, { date: { year: NaN, month: 1, day: 1 } }];
  for (const c of bad) assert.equal(summariseDailyRollUp({ rollupDataPoints: [{ civilStartTime: c, steps: { countSum: '5' } }] }).text, '?: 5', JSON.stringify(c));
  assert.equal(summariseDailyRollUp({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 3, day: 7 } }, steps: { countSum: '5' } }] }).text, '2026-03-07: 5'); // zero padded, time missing is fine
  const many = { rollupDataPoints: Array.from({ length: 40 }, (_, i) => rp(2026, 11, 12, String(i))) };
  assert.equal(summariseDailyRollUp(many).count, 31); assert.equal(summariseDailyRollUp(many).days.length, 31);
  assert.doesNotMatch(summariseDailyRollUp({ rollupDataPoints: [{ steps: null }, { civilStartTime: '<b>', steps: { countSum: '<b>' } }] }).text, BAD);
});

const sl = (s, so, e, eo, m) => ({ name: 'users/me/dataTypes/sleep/dataPoints/X', sleep: { interval: { startTime: s, startUtcOffset: so, endTime: e, endUtcOffset: eo }, type: 'STAGES', summary: { minutesInSleepPeriod: '480', minutesAsleep: m, minutesAwake: '25' }, metadata: { main: true } } });
test('P8. summariseSleep: UTC times plus UTC offsets converted to local civil time, and the local day it ends on', async () => {
  const { summariseSleep } = await load();
  // local = UTC + offset seconds. 22:30Z - 14400 s (4 h) = 18:30 same day; 06:30Z - 4 h = 02:30
  const a = sl('2026-04-20T22:30:00Z', '-14400s', '2026-04-21T06:30:00Z', '-14400s', '455');
  // 06:30Z + 3600 s = 07:30; 23:10:30.5Z + 3600 = 00:10:30 on the NEXT day (fraction dropped)
  const b = sl('2026-11-12T23:10:30.5Z', '3600s', '2026-11-13T06:30:00Z', '3600s', '300');
  // end 00:30Z - 3600 s = 23:30 the PREVIOUS day, so it ends on 2026-04-20
  const c = sl('2026-04-20T20:00:00Z', '-3600s', '2026-04-21T00:30:00Z', '-3600s', '60');
  assert.deepEqual(summariseSleep({ dataPoints: [a, b, c], nextPageToken: '' }), { count: 3, records: [
    { start: '2026-04-20T22:30:00Z', end: '2026-04-21T06:30:00Z', localStart: '2026-04-20T18:30:00', localEnd: '2026-04-21T02:30:00', endDay: '2026-04-21', minutesAsleep: 455 },
    { start: '2026-11-12T23:10:30.5Z', end: '2026-11-13T06:30:00Z', localStart: '2026-11-13T00:10:30', localEnd: '2026-11-13T07:30:00', endDay: '2026-11-13', minutesAsleep: 300 },
    { start: '2026-04-20T20:00:00Z', end: '2026-04-21T00:30:00Z', localStart: '2026-04-20T19:00:00', localEnd: '2026-04-20T23:30:00', endDay: '2026-04-20', minutesAsleep: 60 }],
  text: '2026-04-20T18:30:00 -> 2026-04-21T02:30:00 (ends 2026-04-21), 455 min asleep; 2026-11-13T00:10:30 -> 2026-11-13T07:30:00 (ends 2026-11-13), 300 min asleep; 2026-04-20T19:00:00 -> 2026-04-20T23:30:00 (ends 2026-04-20), 60 min asleep' });
  assert.deepEqual(summariseSleep({ dataPoints: [] }), { count: 0, records: [], text: 'no sleep records' });
  assert.equal(summariseSleep({ dataPoints: [sl('2026-01-01T00:00:00Z', '0s', '2026-01-01T08:00:00Z', '0s', '480')] }).records[0].localEnd, '2026-01-01T08:00:00');
});

test('P9. summariseSleep: garbage and hostile input never throws; bad parts are shown as ?, never guessed', async () => {
  const { summariseSleep } = await load();
  const empty = { count: 0, records: [], text: 'no sleep records' };
  for (const j of [{}, null, undefined, 'x', 7, [], { dataPoints: 'x' }, { dataPoints: {} }, JSON.parse('{"__proto__":{"dataPoints":[{}]}}')]) assert.deepEqual(summariseSleep(j), empty, JSON.stringify(j));
  assert.deepEqual(summariseSleep({ dataPoints: [{}] }), { count: 1, records: [{ start: '?', end: '?', localStart: '?', localEnd: '?', endDay: '?', minutesAsleep: null }], text: '? -> ? (ends ?), ? min asleep' });
  assert.equal(summariseSleep({ dataPoints: [null, 5, 'a', { sleep: null }, { sleep: { interval: 3, summary: 'x' } }] }).count, 2);
  for (const m of ['abc', '-1', '1e3', '9.5', '99999999999999999999', NaN, {}, null]) {
    const r = summariseSleep({ dataPoints: [sl('2026-04-20T22:30:00Z', '0s', '2026-04-21T06:30:00Z', '0s', m)] });
    assert.equal(r.records[0].minutesAsleep, null, String(m));
    assert.equal(r.text, '2026-04-20T22:30:00 -> 2026-04-21T06:30:00 (ends 2026-04-21), ? min asleep', String(m));
  }
  // a missing or unusable offset: the local parts are ? (the UTC string is still kept), no guessing
  for (const o of [undefined, null, '', 'abc', '14400', '4h', '1.5s', '--3s', 'sNaN', 5, '999999999s', {}]) {
    const r = summariseSleep({ dataPoints: [sl('2026-04-20T22:30:00Z', o, '2026-04-21T06:30:00Z', o, '5')] }).records[0];
    assert.deepEqual([r.start, r.end, r.localStart, r.localEnd, r.endDay, r.minutesAsleep], ['2026-04-20T22:30:00Z', '2026-04-21T06:30:00Z', '?', '?', '?', 5], String(o));
  }
  // times that are not UTC ISO strings, or not real calendar dates
  for (const t of ['yesterday', '<script>', 5, null, '2026-04-20 22:30:00Z', '2026-04-20T22:30:00', '2026-04-20T22:30:00+01:00', '2026-13-45T00:00:00Z', '2026-02-30T00:00:00Z', '2026-04-20T25:00:00Z']) {
    const r = summariseSleep({ dataPoints: [sl(t, '0s', t, '0s', '1')] });
    assert.equal(r.text, '? -> ? (ends ?), 1 min asleep', String(t));
  }
  assert.equal(summariseSleep({ dataPoints: Array.from({ length: 40 }, () => ({})) }).count, 25);
  assert.doesNotMatch(summariseSleep({ dataPoints: [{ sleep: { summary: { minutesAsleep: NaN } } }, {}] }).text, BAD);
});


test('P10. describeError: GIS error objects (invalid_scope, access_denied, popup_closed)', async () => {
  const { describeError } = await load();
  assert.equal(describeError({ error: 'invalid_scope', error_description: 'Bad scope', type: 'token_failed' }), 'error=invalid_scope; error_description=Bad scope; type=token_failed');
  assert.equal(describeError({ error: 'access_denied' }), 'error=access_denied');
  assert.equal(describeError({ type: 'popup_closed' }), 'type=popup_closed');
  assert.equal(describeError({ type: 'popup_failed_to_open' }), 'type=popup_failed_to_open');
  assert.equal(describeError({ error: 'invalid_scope', error_description: 'Bad scope' }), 'error=invalid_scope; error_description=Bad scope');
});

test('P11. describeError: Google HTTP error bodies', async () => {
  const { describeError } = await load();
  assert.equal(describeError({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }), 'PERMISSION_DENIED (403): The caller does not have permission');
  assert.equal(describeError({ error: { status: 'UNAUTHENTICATED', message: 'Invalid token' } }), 'UNAUTHENTICATED: Invalid token');
  assert.equal(describeError({ error: { message: 'Something broke' } }), 'Something broke');
  // details: the FIRST entry that has a string reason is appended as '; reason=X'
  const notLinked = { error: { code: 400, message: 'Account not linked', status: 'FAILED_PRECONDITION', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCOUNT_NOT_LINKED', domain: 'health.googleapis.com' }] } };
  assert.equal(describeError(notLinked), 'FAILED_PRECONDITION (400): Account not linked; reason=ACCOUNT_NOT_LINKED');
  assert.equal(describeError({ error: { code: 400, status: 'X', message: 'm', details: [null, 5, { '@type': 't' }, { reason: 'FIRST' }, { reason: 'SECOND' }] } }), 'X (400): m; reason=FIRST');
  assert.equal(describeError({ error: { message: 'only', details: [{ reason: 'R' }] } }), 'only; reason=R');
  for (const d of [undefined, null, 'x', {}, [], [{ reason: 5 }], [{ reason: {} }]]) assert.equal(describeError({ error: { code: 400, status: 'S', message: 'm', details: d } }), 'S (400): m', JSON.stringify(d));
});

test('P12. describeError: junk gives "unknown error" and never throws', async () => {
  const { describeError } = await load();
  for (const j of [null, undefined, 42, NaN, Infinity, true, false, {}, [], '', '   ', Symbol('s'), () => 1, 10n, { error: 5 }, { error: null }, { error: {} }, JSON.parse('{"__proto__":{"error":"polluted"}}')])
    assert.equal(describeError(j), 'unknown error', String(typeof j));
  assert.equal(({}).error, undefined);
  const thrower = { get error() { throw new Error('boom'); } };
  assert.equal(typeof describeError(thrower), 'string');
  const proxy = new Proxy({}, { get() { throw new Error('boom'); }, has() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
  assert.equal(typeof describeError(proxy), 'string');
  const circ = { error: 'x' }; circ.self = circ; assert.equal(describeError(circ), 'error=x');
  assert.equal(describeError(new Error('boom')), 'Error: boom');
  assert.equal(describeError(new TypeError('Failed to fetch')), 'TypeError: Failed to fetch');
  assert.equal(describeError('plain text'), 'plain text');
});

test('P13. describeError: cleaning (control chars, HTML kept as text, token and email removed, clipped to exactly 200)', async () => {
  const { describeError } = await load();
  assert.equal(describeError('a\nb\u0000c\t  d'), 'a b c d');
  assert.equal(describeError('token ya29.a0AfH6SMBxyz-_123 expired'), 'token [token removed] expired');
  assert.equal(describeError('user a.b@example.com denied'), 'user [email removed] denied');
  assert.equal(describeError({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'no access for ann@example.org' } }), 'PERMISSION_DENIED (403): no access for [email removed]');
  const html = describeError({ error: 'x', error_description: '<img src=x onerror=alert(1)>\n<script>1</script>' });
  assert.match(html, /^error=x; error_description=/); assert.doesNotMatch(html, /[\u0000-\u001f]/);
  const exact = 'a'.repeat(200); assert.equal(describeError(exact), exact);
  const over = describeError('a'.repeat(201)); assert.equal(over, 'a'.repeat(199) + '…'); assert.equal(over.length, 200);
  const huge = describeError({ error: 'e', error_description: 'z'.repeat(5000) }); assert.equal(huge.length, 200); assert.ok(huge.endsWith('…'));
  assert.equal(describeError('é'.repeat(300)).length, 200);
});

const TOKEN_SCOPE = SC1 + ' ' + SC2;
test('P14. resultSummary: exact text for a mixed result, numbers hidden', async () => {
  const { resultSummary } = await load();
  const results = { token: { ok: true, expiresIn: 3599, hasRefreshToken: false, scope: TOKEN_SCOPE }, gisError: null, checks: [
    { name: 'identity', status: 200, ok: true, message: '', numbers: '' },
    { name: 'steps', status: 403, ok: false, message: 'PERMISSION_DENIED (403): no', numbers: '2026-11-12: 6120' },
    { name: 'sleep', status: null, ok: false, message: 'Failed to fetch', numbers: '' }] };
  assert.equal(resultSummary(results, false), ['Google Health probe result', 'Sign-in: ok', 'expires_in: 3599', 'refresh_token present: no', 'scope granted: ' + TOKEN_SCOPE,
    'identity: HTTP 200 - ok', 'steps: HTTP 403 - failed: PERMISSION_DENIED (403): no', 'sleep: no response - failed: Failed to fetch'].join('\n'));
  assert.equal(resultSummary(results), resultSummary(results, false));
});

test('P15. resultSummary: numbers lines only when showNumbers is exactly true', async () => {
  const { resultSummary } = await load();
  const results = { token: { ok: true, expiresIn: 3599, hasRefreshToken: true, scope: 'a' }, checks: [
    { name: 'identity', status: 200, ok: true, numbers: '' },
    { name: 'steps', status: 200, ok: true, numbers: '2026-11-12: 6120; 2026-11-13: 0' },
    { name: 'sleep', status: 200, ok: true, numbers: '2026-11-13T22:30:00+01:00 -> 2026-11-14T06:30:00+01:00, 473 min asleep' }] };
  const base = ['Google Health probe result', 'Sign-in: ok', 'expires_in: 3599', 'refresh_token present: yes', 'scope granted: a', 'identity: HTTP 200 - ok', 'steps: HTTP 200 - ok', 'sleep: HTTP 200 - ok'];
  assert.equal(resultSummary(results, true), [...base, 'steps numbers: 2026-11-12: 6120; 2026-11-13: 0', 'sleep numbers: 2026-11-13T22:30:00+01:00 -> 2026-11-14T06:30:00+01:00, 473 min asleep'].join('\n'));
  for (const v of [false, undefined, null, 'true', 1, 'yes', {}]) assert.equal(resultSummary(results, v), base.join('\n'), String(v));
});

test('P16. resultSummary: a failed sign-in shows the GIS error verbatim and no token lines', async () => {
  const { resultSummary } = await load();
  assert.equal(resultSummary({ token: { ok: false }, gisError: { error: 'invalid_scope', error_description: 'Bad scope' }, checks: [] }, false),
    ['Google Health probe result', 'Sign-in: failed', 'GIS error: error=invalid_scope; error_description=Bad scope'].join('\n'));
  assert.equal(resultSummary({ gisError: { type: 'popup_closed' } }, true), ['Google Health probe result', 'Sign-in: failed', 'GIS error: type=popup_closed'].join('\n'));
  // token lines are omitted even if fields are present when ok is not true
  assert.equal(resultSummary({ token: { ok: false, expiresIn: 5, scope: 'a' } }, false), 'Google Health probe result\nSign-in: failed');
});

test('P17. resultSummary: never leaks the token, an email or hidden numbers; hostile input never throws or prints junk', async () => {
  const { resultSummary } = await load();
  const out = resultSummary({ token: { ok: true, expiresIn: 3599, accessToken: 'ya29.SECRETTOKEN123', access_token: 'ya29.SECRETTOKEN456', scope: 'a' },
    gisError: { error: 'x', error_description: 'who is ann@example.com' },
    checks: [{ name: 'steps', status: 401, ok: false, message: 'bad ya29.SECRETTOKEN789 for bob@example.org', numbers: '987654', access_token: 'ya29.SECRETTOKEN000' }] }, false);
  assert.doesNotMatch(out, /SECRETTOKEN|ya29|@|987654/);
  assert.match(out, /\[token removed\]/); assert.match(out, /\[email removed\]/);
  for (const r of [null, undefined, 'x', 5, {}, [], { checks: 'x' }, { checks: [null, 5, 'a', {}] }, { token: { ok: true, expiresIn: NaN, hasRefreshToken: 'yes', scope: {} } },
    { token: { ok: true, expiresIn: -1, scope: 5 } }, { checks: [{ name: 5, status: 'abc', ok: 'yes', message: {}, numbers: 5 }] }, { checks: [{ name: 'a', status: 99 }, { name: 'b', status: 600 }, { name: 'c', status: 200.5 }] }]) {
    for (const show of [true, false]) {
      let s; assert.doesNotThrow(() => { s = resultSummary(r, show); });
      assert.equal(typeof s, 'string'); assert.doesNotMatch(s, BAD); assert.doesNotMatch(s, /null/);
      assert.ok(s.startsWith('Google Health probe result\nSign-in: ') || s === 'Google Health probe result');
    }
  }
  assert.equal(resultSummary(null, false), 'Google Health probe result\nSign-in: failed');
  assert.equal(resultSummary({ token: { ok: true, expiresIn: NaN, hasRefreshToken: 'yes' } }, false), 'Google Health probe result\nSign-in: ok\nexpires_in: unknown\nrefresh_token present: no\nscope granted: none');
  // statuses outside 100..599 or non-integers count as no response; non-string names become ?
  assert.equal(resultSummary({ checks: [{ name: 'a', status: 99, ok: true }, { name: 5, status: 200, ok: true }] }, false), 'Google Health probe result\nSign-in: failed\na: no response - ok\n?: HTTP 200 - ok');
});

test('P18. probe.js imports in Node with no DOM and exports the eleven helpers', async () => {   // updated by the test designer for docs/specs/google-health-workouts-probe.md (B16): was eight
  assert.equal(typeof globalThis.document, 'undefined'); assert.equal(typeof globalThis.window, 'undefined');
  const P = await load();
  assert.deepEqual(Object.keys(P).sort(), ['buildDailyRollUpBody', 'buildExerciseUrl', 'buildSleepFilter', 'buildSleepUrl', 'civilRange', 'describeError', 'describeShape', 'resultSummary', 'summariseDailyRollUp', 'summariseExercise', 'summariseSleep']);
  for (const k of Object.keys(P)) assert.equal(typeof P[k], 'function', k);
});

// ================================================================ static source checks (WEAK)
const SRC = () => [read(PAGE), read(PROBE)];
const stripComments = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

test('P19. source: only Google hosts; the only external script is the Google Identity Services client', () => {
  const [html, js] = SRC();
  const allowed = h => ['accounts.google.com', 'health.googleapis.com', 'www.googleapis.com'].includes(h) || h.endsWith('.gstatic.com');
  for (const src of [html, js]) for (const m of src.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) assert.ok(allowed(new URL(m[0]).hostname), 'host not allowed: ' + m[0]);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  assert.ok(scripts.includes('https://accounts.google.com/gsi/client'), 'GIS script');
  for (const s of scripts) assert.ok(s === 'https://accounts.google.com/gsi/client' || /^\.\/probe\.js$|^probe\.js$/.test(s), 'unexpected script ' + s);
  assert.doesNotMatch(html, /<link\b[^>]*\bhref\s*=\s*["']https?:/i); assert.doesNotMatch(html + js, /@import|import\s*\(\s*["']https?:|from\s+["']https?:/);
  assert.match(html, /from\s+['"]\.\/probe\.js['"]/);
});

test('P20. source: no client secret, no storage, no HTML injection, no eval, no console, uses textContent', () => {
  const [html, js] = SRC(); const all = html + '\n' + js;
  assert.doesNotMatch(all, /client_secret|GOCSPX-|ya29\./i);
  const code = stripComments(all);
  assert.doesNotMatch(code, /\b(localStorage|sessionStorage|indexedDB|caches)\b|document\.cookie/);
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]|srcdoc/i);
  assert.doesNotMatch(code, /\bconsole\./);
  assert.match(code, /textContent/);
  assert.doesNotMatch(code, /localStorage|sessionStorage/);
});

test('P21. source: exactly the two readonly scopes, token-model calls only', () => {
  const [html, js] = SRC(); const all = html + '\n' + js; const code = stripComments(all);
  assert.ok(all.includes(SC1) && all.includes(SC2), 'both full scope URLs');
  assert.deepEqual([...new Set([...all.matchAll(/googlehealth\.[A-Za-z0-9_.]+/g)].map(m => m[0]))].sort(), ['googlehealth.activity_and_fitness.readonly', 'googlehealth.sleep.readonly']);
  assert.deepEqual([...new Set([...all.matchAll(/googleapis\.com\/auth\/[A-Za-z0-9_.\/-]+/g)].map(m => m[0]))].sort(), ['googleapis.com/auth/googlehealth.activity_and_fitness.readonly', 'googleapis.com/auth/googlehealth.sleep.readonly']);
  assert.doesNotMatch(code, /\bopenid\b|userinfo|auth\/(drive|calendar|fitness)\b|\bprofile\b.*scope/);
  assert.match(code, /initTokenClient/); assert.match(code, /requestAccessToken/); assert.match(code, /error_callback/);
  assert.doesNotMatch(code, /initCodeClient|oauth2\.googleapis\.com|response_type/);
});

test('P22. source: page has the contract ids, exact labels, the three endpoints and the request details', () => {
  const html = read(PAGE); const all = html + '\n' + read(PROBE);
  for (const id of ['clientId', 'signIn', 'showNumbers', 'copySummary', 'status', 'tokenInfo', 'gisError', 'check-identity', 'check-steps', 'check-sleep', 'summary'])
    assert.match(html, new RegExp('\\bid\\s*=\\s*["\']' + id + '["\']'), 'id ' + id);
  assert.match(html, />\s*Sign in with Google\s*</); assert.match(html, />\s*Copy result summary\s*</); assert.match(html, /show the numbers/);
  assert.match(html, /<input\b[^>]*\bid\s*=\s*["']clientId["'][^>]*>/); assert.match(html, /<input\b[^>]*\btype\s*=\s*["']checkbox["'][^>]*\bid\s*=\s*["']showNumbers["']|<input\b[^>]*\bid\s*=\s*["']showNumbers["'][^>]*\btype\s*=\s*["']checkbox["']/);
  for (const s of ['https://health.googleapis.com/v4', '/users/me/identity', '/users/me/dataTypes/steps/dataPoints:dailyRollUp', '/users/me/dataTypes/sleep/dataPoints:reconcile', 'windowSizeDays', 'page_size', 'Bearer', 'buildDailyRollUpBody', 'buildSleepUrl', 'summariseDailyRollUp', 'summariseSleep', 'resultSummary', 'describeError', 'Enter a Client ID first'])
    assert.ok(all.includes(s), 'missing ' + s);
  assert.match(all, /25/); assert.match(all, /navigator\.clipboard\.writeText/);
});

test('P23. the probe page is not shipped: not in sw.js, not referenced from the root index.html, js/ or css/', () => {
  const sw = read('sw.js'); assert.doesNotMatch(sw, /tools\/|google-health-probe|probe\.js/);
  assert.doesNotMatch(read('index.html'), /tools\/|google-health-probe/);
  for (const f of ['js/main.js', 'js/ui/settings.js']) if (exists(f)) assert.doesNotMatch(read(f), /google-health-probe/);
  for (const f of ['manifest.webmanifest', 'package.json']) if (exists(f)) assert.doesNotMatch(read(f), /google-health-probe/);
  assert.ok(exists(PAGE) && exists(PROBE), 'page and probe.js exist');
});

test('P24. setup doc has the required sections and content; DECISIONS has a probe entry', () => {
  assert.ok(exists(DOC), 'docs/GOOGLE-HEALTH-SETUP.md exists');
  const d = read(DOC);
  const heads = d.split('\n').filter(l => /^#{1,3}\s/.test(l)).join('\n').toLowerCase();
  for (const k of ['create a google cloud project', 'enable', 'consent screen', 'scopes', 'oauth client', 'google health', 'run the probe', 'what to expect', 'what to send back', 'delete'])
    assert.ok(heads.includes(k), 'heading about: ' + k);
  assert.ok(d.split('\n').filter(l => /^\s*\d+\.\s/.test(l)).length >= 8, 'numbered steps');
  for (const s of [SC1, SC2, 'http://localhost:8080', 'https://ahaselden.github.io', 'http://localhost:8080/tools/google-health-probe/', 'https://myaccount.google.com/permissions', 'npm start', 'Client ID', 'Web application', 'External', 'Testing', 'test user', 'not verified', 'Continue', '1 hour', 'refresh token'])
    assert.ok(d.includes(s) || d.toLowerCase().includes(s.toLowerCase()), 'doc mentions ' + s);
  assert.match(d, /\bdelete\b/i); assert.match(d, /\brevoke\b/i);
  assert.match(d, /secret[^\n]*never|never[^\n]*secret/i);
  assert.doesNotMatch(d, /GOCSPX-|ya29\.|client_secret\s*["':=]/i);
  assert.doesNotMatch(d, /[A-Za-z0-9-]{20,}\.apps\.googleusercontent\.com/); // no real Client ID pasted either
  const dec = read('docs/DECISIONS.md');
  assert.match(dec, /^## D\d+\..*google health.*probe|^## D\d+\..*probe.*google health/im, 'DECISIONS entry about the Google Health probe');
});
