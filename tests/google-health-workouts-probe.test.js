// Spec: docs/specs/google-health-workouts-probe.md (backlog item 24, step 1: the probe also reads workouts). Test-designer file, written BEFORE the implementation.
// All data is made up (names, ids, tokens, times); nothing here can be a real key or id. Golden values are hand-computed (arithmetic in the comments).
// B16 (export list) is the updated P18 in tests/google-health-probe.test.js; B16 here only checks purity of probe.js.
// B17 and B18 are WEAK source-text checks: they prove strings are present or absent, not that the page behaves.
// No test shares state with another: every test builds its own input; none reads the clock (dates are passed in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const load = () => import('../tools/google-health-probe/probe.js');   // dynamic, so a missing export fails only the tests that need it
const L = (y, m, d, h = 0, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s);   // LOCAL time: no dependence on the machine timezone
const NOW = L(2026, 11, 14, 20, 0, 0);
const BAD = /NaN|undefined|\[object|Infinity/;
const PAGE = 'tools/google-health-probe/index.html', PROBE = 'tools/google-health-probe/probe.js';
const stripComments = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const dp = (...records) => ({ dataPoints: records, nextPageToken: '' });
const shape = async (json, opts) => { const { describeShape } = await load(); return opts === undefined ? describeShape(json) : describeShape(json, opts); };
// every printed line has this form (types, optional enum, optional count); keys are limited to the safe alphabet or ?
const LINE = /^[A-Za-z0-9_?.[\]]+: [a-z|]+( = [A-Z][A-Z0-9_]{1,40})?( \(\d+ of \d+\))?$/;

// ================================================================ B1 buildExerciseUrl
test('B1. buildExerciseUrl: exact encoded URL, range start date, days normalised like the other builders, "" for an invalid now', async () => {
  const { buildExerciseUrl } = await load();
  const base = 'https://health.googleapis.com/v4/users/me/dataTypes/exercise/dataPoints?page_size=25&filter=exercise.interval.civil_start_time%20%3E%3D%20%22';
  // encodeURIComponent: space %20, > %3E, = %3D, " %22; . _ - stay as they are. 14 Nov minus 2 days = 12 Nov
  assert.equal(buildExerciseUrl(NOW, 3), base + '2026-11-12%22');
  assert.equal(buildExerciseUrl(NOW, 1), base + '2026-11-14%22');
  assert.equal(buildExerciseUrl(NOW, 7), base + '2026-11-08%22');          // 14 - 6
  assert.equal(buildExerciseUrl(NOW, 31), base + '2026-10-15%22');         // 14 Nov minus 30 days = 15 Oct
  assert.equal(buildExerciseUrl(L(2026, 3, 1, 9), 3), base + '2026-02-27%22');
  assert.equal(buildExerciseUrl(L(2028, 3, 1, 9), 3), base + '2028-02-28%22');   // leap year: Feb 28, 29, Mar 1
  assert.equal(buildExerciseUrl(L(2026, 11, 14, 0, 0, 0), 3), buildExerciseUrl(L(2026, 11, 14, 23, 59, 59), 3));
  for (const d of [undefined, NaN, '3', null, Infinity, -Infinity, {}, []]) assert.equal(buildExerciseUrl(NOW, d), base + '2026-11-12%22', String(d));
  for (const d of [0, -5, 0.5]) assert.equal(buildExerciseUrl(NOW, d), base + '2026-11-14%22', String(d));
  assert.equal(buildExerciseUrl(NOW, 2.9), base + '2026-11-13%22');
  for (const d of [100, 1e9]) assert.equal(buildExerciseUrl(NOW, d), base + '2026-10-15%22', String(d));
  assert.equal(decodeURIComponent(buildExerciseUrl(NOW, 3).split('filter=')[1]), 'exercise.interval.civil_start_time >= "2026-11-12"');
  for (const n of [null, undefined, 'x', 0, 1763150400000, new Date(NaN), {}, []]) assert.equal(buildExerciseUrl(n, 3), '', String(n));
});

// ================================================================ describeShape
const FAKE = { name: 'users/me/dataTypes/exercise/dataPoints/TEST-ID-0042', exercise: {
  interval: { startTime: '2026-11-14T07:15:00Z', startUtcOffset: '0s', endTime: '2026-11-14T07:45:00Z', endUtcOffset: '0s' },
  exerciseType: 'RUNNING', displayName: 'Morning run with Pat Example', activeDuration: '1800s', hasGps: true,
  metricsSummary: { caloriesKcal: 412.5, distanceMillimeters: '5234000', steps: '5120', averageHeartRateBeatsPerMinute: '151', pace: '343.2s' },
  notes: 'secret note', laps: [{ distance: '1000000', label: 'lap one' }] } };
// sorted by PATH in code-unit order; a parent sorts before its children; after "exercise." the next letters are a d e h i l m n
const FAKE_SHAPE = ['exercise: object', 'exercise.activeDuration: string', 'exercise.displayName: string', 'exercise.exerciseType: string = RUNNING', 'exercise.hasGps: boolean',
  'exercise.interval: object', 'exercise.interval.endTime: string', 'exercise.interval.endUtcOffset: string', 'exercise.interval.startTime: string', 'exercise.interval.startUtcOffset: string',
  'exercise.laps: array', 'exercise.laps[]: object', 'exercise.laps[].distance: string', 'exercise.laps[].label: string',
  'exercise.metricsSummary: object', 'exercise.metricsSummary.averageHeartRateBeatsPerMinute: string', 'exercise.metricsSummary.caloriesKcal: number',
  'exercise.metricsSummary.distanceMillimeters: string', 'exercise.metricsSummary.pace: string', 'exercise.metricsSummary.steps: string', 'exercise.notes: string', 'name: string'];

test('B2. describeShape: exact sorted structure of a realistic workout record (containers get lines, arrays collapse to [], enum printed)', async () => {
  assert.equal(await shape(dp(FAKE)), FAKE_SHAPE.join('\n'));
  assert.equal(await shape(dp(FAKE), {}), FAKE_SHAPE.join('\n'));
});

test('B3. describeShape: no personal value is ever printed (realistic and hostile values)', async () => {
  const out = await shape(dp(FAKE));
  const leaves = []; const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); else leaves.push(v); }; walk(FAKE);
  let checked = 0;
  for (const v of leaves) {
    if (typeof v === 'string' && !/^[A-Z][A-Z0-9_]{1,40}$/.test(v) && v.length >= 3) { assert.ok(!out.includes(v), 'leaked string value ' + v); checked++; }
    if (typeof v === 'number') { assert.ok(!out.includes(String(v)), 'leaked number ' + v); checked++; }
  }
  assert.ok(checked >= 10, 'the leak check really looked at values');
  for (const s of ['Pat', 'Example', 'TEST-ID', '0042', '2026-11-14', '07:15', 'secret', 'lap one', '5234000', '5120', '1800', '412', '343.2']) assert.ok(!out.includes(s), 'leaked ' + s);
  assert.doesNotMatch(out, /\btrue\b|\bfalse\b/);
  for (const l of out.split('\n')) assert.match(l, LINE, l);
  // hostile values: markup, token-like text, email, phone, a huge string, huge numbers, a place name
  const hostile = { exercise: { note: '<img src=x onerror=alert(1)>', tok: 'ya29.test-token-abc', mail: 'pat@example.test', phone: '+44 7700 900123', big: 'z'.repeat(100000),
    huge: 12345678901234, neg: -98765.4321, place: 'Testville Park', route: ['Elm Road', 'Oak Lane'], gps: { lat: 51.5074123, lon: -0.1278321 } }, id: 'a1b2c3d4-0000-4000-8000-000000000042' };
  const h = await shape(dp(hostile));
  for (const s of ['<img', 'onerror', 'ya29', '@', '7700', 'zzz', '1234567890', '98765', 'Testville', 'Elm Road', 'Oak Lane', '51.5074', '0.1278', 'a1b2c3d4']) assert.ok(!h.includes(s), 'leaked ' + s);
  for (const l of h.split('\n')) assert.match(l, LINE, l);
  assert.ok(h.length < 600, 'a 100,000 character value does not inflate the output');
});

