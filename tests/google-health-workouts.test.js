// Spec: docs/specs/google-health-workouts.md (backlog item 24). Test-designer file, written BEFORE the implementation. All data is made up.
// Golden values are hand-computed (arithmetic in the comments). X1-X13 are pure domain tests of the exercise parser, the merge and the texts; V1-V4 test the
// Diary line formatter (domain/activity.js); Y1-Y9 use fakes for fetch / google (services/google-health-api.js); Z1-Z3 are round trips and WEAK source-text checks
// (they prove strings, imports and calls are present, not that the screens work: the headless checklist in the spec is the real UI test).
// Existing exports keep working; the few old assertions this change deliberately breaks are listed in the spec and edited in the old test files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { sanitizeActivityDay, defaults, SCHEMA_VERSION } from '../js/core/schema.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';

const read = p => { assert.ok(existsSync(new URL('../' + p, import.meta.url)), 'missing file: ' + p); return readFileSync(new URL('../' + p, import.meta.url), 'utf8'); };
const D = () => import('../js/domain/google-health-api.js');
const S = () => import('../js/services/google-health-api.js');
const A = () => import('../js/domain/activity.js');
const L = (y, m, d, h = 0) => new Date(y, m - 1, d, h, 0, 0); // LOCAL time, so the tests do not depend on the machine's timezone
const NOW = L(2026, 11, 16, 12);
const clone = o => JSON.parse(JSON.stringify(o));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
const ID = '123456-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com';
const TOKEN = 'ya29.test-token-abc';
const EMAIL = 'owner@example.com';
const SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const HEALTH = 'https://health.googleapis.com/v4/users/me';
const PFX = 'users/me/dataTypes/exercise/dataPoints/';
const FAILED = 'Workouts could not be read from Google Health.'; // the fixed text (spec "Decided here")
const EX_URL = d => `${HEALTH}/dataTypes/exercise/dataPoints?page_size=25&filter=exercise.interval.civil_start_time%20%3E%3D%20%22${d}%22`;

// ================================================================ builders
test('X1. buildExerciseFilter / buildExerciseUrl: quoted civil_start_time >= first day of the window, page_size=25, percent-encoded, optional pageToken, "" for an invalid now', async () => {
  const { buildExerciseFilter, buildExerciseUrl } = await D();
  assert.equal(buildExerciseFilter(NOW, 7), 'exercise.interval.civil_start_time >= "2026-11-10"'); // 16 - 6 = 10
  assert.equal(buildExerciseFilter(NOW), 'exercise.interval.civil_start_time >= "2026-11-10"');
  assert.equal(buildExerciseFilter(L(2026, 3, 1, 9), 3), 'exercise.interval.civil_start_time >= "2026-02-27"');
  assert.equal(buildExerciseFilter(NOW, 31), 'exercise.interval.civil_start_time >= "2026-10-17"');
  assert.equal(buildExerciseUrl(NOW, 7), EX_URL('2026-11-10'));
  assert.equal(buildExerciseUrl(NOW), EX_URL('2026-11-10'));
  assert.equal(buildExerciseUrl(L(2026, 12, 3, 9), 7), EX_URL('2026-11-27'));
  assert.equal(buildExerciseUrl(NOW, 7, 'abc/def='), EX_URL('2026-11-10') + '&pageToken=abc%2Fdef%3D');
  for (const bad of ['', undefined, null, 5, {}, []]) assert.equal(buildExerciseUrl(NOW, 7, bad), EX_URL('2026-11-10'), String(bad));
  for (const n of [null, undefined, 'x', new Date(NaN), 5]) { assert.equal(buildExerciseFilter(n, 7), ''); assert.equal(buildExerciseUrl(n, 7), ''); }
  const t = NOW.getTime(); buildExerciseUrl(NOW, 7); assert.equal(NOW.getTime(), t);
});

// ================================================================ the exercise parser
// A realistic record (field layout of the owner's real run, invented values). Start 18:07:37Z at -5 h = 13:07:37 on 2026-11-14.
const base = () => ({
  name: PFX + 'TEST-ID-1',
  dataSource: { device: { displayName: 'Test Watch', formFactor: 'WATCH' }, platform: 'FITBIT', recordingMethod: 'ACTIVELY_MEASURED' },
  exercise: {
    exerciseType: 'RUNNING', displayName: 'Run',
    interval: { startTime: '2026-11-14T18:07:37Z', startUtcOffset: '-18000s', endTime: '2026-11-14T18:40:37Z', endUtcOffset: '-18000s' }, // 33 min wall clock
    activeDuration: '1860s',                                                                                                            // 31 min active
    createTime: '2026-11-14T18:41:00Z', updateTime: '2026-11-14T18:41:00Z',
    exerciseEvents: [{ eventTime: '2026-11-14T18:07:37Z', eventUtcOffset: '-18000s', exerciseEventType: 'START' }],
    exerciseMetadata: { hasGps: true },
    metricsSummary: { caloriesKcal: 312.4, distanceMillimeters: 4200400, steps: '5120', averageHeartRateBeatsPerMinute: '148', activeZoneMinutes: '22',
      averagePaceSecondsPerMeter: 0.43, elevationGainMillimeters: 12000, heartRateZoneDurations: { lightTime: '60s', moderateTime: '900s', vigorousTime: '600s', peakTime: '0s' },
      mobilityMetrics: { avgStrideLengthMillimeters: '1100' } },
    splits: [{ splitType: 'DISTANCE', startTime: '2026-11-14T18:07:37Z', startUtcOffset: '-18000s', endTime: '2026-11-14T18:17:37Z', endUtcOffset: '-18000s', activeDuration: '600s', metricsSummary: { averagePaceSecondsPerMeter: 0.4, distanceMillimeters: 1500000 } }],
  },
});
/** base() with the value at a dotted path replaced (undefined deletes the key). */
const set = (path, value, rec = base()) => {
  const p = path.split('.'); let o = rec;
  for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
  if (value === undefined) delete o[p[p.length - 1]]; else o[p[p.length - 1]] = value;
  return rec;
};
const P = async () => { const f = (await D()).parseExerciseAnswer; assert.equal(typeof f, 'function', 'parseExerciseAnswer is not exported by js/domain/google-health-api.js'); return f; };
const ans = (...recs) => ({ dataPoints: recs, nextPageToken: '' });
const one = async rec => (await P())(ans(rec));
/** The single workout of a one-record answer (any day), or null. */
const w1 = async rec => { const d = await one(rec); const k = Object.keys(d); return k.length ? d[k[0]][0] : null; };
const fixed = list => assert.deepEqual(sanitizeActivityDay({ source: 'google-health', updatedAt: 1, workouts: list }).workouts, list, 'every parsed workout is a fixed point of sanitizeActivityDay');

const RUN_REC = base();
const RUN_W = { id: 'TEST-ID-1', name: 'Run', start: '2026-11-14T18:07:37Z', minutes: 31, kcal: 312, steps: 5120, distanceM: 4200, avgHr: 148 }; // 1860 s = 31 min; 312.4 -> 312; 4200400 mm = 4200.4 m -> 4200
// A session with no GPS, no distance, no display name: start 01:30Z on the 15th at -5 h = 20:30 on the 14th (the offset moves it to the PREVIOUS day).
const SPORT_REC = { name: PFX + 'TEST-ID-2', exercise: { exerciseType: 'SPORT', displayName: '', interval: { startTime: '2026-11-15T01:30:00Z', startUtcOffset: '-18000s', endTime: '2026-11-15T02:00:00Z', endUtcOffset: '-18000s' },
  metricsSummary: { caloriesKcal: 150, averageHeartRateBeatsPerMinute: '121' } } };
const SPORT_W = { id: 'TEST-ID-2', name: 'Sport', start: '2026-11-15T01:30:00Z', minutes: 30, kcal: 150, avgHr: 121 }; // no activeDuration: 02:00 - 01:30 = 30 min
const WALK_REC = { name: PFX + 'TEST-ID-3', exercise: { exerciseType: 'WALKING', interval: { startTime: '2026-11-16T14:00:00Z', startUtcOffset: '-18000s', endTime: '2026-11-16T14:20:00Z', endUtcOffset: '-18000s' },
  activeDuration: '1200s', metricsSummary: { caloriesKcal: 95.4, distanceMillimeters: 1700000, steps: '2400' } } };
const WALK_W = { id: 'TEST-ID-3', name: 'Walking', start: '2026-11-16T14:00:00Z', minutes: 20, kcal: 95, steps: 2400, distanceM: 1700 };
const GOLD = { '2026-11-14': [RUN_W, SPORT_W], '2026-11-16': [WALK_W] };

