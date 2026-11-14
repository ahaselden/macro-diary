// Spec: docs/specs/google-health-import.md (domain half). Test-designer file, written before the implementation.
// Golden values are hand-computed from the spec and from first principles (UTC arithmetic done by hand in the comments), never taken from the code.
// All data is made up. The module is imported inside each test so that a missing module/export fails THAT test, not the whole file.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const H = () => import('../js/domain/health-import.js');
const fixed = m => () => m;
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const table = async text => (await H()).parseCsvTable(text);
const rowsOf = async text => (await table(text)).rows;

// ---------------------------------------------------------------- 1, 2: CSV
test('1. parseCsv: BOM, CRLF/LF/CR, quotes, doubled quotes, embedded commas and line breaks, blank lines, no final newline', async () => {
  const { parseCsv } = await H();
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r1,2\r'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('﻿a,b\n1,2'), [['a', 'b'], ['1', '2']], 'BOM dropped, no final newline needed');
  assert.deepEqual(parseCsv('x,y\n"Walk, brisk","He said ""hi"""\n'), [['x', 'y'], ['Walk, brisk', 'He said "hi"']]);
  assert.deepEqual(parseCsv('x,y\n"line1\nline2",z\r\n'), [['x', 'y'], ['line1\nline2', 'z']]);
  assert.deepEqual(parseCsv('x,y\n"a\r\nb",z\n'), [['x', 'y'], ['a\r\nb', 'z']]);
  assert.deepEqual(parseCsv('a,b\n\n\r\n1,2\n\n'), [['a', 'b'], ['1', '2']], 'completely empty lines are skipped');
  assert.deepEqual(parseCsv('a,,c\n,,\n'), [['a', '', 'c'], ['', '', '']], 'empty cells stay; a line of separators is not an empty line');
  assert.deepEqual(parseCsv('a,b\n1'), [['a', 'b'], ['1']], 'short rows are returned short');
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('﻿'), []);
});

test('1b. parseCsv: an unterminated quote takes the rest as one cell; non-strings give []; never throws', async () => {
  const { parseCsv } = await H();
  assert.deepEqual(parseCsv('a,b\n1,"never closed\n2,3\n'), [['a', 'b'], ['1', 'never closed\n2,3\n']]);
  for (const v of [undefined, null, 5, {}, [], true, NaN, () => 'a,b', Symbol.iterator]) assert.deepEqual(parseCsv(v), [], String(typeof v));
  assert.doesNotThrow(() => parseCsv('"'.repeat(100001)));
  assert.doesNotThrow(() => parseCsv('a,'.repeat(200000) + '\n'));
});

test('2. parseCsvTable: normalised headers, rows as objects, first duplicate wins, prototype names ignored, short rows filled, extra cells ignored, empty rows skipped', async () => {
  const t = await table(' Timestamp ,STEPS,Data   Source\r\n2026-11-05T12:00:00Z,5,Versa 2\r\n');
  assert.deepEqual(t.columns, ['timestamp', 'steps', 'data_source']);
  assert.deepEqual(t.rows, [{ timestamp: '2026-11-05T12:00:00Z', steps: '5', data_source: 'Versa 2' }]);
  const dup = await table('a,b,a\n1,2,3\n');
  assert.deepEqual(dup.rows, [{ a: '1', b: '2' }], 'the first column of a duplicated name wins');
  const proto = await table('__proto__,constructor,prototype,ok\n1,2,3,4\n');
  assert.deepEqual(proto.columns, ['ok']);
  assert.deepEqual(proto.rows, [{ ok: '4' }]);
  assert.equal(Object.getPrototypeOf(proto.rows[0]), Object.prototype); assert.equal(({}).ok, undefined);
  const short = await table('a,b,c\n1\n1,2,3,4,5\n,,\n\n');
  assert.deepEqual(short.rows, [{ a: '1', b: '', c: '' }, { a: '1', b: '2', c: '3' }], 'short row filled with empty text, extra cells ignored, all-empty row skipped');
  assert.deepEqual(await table('a,b\n'), { columns: ['a', 'b'], rows: [] });
  assert.deepEqual(await table(''), { columns: [], rows: [] });
  assert.deepEqual(await table(null), { columns: [], rows: [] });
  const withBom = await table('﻿timestamp,steps\n1,2\n');
  assert.deepEqual(withBom.columns, ['timestamp', 'steps'], 'the BOM must not stick to the first header name');
});