test('B4. describeShape: union over the first `records` objects (default 3, max 5), non-objects skipped first, (k of n) only when not in every record', async () => {
  const r1 = { a: 1, b: 'x', c: { d: true } }, r2 = { a: 2, c: { d: false, e: null } }, r3 = { a: 3, b: 'y', c: {} };
  const r4 = { z: 1 }, r5 = { x: 1 }, r6 = { y: 1 };
  const three = ['a: number', 'b: string (2 of 3)', 'c: object', 'c.d: boolean (2 of 3)', 'c.e: null (1 of 3)'].join('\n');
  assert.equal(await shape(dp(r1, r2, r3, r4, r5, r6)), three);                       // default 3: r4..r6 never examined
  for (const o of [{ records: undefined }, { records: NaN }, { records: '5' }, { records: null }, { records: {} }, { records: [] }, null, 'x', 5, []]) assert.equal(await shape(dp(r1, r2, r3, r4, r5, r6), o), three, JSON.stringify(o));
  const five = ['a: number (3 of 5)', 'b: string (2 of 5)', 'c: object (3 of 5)', 'c.d: boolean (2 of 5)', 'c.e: null (1 of 5)', 'x: number (1 of 5)', 'z: number (1 of 5)'].join('\n');
  assert.equal(await shape(dp(r1, r2, r3, r4, r5, r6), { records: 5 }), five);
  assert.equal(await shape(dp(r1, r2, r3, r4, r5, r6), { records: Infinity }), three, 'not a finite number: the default 3');
  for (const n of [6, 99, 1e9]) assert.equal(await shape(dp(r1, r2, r3, r4, r5, r6), { records: n }), five, 'cap 5 for ' + n);
  assert.equal(await shape(dp(r1, r2, r3, r4, r5, r6), { records: 4 }), ['a: number (3 of 4)', 'b: string (2 of 4)', 'c: object (3 of 4)', 'c.d: boolean (2 of 4)', 'c.e: null (1 of 4)', 'z: number (1 of 4)'].join('\n'));
  assert.equal(await shape(dp(r1, r2, r3, r4, r5, r6), { records: 2 }), ['a: number', 'b: string (1 of 2)', 'c: object', 'c.d: boolean', 'c.e: null (1 of 2)'].join('\n'));
  assert.equal(await shape(dp(r1, r2, r3, r4, r5, r6), { records: 2.9 }), await shape(dp(r1, r2, r3), { records: 2 }));   // floor
  // n is the number actually examined (2 records exist although 3 are asked for): no suffix when a path is in both
  assert.equal(await shape(dp(r1, r2)), ['a: number', 'b: string (1 of 2)', 'c: object', 'c.d: boolean', 'c.e: null (1 of 2)'].join('\n'));
  // non-object items are skipped BEFORE counting the first N
  assert.equal(await shape({ dataPoints: [null, 'str', 7, [], r1, r2, r3, r4] }), three);
  // 1 record: never a suffix
  assert.equal(await shape(dp(r1)), ['a: number', 'b: string', 'c: object', 'c.d: boolean'].join('\n'));
});