test('X2. parseExerciseAnswer golden: three sessions -> per LOCAL start day, mapped fields only (peakHr, pace, zones, splits and the rest are never copied), absent metrics are absent keys', async () => {
  const parse = await P();
  assert.deepEqual(parse(ans(RUN_REC, SPORT_REC, WALK_REC)), GOLD);
  for (const order of [[WALK_REC, SPORT_REC, RUN_REC], [SPORT_REC, WALK_REC, RUN_REC]]) assert.deepEqual(parse(ans(...order)), GOLD, 'order of the answer does not matter');
  for (const list of Object.values(parse(ans(RUN_REC, SPORT_REC, WALK_REC)))) {
    fixed(list);
    for (const w of list) { assert.deepEqual(Object.keys(w).filter(k => !['id', 'name', 'start', 'minutes', 'kcal', 'steps', 'distanceM', 'avgHr'].includes(k)), []); for (const [k, v] of Object.entries(w)) assert.notEqual(v, undefined, k); }
  }
  assert.equal('peakHr' in parse(ans(RUN_REC))['2026-11-14'][0], false);
  assert.equal('distanceM' in parse(ans(SPORT_REC))['2026-11-14'][0], false, 'no distance recorded is not 0 m');
  assert.equal('steps' in parse(ans(SPORT_REC))['2026-11-14'][0], false);
  const t = clone(ans(RUN_REC)); parse(t); assert.deepEqual(t, ans(RUN_REC), 'input not mutated');
});

test('X3. id: the last segment of `name`; a record without a usable name gets a derived id that is stable, valid (1..80) and different for a different start', async () => {
  const parse = await P();
  assert.equal((await w1(set('name', PFX + 'TEST-ID-9'))).id, 'TEST-ID-9');
  assert.equal((await w1(set('name', 'TEST-ID-9'))).id, 'TEST-ID-9', 'a name with no slash is its own last segment');
  assert.equal((await w1(set('name', 'users/me/dataTypes/exercise/dataPoints/a.b_c-d=='))).id, 'a.b_c-d==');
  for (const noName of [undefined, null, 5, {}, [], true]) {
    const a = await w1(set('name', noName)), b = await w1(set('name', noName));
    assert.ok(a, 'kept with a derived id: ' + String(noName));
    assert.equal(typeof a.id, 'string'); assert.ok(a.id.length >= 1 && a.id.length <= 80, 'length 1..80'); assert.equal(a.id, b.id, 'the same record gives the same id every time');
    assert.notEqual(a.id, 'TEST-ID-1'); fixed([a]);
    const other = await w1(set('exercise.interval.startTime', '2026-11-14T19:07:37Z', set('name', noName)));
    assert.notEqual(other.id, a.id, 'a different start gives a different derived id');
  }
  // two records without names and different starts are both kept (the derived ids differ)
  const r2 = set('exercise.interval.startTime', '2026-11-14T19:07:37Z', set('name', undefined)), r1 = set('name', undefined);
  assert.equal(parse(ans(r1, r2))['2026-11-14'].length, 2);
  // an over-long id is either skipped or made valid; it never produces an invalid workout (open question 2)
  const long = parse(ans(set('name', PFX + 'x'.repeat(200))));
  for (const list of Object.values(long)) fixed(list);
});