// ---------------------------------------------------------------- 3: parseInstant
test('3. parseInstant: accepted forms give the UTC milliseconds, everything else NaN', async () => {
  const { parseInstant } = await H();
  const u = (...a) => Date.UTC(...a);
  assert.equal(parseInstant('2026-11-04T05:00:00Z'), u(2026, 10, 4, 5, 0, 0));
  assert.equal(parseInstant('2026-11-04 05:00:00'), u(2026, 10, 4, 5, 0, 0), 'space instead of T, no offset = UTC');
  assert.equal(parseInstant('2026-11-04T05:00:00'), u(2026, 10, 4, 5, 0, 0));
  assert.equal(parseInstant('2026-11-04T05:00:00.123Z'), u(2026, 10, 4, 5, 0, 0) + 123);
  assert.equal(parseInstant('2026-11-04T00:00:00-05:00'), u(2026, 10, 4, 5, 0, 0));
  assert.equal(parseInstant('2026-11-04T10:30:00+05:30'), u(2026, 10, 4, 5, 0, 0));
  assert.equal(parseInstant('2026-11-04 00:00:00-05:00'), u(2026, 10, 4, 5, 0, 0));
  assert.equal(parseInstant('2024-02-29T12:00:00Z'), u(2024, 1, 29, 12, 0, 0), 'a real leap day');
  assert.equal(parseInstant('1990-01-01T00:00:00Z'), u(1990, 0, 1)); assert.equal(parseInstant('2099-12-31T23:59:59Z'), u(2099, 11, 31, 23, 59, 59));
  const bad = ['', ' ', 'x', 'null', '2026-11-04', '2026-11-04T05:00Z', '2026-13-01T00:00:00Z', '2026-00-10T00:00:00Z', '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-11-31T00:00:00Z',
    '2026-11-04T24:00:00Z', '2026-11-04T05:61:00Z', '2026-11-04T05:00:61Z', '1989-12-31T23:59:59Z', '2100-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '9999-12-31T23:59:59Z',
    '2026-11-04T05:00:00Zjunk', '<img src=x onerror=1>', '2026-11-04T05:00:00'.repeat(2), null, undefined, 5, NaN, {}, [], true, () => 1];
  for (const v of bad) assert.ok(Number.isNaN((() => { try { return parseInstant(v); } catch (e) { return 'threw ' + e.message; } })()), 'should be NaN: ' + String(v));
});

// ---------------------------------------------------------------- 4-8: steps
const STEPS_CSV = ['timestamp,steps,data source',
  '2026-11-05T05:59:00Z,100,Versa 2', '2026-11-05T06:00:00Z,200,Versa 2', '2026-11-05T06:01:00Z,50,Versa 2',
  '2026-11-05T12:00:00Z,300,Phone Health Connect', '2026-11-05T13:00:00Z,20,Phone Health Connect', '2026-11-06T05:59:59Z,500,Phone Health Connect',
  '2026-11-05T20:00:00Z,1000,Versa 2', ''].join('\n');

test('4. stepTotalsBySource: local days from a fixed offset (negative, zero, positive), totals per source (hand computed)', async () => {
  const { stepTotalsBySource } = await H(), rows = await rowsOf(STEPS_CSV);
  // UTC-6: 05:59:00Z is 23:59 the evening before; 06:00:00Z is midnight; 2026-11-06T05:59:59Z is still 2026-11-05 locally.
  // 2026-11-05: Versa 200 + 50 + 1000 = 1250, Phone 300 + 20 + 500 = 820. 2026-11-04: Versa 100.
  assert.deepEqual(stepTotalsBySource(rows, fixed(-360)), { '2026-11-04': { 'Versa 2': 100 }, '2026-11-05': { 'Versa 2': 1250, 'Phone Health Connect': 820 } });
  // UTC: 2026-11-05 Versa 100 + 200 + 50 + 1000 = 1350, Phone 300 + 20 = 320; 2026-11-06 Phone 500.
  assert.deepEqual(stepTotalsBySource(rows, fixed(0)), { '2026-11-05': { 'Versa 2': 1350, 'Phone Health Connect': 320 }, '2026-11-06': { 'Phone Health Connect': 500 } });
  // UTC+5:30: 06:00Z = 11:30, 20:00Z = 01:30 the NEXT day, 2026-11-06T05:59:59Z = 11:29:59 on the 6th.
  // 2026-11-05: Versa 100 + 200 + 50 = 350, Phone 300 + 20 = 320. 2026-11-06: Versa 1000, Phone 500.
  assert.deepEqual(stepTotalsBySource(rows, fixed(330)), { '2026-11-05': { 'Versa 2': 350, 'Phone Health Connect': 320 }, '2026-11-06': { 'Versa 2': 1000, 'Phone Health Connect': 500 } });
  const edge = await rowsOf('timestamp,steps,data source\n2026-11-05T18:29:59Z,1,W\n2026-11-05T18:30:00Z,2,W\n');
  assert.deepEqual(stepTotalsBySource(edge, fixed(330)), { '2026-11-05': { W: 1 }, '2026-11-06': { W: 2 } }, '18:30:00Z is midnight at UTC+5:30');
});

test('5. a daylight-saving offset function puts rows on the right local days across the change (a fixed offset would not)', async () => {
  const { stepTotalsBySource } = await H();
  // US Central 2026: UTC-5 (CDT) until 2026-11-01T07:00:00Z, then UTC-6 (CST).
  const chicago = ms => (ms < Date.UTC(2026, 10, 1, 7, 0, 0) ? -300 : -360);
  const rows = await rowsOf(['timestamp,steps,data source', '2026-11-01T04:59:59Z,1,W', '2026-11-01T05:00:00Z,1,W', '2026-11-01T06:59:59Z,1,W', '2026-11-01T07:00:00Z,1,W',
    '2026-11-02T05:59:59Z,1,W', '2026-11-02T06:00:00Z,1,W'].join('\n'));
  // 04:59:59Z = 23:59:59 on Oct 31 (CDT); 05:00:00Z = midnight Nov 1; 06:59:59Z = 01:59:59 CDT; 07:00:00Z = 01:00:00 CST;
  // 2026-11-02T05:59:59Z = 23:59:59 CST on Nov 1; 06:00:00Z = midnight Nov 2.
  assert.deepEqual(stepTotalsBySource(rows, chicago), { '2026-10-31': { W: 1 }, '2026-11-01': { W: 4 }, '2026-11-02': { W: 1 } });
  assert.deepEqual(stepTotalsBySource(rows, fixed(-300)), { '2026-10-31': { W: 1 }, '2026-11-01': { W: 3 }, '2026-11-02': { W: 2 } }, 'sanity: a wrong fixed offset gives another answer');
});