test('B5. describeShape: arrays collapse to [], sorting is by path, different types of one path are listed on ONE line', async () => {
  const out = await shape(dp({ nested: [[1]], list: [{ k: true }, { k: false, j: 1 }], empty: [], Zed: 1, _u: 1, abc: 1 }));
  // code-unit order: digits < uppercase < "_" < lowercase; "list" < "list[]" < "list[].j" < "list[].k"
  assert.equal(out, ['Zed: number', '_u: number', 'abc: number', 'empty: array', 'list: array', 'list[]: object', 'list[].j: number', 'list[].k: boolean', 'nested: array', 'nested[]: array', 'nested[][]: number'].join('\n'));
  const mixed = (await shape(dp({ m: 1 }, { m: 's' }))).split('\n');
  assert.equal(mixed.length, 1); assert.match(mixed[0], /^m: (number\|string|string\|number)$/);
  const inArr = (await shape(dp({ l: [1, 'a', null] }))).split('\n');
  assert.equal(inArr[0], 'l: array'); assert.equal(inArr.length, 2); assert.match(inArr[1], /^l\[\]: (null|number|string)(\|(null|number|string))+$/);
});

test('B6. describeShape: only ^[A-Z][A-Z0-9_]{1,40}$ strings are printed, as "string = VALUE"; every other value is not', async () => {
  const cases = [['RUNNING', 'string = RUNNING'], ['AB', 'string = AB'], ['A', 'string'], ['A' + 'B'.repeat(40), 'string = A' + 'B'.repeat(40)], ['A' + 'B'.repeat(41), 'string'],
    ['Running', 'string'], ['running', 'string'], ['RUN-NING', 'string'], ['RUN NING', 'string'], ['1RUN', 'string'], ['_RUN', 'string'], ['HIGH_INTENSITY_2', 'string = HIGH_INTENSITY_2'],
    ['', 'string'], ['RUN\n', 'string'], ['<IMG>', 'string'], [5, 'number'], [null, 'null'], [true, 'boolean']];
  const rec = {}; cases.forEach(([v], i) => { rec['k' + String(i).padStart(2, '0')] = v; });
  assert.equal(await shape(dp(rec)), cases.map(([, t], i) => `k${String(i).padStart(2, '0')}: ${t}`).join('\n'));
  // two records, two enum values on one path: ONE line that names both (exact format not pinned, spec open question 4)
  const two = (await shape(dp({ exercise: { exerciseType: 'RUNNING' } }, { exercise: { exerciseType: 'WALKING' } }))).split('\n').filter(l => l.startsWith('exercise.exerciseType'));
  assert.equal(two.length, 1); assert.match(two[0], /RUNNING/); assert.match(two[0], /WALKING/);
});

test('B7. describeShape: unsafe keys print as ?, never as text; prototype-looking keys neither break nor pollute', async () => {
  const bad = JSON.parse('{"<img src=x onerror=alert(1)>":1,"a b":2,"":3,"' + 'x'.repeat(41) + '":4,"\\u00e9":6,"two\\nlines: string":7,"' + 'x'.repeat(40) + '":5,"ok_Key9":7}');
  const out = await shape(dp(bad));
  assert.equal(out, ['?: number', 'ok_Key9: number', 'x'.repeat(40) + ': number'].join('\n'));   // five unsafe keys end at the same path "?"; "?" (0x3F) < "o" < "x"
  assert.doesNotMatch(out, /[<>=!\u00e9]|onerror|img|lines/);
  const nested = await shape(dp(JSON.parse('{"<script>":{"deep":1}}')));
  assert.equal(nested, '?: object\n?.deep: number');
  // other prototype-looking names are ordinary keys and print as they are (sorted: h < t < v)
  assert.equal(await shape(dp({ toString: 5, hasOwnProperty: true, valueOf: null })), ['hasOwnProperty: boolean', 'toString: number', 'valueOf: null'].join('\n'));
  // owner decision: __proto__, constructor and prototype as keys print as exactly "?" (case-sensitive names; "Constructor" and "__proto" are ordinary safe keys)
  assert.equal(await shape(dp({ constructor: 'x' })), '?: string');
  assert.equal(await shape(dp({ prototype: 'x' })), '?: string');
  assert.equal(await shape(dp({ exercise: { constructor: 1, a: 1 } })), ['exercise: object', 'exercise.?: number', 'exercise.a: number'].join('\n'));   // "?" (0x3F) sorts before "a"
  assert.equal(await shape(dp({ Constructor: 1, __proto: 2, prototypes: 3 })), ['Constructor: number', '__proto: number', 'prototypes: number'].join('\n'));
  // an OWN __proto__ key made by JSON.parse: exactly "?", children listed under it, no pollution
  const p1 = await shape(dp(JSON.parse('{"__proto__":{"polluted":"yes"},"a":1}')));
  assert.equal(p1, ['?: object', '?.polluted: string', 'a: number'].join('\n'));
  assert.equal(await shape(dp(JSON.parse('{"exercise":{"__proto__":1,"a":1}}'))), ['exercise: object', 'exercise.?: number', 'exercise.a: number'].join('\n'));
  assert.doesNotMatch(p1, /__proto__|constructor|prototype/);
  assert.equal({}.polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
  for (const l of p1.split('\n')) assert.match(l, LINE, l);
});

test('B8. describeShape: depth limit 6 and at most 200 path lines then "... more paths"', async () => {
  let deep = 1; for (const k of 'jihgfedcba') deep = { [k]: deep };                 // a.b.c.d.e.f.g.h.i.j
  const lines = (await shape(dp(deep))).split('\n');
  assert.deepEqual(lines, ['a: object', 'a.b: object', 'a.b.c: object', 'a.b.c.d: object', 'a.b.c.d.e: object', 'a.b.c.d.e.f: object']);
  let hugeDepth = { v: 1 }; for (let i = 0; i < 50000; i++) hugeDepth = { n: hugeDepth };
  assert.deepEqual((await shape(dp(hugeDepth))).split('\n'), ['n: object', 'n.n: object', 'n.n.n: object', 'n.n.n.n: object', 'n.n.n.n.n: object', 'n.n.n.n.n.n: object']);
  const few = {}; for (let i = 0; i < 150; i++) few['k' + String(i).padStart(3, '0')] = i;
  const fewOut = (await shape(dp(few))).split('\n'); assert.equal(fewOut.length, 150); assert.doesNotMatch(fewOut.join('\n'), /more paths/);
  const many = {}; for (let i = 0; i < 500; i++) many['k' + String(i).padStart(3, '0')] = i;
  const out = (await shape(dp(many))).split('\n');
  assert.equal(out[out.length - 1], '... more paths');
  assert.ok(out.length === 200 || out.length === 201, 'total lines ' + out.length);          // spec open question 7: 200 path lines + marker, or 199 + marker
  assert.equal(out[0], 'k000: number'); assert.equal(out[198], 'k198: number');                 // the FIRST paths in sorted order are kept
  assert.ok(!out.includes('k499: number'));
  assert.equal(out.filter(l => l === '... more paths').length, 1);
  // the union over five records also respects the cap
  const five = Array.from({ length: 5 }, (_, r) => Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['r' + r + 'k' + String(i).padStart(3, '0'), i])));
  const u = (await shape(dp(...five), { records: 5 })).split('\n'); assert.equal(u[u.length - 1], '... more paths'); assert.ok(u.length <= 201);
});