test('X4. name: displayName when it is a non-empty plain string (control characters removed, trimmed, cut at 60), else a label from exerciseType, else "Workout"; markup is kept as TEXT', async () => {
  const name = async (display, ...rest) => (await w1(set('exercise.exerciseType', rest.length ? rest[0] : 'RUNNING', set('exercise.displayName', display)))).name;   // an explicit undefined type deletes the key
  assert.equal(await name('Morning run'), 'Morning run');
  assert.equal(await name('  Spaced  '), 'Spaced');
  assert.equal(await name('x'.repeat(100)), 'x'.repeat(60));
  assert.equal(await name('Run\u0007ning'), 'Running', 'control characters are removed');
  assert.equal(await name('Morning\nrun'), 'Morningrun', 'a newline is a control character and is removed, as the saved-shape rule does');
  assert.equal(await name('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>', 'kept as plain text; escaping happens when it is drawn');
  assert.equal(await name('<b>Run</b> & "go"'), '<b>Run</b> & "go"');
  for (const empty of ['', '   ', '\u0007\u0000', undefined, null, 5, true, {}, ['Run'], NaN]) assert.equal(await name(empty), 'Running', 'label from the type for ' + JSON.stringify(empty));
  assert.equal(await name('', 'SPORT'), 'Sport');
  assert.equal(await name('', 'WALKING'), 'Walking');
  assert.equal(await name('', 'WORKOUT'), 'Workout');
  assert.equal(await name('', 'HIGH_INTENSITY_X'), 'High intensity x');
  assert.equal(await name('', 'OUTDOOR_BIKE_RIDE'), 'Outdoor bike ride');
  for (const badType of [undefined, null, 5, {}, '', '<b>x</b>', 'run ning', 'running ', 'x'.repeat(500)]) assert.equal(await name('', badType), 'Workout', 'no usable type: ' + JSON.stringify(badType));
  assert.equal(await name('Own name', 'SPORT'), 'Own name', 'displayName wins over the type');
  fixed([await w1(set('exercise.displayName', '<b>x\u0007</b>'))]);
});

test('X5. start: interval.startTime as UTC text YYYY-MM-DDTHH:MM:SSZ (fraction dropped, never rounded); an unusable start or a missing / unusable start offset skips the record, its siblings stay', async () => {
  const parse = await P();
  assert.equal((await w1(set('exercise.interval.startTime', '2026-11-14T18:07:37.999Z'))).start, '2026-11-14T18:07:37Z');
  assert.equal((await w1(set('exercise.interval.startTime', '2026-11-14T18:07:37.5Z'))).start, '2026-11-14T18:07:37Z');
  for (const bad of ['not a time', '2026-11-14 18:07:37Z', '2026-11-14T18:07:37+01:00', '2026-11-14T18:07:37', '2026-13-14T18:07:37Z', '2026-02-30T18:07:37Z', '2026-11-14T25:07:37Z', '', 5, null, undefined, {}, []])
    assert.deepEqual(await one(set('exercise.interval.startTime', bad)), {}, 'start ' + JSON.stringify(bad));
  for (const bad of ['-18000', '1.5s', '90000s', '-90000s', 'abc', '', '+3600s', 3600, null, undefined])
    assert.deepEqual(await one(set('exercise.interval.startUtcOffset', bad)), {}, 'start offset ' + JSON.stringify(bad) + ' (never guessed as 0)');
  for (const bad of [undefined, null, 5, 'x', []]) assert.deepEqual(await one(set('exercise.interval', bad)), {}, 'interval ' + JSON.stringify(bad));
  assert.deepEqual(parse(ans(set('exercise.interval.startTime', 'x'), RUN_REC)), { '2026-11-14': [RUN_W] }, 'an invalid record does not remove its valid sibling');
  // the END of the interval is optional (the active duration is enough)
  assert.deepEqual(await w1(set('exercise.interval.endTime', undefined)), RUN_W);
  assert.deepEqual(await w1(set('exercise.interval.endUtcOffset', undefined)), RUN_W);
});

test('X6. the day is the LOCAL day the session STARTS on (start UTC + start offset): earlier day, midnight, later day, month / year / leap rollover; the START offset decides, not the end offset', async () => {
  const day = async (start, so) => { const d = await one(set('exercise.interval.startUtcOffset', so, set('exercise.interval.startTime', start))); const k = Object.keys(d); assert.equal(k.length, 1, start + ' ' + so); return k[0]; };
  assert.equal(await day('2026-11-15T02:30:00Z', '-18000s'), '2026-11-14');   // 21:30 on the 14th
  assert.equal(await day('2026-11-15T05:00:00Z', '-18000s'), '2026-11-15');   // exactly local midnight is the new day
  assert.equal(await day('2026-11-15T04:59:59Z', '-18000s'), '2026-11-14');   // one second earlier is not
  assert.equal(await day('2026-11-14T23:30:00Z', '3600s'), '2026-11-15');     // 00:30 on the 15th
  assert.equal(await day('2026-11-14T16:00:00Z', '0s'), '2026-11-14');
  assert.equal(await day('2026-12-31T23:30:00Z', '3600s'), '2027-01-01');
  assert.equal(await day('2026-03-01T00:30:00Z', '-3600s'), '2026-02-28');    // 2026 is not a leap year
  assert.equal(await day('2028-03-01T00:30:00Z', '-3600s'), '2028-02-29');    // 2028 is
  assert.equal(await day('2026-11-01T04:30:00Z', '-14400s'), '2026-11-01');   // start offset -4 h = 00:30 on 1 Nov; the END offset (-5 h) would say 31 Oct
  const r = set('exercise.interval.endUtcOffset', '-18000s', set('exercise.interval.endTime', '2026-11-01T05:10:00Z', set('exercise.interval.startUtcOffset', '-14400s', set('exercise.interval.startTime', '2026-11-01T04:30:00Z'))));
  assert.deepEqual(Object.keys(await one(r)), ['2026-11-01']);
});

test('X7. minutes: active duration (a protobuf Duration like "1860s" or "1590.5s") rounded to the nearest minute (.5 up), else the interval length; an unusable duration falls back to the interval; nothing usable gives 0', async () => {
  const mins = async over => (await w1(over)).minutes;
  assert.equal(await mins(base()), 31, 'duration 1860 s wins over the 33 minute interval');
  assert.equal(await mins(set('exercise.activeDuration', '1590s')), 27, '1590 s = 26.5 min -> 27');
  assert.equal(await mins(set('exercise.activeDuration', '1569s')), 26, '26.15 min -> 26');
  assert.equal(await mins(set('exercise.activeDuration', '1585.5s')), 26, '26.425 min -> 26');
  assert.equal(await mins(set('exercise.activeDuration', '1589.9s')), 26, '26.498 min -> 26');
  assert.equal(await mins(set('exercise.activeDuration', undefined)), 33, '18:07:37 -> 18:40:37 = 33 min');
  for (const bad of ['abc', '', '-5s', 'sec', {}, null, ['60s'], '1e3s ', 'NaNs']) assert.equal(await mins(set('exercise.activeDuration', bad)), 33, 'unusable duration ' + JSON.stringify(bad) + ' -> interval');
  assert.equal(await mins(set('exercise.activeDuration', '90000s')), 33, 'a duration over 1440 minutes is not clamped: the interval is used (decided here)');
  const none = set('exercise.interval.endTime', undefined, set('exercise.activeDuration', undefined));
  assert.equal(await mins(none), 0, 'no duration and no end: 0 minutes, the workout is still kept');
  assert.equal('kcal' in (await w1(none)), true);
  assert.equal(await mins(set('exercise.interval.endTime', 'junk', set('exercise.activeDuration', undefined))), 0);
});

test('X8. metrics: numbers and digit strings both work (kcal 312.4 -> 312, 312.6 -> 313, mm -> m rounded); out of range is DROPPED never clamped; absent or junk metrics are absent keys, never 0', async () => {
  const m = async (field, v) => { const w = await w1(set('exercise.metricsSummary.' + field, v)); assert.ok(w, 'the workout itself is kept'); return w; };
  // kcal 0..20000, round
  assert.equal((await m('caloriesKcal', 312.4)).kcal, 312); assert.equal((await m('caloriesKcal', 312.6)).kcal, 313); assert.equal((await m('caloriesKcal', '312')).kcal, 312);
  assert.equal((await m('caloriesKcal', 0)).kcal, 0, 'an explicit 0 is data'); assert.equal((await m('caloriesKcal', 20000)).kcal, 20000);
  for (const bad of [20001, 1e9, -1, -0.6, NaN, Infinity, -Infinity, 'abc', '', '-5', null, true, {}, [5], undefined]) assert.equal('kcal' in await m('caloriesKcal', bad), false, 'kcal ' + String(bad));
  // distance: millimetres -> whole metres, 0..1,000,000 m
  assert.equal((await m('distanceMillimeters', 4234567)).distanceM, 4235, '4234.567 m -> 4235'); assert.equal((await m('distanceMillimeters', '4200000')).distanceM, 4200);
  assert.equal((await m('distanceMillimeters', 1000000000)).distanceM, 1000000, 'exactly 1,000,000 m is allowed');
  for (const bad of [1001000000, 1e15, -1000, NaN, Infinity, 'abc', '', null, true, {}, undefined]) assert.equal('distanceM' in await m('distanceMillimeters', bad), false, 'distance ' + String(bad));
  // steps 0..200000, number or digit string
  assert.equal((await m('steps', '5120')).steps, 5120); assert.equal((await m('steps', 5120)).steps, 5120); assert.equal((await m('steps', '200000')).steps, 200000); assert.equal((await m('steps', '0')).steps, 0);
  for (const bad of ['200001', 200001, '-5', -5, 'x', '', ' 12', NaN, Infinity, null, true, {}, undefined]) assert.equal('steps' in await m('steps', bad), false, 'steps ' + String(bad));
  // average heart rate 20..300
  assert.equal((await m('averageHeartRateBeatsPerMinute', '148')).avgHr, 148); assert.equal((await m('averageHeartRateBeatsPerMinute', 148)).avgHr, 148);
  assert.equal((await m('averageHeartRateBeatsPerMinute', '20')).avgHr, 20); assert.equal((await m('averageHeartRateBeatsPerMinute', '300')).avgHr, 300);
  for (const bad of ['19', '301', '0', 0, 19, 301, '-148', -1, 'x', '', NaN, Infinity, null, {}, undefined]) assert.equal('avgHr' in await m('averageHeartRateBeatsPerMinute', bad), false, 'avgHr ' + String(bad));
  // a whole summary missing or not an object: the workout is kept without metrics
  for (const bad of [undefined, null, 'x', 5, [], true]) {
    const w = await w1(set('exercise.metricsSummary', bad));
    assert.deepEqual(w, { id: 'TEST-ID-1', name: 'Run', start: '2026-11-14T18:07:37Z', minutes: 31 }, 'metricsSummary ' + JSON.stringify(bad));
  }
  // each metric is independent: a bad kcal does not drop a good distance
  const mixed = await w1(set('exercise.metricsSummary.caloriesKcal', -5));
  const { kcal: _k, ...noKcal } = RUN_W; assert.deepEqual(mixed, noKcal);
  // the metric names must be OWN properties
  const inherited = set('exercise.metricsSummary', Object.create({ caloriesKcal: 99, steps: '7' }));
  assert.deepEqual(await w1(inherited), { id: 'TEST-ID-1', name: 'Run', start: '2026-11-14T18:07:37Z', minutes: 31 });
});

test('X9. per day: sorted by start then id, the same id appears once, two sessions in the same minute are both kept, at most 20 a day (the EARLIEST)', async () => {
  const parse = await P();
  const at = (id, iso) => set('exercise.interval.startTime', iso, set('name', PFX + id));
  // sorted by start whatever the answer order
  const a = at('a', '2026-11-14T15:00:00Z'), b = at('b', '2026-11-14T16:00:00Z'), c = at('c', '2026-11-14T17:00:00Z');
  for (const order of [[a, b, c], [c, b, a], [b, c, a]]) assert.deepEqual(parse(ans(...order))['2026-11-14'].map(w => w.id), ['a', 'b', 'c']);
  // the same minute (identical start): both kept, ordered by id
  const s1 = at('b-id', '2026-11-14T15:00:00Z'), s2 = at('a-id', '2026-11-14T15:00:00Z');
  assert.deepEqual(parse(ans(s1, s2))['2026-11-14'].map(w => w.id), ['a-id', 'b-id']); assert.deepEqual(parse(ans(s2, s1))['2026-11-14'].map(w => w.id), ['a-id', 'b-id']);
  // the same id twice (a second page repeating a record): one workout
  const dup = parse(ans(a, a, at('a', '2026-11-14T15:00:00Z'), b));
  assert.deepEqual(Object.values(dup).flat().filter(w => w.id === 'a').length, 1); assert.equal(Object.values(dup).flat().length, 2);
  const dupOtherDay = parse(ans(a, at('a', '2026-11-15T15:00:00Z')));
  assert.equal(Object.values(dupOtherDay).flat().filter(w => w.id === 'a').length, 1, 'one id is one workout, whatever day the copies claim');
  // 25 sessions on one day, given latest first: the earliest 20 stay, in order (10:00 .. 10:24 local; 15:MM:00Z at -5 h)
  const many = Array.from({ length: 25 }, (_, i) => at('T' + String(i).padStart(2, '0'), `2026-11-14T15:${String(i).padStart(2, '0')}:00Z`));
  const got = parse(ans(...[...many].reverse()));
  assert.deepEqual(got['2026-11-14'].map(w => w.id), many.slice(0, 20).map((_, i) => 'T' + String(i).padStart(2, '0')));
  fixed(got['2026-11-14']);
  // the cap is per day: 20 on one day and 3 on the next both stay
  const next = ['x', 'y', 'z'].map((id, i) => at(id, `2026-11-15T15:0${i}:00Z`));
  const two = parse(ans(...many.slice(0, 20), ...next)); assert.equal(two['2026-11-14'].length, 20); assert.equal(two['2026-11-15'].length, 3);
});

test('X10. parseExerciseAnswer hostile input: never throws, junk gives {}, own properties only, __proto__ is not data, getters that throw skip only that item, frozen input untouched, plain output', async () => {
  const parse = await P();
  for (const j of [undefined, null, 'x', 1, true, [], {}, { dataPoints: 'x' }, { dataPoints: null }, { dataPoints: {} }, { dataPoints: [null, 1, 'x', [], undefined, true] },
    { dataPoints: [{ exercise: 5 }, { exercise: null }, { exercise: [] }, { exercise: 'x' }, {}, { name: PFX + 'a' }] }]) assert.deepEqual(parse(j), {}, JSON.stringify(j));
  const proto = JSON.parse('{"__proto__":{"dataPoints":[' + JSON.stringify(RUN_REC) + ']}}');
  assert.deepEqual(parse(proto), {});
  assert.deepEqual(parse(Object.create({ dataPoints: [RUN_REC] })), {}, 'inherited dataPoints is not data');
  assert.deepEqual(parse(ans(Object.assign(Object.create({ exercise: RUN_REC.exercise }), { name: PFX + 'a' }))), {}, 'inherited exercise is not data');
  assert.equal(({}).polluted, undefined);
  const evil = JSON.parse('{"name":"' + PFX + 'e1","exercise":{"__proto__":{"polluted":1},"exerciseType":"RUNNING","interval":{"startTime":"2026-11-14T18:07:37Z","startUtcOffset":"0s"},"metricsSummary":{"__proto__":{"caloriesKcal":999},"caloriesKcal":5}}}');
  assert.deepEqual(parse(ans(evil)), { '2026-11-14': [{ id: 'e1', name: 'Running', start: '2026-11-14T18:07:37Z', minutes: 0, kcal: 5 }] });
  assert.equal(({}).polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
  const boom = Object.defineProperty({}, 'dataPoints', { enumerable: true, get() { throw new Error('boom'); } });
  assert.deepEqual(parse(boom), {});
  const bad = Object.defineProperty({ name: PFX + 'q' }, 'exercise', { enumerable: true, get() { throw new Error('boom'); } });
  assert.deepEqual(parse(ans(bad, RUN_REC)), { '2026-11-14': [RUN_W] }, 'an item with a throwing getter is skipped, its sibling stays');
  assert.deepEqual(parse({ dataPoints: new Array(50000).fill({ exercise: 1 }) }), {});
  assert.deepEqual(parse({ dataPoints: new Array(50000).fill(null) }), {});
  const frozen = deepFreeze(clone(ans(RUN_REC, SPORT_REC, WALK_REC))), snap = clone(frozen);
  assert.deepEqual(parse(frozen), GOLD); assert.deepEqual(frozen, snap);
  const out = parse(ans(RUN_REC, WALK_REC));
  assert.equal(Object.getPrototypeOf(out), Object.prototype); for (const k of Object.keys(out)) assert.match(k, /^\d{4}-\d{2}-\d{2}$/);
  // numbers that are not numbers, in every metric, never reach the output
  const weird = set('exercise.metricsSummary', { caloriesKcal: { valueOf: () => 5 }, distanceMillimeters: [5000], steps: new Number(5), averageHeartRateBeatsPerMinute: '1e2' });
  assert.deepEqual(await w1(weird), { id: 'TEST-ID-1', name: 'Run', start: '2026-11-14T18:07:37Z', minutes: 31 });
});

test('X11. parseHealthAnswers(steps, sleep, exercise): the third argument adds `workouts` per day; a day with only workouts appears; the two-argument call is unchanged', async () => {
  const { parseHealthAnswers } = await D();
  const pt = (d, count) => ({ civilStartTime: { date: { year: 2026, month: 11, day: d }, time: {} }, steps: { countSum: count } });
  const stepsAns = { rollupDataPoints: [pt(16, '1226'), pt(14, '12921')] };
  const sleepRec = { sleep: { interval: { startTime: '2026-11-14T03:30:00Z', startUtcOffset: '-18000s', endTime: '2026-11-14T11:30:00Z', endUtcOffset: '-18000s' }, summary: { minutesAsleep: '435' } } };
  const sleepAns = { dataPoints: [sleepRec] };
  const two = parseHealthAnswers(stepsAns, sleepAns);
  assert.deepEqual(two, { '2026-11-16': { steps: 1226 }, '2026-11-14': { steps: 12921, sleepMinutes: 435, sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z' } });
  for (const third of [undefined, null, {}, 'x', 5, [], { dataPoints: [] }, { dataPoints: 'x' }]) assert.deepEqual(parseHealthAnswers(stepsAns, sleepAns, third), two, 'no workouts: ' + JSON.stringify(third));
  const three = parseHealthAnswers(stepsAns, sleepAns, ans(RUN_REC, SPORT_REC, WALK_REC));
  assert.deepEqual(three, { '2026-11-16': { steps: 1226, workouts: [WALK_W] }, '2026-11-14': { steps: 12921, sleepMinutes: 435, sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z', workouts: [RUN_W, SPORT_W] } });
  // a day that has only workouts
  assert.deepEqual(parseHealthAnswers(null, null, ans(RUN_REC)), { '2026-11-14': { workouts: [RUN_W] } });
  assert.deepEqual(parseHealthAnswers({}, {}, {}), {});
  for (const v of Object.values(three)) for (const [k, x] of Object.entries(v)) assert.notEqual(x, undefined, k + ' must be absent, not undefined');
  assert.equal(Object.keys(parseHealthAnswers(null, null, ans(RUN_REC)))[0].length, 10);
  for (const j of [undefined, null, 'x', {}, [], { dataPoints: [null] }]) assert.deepEqual(parseHealthAnswers(j, j, j), {});
  assert.doesNotThrow(() => parseHealthAnswers(stepsAns, sleepAns, Object.defineProperty({}, 'dataPoints', { get() { throw new Error('x'); } })));
});

// ================================================================ applyHealthSync: replace per day
const ZIP_W = { id: 'zip-1', name: 'Run', start: '2026-11-14T18:07:00Z', minutes: 31, kcal: 300, steps: 5100, distanceM: 4150, avgHr: 147, peakHr: 170 }; // a Takeout-style workout
const ZIP_W15 = { id: 'zip-2', name: 'Walk', start: '2026-11-15T13:00:00Z', minutes: 40 };
const stored = () => ({ updatedAt: 1000, source: 'google-health', steps: 5000, sleepMinutes: 300, sleepStart: '2026-11-14T03:00:00Z', sleepEnd: '2026-11-14T08:00:00Z', workouts: [clone(ZIP_W)] });

test('X12. applyHealthSync REPLACES a day\'s stored workouts when the API has some for it (the zip workout is not shown twice); other days, steps and sleep keep their own rules', async () => {
  const { applyHealthSync } = await D();
  const state = () => ({ activity: { '2026-11-14': stored(), '2026-11-15': { updatedAt: 1000, source: 'google-health', workouts: [clone(ZIP_W15)] }, '2026-10-01': { updatedAt: 1, source: 'google-health', workouts: [clone(ZIP_W15)] } } });
  // the API has two for the 14th: the stored zip workout is gone (peakHr with it), steps and sleep stay
  const s = state();
  assert.deepEqual(applyHealthSync(s, { '2026-11-14': { workouts: [RUN_W, SPORT_W] } }, 9000), { added: 0, updated: 1, unchanged: 0 });
  assert.deepEqual(s.activity['2026-11-14'], { updatedAt: 9000, source: 'google-health', steps: 5000, sleepMinutes: 300, sleepStart: '2026-11-14T03:00:00Z', sleepEnd: '2026-11-14T08:00:00Z', workouts: [RUN_W, SPORT_W] });
  assert.deepEqual(s.activity['2026-11-15'], state().activity['2026-11-15'], 'a day the API says nothing about keeps its workouts');
  assert.deepEqual(s.activity['2026-10-01'], state().activity['2026-10-01'], 'a day outside the answer is untouched');
  // steps and workouts of the same day are independent fields of the same answer
  const s2 = state(); applyHealthSync(s2, { '2026-11-14': { steps: 12921, workouts: [RUN_W] }, '2026-11-15': { steps: 7 } }, 9000);
  assert.deepEqual(s2.activity['2026-11-14'], { updatedAt: 9000, source: 'google-health', steps: 12921, sleepMinutes: 300, sleepStart: '2026-11-14T03:00:00Z', sleepEnd: '2026-11-14T08:00:00Z', workouts: [RUN_W] });
  assert.deepEqual(s2.activity['2026-11-15'], { updatedAt: 9000, source: 'google-health', steps: 7, workouts: [ZIP_W15] }, 'steps only: the stored workouts stay');
  // an empty list, junk or nothing usable is "the API had none": the stored workouts stay
  for (const none of [[], 'x', {}, null, [null, 5, 'x', []], [{ id: '', name: 'n', start: '2026-11-14T18:07:37Z', minutes: 1 }], [{ id: 'q', name: 'n', start: 'bad', minutes: 1 }]]) {
    const s3 = state(), res = applyHealthSync(s3, { '2026-11-14': { steps: 5000, workouts: none } }, 9000);
    assert.deepEqual(res, { added: 0, updated: 0, unchanged: 1 }, JSON.stringify(none)); assert.deepEqual(s3.activity['2026-11-14'], state().activity['2026-11-14'], JSON.stringify(none));
    const s4 = state(), res4 = applyHealthSync(s4, { '2026-11-14': { workouts: none } }, 9000);
    assert.deepEqual(res4, { added: 0, updated: 0, unchanged: 0 }, 'a day with nothing usable at all writes nothing: ' + JSON.stringify(none)); assert.deepEqual(s4, state());
  }
  // a day that exists only in the answer, and a day with workouts but no stored record
  const s5 = { activity: {} };
  assert.deepEqual(applyHealthSync(s5, { '2026-11-14': { workouts: [RUN_W] }, '2026-11-16': { steps: 1226, workouts: [WALK_W] } }, 9000), { added: 2, updated: 0, unchanged: 0 });
  assert.deepEqual(s5.activity['2026-11-14'], { updatedAt: 9000, source: 'google-health', workouts: [RUN_W] });
  assert.deepEqual(s5.activity['2026-11-16'], { updatedAt: 9000, source: 'google-health', steps: 1226, workouts: [WALK_W] });
  // the same id as a stored workout is not duplicated (replacement, not append)
  const s6 = { activity: { '2026-11-14': { updatedAt: 1000, source: 'google-health', workouts: [{ ...RUN_W, kcal: 1 }] } } };
  applyHealthSync(s6, { '2026-11-14': { workouts: [RUN_W] } }, 9000); assert.deepEqual(s6.activity['2026-11-14'].workouts, [RUN_W]);
  // at most 20 a day
  const twentyFive = Array.from({ length: 25 }, (_, i) => ({ id: 'T' + String(i).padStart(2, '0'), name: 'Run', start: `2026-11-14T15:${String(i).padStart(2, '0')}:00Z`, minutes: 1 }));
  const s7 = { activity: {} }; applyHealthSync(s7, { '2026-11-14': { workouts: twentyFive } }, 9000);
  assert.deepEqual(s7.activity['2026-11-14'].workouts.map(w => w.id), twentyFive.slice(0, 20).map(w => w.id));
});

test('X13. applyHealthSync workouts: equal content writes nothing (stamp not bumped, object not replaced), a changed field bumps only that day, junk is dropped, every record is a fixed point, inputs are not aliased or mutated', async () => {
  const { applyHealthSync } = await D();
  const state = { activity: { '2026-11-15': { updatedAt: 1000, source: 'google-health', workouts: [clone(ZIP_W15)] } }, days: { x: [1] }, goals: { k: 1 } };
  const days = { '2026-11-14': { steps: 12921, workouts: [RUN_W, SPORT_W] }, '2026-11-16': { workouts: [WALK_W] } };
  assert.deepEqual(applyHealthSync(state, clone(days), 5000), { added: 2, updated: 0, unchanged: 0 });
  const before = clone(state), obj14 = state.activity['2026-11-14'];
  assert.deepEqual(applyHealthSync(state, clone(days), 9000), { added: 0, updated: 0, unchanged: 2 });
  assert.equal(JSON.stringify(state), JSON.stringify(before)); assert.equal(state.activity['2026-11-14'], obj14); assert.equal(state.activity['2026-11-14'].updatedAt, 5000);
  // the stored copy has another key order: still equal
  const st = { activity: { '2026-11-16': { workouts: [{ avgHr: undefined, steps: 2400, distanceM: 1700, kcal: 95, minutes: 20, start: WALK_W.start, name: 'Walking', id: 'TEST-ID-3' }], source: 'google-health', updatedAt: 1000 } } };
  assert.deepEqual(applyHealthSync(st, { '2026-11-16': { workouts: [WALK_W] } }, 9000), { added: 0, updated: 0, unchanged: 1 }); assert.equal(st.activity['2026-11-16'].updatedAt, 1000);
  // one field changes: that day is written, the stamp is bumped, the other day is not
  const res = applyHealthSync(state, { '2026-11-14': { steps: 12921, workouts: [RUN_W, { ...SPORT_W, kcal: 151 }] }, '2026-11-16': { workouts: [WALK_W] } }, 11000);
  assert.deepEqual(res, { added: 0, updated: 1, unchanged: 1 });
  assert.equal(state.activity['2026-11-14'].updatedAt, 11000); assert.equal(state.activity['2026-11-14'].workouts[1].kcal, 151); assert.equal(state.activity['2026-11-16'].updatedAt, 5000);
  assert.deepEqual(state.days, { x: [1] }); assert.deepEqual(state.goals, { k: 1 });
  // junk next to good workouts: only the good ones arrive; the record is a fixed point of sanitizeActivityDay
  const junky = [null, 5, 'x', [], { id: '', name: 'n', start: '2026-11-14T18:07:37Z', minutes: 1 }, { id: 'k', name: 'n', start: 'bad', minutes: 1 }, { ...RUN_W, kcal: 99999, distanceM: -1, avgHr: 5, evil: 'x' }, { ...SPORT_W, id: RUN_W.id }];
  const sj = { activity: {} }; applyHealthSync(sj, { '2026-11-14': { workouts: junky } }, 5000);
  assert.deepEqual(sj.activity['2026-11-14'].workouts, [{ id: 'TEST-ID-1', name: 'Run', start: '2026-11-14T18:07:37Z', minutes: 31, steps: 5120 }], 'out of range dropped (not clamped), unknown keys dropped, the repeated id keeps the first');
  for (const r of [...Object.values(state.activity), ...Object.values(sj.activity)]) assert.deepEqual(sanitizeActivityDay(r), r);
  // a frozen answer is fine; the stored workouts are copies, not the answer's objects
  const frozen = deepFreeze(clone(days)), snap = clone(frozen), s2 = { activity: {} };
  applyHealthSync(s2, frozen, 5000); assert.deepEqual(frozen, snap);
  assert.notEqual(s2.activity['2026-11-14'].workouts[0], frozen['2026-11-14'].workouts[0]);
  // prototype keys inside a workout and inside days are no data
  const evil = JSON.parse('{"2026-11-14":{"workouts":[{"__proto__":{"polluted":1},"id":"p","name":"n","start":"2026-11-14T18:07:37Z","minutes":1}]},"__proto__":{"workouts":[{"id":"z","name":"n","start":"2026-11-14T18:07:37Z","minutes":1}]}}');
  const s3 = { activity: {} }; applyHealthSync(s3, evil, 5000);
  assert.deepEqual(Object.keys(s3.activity), ['2026-11-14']); assert.equal(({}).polluted, undefined);
  // workouts in days no longer need steps or sleep to be written (the old "ignored" rule is gone), but bad now / state still write nothing
  for (const now of [0, -1, NaN, '5000', null]) { const s = { activity: {} }; assert.deepEqual(applyHealthSync(s, days, now), { added: 0, updated: 0, unchanged: 0 }); assert.deepEqual(s, { activity: {} }); }
  assert.deepEqual(applyHealthSync(null, days, 5000), { added: 0, updated: 0, unchanged: 0 });
});

// ================================================================ healthSyncText
test('X14. healthSyncText: the old sentences byte for byte without workouts; ", workouts for N" counts DAYS with workouts; a fixed sentence when the workouts failed; the error value is never echoed', async () => {
  const { healthSyncText, WORKOUTS_FAILED_TEXT } = await D();
  assert.equal(WORKOUTS_FAILED_TEXT, FAILED);
  const BOTH = { '2026-11-16': { steps: 1226, sleepMinutes: 398 }, '2026-11-15': { steps: 2919, sleepMinutes: 336 }, '2026-11-14': { steps: 12921, sleepMinutes: 435 } };
  const NOTHING = 'Nothing to sync: Google Health has no steps or sleep for the last 7 days.';
  assert.equal(healthSyncText(BOTH), 'Synced 3 days: steps for 3, sleep for 3');
  assert.equal(healthSyncText({ '2026-11-14': { steps: 5 } }), 'Synced 1 day: steps for 1, sleep for 0');
  for (const v of [{}, null, undefined, 'x', 5, [], { a: {} }, { a: null }]) assert.equal(healthSyncText(v), NOTHING, JSON.stringify(v));
  for (const e of [undefined, null, '', false, 0]) { assert.equal(healthSyncText(BOTH, e), 'Synced 3 days: steps for 3, sleep for 3'); assert.equal(healthSyncText({}, e), NOTHING); }
  // workouts
  const W3 = { ...BOTH, '2026-11-16': { ...BOTH['2026-11-16'], workouts: [WALK_W] }, '2026-11-14': { ...BOTH['2026-11-14'], workouts: [RUN_W, SPORT_W] } };
  assert.equal(healthSyncText(W3), 'Synced 3 days: steps for 3, sleep for 3, workouts for 2', 'two DAYS with workouts (three workouts)');
  assert.equal(healthSyncText({ '2026-11-14': { workouts: [RUN_W] } }), 'Synced 1 day: steps for 0, sleep for 0, workouts for 1', 'a day with only workouts counts as a synced day');
  assert.equal(healthSyncText({ '2026-11-14': { steps: 5 }, '2026-11-15': { workouts: [RUN_W] } }), 'Synced 2 days: steps for 1, sleep for 0, workouts for 1');
  assert.equal(healthSyncText({ '2026-11-14': { steps: 5, workouts: [] } }), 'Synced 1 day: steps for 1, sleep for 0', 'an empty list is no workouts');
  for (const bad of ['x', {}, null, 5, true]) assert.equal(healthSyncText({ '2026-11-14': { steps: 5, workouts: bad } }), 'Synced 1 day: steps for 1, sleep for 0', JSON.stringify(bad));
  assert.equal(healthSyncText({ '2026-11-14': { workouts: [] } }), NOTHING);
  // the failure sentence is appended after a full stop
  assert.equal(healthSyncText(BOTH, FAILED), 'Synced 3 days: steps for 3, sleep for 3. ' + FAILED);
  assert.equal(healthSyncText(BOTH, true), 'Synced 3 days: steps for 3, sleep for 3. ' + FAILED);
  assert.equal(healthSyncText({}, FAILED), NOTHING + ' ' + FAILED);
  assert.equal(healthSyncText(BOTH, '<img src=x onerror=1> ' + TOKEN + ' ' + EMAIL), 'Synced 3 days: steps for 3, sleep for 3. ' + FAILED, 'a failure value is a flag, its text is never shown');
});

// ================================================================ the Diary line (domain/activity.js)
test('V1. workoutLine(w, weightUnit): "Name · N min · distance · N kcal · avg N bpm", parts that are not recorded are left out; the old shape "Name · N min · N kcal" is unchanged', async () => {
  const { workoutLine } = await A();
  assert.equal(typeof workoutLine, 'function');
  assert.equal(workoutLine(RUN_W, 'g'), 'Run · 31 min · 4.2 km · 312 kcal · avg 148 bpm');        // 4200 m = 4.2 km
  assert.equal(workoutLine({ id: 'a', name: 'Running', start: '2026-11-14T18:07:37Z', minutes: 31, kcal: 312, distanceM: 4200, avgHr: 148 }, 'g'), 'Running · 31 min · 4.2 km · 312 kcal · avg 148 bpm');
  assert.equal(workoutLine(SPORT_W, 'g'), 'Sport · 30 min · 150 kcal · avg 121 bpm');
  assert.equal(workoutLine(WALK_W, 'g'), 'Walking · 20 min · 1.7 km · 95 kcal');
  assert.equal(workoutLine({ id: 'a', name: 'Walk', start: '2026-11-14T18:07:37Z', minutes: 45, kcal: 300 }, 'g'), 'Walk · 45 min · 300 kcal', 'the line the Diary showed before');
  assert.equal(workoutLine({ id: 'a', name: 'Walk', start: '2026-11-14T18:07:37Z', minutes: 45 }, 'g'), 'Walk · 45 min');
  assert.equal(workoutLine({ id: 'a', name: 'Walk', start: '2026-11-14T18:07:37Z', minutes: 45, avgHr: 99 }, 'g'), 'Walk · 45 min · avg 99 bpm');
  assert.equal(workoutLine({ id: 'a', name: 'Walk', start: '2026-11-14T18:07:37Z', minutes: 45, distanceM: 3000 }, 'g'), 'Walk · 45 min · 3.0 km', 'one decimal even for a round number');
  assert.equal(workoutLine({ id: 'a', name: 'Walk', start: '2026-11-14T18:07:37Z', minutes: 0 }, 'g'), 'Walk · 0 min');
  assert.equal(workoutLine({ id: 'a', name: 'Zip', start: '2026-11-14T18:07:37Z', minutes: 31, peakHr: 170, steps: 5000, avgHr: 147 }, 'g'), 'Zip · 31 min · avg 147 bpm', 'peak heart rate and steps are not in the line');
});

test('V2. workoutLine units: "g" -> kilometres (distanceM / 1000), "oz" -> miles (distanceM / 1609.344), one decimal, " km" / " mi"; any other unit counts as "g"', async () => {
  const { workoutLine } = await A();
  const dist = (m, unit) => workoutLine({ id: 'a', name: 'R', start: '2026-11-14T18:07:37Z', minutes: 1, distanceM: m }, unit);
  assert.equal(dist(4200, 'g'), 'R · 1 min · 4.2 km');
  assert.equal(dist(4200, 'oz'), 'R · 1 min · 2.6 mi');     // 4200 / 1609.344 = 2.6097
  assert.equal(dist(1700, 'oz'), 'R · 1 min · 1.1 mi');     // 1.0563
  assert.equal(dist(1700, 'g'), 'R · 1 min · 1.7 km');
  assert.equal(dist(5000, 'g'), 'R · 1 min · 5.0 km');
  assert.equal(dist(5000, 'oz'), 'R · 1 min · 3.1 mi');     // 3.1069
  assert.equal(dist(10000, 'oz'), 'R · 1 min · 6.2 mi');    // 6.2137
  assert.equal(dist(1609, 'oz'), 'R · 1 min · 1.0 mi');     // 0.99979
  assert.equal(dist(4251, 'g'), 'R · 1 min · 4.3 km');      // 4.251
  assert.equal(dist(4249, 'g'), 'R · 1 min · 4.2 km');
  assert.equal(dist(100, 'g'), 'R · 1 min · 0.1 km');
  assert.equal(dist(1000000, 'g'), 'R · 1 min · 1000.0 km');
  for (const unit of [undefined, null, '', 'lb', 'G', 5, {}]) assert.equal(dist(4200, unit), 'R · 1 min · 4.2 km', 'unit ' + JSON.stringify(unit) + ' -> kilometres (decided here)');
  assert.equal(workoutLine(RUN_W, 'oz'), 'Run · 31 min · 2.6 mi · 312 kcal · avg 148 bpm');
  assert.equal(workoutLine(WALK_W, 'oz'), 'Walking · 20 min · 1.1 mi · 95 kcal');
  assert.equal(workoutLine(SPORT_W, 'oz'), 'Sport · 30 min · 150 kcal · avg 121 bpm', 'no distance, nothing to convert');
  const one = clone(RUN_W); workoutLine(one, 'oz'); assert.deepEqual(one, RUN_W, 'input not mutated');
});

test('V3. workoutLine hostile input: never throws, returns a string, junk numbers and names are left out or defaulted, markup is returned as TEXT (the Diary escapes it), no NaN / Infinity / undefined / exponent text', async () => {
  const { workoutLine } = await A();
  const w = over => ({ id: 'a', name: 'Run', start: '2026-11-14T18:07:37Z', minutes: 30, ...over });
  for (const bad of [NaN, Infinity, -Infinity, -5, '5000', null, true, {}, [], undefined]) assert.equal(workoutLine(w({ distanceM: bad }), 'g'), 'Run · 30 min', 'distance ' + String(bad));
  for (const bad of [NaN, Infinity, -Infinity, '300', null, true, {}, [], undefined]) assert.equal(workoutLine(w({ kcal: bad }), 'g'), 'Run · 30 min', 'kcal ' + String(bad));
  for (const bad of [NaN, Infinity, -Infinity, '148', null, true, {}, [], undefined]) assert.equal(workoutLine(w({ avgHr: bad }), 'g'), 'Run · 30 min', 'avgHr ' + String(bad));
  for (const bad of [NaN, undefined, null, {}, Infinity]) assert.equal(workoutLine(w({ minutes: bad }), 'g'), 'Run · 0 min', 'minutes ' + String(bad));
  for (const bad of [undefined, null, '', '   ', 5, {}, []]) assert.equal(workoutLine(w({ name: bad }), 'g'), 'Workout · 30 min', 'name ' + JSON.stringify(bad));
  assert.equal(workoutLine(w({ name: '<img src=x onerror=alert(1)> & "q"' }), 'g'), '<img src=x onerror=alert(1)> & "q" · 30 min', 'plain text out; the UI applies esc()');
  for (const v of [null, undefined, 5, 'x', [], true]) { let r; assert.doesNotThrow(() => { r = workoutLine(v, 'g'); }); assert.equal(r, '', 'not a workout: ' + String(v)); }
  // numbers outside the saved-shape ranges are treated as not recorded (decided here, spec open question 5): minutes 0..1440 else "0 min", distanceM 0..1,000,000, kcal 0..20000, avgHr 20..300
  assert.equal(workoutLine(w({ distanceM: 1000001 }), 'g'), 'Run · 30 min'); assert.equal(workoutLine(w({ kcal: 20001 }), 'g'), 'Run · 30 min');
  assert.equal(workoutLine(w({ avgHr: 301 }), 'g'), 'Run · 30 min'); assert.equal(workoutLine(w({ avgHr: 19 }), 'g'), 'Run · 30 min'); assert.equal(workoutLine(w({ minutes: 1441 }), 'g'), 'Run · 0 min');
  assert.equal(workoutLine(w({ avgHr: 20, kcal: 20000, distanceM: 1000000, minutes: 1440 }), 'g'), 'Run · 1440 min · 1000.0 km · 20000 kcal · avg 20 bpm', 'the range limits themselves are valid');
  for (const huge of [1e300, Number.MAX_VALUE, 1e21, 1e7]) { const r = workoutLine(w({ distanceM: huge, kcal: huge, avgHr: huge, minutes: huge }), 'oz'); assert.equal(typeof r, 'string'); assert.doesNotMatch(r, /NaN|Infinity|undefined|null|\[object|e\+/, String(huge)); }
  const boom = Object.defineProperty({ name: 'x' }, 'minutes', { enumerable: true, get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => workoutLine(boom, 'g'));
  const inh = Object.assign(Object.create({ distanceM: 5000, kcal: 9, avgHr: 99 }), { name: 'P', minutes: 5 }); assert.equal(workoutLine(inh, 'g'), 'P · 5 min', 'inherited numbers are not data (own properties only)');
});

test('V4. (weak) domain/activity.js stays pure and exports workoutLine; the existing exports remain; diary.js draws the workouts through workoutLine and esc() with the units setting', async () => {
  const mod = await A();
  for (const n of ['workoutLine', 'activityLine', 'activityForDay', 'applyActivityImport']) assert.equal(typeof mod[n], 'function', n);
  const code = p => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const dom = code('js/domain/activity.js');
  assert.doesNotMatch(dom, /\b(document|window|localStorage|sessionStorage|fetch|navigator)\b|Date\.now|Math\.random|\bconsole\./, 'the formatter stays pure');
  for (const i of [...dom.matchAll(/^\s*import\b[^'"\n]*?from\s*['"]([^'"]+)['"]/gm)].map(m => m[1])) assert.match(i, /^(\.\.\/core\/(constants|format|dates|schema)\.js|\.\/[a-z-]+\.js)$/, 'domain import: ' + i);
  const ui = code('js/ui/diary.js');
  assert.match(ui, /import\s*\{[^}]*\bworkoutLine\b[^}]*\}\s*from\s*['"]\.\.\/domain\/activity\.js['"]/);
  assert.match(ui, /workoutLine\(/); assert.match(ui, /weightUnit/);
  const block = ui.slice(ui.indexOf('Workouts'), ui.indexOf('Workouts') + 1200);
  assert.ok(block.includes('workoutLine(') && block.includes('esc('), 'the line is built from workoutLine and goes through esc()');
  assert.doesNotMatch(ui, /\$\{\s*w\.name\s*\}/, 'a workout name is never inserted unescaped');
});

// ================================================================ fakes for the service tests
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const R = (body, status = 200) => () => jsonRes(body, status);
const lowerHeaders = h => { const out = {}; if (!h) return out; if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { out[k.toLowerCase()] = v; }); else for (const [k, v] of Array.isArray(h) ? h : Object.entries(h)) out[String(k).toLowerCase()] = v; return out; };
const kindOf = url => (url.includes('dailyRollUp') ? 'steps' : url.includes('dataTypes/sleep') ? 'sleep' : url.includes('dataTypes/exercise') ? 'exercise' : 'other');
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const call = { url: String(url), method: String(init.method || 'GET').toUpperCase(), headers: lowerHeaders(init.headers), body: init.body, init };
    calls.push(call);
    const kind = kindOf(call.url), r = routes[kind], n = calls.filter(c => kindOf(c.url) === kind).length;   // n is captured before any await
    const out = typeof r === 'function' ? r(call, n) : r;
    if (out instanceof Error) throw out;
    if (out === undefined) throw new Error('no route for ' + call.url);
    return out;
  };
  f.calls = calls;
  return f;
}
const TOKEN_OK = { access_token: TOKEN, expires_in: 3599, scope: SCOPE, token_type: 'Bearer' };
function fakeGoogle() {
  const g = { inits: [], reqArgs: [] };
  g.google = { accounts: { oauth2: { initTokenClient(cfg) { g.inits.push(cfg); return { requestAccessToken(...a) { g.reqArgs.push(a); setTimeout(() => cfg.callback(TOKEN_OK), 0); } }; } } } };
  return g;
}
const pt = (d, count) => ({ civilStartTime: { date: { year: 2026, month: 11, day: d }, time: {} }, ...(count === undefined ? {} : { steps: { countSum: count } }) });
const STEPS = { rollupDataPoints: [pt(16, '1226'), pt(14, '12921')] };
const SLEEP14 = { sleep: { interval: { startTime: '2026-11-14T03:30:00Z', startUtcOffset: '-18000s', endTime: '2026-11-14T11:30:00Z', endUtcOffset: '-18000s' }, summary: { minutesAsleep: '435' } } };
const SLEEP = { dataPoints: [SLEEP14], nextPageToken: '' };
const SLEEP_ONLY = { '2026-11-16': { steps: 1226 }, '2026-11-14': { steps: 12921, sleepMinutes: 435, sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z' } };
const WITH_WORKOUTS = { '2026-11-16': { ...SLEEP_ONLY['2026-11-16'], workouts: [WALK_W] }, '2026-11-14': { ...SLEEP_ONLY['2026-11-14'], workouts: [RUN_W, SPORT_W] } };
const EXERCISE = ans(RUN_REC, SPORT_REC, WALK_REC);
const happy = () => ({ steps: R(STEPS), sleep: R(SLEEP), exercise: R(EXERCISE) });
async function harness({ routes = happy(), now = () => NOW } = {}) {
  const { createHealthSync } = await S();
  const f = fakeFetch(routes), g = fakeGoogle();
  const sync = createHealthSync({ fetch: f, loadGoogle: async () => g.google, now });
  return { sync, f, g };
}
async function spyConsole(fn) {
  const calls = [], names = ['log', 'info', 'warn', 'error', 'debug', 'trace'], orig = {};
  for (const n of names) { orig[n] = console[n]; console[n] = (...a) => calls.push(a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); }
  try { await fn(); } finally { for (const n of names) console[n] = orig[n]; }
  return calls;
}

test('Y1. run: the exercise answer is a THIRD request after steps and sleep (GET, exact 7-day URL, same bearer token), the result carries the workouts per day, no workoutsError key', async () => {
  const h = await harness();
  const res = await h.sync.run(ID);
  assert.deepEqual(res, { ok: true, days: WITH_WORKOUTS });
  assert.equal('workoutsError' in res, false);
  assert.equal(h.f.calls.length, 3);
  assert.deepEqual(h.f.calls.map(c => kindOf(c.url)), ['steps', 'sleep', 'exercise'], 'order: steps, sleep, exercise');
  const ex = h.f.calls[2];
  assert.equal(ex.method, 'GET'); assert.equal(ex.url, EX_URL('2026-11-10')); assert.equal(ex.body, undefined);
  for (const c of h.f.calls) { assert.equal(c.headers.authorization, 'Bearer ' + TOKEN); assert.ok(c.url.startsWith(HEALTH + '/'), c.url); assert.equal(c.url.includes(TOKEN), false); }
  assert.equal(h.g.inits.length, 1, 'one sign-in for all three requests'); assert.equal(h.g.inits[0].scope, SCOPE, 'no new scope, no new consent');
  const { SCOPE: scope } = await S(); assert.equal(scope, SCOPE);
  // the clock decides the window
  const h2 = await harness({ now: () => L(2026, 12, 3, 9) }); await h2.sync.run(ID);
  assert.equal(h2.f.calls[2].url, EX_URL('2026-11-27'));
});

test('Y2. no workouts in the answer is a success without workoutsError: {}, null, [], an empty list, junk items', async () => {
  for (const body of [{}, null, [], { dataPoints: [] }, { dataPoints: [null, 5, 'x'] }, { dataPoints: [{ exercise: 5 }], nextPageToken: '' }]) {
    const h = await harness({ routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: () => new Response(JSON.stringify(body), { status: 200 }) } });
    const res = await h.sync.run(ID);
    assert.deepEqual(res, { ok: true, days: SLEEP_ONLY }, JSON.stringify(body)); assert.equal(h.f.calls.length, 3);
  }
});

test('Y3. exercise paging follows nextPageToken (at most 4 pages) and merges the pages; the same record repeated is one workout', async () => {
  const pages = { 1: { dataPoints: [RUN_REC, SPORT_REC], nextPageToken: 'tok2' }, 2: { dataPoints: [WALK_REC], nextPageToken: '' } };
  let h = await harness({ routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: (c, n) => jsonRes(pages[n]) } });
  assert.deepEqual(await h.sync.run(ID), { ok: true, days: WITH_WORKOUTS });
  const exs = h.f.calls.filter(c => kindOf(c.url) === 'exercise');
  assert.equal(exs.length, 2); assert.equal(exs[0].url.includes('pageToken'), false); assert.equal(exs[1].url, exs[0].url + '&pageToken=tok2');
  // a token that never ends: 4 pages, still a success with what was read (the repeated record counts once)
  h = await harness({ routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: () => jsonRes({ dataPoints: [RUN_REC], nextPageToken: 'again' }) } });
  const res = await h.sync.run(ID);
  assert.equal(h.f.calls.filter(c => kindOf(c.url) === 'exercise').length, 4);
  assert.deepEqual(res, { ok: true, days: { ...SLEEP_ONLY, '2026-11-14': { ...SLEEP_ONLY['2026-11-14'], workouts: [RUN_W] } } });
  for (const tok of ['', undefined, null, 5]) {
    h = await harness({ routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: () => jsonRes({ dataPoints: [RUN_REC], nextPageToken: tok }) } });
    assert.equal((await h.sync.run(ID)).ok, true); assert.equal(h.f.calls.filter(c => kindOf(c.url) === 'exercise').length, 1, String(tok));
  }
});

const ERR = (code, status, extra = {}) => ({ error: { code, message: 'text with ' + TOKEN + ' and ' + EMAIL, status, ...extra } });
const NOT_LINKED = { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCOUNT_NOT_LINKED', domain: 'health.googleapis.com' }] };
const BAD = [
  ['401', () => jsonRes(ERR(401, 'UNAUTHENTICATED'), 401)], ['403', () => jsonRes(ERR(403, 'PERMISSION_DENIED'), 403)], ['429', () => jsonRes(ERR(429, 'RESOURCE_EXHAUSTED'), 429)],
  ['400 not linked', () => jsonRes(ERR(400, 'FAILED_PRECONDITION', NOT_LINKED), 400)], ['400 other', () => jsonRes(ERR(400, 'INVALID_ARGUMENT'), 400)], ['404', () => jsonRes(ERR(404, 'NOT_FOUND'), 404)],
  ['500', () => jsonRes(ERR(500, 'INTERNAL'), 500)], ['503 html', () => new Response('<h1>' + EMAIL + '</h1>', { status: 503 })], ['200 not JSON', () => new Response('<html>' + TOKEN, { status: 200 })],
  ['fetch rejects', () => new TypeError('Failed to fetch ' + TOKEN + ' ' + EMAIL)],
];

test('Y4. an exercise failure (any HTTP error, network, unreadable answer) does NOT fail the run: steps and sleep are returned and `workoutsError` is the one fixed text, nothing from the failure is echoed', async () => {
  for (const silent of [false, true]) for (const [name, bad] of BAD) {
    const h = await harness({ routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: bad } });
    let res; const out = await spyConsole(async () => { res = silent ? await h.sync.run(ID, { silent: true }) : await h.sync.run(ID); });
    assert.deepEqual(res, { ok: true, days: SLEEP_ONLY, workoutsError: FAILED }, name + (silent ? ' (silent)' : ''));
    assert.equal('silent' in res, false); assert.equal(h.f.calls.length, 3, 'the exercise request was made once, not retried');
    for (const s of [JSON.stringify(res), ...out]) { assert.equal(s.includes(TOKEN), false, name); assert.equal(s.includes(EMAIL), false, name); assert.equal(s.includes('ya29'), false); }
  }
  // no route at all behaves like a failed request
  const h = await harness({ routes: { steps: R(STEPS), sleep: R(SLEEP) } });
  assert.deepEqual(await h.sync.run(ID), { ok: true, days: SLEEP_ONLY, workoutsError: FAILED });
});

test('Y5. a failure on a LATER exercise page fails the workouts as a whole: no workouts from the earlier page, steps and sleep still returned', async () => {
  const h = await harness({ routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: (c, n) => (n === 1 ? jsonRes({ dataPoints: [RUN_REC], nextPageToken: 'tok2' }) : jsonRes(ERR(429, 'RESOURCE_EXHAUSTED'), 429)) } });
  const res = await h.sync.run(ID);
  assert.deepEqual(res, { ok: true, days: SLEEP_ONLY, workoutsError: FAILED });
  assert.equal(h.f.calls.filter(c => kindOf(c.url) === 'exercise').length, 2);
});

test('Y6. a failure of steps or sleep stays ALL-OR-NOTHING as today: the exact old message, no days, no workoutsError, and the exercise request is not made', async () => {
  const msgs = { 401: 'Google rejected the sign-in. Tap Sync Google Health to sign in again.', 500: 'Google Health answered with an error (HTTP 500). Try again later.' };
  const steps401 = await harness({ routes: { steps: () => jsonRes(ERR(401, 'UNAUTHENTICATED'), 401), sleep: R(SLEEP), exercise: R(EXERCISE) } });
  assert.deepEqual(await steps401.sync.run(ID), { ok: false, message: msgs[401] }); assert.equal(steps401.f.calls.length, 1);
  const sleep500 = await harness({ routes: { steps: R(STEPS), sleep: () => jsonRes(ERR(500, 'INTERNAL'), 500), exercise: R(EXERCISE) } });
  const res = await sleep500.sync.run(ID);
  assert.deepEqual(res, { ok: false, message: msgs[500] }); assert.equal('days' in res, false); assert.equal('workoutsError' in res, false); assert.equal(sleep500.f.calls.length, 2, 'steps and sleep only');
  const quiet = await harness({ routes: { steps: R(STEPS), sleep: () => jsonRes(ERR(500, 'INTERNAL'), 500), exercise: R(EXERCISE) } });
  assert.deepEqual(await quiet.sync.run(ID, { silent: true }), { ok: false, message: msgs[500] }, 'quiet runs behave the same, no silent flag after the token');
});

test('Y7. a silent (quiet) run makes the same three requests and returns the same result as a tap', async () => {
  const hs = await harness(), hn = await harness();
  const rs = await hs.sync.run(ID, { silent: true }), rn = await hn.sync.run(ID);
  assert.deepEqual(rs, { ok: true, days: WITH_WORKOUTS }); assert.deepEqual(rn, rs);
  assert.deepEqual(hs.f.calls.map(c => [c.method, c.url, c.body]), hn.f.calls.map(c => [c.method, c.url, c.body]));
  assert.equal(hs.f.calls.length, 3); assert.equal(hs.g.reqArgs[0][0].prompt, 'none');
});

test('Y8. the token and any email never appear in a result, a console call, a URL or a body, with workouts present or failed', async () => {
  const hostileWorkout = set('exercise.displayName', 'Run ' + EMAIL);   // text from Google may contain anything; it is data, but never the token
  const scenarios = [
    { routes: happy() },
    { routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: R(ans(hostileWorkout)) } },
    { routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: R(ERR(500, 'INTERNAL'), 500) } },
    { routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: () => new Response(TOKEN + EMAIL, { status: 200 }) } },
    { routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: () => new Error('offline ' + TOKEN) } },
  ];
  for (const [i, sc] of scenarios.entries()) {
    const h = await harness(sc); let res;
    const out = await spyConsole(async () => { res = await h.sync.run(ID); });
    for (const s of [...out, ...h.f.calls.map(c => c.url + '|' + String(c.body || ''))]) { assert.equal(s.includes(TOKEN), false, `scenario ${i}`); assert.equal(s.includes('ya29'), false); }
    assert.equal(JSON.stringify(res).includes(TOKEN), false, `scenario ${i}: result`);
    if (i !== 1) assert.equal(JSON.stringify(res).includes(EMAIL), false, `scenario ${i}: result email`);
  }
});

test('Y9. one run at a time still holds with three requests, and the lock is released after a run with failed workouts', async () => {
  const h = await harness({ routes: { steps: R(STEPS), sleep: R(SLEEP), exercise: () => jsonRes(ERR(500, 'INTERNAL'), 500) } });
  const first = h.sync.run(ID), second = await h.sync.run(ID);
  assert.deepEqual(second, { ok: false, busy: true, message: 'A sync is already running.' });
  assert.equal((await first).workoutsError, FAILED);
  assert.equal((await h.sync.run(ID)).ok, true, 'released');
  assert.equal(h.g.inits.length, 2);
});

// ================================================================ round trip and source checks
test('Z1. a synced workouts day round-trips through sanitize, sync records and a backup JSON exactly like any activity day; no schema change', async () => {
  const { applyHealthSync } = await D();
  assert.equal(SCHEMA_VERSION, 13, 'no SCHEMA_VERSION bump (this test already passes before the change: it guards against one)'); assert.equal(STORAGE_KEY, 'macrodiary.v1');
  const state = defaults();
  applyHealthSync(state, WITH_WORKOUTS, 5000);
  const rec = state.activity['2026-11-14'];
  assert.deepEqual(rec, { updatedAt: 5000, source: 'google-health', steps: 12921, sleepMinutes: 435, sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z', workouts: [RUN_W, SPORT_W] });
  assert.deepEqual(sanitizeActivityDay(rec), rec);
  // sync records: one record per day, the activity as it is, and it arrives on another device unchanged
  const recs = toRecords(state), r14 = recs.find(r => r.key === 'activity:2026-11-14');
  assert.ok(r14); assert.deepEqual(r14.value, { activity: rec }); assert.equal(r14.updatedAt, 5000);
  const other = applyRecords(defaults(), clone(recs));
  assert.deepEqual(other.activity, state.activity);
  // a backup is the state as JSON: it comes back identical (through sanitize) and nothing about exercise is stored beside the day record
  const back = JSON.parse(JSON.stringify(state));
  assert.deepEqual(back.activity, state.activity);
  assert.deepEqual(Object.keys(state).sort(), Object.keys(defaults()).sort(), 'no new top-level key');
  assert.equal(JSON.stringify(state).includes('exercise'), false); assert.equal(JSON.stringify(state).includes('dataSource'), false); assert.equal(JSON.stringify(state).includes('apps.googleusercontent.com'), false);
  // a second sync of the same answer changes nothing (so sync pushes nothing)
  const snapshot = JSON.stringify(state);
  assert.deepEqual(applyHealthSync(state, clone(WITH_WORKOUTS), 9000), { added: 0, updated: 0, unchanged: 2 }); assert.equal(JSON.stringify(state), snapshot);
});

test('Z2. (weak) health-sync-view.js hands the failure flag to healthSyncText and still writes only text; the service imports buildExerciseUrl and the fixed text; no new scope string', () => {
  const code = p => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const ui = code('js/ui/health-sync-view.js'), svc = code('js/services/google-health-api.js'), dom = code('js/domain/google-health-api.js');
  assert.match(ui, /healthSyncText\([^)]*workoutsError/, 'the status text gets res.workoutsError');
  assert.doesNotMatch(ui, /\binnerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'text from Google is written with textContent only');
  assert.match(svc, /buildExerciseUrl/); assert.match(svc, /workoutsError/); assert.match(svc, /WORKOUTS_FAILED_TEXT/);
  assert.match(dom, /export\s+(async\s+)?function\s+buildExerciseUrl\b/); assert.match(dom, /export\s+function\s+parseExerciseAnswer\b/); assert.match(dom, /export\s+(const|function)\s+WORKOUTS_FAILED_TEXT\b/);
  assert.equal([...(svc + dom).matchAll(/\/auth\/[a-z._]+/g)].map(m => m[0]).filter(s => !/googlehealth\.(activity_and_fitness|sleep)\.readonly$/.test(s)).length, 0, 'still only the two read-only Health scopes');
  assert.doesNotMatch(svc, /\bconsole\.(log|info|warn|error|debug|trace)\b/); assert.doesNotMatch(dom, /\b(document|window|localStorage|fetch|navigator)\b|Date\.now|\bconsole\./, 'the domain file is still pure');
});

test('Z3. (weak) docs: DECISIONS.md has an entry for the workouts SYNC (not the probe): replace per day, the failure rule, the same permission', () => {
  const dec = read('docs/DECISIONS.md');
  const entries = [...dec.matchAll(/^## D\d+\. Google Health[^\n]*\n([\s\S]*?)(?=\n## D\d+\.|(?![\s\S]))/gim)].map(m => m[1]);
  assert.ok(entries.some(b => /replace/i.test(b) && /workoutsError|fail/i.test(b) && /activity_and_fitness|same permission|no new (scope|consent)/i.test(b) && /per day|each day|a day/i.test(b)),
    'a "## D<n>. Google Health ..." entry must say that the API workouts REPLACE the stored ones of a day, what happens when the workouts request fails, and that no new permission is needed');
});