test('5b. the offset function is called with the UTC instant in milliseconds', async () => {
  const { stepTotalsBySource } = await H(), seen = [];
  stepTotalsBySource(await rowsOf('timestamp,steps,data source\n2026-11-05T12:00:00Z,5,W\n'), ms => { seen.push(ms); return 0; });
  assert.ok(seen.length >= 1 && seen.every(x => x === Date.UTC(2026, 10, 5, 12, 0, 0)), JSON.stringify(seen));
});

test('6. chooseStepTotal is the one source rule: the LARGEST total, never the sum; dailySteps applies it per local day', async () => {
  const { chooseStepTotal, dailySteps } = await H();
  assert.equal(chooseStepTotal({ 'Versa 2': 1250, 'Phone Health Connect': 820 }), 1250);
  assert.equal(chooseStepTotal({ phone: 820, watch: 1250, other: 3 }), 1250);
  assert.equal(chooseStepTotal({ a: 5, b: 5 }), 5, 'tie');
  assert.equal(chooseStepTotal({ only: 42 }), 42);
  for (const v of [{}, { a: 0 }, { a: -5 }, { a: NaN, b: Infinity }, { a: 'x' }, null, undefined, 'x', 5, [], true]) assert.equal(chooseStepTotal(v), 0, JSON.stringify(v));
  assert.equal(chooseStepTotal({ a: 'x', b: 3, c: null, d: -9, e: NaN }), 3, 'non-numbers and negatives are not candidates');
  assert.equal(chooseStepTotal(JSON.parse('{"__proto__": 5, "a": 3}')), 5, 'an own key called __proto__ is just a source');
  assert.deepEqual(dailySteps(await rowsOf(STEPS_CSV), fixed(-360)), { '2026-11-04': 100, '2026-11-05': 1250 }, 'not 2070 (the sum) and not 820 (the phone)');
  // the larger source can differ from day to day
  const two = await rowsOf('timestamp,steps,data source\n2026-11-05T12:00:00Z,800,Phone\n2026-11-05T12:01:00Z,100,Watch\n2026-11-06T12:00:00Z,100,Phone\n2026-11-06T12:01:00Z,900,Watch\n');
  assert.deepEqual(dailySteps(two, fixed(0)), { '2026-11-05': 800, '2026-11-06': 900 });
});

test('6b. dailySteps: zero days omitted, rounding, a missing source is "unknown", the day is capped at 200000', async () => {
  const { dailySteps, stepTotalsBySource } = await H();
  assert.deepEqual(dailySteps(await rowsOf('timestamp,steps,data source\n2026-11-05T12:00:00Z,0,W\n2026-11-06T12:00:00Z,0.4,W\n'), fixed(0)), {}, 'a day whose total is 0 (or rounds to 0) is omitted');
  assert.deepEqual(dailySteps(await rowsOf('timestamp,steps,data source\n2026-11-05T12:00:00Z,1.5,W\n2026-11-05T12:01:00Z,1.4,W\n'), fixed(0)), { '2026-11-05': 3 }, '2.9 rounds to 3');
  assert.deepEqual(stepTotalsBySource(await rowsOf('timestamp,steps\n2026-11-05T12:00:00Z,7\n'), fixed(0)), { '2026-11-05': { unknown: 7 } }, 'no source column');
  assert.deepEqual(stepTotalsBySource(await rowsOf('timestamp,steps,data source\n2026-11-05T12:00:00Z,7,\n2026-11-05T12:01:00Z,1,  \n'), fixed(0)), { '2026-11-05': { unknown: 8 } });
  assert.deepEqual(stepTotalsBySource(await rowsOf('timestamp,steps,data_source\n2026-11-05T12:00:00Z,7,W\n'), fixed(0)), { '2026-11-05': { W: 7 } }, 'data_source spelling works too');
  const long = 'S'.repeat(100);
  assert.deepEqual(stepTotalsBySource(await rowsOf(`timestamp,steps,data source\n2026-11-05T12:00:00Z,7,${long}\n`), fixed(0)), { '2026-11-05': { ['S'.repeat(60)]: 7 } }, 'source name cut to 60');
  const big = await rowsOf(['timestamp,steps,data source', ...[0, 1, 2].map(i => `2026-11-05T12:0${i}:00Z,100000,W`)].join('\n'));
  assert.deepEqual(dailySteps(big, fixed(0)), { '2026-11-05': 200000 }, '3 x 100000 is capped at 200000');
});

test('7. mergeStepTotals sums per source (a local day can span two monthly files), equals one pass over both, changes no input', async () => {
  const { mergeStepTotals, stepTotalsBySource } = await H();
  const a = deepFreeze({ '2026-11-05': { W: 100, P: 50 } }), b = deepFreeze({ '2026-11-05': { W: 20 }, '2026-11-06': { P: 7 } });
  assert.deepEqual(mergeStepTotals(a, b), { '2026-11-05': { W: 120, P: 50 }, '2026-11-06': { P: 7 } });
  assert.deepEqual(mergeStepTotals(b, a), mergeStepTotals(a, b), 'order does not matter');
  assert.deepEqual(mergeStepTotals({}, {}), {});
  assert.deepEqual(mergeStepTotals(undefined, a), a); assert.notEqual(mergeStepTotals(undefined, a), a, 'a NEW object');
  const all = (await rowsOf(STEPS_CSV));
  const one = stepTotalsBySource(all, fixed(-360)), split = mergeStepTotals(stepTotalsBySource(all.slice(0, 3), fixed(-360)), stepTotalsBySource(all.slice(3), fixed(-360)));
  assert.deepEqual(split, one);
});