test('B9. describeShape: empty and garbage input, inherited or __proto__ dataPoints, non-plain objects give exactly "no data points"', async () => {
  const empty = 'no data points';
  const inherited = Object.create({ dataPoints: [{ a: 1 }] });
  for (const j of [undefined, null, 'x', '', 5, NaN, true, Symbol('s'), 10n, [], [{ a: 1 }], {}, { dataPoints: [] }, { dataPoints: 'x' }, { dataPoints: {} }, { dataPoints: null }, { dataPoints: [null, 1, 'a', []] },
    { dataPoints: [[{ a: 1 }]] }, { datapoints: [{ a: 1 }] }, { rollupDataPoints: [{ a: 1 }] }, JSON.parse('{"__proto__":{"dataPoints":[{"a":1}]}}'), inherited, new Map([['dataPoints', [{ a: 1 }]]]), () => 1])
    assert.equal(await shape(j), empty, String(typeof j) + ' ' + (() => { try { return JSON.stringify(j); } catch { return ''; } })());
  assert.equal(inherited.dataPoints.length, 1);
  assert.equal(typeof await shape({ dataPoints: [{}] }), 'string');                       // a record with no keys: the text is not pinned (no throw, a string)
});

test('B10. describeShape: never throws and stays fast (throwing getters, Proxies, changing getters, option getters, 1000 data points, huge values)', async () => {
  const { describeShape } = await load();
  const boom = () => { throw new Error('boom-secret'); };
  const thrower = new Proxy({}, { get: boom, has: boom, ownKeys: boom, getOwnPropertyDescriptor: boom });
  let flip = 0;
  const inputs = [
    { get dataPoints() { boom(); } },
    { dataPoints: [{ get exercise() { boom(); }, ok: 1 }] },
    { dataPoints: [{ exercise: { get inner() { boom(); }, ok: 1 } }] },
    { dataPoints: [{ get a() { return flip++ % 2 ? 'x' : 5; } }, { get a() { return flip++ % 2 ? {} : []; } }] },
    thrower, { dataPoints: thrower }, { dataPoints: [thrower] }, { dataPoints: [{ exercise: thrower }] },
    new Proxy({ dataPoints: [{ a: 1 }] }, { get: boom }), { dataPoints: new Proxy([{ a: 1 }], { get: boom }) },
  ];
  for (const j of inputs) { let s; assert.doesNotThrow(() => { s = describeShape(j); }); assert.equal(typeof s, 'string'); assert.ok(!s.includes('boom-secret')); }
  for (const o of [{ get records() { boom(); } }, { records: { valueOf: boom } }, { records: { toString: boom } }, thrower, { records: Symbol('s') }, { records: 10n }]) {
    let s; assert.doesNotThrow(() => { s = describeShape(dp({ a: 1 }), o); }); assert.equal(typeof s, 'string');
  }
  const t0 = Date.now();
  const thousand = Array.from({ length: 1000 }, (_, i) => ({ ['r' + i]: i, exercise: { interval: { startTime: 'x'.repeat(1000) }, tags: [1, 2, 3] } }));
  const out = describeShape({ dataPoints: thousand });
  assert.ok(Date.now() - t0 < 2000, 'took ' + (Date.now() - t0) + ' ms');
  assert.ok(out.split('\n').length <= 201);
  assert.ok(out.includes('r0: number (1 of 3)') && out.includes('r2: number (1 of 3)') && !out.includes('r3:'), 'only the first 3 of 1000 are examined');
  assert.ok(!out.includes('xxxx'));
});

// ================================================================ summariseExercise
const ex = (s, so, e, eo, type = 'RUNNING') => ({ name: 'users/me/dataTypes/exercise/dataPoints/TEST-ID-1', exercise: { interval: { startTime: s, startUtcOffset: so, endTime: e, endUtcOffset: eo }, exerciseType: type, activeDuration: '1800s', hasGps: false } });