test('8. hostile step rows are ignored or contained', async () => {
  const { stepTotalsBySource, dailySteps } = await H();
  const lines = ['timestamp,steps,data source',
    '2026-11-05T12:00:00Z,5 ,W', '2026-11-05T12:00:00Z,100000,W', '2026-11-05T12:00:00Z,7,W',                       // valid (a trailing space is trimmed; 100000 is the per-row maximum)
    '2026-11-05T12:00:00Z,abc,W', '2026-11-05T12:00:00Z,-5,W', '2026-11-05T12:00:00Z,1e3,W', '2026-11-05T12:00:00Z,0x10,W', '2026-11-05T12:00:00Z,NaN,W',
    '2026-11-05T12:00:00Z,Infinity,W', '2026-11-05T12:00:00Z,,W', '2026-11-05T12:00:00Z,100001,W', `2026-11-05T12:00:00Z,${'9'.repeat(400)},W`, '2026-11-05T12:00:00Z,+5,W',
    '2026-13-40T00:00:00Z,5,W', '1969-12-31T23:59:59Z,5,W', '2150-01-01T00:00:00Z,5,W', 'garbage,5,W', ',5,W', '12345,5,W', '2026-11-05,5,W',
    '2026-11-05T12:00:00Z,3,__proto__', '2026-11-05T12:00:00Z,4,constructor', '2026-11-05T12:00:00Z', 'only-one-cell'];
  const rows = await rowsOf(lines.join('\n'));
  const out = stepTotalsBySource(rows, fixed(0));
  assert.deepEqual(Object.keys(out), ['2026-11-05']);
  assert.deepEqual(out['2026-11-05'], { W: 100012, unknown: 7 });
  assert.equal(Object.getPrototypeOf(out['2026-11-05']), Object.prototype); assert.equal(({}).W, undefined);
  assert.deepEqual(dailySteps(rows, fixed(0)), { '2026-11-05': 100012 });
  // objects that are not rows at all
  assert.doesNotThrow(() => stepTotalsBySource([null, undefined, 5, 'x', [], {}, { timestamp: {}, steps: [] }, { timestamp: '2026-11-05T12:00:00Z', steps: 5 }, { timestamp: '2026-11-05T12:00:00Z', steps: 5, data_source: {} }], fixed(0)));
});

// ---------------------------------------------------------------- 9, 10: sleep
const SLEEP_HEAD = 'sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source';
const sleepLine = (id, type, asleep, so, start, eo, end) => [id, type, '', '0', '5', asleep, '10', '5', '5', so, start, eo, end, 'Versa 2'].join(',');

test('9. sleepByDay: a sleep belongs to the local day it ENDS; naps are summed; the main sleep gives the times; duplicates once; the offset columns are ignored', async () => {
  const { sleepByDay } = await H();
  const rows = await rowsOf([SLEEP_HEAD,
    sleepLine('s1', 'STAGES', 420, '-06:00', '2026-11-04T05:00:00Z', '-06:00', '2026-11-04T13:00:00Z'),     // ends 07:00 local on the 4th
    sleepLine('s2', 'CLASSIC', 45, '-06:00', '2026-11-04T19:00:00Z', '-06:00', '2026-11-04T20:00:00Z'),    // nap, ends 14:00 local on the 4th
    sleepLine('s3', 'STAGES', 300, '-06:00', '2026-11-05T01:00:00Z', '-06:00', '2026-11-05T06:30:00Z'),    // starts 19:00 on the 4th, ends 00:30 on the 5th: the 5th
    sleepLine('s4', 'STAGES', 450, '+01:00', '2026-11-05T21:00:00Z', '+01:00', '2026-11-06T05:30:00Z'),    // its own offset says the 6th; the device (UTC-6) says 23:30 on the 5th
    sleepLine('s1', 'STAGES', 999, '-06:00', '2026-11-04T01:00:00Z', '-06:00', '2026-11-04T09:00:00Z'),    // same id again (overlapping yearly files): ignored
    ''].join('\r\n'));
  assert.deepEqual(sleepByDay(rows, fixed(-360)), {
    '2026-11-04': { sleepMinutes: 465, sleepStart: '2026-11-04T05:00:00Z', sleepEnd: '2026-11-04T13:00:00Z' },        // 420 + 45, main sleep s1
    '2026-11-05': { sleepMinutes: 750, sleepStart: '2026-11-05T21:00:00Z', sleepEnd: '2026-11-06T05:30:00Z' },        // 300 + 450, main sleep s4 (450 > 300)
  });
});