test('B11. summariseExercise: UTC time plus UTC offset -> local time and the local day the session STARTS on; exact shape', async () => {
  const { summariseExercise } = await load();
  // a: 07:15:00.9Z + 3600 s = 08:15:00 (fraction dropped); 07:45Z + 1 h = 08:45
  const a = ex('2026-11-14T07:15:00.9Z', '3600s', '2026-11-14T07:45:00Z', '3600s', 'RUNNING');
  // b: 23:30Z + 1 h = 00:30 on the NEXT day (starts 2026-11-15); end 00:30Z next day + 1 h = 01:30
  const b = ex('2026-11-14T23:30:00Z', '3600s', '2026-11-15T00:30:00Z', '3600s', 'WALKING');
  // c: 00:10:00.9Z - 1 h = 23:10 the PREVIOUS day (starts 2026-11-14); end 00:40Z - 1 h = 23:40
  const c = ex('2026-11-15T00:10:00.9Z', '-3600s', '2026-11-15T00:40:00Z', '-3600s', 'CYCLING');
  const r = summariseExercise({ dataPoints: [a, b, c], nextPageToken: '' });
  assert.equal(r.count, 3);
  assert.deepEqual(Object.keys(r).sort(), ['count', 'records', 'text']);
  assert.deepEqual(r.records, [
    { type: 'RUNNING', localStart: '2026-11-14T08:15:00', localEnd: '2026-11-14T08:45:00', startDay: '2026-11-14' },
    { type: 'WALKING', localStart: '2026-11-15T00:30:00', localEnd: '2026-11-15T01:30:00', startDay: '2026-11-15' },
    { type: 'CYCLING', localStart: '2026-11-14T23:10:00', localEnd: '2026-11-14T23:40:00', startDay: '2026-11-14' }]);
  assert.equal(typeof r.text, 'string'); assert.equal(r.text.split('; ').length, 3);
  // per record: type, localStart, localEnd appear in that order, records in order (the line format itself is not pinned: spec open question 9)
  let at = 0;
  for (const rec of r.records) for (const piece of [rec.type, rec.localStart, rec.localEnd]) { const i = r.text.indexOf(piece, at); assert.ok(i >= at, 'text lacks ' + piece + ' in order: ' + r.text); at = i + piece.length; }
  assert.doesNotMatch(r.text, BAD);
  assert.deepEqual(summariseExercise({ dataPoints: [] }), { count: 0, records: [], text: 'no exercise records' });
  // the owner's own case: a 30-minute run on 2026-11-14 at UTC+0
  assert.deepEqual(summariseExercise(dp(ex('2026-11-14T10:00:00Z', '0s', '2026-11-14T10:30:00Z', '0s'))).records, [{ type: 'RUNNING', localStart: '2026-11-14T10:00:00', localEnd: '2026-11-14T10:30:00', startDay: '2026-11-14' }]);
  // start and end may carry different offsets (a clock change during the session): each is decoded with its own offset. 01:00Z+0 = 01:00; 01:30Z+3600 = 02:30
  assert.deepEqual(summariseExercise(dp(ex('2026-03-29T01:00:00Z', '0s', '2026-03-29T01:30:00Z', '3600s'))).records[0], { type: 'RUNNING', localStart: '2026-03-29T01:00:00', localEnd: '2026-03-29T02:30:00', startDay: '2026-03-29' });
});

test('B12. summariseExercise: type is the first enum-shaped string in a field of `exercise` whose name contains "type"; otherwise ?', async () => {
  const { summariseExercise } = await load();
  const typeOf = rec => summariseExercise(dp(rec)).records[0].type;
  const E = o => ({ exercise: o });
  assert.equal(typeOf(E({ exerciseType: 'RUNNING' })), 'RUNNING');
  assert.equal(typeOf(E({ type: 'WALKING' })), 'WALKING');
  assert.equal(typeOf(E({ activityType: 'CYCLING' })), 'CYCLING');
  assert.equal(typeOf(E({ ActivityTYPE: 'HIKING' })), 'HIKING');                          // case-insensitive name match
  assert.equal(typeOf(E({ activityType: 'RUNNING', exerciseType: 'WALKING' })), 'RUNNING');   // first in key order
  assert.equal(typeOf(E({ exerciseType: 'lowercase', activityType: 'CYCLING' })), 'CYCLING');  // a value of the wrong shape is skipped
  assert.equal(typeOf(E({ exerciseType: 'HIGH_INTENSITY_2' })), 'HIGH_INTENSITY_2');
  for (const v of ['running', 'Running', 'A', 'RUNNING-FAST', 'RUN NING', '1RUN', '<IMG SRC=X>', '', 5, null, true, {}, []]) assert.equal(typeOf(E({ exerciseType: v })), '?', JSON.stringify(v));
  assert.equal(typeOf(E({ sport: 'RUNNING', kind: 'WALKING' })), '?');                    // no "type" in the field name
  assert.equal(typeOf({ type: 'RUNNING', exercise: {} }), '?');                           // a type outside `exercise` does not count
  assert.equal(typeOf({ exerciseType: 'RUNNING' }), '?');
  for (const e of [null, 'x', 5, [], undefined]) assert.equal(typeOf({ exercise: e }), '?', String(e));
  // a type never makes the interval wrong, nor the other way round
  assert.deepEqual(summariseExercise(dp(E({ exerciseType: 'RUNNING' }))).records, [{ type: 'RUNNING', localStart: '?', localEnd: '?', startDay: '?' }]);
});