test('9b. sleepByDay: tie for the main sleep goes to the one that ends later; times are written as UTC without milliseconds; empty ids all count', async () => {
  const { sleepByDay } = await H();
  const tie = await rowsOf([SLEEP_HEAD,
    sleepLine('a', 'STAGES', 50, '-06:00', '2026-11-07T08:00:00Z', '-06:00', '2026-11-07T09:00:00Z'),
    sleepLine('b', 'STAGES', 50, '-06:00', '2026-11-07T15:00:00Z', '-06:00', '2026-11-07T16:00:00Z')].join('\n'));
  for (const rs of [tie, [...tie].reverse()]) assert.deepEqual(sleepByDay(rs, fixed(-360)), { '2026-11-07': { sleepMinutes: 100, sleepStart: '2026-11-07T15:00:00Z', sleepEnd: '2026-11-07T16:00:00Z' } });
  const fmtRows = await rowsOf([SLEEP_HEAD, sleepLine('f', 'STAGES', 90, '-06:00', '2026-11-08 00:00:00-06:00', '-06:00', '2026-11-08 08:00:00.000Z')].join('\n'));
  assert.deepEqual(sleepByDay(fmtRows, fixed(-360)), { '2026-11-08': { sleepMinutes: 90, sleepStart: '2026-11-08T06:00:00Z', sleepEnd: '2026-11-08T08:00:00Z' } });
  const noId = await rowsOf([SLEEP_HEAD, sleepLine('', 'STAGES', 10, '-06:00', '2026-11-09T08:00:00Z', '-06:00', '2026-11-09T09:00:00Z'), sleepLine('', 'STAGES', 20, '-06:00', '2026-11-09T10:00:00Z', '-06:00', '2026-11-09T11:00:00Z')].join('\n'));
  assert.equal(sleepByDay(noId, fixed(-360))['2026-11-09'].sleepMinutes, 30);
  const minimal = await rowsOf('sleep_id,minutes_asleep,sleep_start,sleep_end\nm1,60,2026-11-10T08:00:00Z,2026-11-10T09:00:00Z\n');
  assert.deepEqual(sleepByDay(minimal, fixed(-360)), { '2026-11-10': { sleepMinutes: 60, sleepStart: '2026-11-10T08:00:00Z', sleepEnd: '2026-11-10T09:00:00Z' } }, 'missing and extra columns are fine');
});

test('10. hostile sleep rows are ignored; minutes are rounded and capped; a zero-minute day is omitted', async () => {
  const { sleepByDay } = await H();
  const line = (id, asleep, start, end) => `${id},${asleep},${start},${end}`;
  const rows = await rowsOf(['sleep_id,minutes_asleep,sleep_start,sleep_end',
    line('h1', 100, '2026-11-10T10:00:00Z', '2026-11-10T09:00:00Z'),            // ends before it starts
    line('h1b', 100, '2026-11-10T10:00:00Z', '2026-11-10T10:00:00Z'),           // zero length
    line('h2', 'abc', '2026-11-11T08:00:00Z', '2026-11-11T12:00:00Z'), line('h3', -5, '2026-11-12T08:00:00Z', '2026-11-12T12:00:00Z'), line('h4', '', '2026-11-13T08:00:00Z', '2026-11-13T12:00:00Z'),
    line('h5', '1e3', '2026-11-14T08:00:00Z', '2026-11-14T12:00:00Z'), line('h5b', 'NaN', '2026-11-14T08:00:00Z', '2026-11-14T12:00:00Z'),
    line('h6', 100, '2026-11-14T10:00:00Z', '2026-11-15T12:00:01Z'),            // longer than 24 hours
    line('h7', 0, '2026-11-16T08:00:00Z', '2026-11-16T12:00:00Z'),              // zero minutes: day omitted
    line('h8', '90.6', '2026-11-17T10:00:00Z', '2026-11-17T12:00:00Z'),         // rounds to 91
    line('h9', 5000, '2026-11-17T16:00:00Z', '2026-11-18T12:00:00Z'),           // 20 h span, absurd minutes: capped at 1440
    line('__proto__', 60, '2026-11-19T11:00:00Z', '2026-11-19T12:00:00Z'),       // a hostile id is just an id
    line('h11', 60, 'x', '2026-11-20T12:00:00Z'), line('h12', 60, '2026-11-20T10:00:00Z', ''), line('h13', 60, '1970-01-01T00:00:00Z', '1970-01-01T08:00:00Z'),
    'h14', ''].join('\n'));
  const out = sleepByDay(rows, fixed(-360));
  assert.deepEqual(Object.keys(out).sort(), ['2026-11-17', '2026-11-18', '2026-11-19']);
  assert.equal(out['2026-11-17'].sleepMinutes, 91);
  assert.deepEqual(out['2026-11-18'], { sleepMinutes: 1440, sleepStart: '2026-11-17T16:00:00Z', sleepEnd: '2026-11-18T12:00:00Z' });
  assert.deepEqual(out['2026-11-19'], { sleepMinutes: 60, sleepStart: '2026-11-19T11:00:00Z', sleepEnd: '2026-11-19T12:00:00Z' });
  const many = await rowsOf(['sleep_id,minutes_asleep,sleep_start,sleep_end', ...Array.from({ length: 5 }, (_, i) => `m${i},400,2026-11-21T0${i}:00:00Z,2026-11-21T1${i}:00:00Z`)].join('\n'));
  assert.equal(sleepByDay(many, fixed(0))['2026-11-21'].sleepMinutes, 1440, '5 x 400 = 2000 is capped at 1440');
});

// ---------------------------------------------------------------- 11, 12: workouts
const EX_HEAD = 'exercise_id,exercise_start,exercise_end,utc_offset,activity_name,log_type,tracker_total_calories,tracker_total_steps,tracker_total_distance_mm,tracker_avg_heart_rate,tracker_peak_heart_rate,some_future_column';
const exLine = (id, start, end, name, kcal = '', steps = '', mm = '', avg = '', peak = '') => [id, start, end, '-06:00', name, 'auto', kcal, steps, mm, avg, peak, 'x'].join(',');