test('B13. summariseExercise: empty, garbage and hostile input never throws; bad parts are ?; at most 25', async () => {
  const { summariseExercise } = await load();
  const empty = { count: 0, records: [], text: 'no exercise records' };
  for (const j of [{}, null, undefined, 'x', 7, NaN, [], [{ exercise: {} }], { dataPoints: 'x' }, { dataPoints: {} }, { dataPoints: null }, { dataPoints: [null, 1, 'a', []] }, JSON.parse('{"__proto__":{"dataPoints":[{}]}}'),
    Object.create({ dataPoints: [{}] }), new Map([['dataPoints', [{}]]])]) assert.deepEqual(summariseExercise(j), empty, JSON.stringify(j));
  const unknown = { type: '?', localStart: '?', localEnd: '?', startDay: '?' };
  assert.deepEqual(summariseExercise({ dataPoints: [{}] }).records, [unknown]);
  assert.equal(summariseExercise({ dataPoints: [null, 5, 'a', { exercise: null }, { exercise: { interval: 3 } }] }).count, 2);
  assert.deepEqual(summariseExercise({ dataPoints: [{ exercise: { interval: [] } }] }).records, [unknown]);
  // a missing or unusable offset: ? (never guessed as 0); the start offset decides localStart and startDay, the end offset decides localEnd
  for (const o of [undefined, null, '', 'abc', '14400', '4h', '1.5s', '--3s', 'sNaN', 5, '999999999s', {}]) {
    const bothBad = summariseExercise(dp(ex('2026-11-14T10:00:00Z', o, '2026-11-14T10:30:00Z', o))).records[0];
    assert.deepEqual([bothBad.localStart, bothBad.localEnd, bothBad.startDay], ['?', '?', '?'], String(o));
    const endBad = summariseExercise(dp(ex('2026-11-14T10:00:00Z', '0s', '2026-11-14T10:30:00Z', o))).records[0];
    assert.deepEqual([endBad.localStart, endBad.localEnd, endBad.startDay], ['2026-11-14T10:00:00', '?', '2026-11-14'], 'end ' + String(o));
  }
  for (const t of ['yesterday', '<script>', 5, null, '2026-11-14 10:00:00Z', '2026-11-14T10:00:00', '2026-11-14T10:00:00+01:00', '2026-13-45T00:00:00Z', '2026-02-30T00:00:00Z', '2026-11-14T25:00:00Z']) {
    const r = summariseExercise(dp(ex(t, '0s', t, '0s')));
    assert.deepEqual(r.records, [{ type: 'RUNNING', localStart: '?', localEnd: '?', startDay: '?' }], String(t));
    assert.doesNotMatch(r.text, BAD);
  }
  const many = summariseExercise({ dataPoints: Array.from({ length: 40 }, () => ({})) }); assert.equal(many.count, 25); assert.equal(many.records.length, 25);
  const thousand = summariseExercise({ dataPoints: Array.from({ length: 1000 }, () => ex('2026-11-14T10:00:00Z', '0s', '2026-11-14T10:30:00Z', '0s')) }); assert.equal(thousand.count, 25);
  // markup and token-like text in values never reaches the text (type must have the enum shape; times must be UTC strings)
  const mark = summariseExercise(dp({ exercise: { exerciseType: '<img src=x onerror=alert(1)>', interval: { startTime: '<b>x</b>', startUtcOffset: 'ya29.test-token-abc', endTime: 'ann@example.test', endUtcOffset: '0s' } } }));
  assert.doesNotMatch(mark.text, /[<@]|ya29|onerror|<b/);                                 // ">" is not checked: the text legitimately contains "->"
  assert.doesNotMatch(summariseExercise({ dataPoints: [{ exercise: { interval: { startTime: NaN, endTime: Infinity } } }, {}] }).text, BAD);
  const boom = () => { throw new Error('boom'); };
  for (const j of [{ get dataPoints() { boom(); } }, { dataPoints: [{ get exercise() { boom(); } }] }, { dataPoints: [{ exercise: { get interval() { boom(); } } }] }, { dataPoints: [{ exercise: { get exerciseType() { boom(); } } }] },
    new Proxy({}, { get: boom, has: boom, ownKeys: boom, getOwnPropertyDescriptor: boom }), { dataPoints: new Proxy([{}], { get: boom }) }]) {
    let r; assert.doesNotThrow(() => { r = summariseExercise(j); }); assert.equal(typeof r, 'object'); assert.equal(typeof r.text, 'string'); assert.equal(typeof r.count, 'number'); assert.ok(Array.isArray(r.records));
  }
});

// ================================================================ resultSummary with a shape
const TOKEN_SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const mixed = extra => ({ token: { ok: true, expiresIn: 3599, hasRefreshToken: false, scope: TOKEN_SCOPE }, gisError: null, checks: [
  { name: 'identity', status: 200, ok: true, numbers: '' }, { name: 'steps', status: 200, ok: true, numbers: '2026-11-12: 6120' }, { name: 'sleep', status: 200, ok: true, numbers: '' },
  { name: 'Exercise', status: 200, ok: true, numbers: 'RUNNING: 2026-11-14T07:15:00 -> 2026-11-14T07:45:00', ...extra }] });
const HEAD = ['Google Health probe result', 'Sign-in: ok', 'expires_in: 3599', 'refresh_token present: no', 'scope granted: ' + TOKEN_SCOPE, 'identity: HTTP 200 - ok', 'steps: HTTP 200 - ok', 'sleep: HTTP 200 - ok', 'Exercise: HTTP 200 - ok'];
const SHAPE = 'exercise: object\nexercise.exerciseType: string = RUNNING\nexercise.interval.startTime: string';
const BLOCK = ['Exercise shape:', '  exercise: object', '  exercise.exerciseType: string = RUNNING', '  exercise.interval.startTime: string'];

test('B14. resultSummary: "<name> shape:" plus two-space-indented lines are ALWAYS printed; numbers still only when showNumbers === true; old text unchanged', async () => {
  const { resultSummary } = await load();
  const r = mixed({ shape: SHAPE });
  assert.equal(resultSummary(r, false), [...HEAD, ...BLOCK].join('\n'));
  for (const v of [undefined, null, 'true', 1, 'yes', {}]) assert.equal(resultSummary(r, v), [...HEAD, ...BLOCK].join('\n'), String(v));
  const shown = resultSummary(r, true).split('\n');
  const at = shown.indexOf('Exercise shape:');
  assert.ok(at > 0, 'header present with numbers on');
  assert.deepEqual(shown.slice(at, at + 4), BLOCK, 'the shape block is contiguous');
  assert.ok(shown.includes('Exercise numbers: RUNNING: 2026-11-14T07:15:00 -> 2026-11-14T07:45:00'));
  assert.ok(shown.includes('steps numbers: 2026-11-12: 6120'));
  assert.equal(shown.length, HEAD.length + BLOCK.length + 2);                             // exactly the two numbers lines more
  assert.deepEqual(shown.filter(l => !BLOCK.includes(l) && !l.includes(' numbers: ')), HEAD);
  // without any shape the text is exactly what it was before this change
  assert.equal(resultSummary(mixed({}), false), HEAD.join('\n'));
  assert.equal(resultSummary(mixed({}), true), [...HEAD, 'steps numbers: 2026-11-12: 6120', 'Exercise numbers: RUNNING: 2026-11-14T07:15:00 -> 2026-11-14T07:45:00'].join('\n'));
  // a failed check can carry a shape too (the page decides whether it does); the header uses the check name
  const failed = resultSummary({ token: { ok: false }, checks: [{ name: 'Exercise', status: 403, ok: false, message: 'PERMISSION_DENIED (403): no', shape: 'no data points' }] }, false);
  assert.equal(failed, ['Google Health probe result', 'Sign-in: failed', 'Exercise: HTTP 403 - failed: PERMISSION_DENIED (403): no', 'Exercise shape:', '  no data points'].join('\n'));
  assert.equal(resultSummary({ checks: [{ name: 5, status: 200, ok: true, shape: 'a: string' }] }, false), 'Google Health probe result\nSign-in: failed\n?: HTTP 200 - ok\n? shape:\n  a: string');
});

test('B15. resultSummary: an unusable shape adds nothing; shape lines are cleaned; a hostile shape cannot start a top-level line; never throws', async () => {
  const { resultSummary } = await load();
  const plain = resultSummary(mixed({}), false);
  for (const s of [undefined, null, 5, true, {}, [], ['a: string'], '', '   ', '\n\n', Symbol('s'), () => 1]) assert.equal(resultSummary(mixed({ shape: s }), false), plain, String(typeof s) + ' ' + String(s === '' ? 'empty' : ''));
  const dirty = resultSummary(mixed({ shape: 'ok: string\nbad ya29.SECRETTOKEN123 token\nwho ann@example.test\ta\u0000b: number' }), false).split('\n');
  const block = dirty.slice(dirty.indexOf('Exercise shape:') + 1);
  assert.equal(block.length, 3);
  assert.equal(block[0], '  ok: string'); assert.equal(block[1], '  bad [token removed] token'); assert.equal(block[2], '  who [email removed] a b: number');   // tab and NUL become one space
  assert.doesNotMatch(dirty.join('\n'), /SECRETTOKEN|ya29|@/);
  // injected line breaks (\r, \n, a fake header) stay inside the indented block
  const inj = resultSummary(mixed({ shape: 'x: string\r\nSign-in: ok\nExercise: HTTP 200 - ok\r\n\u2028Evil: 1' }), false).split('\n');
  const after = inj.slice(inj.indexOf('Exercise shape:') + 1);
  assert.ok(after.length >= 1);
  for (const l of after) assert.ok(l.startsWith('  '), 'not indented: ' + JSON.stringify(l));
  assert.equal(inj.filter(l => l === 'Sign-in: ok').length, 1);
  assert.equal(inj.filter(l => l === 'Exercise: HTTP 200 - ok').length, 1);
  for (const l of resultSummary(mixed({ shape: 'x: string\u0000\u0007\u001b[31m' }), false).split('\n')) assert.doesNotMatch(l, /[\u0000-\u0008\u000b-\u001f\u007f]/);
  // huge and odd shapes: no throw, always a string, header intact
  for (const s of ['a: string\n'.repeat(5000), 'z'.repeat(20000), '\n'.repeat(1000) + 'a: string', 'é'.repeat(500), '<img src=x onerror=alert(1)>']) {
    let out; assert.doesNotThrow(() => { out = resultSummary(mixed({ shape: s }), true); }); assert.equal(typeof out, 'string'); assert.ok(out.startsWith('Google Health probe result\nSign-in: ok\n')); assert.doesNotMatch(out, BAD);
  }
  assert.ok(resultSummary(mixed({ shape: '<img src=x onerror=alert(1)>' }), false).includes('  <img src=x onerror=alert(1)>'), 'markup is kept as text (the page writes it with textContent)');
});