test('11. workoutsByDay: hand-computed fields, the local day of the START, sorted by start, empty cells absent, mm to m, rounding', async () => {
  const { workoutsByDay } = await H();
  const rows = await rowsOf([EX_HEAD,
    exLine('e1', '2026-11-05T14:00:00Z', '2026-11-05T14:45:00Z', 'Walk', '210.4', '5200', '3500000', '112.6', '150'),
    exLine('e2', '2026-11-06T05:30:00Z', '2026-11-06T06:30:00Z', 'Weightlifting'),                                  // 23:30 local on the 5th, 60 minutes, nothing else recorded
    exLine('e3', '2026-11-06T06:00:00Z', '2026-11-06T06:20:40Z', 'Run', '0', '', '1499'),                           // midnight local on the 6th; 20 min 40 s -> 21; 1499 mm -> 1 m
    exLine('e4', '2026-11-05T12:00:00Z', '2026-11-05T12:30:00Z', ''),                                               // no name
    ''].join('\r\n'));
  const out = workoutsByDay(rows, fixed(-360));
  assert.deepEqual(out, {
    '2026-11-05': [
      { id: 'e4', name: 'Workout', start: '2026-11-05T12:00:00Z', minutes: 30 },
      { id: 'e1', name: 'Walk', start: '2026-11-05T14:00:00Z', minutes: 45, kcal: 210, steps: 5200, distanceM: 3500, avgHr: 113, peakHr: 150 },
      { id: 'e2', name: 'Weightlifting', start: '2026-11-06T05:30:00Z', minutes: 60 },
    ],
    '2026-11-06': [{ id: 'e3', name: 'Run', start: '2026-11-06T06:00:00Z', minutes: 21, kcal: 0, distanceM: 1 }],
  });
  assert.equal('kcal' in out['2026-11-05'][0], false, 'an empty cell means not recorded: the key is absent, not 0');
  assert.deepEqual(Object.keys(workoutsByDay(rows, fixed(0))).sort(), ['2026-11-05', '2026-11-06'], 'with UTC days e2 moves to the 6th');
  assert.equal(workoutsByDay(rows, fixed(0))['2026-11-06'].length, 2);
});