// ================================================================ B16 purity (the export list is P18 in tests/google-health-probe.test.js)
test('B16. probe.js stays pure: no DOM, network, storage or console in its code, and the three new helpers are exported functions', async () => {
  assert.equal(typeof globalThis.document, 'undefined'); assert.equal(typeof globalThis.window, 'undefined');
  const P = await load();
  for (const k of ['buildExerciseUrl', 'describeShape', 'summariseExercise']) assert.equal(typeof P[k], 'function', k);
  const code = stripComments(read(PROBE));
  assert.doesNotMatch(code, /\b(document|window|fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator|console|process)\b/);
  assert.doesNotMatch(code, /\beval\s*\(|new\s+Function|innerHTML/);
});

// ================================================================ B17 page (WEAK)
test('B17. (weak) source: page has #check-exercise, imports and uses the three helpers, passes a shape; probe builds the exercise endpoint; no new scope', () => {
  const html = read(PAGE), js = read(PROBE), code = stripComments(html);
  assert.match(html, /\bid\s*=\s*["']check-exercise["']/);
  for (const id of ['clientId', 'signIn', 'showNumbers', 'copySummary', 'status', 'tokenInfo', 'gisError', 'check-identity', 'check-steps', 'check-sleep', 'summary']) assert.match(html, new RegExp('\\bid\\s*=\\s*["\']' + id + '["\']'), 'existing id stays: ' + id);
  const imp = code.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/probe\.js['"]/);
  assert.ok(imp, 'imports from ./probe.js');
  for (const n of ['buildExerciseUrl', 'summariseExercise', 'describeShape', 'resultSummary', 'buildSleepUrl', 'buildDailyRollUpBody']) assert.ok(imp[1].split(',').map(s => s.trim()).includes(n), 'imports ' + n);
  for (const call of ['buildExerciseUrl\\s*\\(', 'summariseExercise\\s*\\(', 'describeShape\\s*\\(']) assert.match(code, new RegExp(call), 'calls ' + call);
  assert.match(code, /['"]Exercise['"]/, 'a check named Exercise');
  assert.match(code, /\bshape\s*:/, 'passes a shape field to the summary');
  assert.match(code, /textContent/);
  assert.match(js, /dataTypes\/exercise\/dataPoints/); assert.match(js, /exercise\.interval\.civil_start_time/); assert.match(js, /page_size=25/);
  assert.doesNotMatch(stripComments(js), /dataTypes\/exercise\/dataPoints:/, 'no :reconcile or other custom method on the exercise endpoint');
  const all = html + '\n' + js;
  assert.deepEqual([...new Set([...all.matchAll(/googlehealth\.[A-Za-z0-9_.]+/g)].map(m => m[0]))].sort(), ['googlehealth.activity_and_fitness.readonly', 'googlehealth.sleep.readonly']);
  assert.doesNotMatch(all, /googlehealth\.(exercise|workout)/i);
  assert.doesNotMatch(code, /\bconsole\.|localStorage|sessionStorage|innerHTML/);
  // the day-range control (owner decision): label "Days to read", <select id="days"> with 3 (default), 7, 14, 31, read in code and passed to the builders
  assert.match(html, /<label\b[^>]*\bfor\s*=\s*["']days["'][^>]*>\s*Days to read\s*<\/label>/);
  const sel = html.match(/<select\b[^>]*\bid\s*=\s*["']days["'][^>]*>([\s\S]*?)<\/select>/);
  assert.ok(sel, '<select id="days">');
  const opts = [...sel[1].matchAll(/<option\b([^>]*)>\s*([^<]*?)\s*<\/option>/g)].map(m => ({ value: (m[1].match(/\bvalue\s*=\s*["']([^"']*)["']/) || [])[1], text: m[2], selected: /\bselected\b/.test(m[1]) }));
  assert.deepEqual(opts.map(o => o.value), ['3', '7', '14', '31']); assert.deepEqual(opts.map(o => o.text), ['3', '7', '14', '31']);
  const sels = opts.filter(o => o.selected).map(o => o.value); assert.ok(sels.length === 0 || (sels.length === 1 && sels[0] === '3'), 'the default is 3');
  assert.match(code, /(\$\(\s*['"]days['"]\s*\)|getElementById\(\s*['"]days['"]\s*\))\s*\.value/, 'the page reads #days.value');
  for (const b of ['buildDailyRollUpBody', 'buildSleepUrl', 'buildExerciseUrl']) assert.doesNotMatch(code, new RegExp(b + '\\s*\\([^)]*,\\s*3\\s*\\)'), b + ' is no longer called with a fixed 3');
});

// ================================================================ B18 docs (WEAK)
const section = (doc, titleRe) => {
  const lines = doc.split('\n'); const i = lines.findIndex(l => /^#{1,3}\s/.test(l) && titleRe.test(l)); if (i < 0) return null;
  let j = i + 1; while (j < lines.length && !/^#{1,2}\s/.test(lines[j])) j++; return lines.slice(i, j).join('\n');
};
test('B18. (weak) docs: the setup guide has a "Workouts check" section with the required advice; DECISIONS has the new entry', () => {
  const doc = read('docs/GOOGLE-HEALTH-SETUP.md'), s = section(doc, /workouts check/i);
  assert.ok(s, 'a heading "Workouts check" in docs/GOOGLE-HEALTH-SETUP.md');
  assert.match(s, /workout/i);
  assert.match(s, /no new (permission|scope)/i);                                         // the same two permissions are enough
  assert.match(s, /Days to read/); assert.match(s, /\b31\b/);                            // choose 31 in the "Days to read" list
  assert.match(s, /Exercise shape/);                                                     // what to send back
  assert.match(s, /Copy result summary/);
  assert.ok(s.length < 2500, 'a short section');
  assert.doesNotMatch(doc, /GOCSPX-|ya29\.[A-Za-z0-9_-]{8,}|client_secret\s*["':=]/i);
  const dec = read('docs/DECISIONS.md');
  const m = dec.match(/^## D(\d+)\.[^\n]*(?:workout|exercise)[^\n]*probe[^\n]*$|^## D(\d+)\.[^\n]*probe[^\n]*(?:workout|exercise)[^\n]*$/im);
  assert.ok(m, 'DECISIONS.md needs "## D<n>. Google Health probe ... workouts ..."');
  assert.ok(Number(m[1] || m[2]) >= 65, 'a NEW decision number (the last on this branch is D64)');
  const body = section(dec, /^## D\d+\.[^\n]*(?:workout|exercise)[^\n]*probe|^## D\d+\.[^\n]*probe[^\n]*(?:workout|exercise)/i);
  assert.ok(body, 'entry body');
  assert.match(body, /shape/i); assert.match(body, /activity_and_fitness|same scope|no new scope/i); assert.match(body, /field names?/i); assert.match(body, /values?/i);
});