test('12. hostile workouts: HTML and formula names stay text, control characters removed, name cap, ids, repeated id once, bad numbers dropped, minutes rules', async () => {
  const { workoutsByDay } = await H();
  const q = s => '"' + s.replace(/"/g, '""') + '"';
  const day = '2026-11-05T';
  const rows = await rowsOf([EX_HEAD,
    exLine('n1', day + '10:00:00Z', day + '10:10:00Z', q('<img src=x onerror=alert(1)>')),
    exLine('n2', day + '10:01:00Z', day + '10:10:00Z', q('=HYPERLINK("http://example.invalid","click")')),
    exLine('n3', day + '10:02:00Z', day + '10:10:00Z', 'Wal\u0007k\u0000\u009f'),
    exLine('n4', day + '10:03:00Z', day + '10:10:00Z', 'x'.repeat(100)),
    exLine('n5', day + '10:04:00Z', day + '10:10:00Z', '    '),
    exLine('', day + '10:05:00Z', day + '10:10:00Z', 'no id'),
    exLine('__proto__', day + '10:06:00Z', day + '10:10:00Z', 'proto id'),
    exLine('n1', day + '10:07:00Z', day + '10:10:00Z', 'repeat of n1'),
    exLine('i'.repeat(200), day + '10:08:00Z', day + '10:10:00Z', 'long id'),
    exLine('b1', day + '11:00:00Z', day + '11:10:00Z', 'bad numbers', 'abc', '-1', '9999999999', '19', '301'),
    exLine('b2', day + '11:01:00Z', day + '11:10:00Z', 'limits', '20000', '200000', '1000000000', '20', '300'),
    exLine('b3', day + '11:02:00Z', day + '11:10:00Z', 'over limits', '20001', '200001', '1000001000', '19.4', '300.6'),
    exLine('m1', day + '12:00:00Z', day + '11:00:00Z', 'end before start'), exLine('m2', day + '12:01:00Z', '', 'no end'), exLine('m3', day + '12:02:00Z', 'junk', 'bad end'),
    exLine('m4', day + '12:03:00Z', '2026-11-08T12:00:00Z', 'three days'),
    exLine('x1', 'junk', day + '12:00:00Z', 'bad start'), exLine('x2', '', '', 'no start'), exLine('x3', '1970-01-01T00:00:00Z', '1970-01-01T01:00:00Z', 'ancient'),
    'short', ''].join('\n'));
  const list = workoutsByDay(rows, fixed(-360))['2026-11-05'], by = id => list.find(w => w.id === id);
  assert.equal(by('n1').name, '<img src=x onerror=alert(1)>'); assert.equal(by('n2').name, '=HYPERLINK("http://example.invalid","click")');
  assert.equal(by('n3').name, 'Walk'); assert.equal(by('n4').name, 'x'.repeat(60)); assert.equal(by('n5').name, 'Workout');
  assert.equal(list.filter(w => w.id === 'n1').length, 1); assert.equal(by('n1').minutes, 10, 'the first row with an id wins');
  assert.equal(by('__proto__').name, 'proto id'); assert.equal(by(''), undefined);
  assert.equal(by('i'.repeat(80)).name, 'long id', 'id cut to 80 characters');
  assert.deepEqual(by('b1'), { id: 'b1', name: 'bad numbers', start: day + '11:00:00Z', minutes: 10 });
  assert.deepEqual(by('b2'), { id: 'b2', name: 'limits', start: day + '11:01:00Z', minutes: 9, kcal: 20000, steps: 200000, distanceM: 1000000, avgHr: 20, peakHr: 300 });
  assert.deepEqual(by('b3'), { id: 'b3', name: 'over limits', start: day + '11:02:00Z', minutes: 8 });
  assert.equal(by('m1').minutes, 0); assert.equal(by('m2').minutes, 0); assert.equal(by('m3').minutes, 0); assert.equal(by('m4').minutes, 1440, 'three days are capped at 1440');
  for (const id of ['x1', 'x2', 'x3']) assert.equal(by(id), undefined, id);
  assert.equal(Object.getPrototypeOf(by('n1')), Object.prototype);
  assert.deepEqual(list.map(w => w.start), [...list.map(w => w.start)].sort(), 'sorted by start');
});

test('12b. at most 20 workouts a day: the earliest 20 by start, then id', async () => {
  const { workoutsByDay } = await H();
  const lines = Array.from({ length: 50 }, (_, i) => exLine('w' + String(49 - i).padStart(2, '0'), `2026-11-05T${String(8 + Math.floor((49 - i) / 6)).padStart(2, '0')}:${String(((49 - i) % 6) * 10).padStart(2, '0')}:00Z`, '', 'Walk'));
  const out = workoutsByDay(await rowsOf([EX_HEAD, ...lines].join('\n')), fixed(0))['2026-11-05'];
  assert.equal(out.length, 20);
  assert.deepEqual(out.map(w => w.id), Array.from({ length: 20 }, (_, i) => 'w' + String(i).padStart(2, '0')), 'w00..w19 are the earliest');
});

// ---------------------------------------------------------------- 13-15
test('13. cutoffDay: 365 days before today for "year", null for "all", unknown scope is "year", invalid today is null', async () => {
  const { cutoffDay } = await H();
  assert.equal(cutoffDay('2026-11-13', 'year'), '2025-11-13');
  assert.equal(cutoffDay('2024-03-01', 'year'), '2023-03-02', '2023-03-01 to 2024-03-01 is 366 days (Feb 29 2024), so 365 days back is March 2');
  assert.equal(cutoffDay('2024-02-29', 'year'), '2023-03-01');
  assert.equal(cutoffDay('2025-01-01', 'year'), '2024-01-02', '2024 is a leap year: 366 days from 2024-01-01 to 2025-01-01');
  assert.equal(cutoffDay('2026-03-01', 'year'), '2025-03-01');
  assert.equal(cutoffDay('2026-11-13', 'all'), null);
  assert.equal(cutoffDay('2026-11-13', 'whatever'), '2025-11-13'); assert.equal(cutoffDay('2026-11-13'), '2025-11-13'); assert.equal(cutoffDay('2026-11-13', null), '2025-11-13');
  for (const v of ['2026-02-30', 'x', '', '2026-1-5', null, undefined, 5, {}, '2026-11-13T00:00:00Z']) assert.equal(cutoffDay(v, 'year'), null, String(v));
});

const W1 = { id: 'e1', name: 'Walk', start: '2025-11-13T14:00:00Z', minutes: 45 };
test('14. combineActivity: filters by since (inclusive), counts left-out days once each, builds partial records, omits empty days, never changes its input', async () => {
  const { combineActivity } = await H();
  const input = deepFreeze({
    steps: { '2025-11-12': 1000, '2025-11-13': 2000, '2026-11-13': 5000 },
    sleep: { '2025-11-12': { sleepMinutes: 400, sleepStart: '2025-11-12T05:00:00Z', sleepEnd: '2025-11-12T12:00:00Z' }, '2026-11-13': { sleepMinutes: 420, sleepStart: '2026-11-13T05:00:00Z', sleepEnd: '2026-11-13T12:00:00Z' } },
    workouts: { '2025-11-13': [W1], '2026-01-01': [] },
  });
  const out = combineActivity(input, '2025-11-13');
  assert.deepEqual(out, { left: 1, days: {
    '2025-11-13': { steps: 2000, workouts: [W1] },
    '2026-11-13': { steps: 5000, sleepMinutes: 420, sleepStart: '2026-11-13T05:00:00Z', sleepEnd: '2026-11-13T12:00:00Z' } } }, '2025-11-12 has steps AND sleep but counts as one left-out day; the empty workout list makes no day');
  const all = combineActivity(input, null);
  assert.deepEqual(Object.keys(all.days).sort(), ['2025-11-12', '2025-11-13', '2026-11-13']); assert.equal(all.left, 0);
  assert.deepEqual(all.days['2025-11-12'], { steps: 1000, sleepMinutes: 400, sleepStart: '2025-11-12T05:00:00Z', sleepEnd: '2025-11-12T12:00:00Z' });
  assert.notEqual(out.days['2025-11-13'].workouts, input.workouts['2025-11-13'], 'workout lists are copied');
  assert.deepEqual(combineActivity({}, '2025-11-13'), { days: {}, left: 0 });
  assert.deepEqual(combineActivity({ steps: { 'bogus': 5, '2026-02-30': 5, '__proto__': 5, '2026-1-5': 5 } }, null), { days: {}, left: 0 }, 'keys that are not real dates are ignored');
  for (const v of [undefined, null, 'x', 5, [], { steps: 'x', sleep: 5, workouts: [] }]) assert.doesNotThrow(() => combineActivity(v, null), String(v));
});

test('15. countActivity and importSummaryText: exact wording, singular and plural', async () => {
  const { countActivity, importSummaryText } = await H();
  assert.deepEqual(countActivity({ '2025-11-13': { steps: 2000, workouts: [W1, { ...W1, id: 'e2' }] }, '2026-11-13': { steps: 5, sleepMinutes: 420, sleepStart: 'a', sleepEnd: 'b' }, '2026-11-14': { workouts: [W1] } }), { stepDays: 2, sleepDays: 1, workouts: 3 });
  assert.deepEqual(countActivity({}), { stepDays: 0, sleepDays: 0, workouts: 0 }); assert.deepEqual(countActivity(null), { stepDays: 0, sleepDays: 0, workouts: 0 });
  const t = (stepDays, sleepDays, workouts, left) => importSummaryText({ stepDays, sleepDays, workouts, left });
  assert.equal(t(12, 11, 7, 0), 'Imported 12 days of steps, 11 days of sleep, 7 workouts.');
  assert.equal(t(2, 1, 2, 1), 'Imported 2 days of steps, 1 day of sleep, 2 workouts. 1 day older than a year was left out.');
  assert.equal(t(1, 1, 1, 1), 'Imported 1 day of steps, 1 day of sleep, 1 workout. 1 day older than a year was left out.');
  assert.equal(t(3, 0, 0, 30), 'Imported 3 days of steps, 0 days of sleep, 0 workouts. 30 days older than a year were left out.');
  assert.equal(t(0, 0, 0, 0), 'Nothing to import: no steps, sleep or workouts found for that period.');
  assert.equal(t(0, 0, 0, 5), 'Nothing to import: no steps, sleep or workouts found for that period. 5 days older than a year were left out.');
  for (const v of [undefined, null, {}, 'x', { stepDays: NaN, sleepDays: 'a', workouts: -1, left: Infinity }]) {
    const s = importSummaryText(v); assert.equal(typeof s, 'string'); assert.doesNotMatch(s, /NaN|undefined|Infinity|null|-1/, String(v));
  }
});

// ---------------------------------------------------------------- 16: purity and volume
test('16. no function throws or mutates on garbage or frozen input', async () => {
  const m = await H();
  const garbageRows = [undefined, null, 'x', 5, {}, [null, 1, 'x', [], {}, { timestamp: {}, steps: [], data_source: 5 }, { sleep_id: {}, sleep_start: 5 }, { exercise_id: [], exercise_start: {} }]];
  const rowsFor = (await rowsOf(STEPS_CSV));
  const garbageTz = [undefined, null, 'x', () => NaN, () => { throw new Error('tz'); }, () => 1e12, () => 'a', fixed(-360)];
  for (const f of [m.stepTotalsBySource, m.dailySteps, m.sleepByDay, m.workoutsByDay]) for (const rows of garbageRows) for (const tz of garbageTz) {
    let out; assert.doesNotThrow(() => { out = f(rows, tz); }, `${f.name}(${String(rows).slice(0, 20)}, ${String(tz).slice(0, 20)})`);
    assert.ok(out && typeof out === 'object' && !Array.isArray(out), f.name + ' returns a plain object');
  }
  for (const f of [m.stepTotalsBySource, m.dailySteps]) assert.doesNotThrow(() => f(rowsFor, () => { throw new Error('tz'); }), 'a throwing tz on valid rows');
  const frozen = deepFreeze((await rowsOf(STEPS_CSV)).map(r => ({ ...r })));
  assert.doesNotThrow(() => { m.stepTotalsBySource(frozen, fixed(-360)); m.dailySteps(frozen, fixed(-360)); });
  const sl = deepFreeze(await rowsOf(`${SLEEP_HEAD}\n${sleepLine('s1', 'STAGES', 420, '-06:00', '2026-11-04T05:00:00Z', '-06:00', '2026-11-04T13:00:00Z')}\n`));
  assert.doesNotThrow(() => m.sleepByDay(sl, fixed(-360)));
  const ex = deepFreeze(await rowsOf(`${EX_HEAD}\n${exLine('e1', '2026-11-05T14:00:00Z', '2026-11-05T14:45:00Z', 'Walk')}\n`));
  assert.doesNotThrow(() => m.workoutsByDay(ex, fixed(-360)));
  assert.equal(Object.keys(Object.prototype).length, 0); assert.equal(({}).W, undefined);
});

test('16b. 72,000 step rows (50 days x 1440 minutes x 3 steps) are reduced to 50 correct daily totals', async () => {
  const { parseCsvTable, dailySteps } = await H();
  const start = Date.UTC(2026, 0, 1), lines = ['timestamp,steps,data source'];
  for (let i = 0; i < 50 * 1440; i++) lines.push(new Date(start + i * 60000).toISOString().replace('.000Z', 'Z') + ',3,Versa 2');
  const out = dailySteps(parseCsvTable(lines.join('\n')).rows, fixed(0));
  const keys = Object.keys(out).sort();
  assert.equal(keys.length, 50); assert.equal(keys[0], '2026-01-01'); assert.equal(keys[49], '2026-02-19');
  for (const k of keys) assert.equal(out[k], 4320, k);
});
