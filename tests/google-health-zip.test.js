// Spec: docs/specs/google-health-import.md (the zip reader and the Takeout read). Test-designer file, written before the implementation.
// Zips are assembled BY HAND in tests/zip-builder.js from the zip format description (own CRC-32, own headers), so the reader is checked against
// bytes it did not produce. spyBlob() refuses whole-file reads and records every slice, which is how "random access, one entry at a time" is tested.
// All data is made up. Numbering follows the spec's behaviour list (30-43).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildZip, zipBlob, spyBlob, crc32 } from './zip-builder.js';

const Z = () => import('../js/services/zip.js');
const G = () => import('../js/services/google-health.js');
const enc = s => Buffer.from(s, 'utf8');
const codeOf = async p => { try { await p; } catch (e) { return e; } return null; };
const later = f => (async () => f())();   // turns a synchronous throw into a rejection too
const rejectsWith = async (p, code, re) => {
  const e = await codeOf(p); assert.ok(e, 'expected a rejection with code ' + code);
  assert.equal(e.code, code, `code was ${e.code}: ${e.message}`); assert.ok(e instanceof Error); assert.equal(typeof e.message, 'string'); assert.ok(e.message.length > 5);
  assert.doesNotMatch(e.message, /undefined|\[object/); if (re) assert.match(e.message, re); return e;
};
const readAll = async (blob, name) => { const { listEntries, readEntryText } = await Z(); const es = await listEntries(blob); const e = es.find(x => x.name === name); assert.ok(e, 'no entry ' + name); return readEntryText(blob, e); };

// ---------------------------------------------------------------- 30
test('30. listEntries: names (also non-ASCII), methods and sizes from the central directory', async () => {
  const { listEntries } = await Z();
  const texts = ['hello', 'x,y\n1,2\n', 'Größe,größer\n', 'smile'];
  const files = [{ name: 'a.txt', data: texts[0], method: 'store' }, { name: 'dir/b.csv', data: texts[1] }, { name: 'Takeout/Ünïcödé/データ.csv', data: texts[2] }, { name: '🙂.txt', data: texts[3], method: 'store' }];
  const { bytes, entries } = buildZip(files);
  const list = await listEntries(new Blob([bytes]));
  assert.deepEqual(list.map(e => e.name), files.map(f => f.name));
  assert.deepEqual(list.map(e => e.method), [0, 8, 8, 0]);
  assert.deepEqual(list.map(e => e.size), texts.map(t => enc(t).length));
  assert.deepEqual(list.map(e => e.compressedSize), entries.map(e => e.dataEnd - e.dataOffset));
  assert.ok(list.every(e => typeof e.offset === 'number'));
  assert.deepEqual(await listEntries(zipBlob([])), [], 'an empty archive lists nothing');
});

test('30b. 12,000 entries are listed completely (the real export has about 11,000)', async () => {
  const { listEntries } = await Z();
  const files = Array.from({ length: 12000 }, (_, i) => ({ name: `Takeout/Fit/All Data/f${String(i).padStart(5, '0')}.json`, data: 'x', method: 'store' }));
  const { bytes } = buildZip(files), blob = spyBlob(bytes);
  const list = await listEntries(blob);
  assert.equal(list.length, 12000); assert.equal(list[0].name, files[0].name); assert.equal(list[11999].name, files[11999].name); assert.equal(new Set(list.map(e => e.name)).size, 12000);
  assert.ok(blob.bytesRead() <= bytes.length, 'only the end of the file was read');
});

// ---------------------------------------------------------------- 31
test('31. readEntryText: stored, deflated, data descriptor, a different local extra field, empty, large, non-ASCII', async () => {
  const csv = 'timestamp,steps,data source\n2026-11-05T12:00:00Z,5,Versa 2\nWéird,ñ,日本語\n';
  const big = 'line,1,2\n'.repeat(300000);   // 2.7 MB of text, compresses to a few KB
  const files = [
    { name: 'stored.csv', data: csv, method: 'store' }, { name: 'deflated.csv', data: csv }, { name: 'desc-deflated.csv', data: csv, descriptor: true }, { name: 'desc-stored.csv', data: csv, method: 'store', descriptor: true },
    { name: 'extra.csv', data: csv, localExtra: Buffer.alloc(40, 7) }, { name: 'empty-stored.csv', data: '', method: 'store' }, { name: 'empty-deflated.csv', data: '' }, { name: 'big.csv', data: big },
  ];
  const blob = zipBlob(files);
  for (const n of ['stored.csv', 'deflated.csv', 'desc-deflated.csv', 'desc-stored.csv', 'extra.csv']) assert.equal(await readAll(blob, n), csv, n);
  assert.equal(await readAll(blob, 'empty-stored.csv'), ''); assert.equal(await readAll(blob, 'empty-deflated.csv'), '');
  const out = await readAll(blob, 'big.csv'); assert.equal(out.length, big.length); assert.equal(out.slice(-9), 'line,1,2\n'); assert.equal(out, big);
});

// ---------------------------------------------------------------- 32
test('32. an archive comment of 65,535 bytes, and a comment that contains a fake end-of-central-directory record', async () => {
  const { listEntries } = await Z();
  const files = [{ name: 'a.txt', data: 'hello', method: 'store' }, { name: 'b.txt', data: 'world' }];
  for (const comment of [Buffer.alloc(65535, 0x78), Buffer.alloc(1, 0x78), Buffer.alloc(0)]) {
    const list = await listEntries(zipBlob(files, { comment })); assert.deepEqual(list.map(e => e.name), ['a.txt', 'b.txt'], 'comment of ' + comment.length);
  }
  const fake = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(8), Buffer.from([1, 0, 0, 0]), Buffer.alloc(4), Buffer.from([5, 0])]);   // claims 1 entry at offset 0, a 5-byte comment
  const sneaky = Buffer.concat([enc('see: '), fake, Buffer.alloc(50, 0x41), enc(' end')]);
  assert.deepEqual((await listEntries(zipBlob(files, { comment: sneaky }))).map(e => e.name), ['a.txt', 'b.txt'], 'the signature inside a comment must be skipped (the length does not add up)');
  const atStart = Buffer.concat([fake, Buffer.alloc(65535 - fake.length, 0x41)]);
  assert.deepEqual((await listEntries(zipBlob(files, { comment: atStart }))).map(e => e.name), ['a.txt', 'b.txt']);
  assert.equal(await readAll(zipBlob(files, { comment: sneaky }), 'b.txt'), 'world');
});

// ---------------------------------------------------------------- 33
test('33. not a zip: text, empty, tiny, random bytes, a lone local header; always the same plain message, never a hang', async () => {
  const { listEntries } = await Z();
  const cases = [new Blob(['hello world']), new Blob([]), new Blob([Buffer.from([0x50, 0x4b])]), new Blob([randomBytes(10)]), new Blob([randomBytes(100000)]), new Blob([Buffer.alloc(70000)]),
    new Blob([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]), new Blob(['<html><body>Sign in to Google</body></html>'.repeat(1000)])];
  for (const b of cases) await rejectsWith(listEntries(b), 'not-zip', /^This file is not a zip file\.$/);
  for (const bad of [null, undefined, 'x', 5, {}, []]) { const e = await codeOf(later(() => listEntries(bad))); assert.ok(e instanceof Error, 'a non-blob argument rejects: ' + String(bad)); }
  const ZipError = (await Z()).ZipError;
  const e = await codeOf(listEntries(new Blob(['hello']))); assert.ok(e instanceof ZipError); assert.equal(e.code, 'not-zip');
});

// ---------------------------------------------------------------- 34
test('34. zip64 is refused with a clear message: end record markers, and an entry that claims size 0xFFFFFFFF', async () => {
  const { listEntries } = await Z();
  const files = [{ name: 'a.txt', data: 'hello', method: 'store' }];
  await rejectsWith(listEntries(zipBlob(files, { zip64: true })), 'zip64', /zip64/i);
  await rejectsWith(listEntries(zipBlob(files, { zip64Entry: true })), 'zip64', /zip64/i);
});

// ---------------------------------------------------------------- 35
test('35. an encrypted entry and an unsupported method fail when READ, not when listed; other entries in the same zip still read', async () => {
  const { listEntries, readEntryText } = await Z();
  const files = [{ name: 'secret.csv', data: 'x', method: 'store', flags: 1 }, { name: 'aes.csv', data: 'x', method: 99, flags: 1, raw: true }, { name: 'bzip.csv', data: 'BZh91AY', method: 12, raw: true, size: 20, crc: 1 }, { name: 'ok.csv', data: 'fine' }];
  const blob = zipBlob(files), list = await listEntries(blob), by = n => list.find(e => e.name === n);
  assert.equal(list.length, 4);
  await rejectsWith(readEntryText(blob, by('secret.csv')), 'encrypted', /password|encrypted/i);
  await rejectsWith(readEntryText(blob, by('aes.csv')), 'encrypted', /password|encrypted/i);
  await rejectsWith(readEntryText(blob, by('bzip.csv')), 'unsupported-method', /compression/i);
  assert.equal(await readEntryText(blob, by('ok.csv')), 'fine');
});

// ---------------------------------------------------------------- 36
test('36. corrupt zips: bad CRC, lying sizes, offsets outside the file, wrong local signature, damaged directory', async () => {
  const { listEntries, readEntryText } = await Z();
  const text = 'a,b\n1,2\n'.repeat(50);
  // wrong CRC (stored and deflated)
  for (const method of ['store', 'deflate']) { const b = zipBlob([{ name: 'x.csv', data: text, method, crc: 0x12345678 }]); const [e] = await listEntries(b); await rejectsWith(readEntryText(b, e), 'corrupt', /damaged/i); }
  // declared size smaller than the real data (inflating must stop and fail), and a 5 MB bomb that declares 10 bytes
  const bomb = Buffer.alloc(5e6);
  for (const f of [{ name: 'x.csv', data: text, size: 10, crc: crc32(enc(text)) }, { name: 'bomb.csv', data: bomb, size: 10, crc: crc32(bomb) }, { name: 'x.csv', data: text, size: text.length + 100, crc: crc32(enc(text)) },
    { name: 'x.csv', data: text, method: 'store', size: 10, crc: crc32(enc(text)) }]) {
    const b = zipBlob([f]); const [e] = await listEntries(b); await rejectsWith(readEntryText(b, e), 'corrupt', /damaged/i);
  }
  // an entry whose data lies outside the file: either listing or reading must say corrupt
  const outside = async (bytes) => {
    const b = new Blob([bytes]); let e1 = await codeOf(listEntries(b));
    if (!e1) { const [e] = await listEntries(b); e1 = await codeOf(readEntryText(b, e)); }
    assert.ok(e1, 'must fail'); assert.equal(e1.code, 'corrupt', e1.message); assert.match(e1.message, /damaged/i);
  };
  await outside(buildZip([{ name: 'x.csv', data: text, badOffset: true }]).bytes);
  const good = buildZip([{ name: 'x.csv', data: text, method: 'store' }, { name: 'y.csv', data: 'tail' }]);
  const cd = good.bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const hugeCsize = Buffer.from(good.bytes); hugeCsize.writeUInt32LE(0x7fffff00, cd + 20); await outside(hugeCsize);
  // wrong local header signature: listing works (the directory is fine), reading says corrupt
  const badSig = Buffer.from(good.bytes); badSig.fill(0, good.entries[0].localOffset, good.entries[0].localOffset + 4);
  const bb = new Blob([badSig]); const l = await listEntries(bb); await rejectsWith(readEntryText(bb, l[0]), 'corrupt', /damaged/i); assert.equal(await readEntryText(bb, l[1]), 'tail', 'the other entry is fine');
  // damaged directory: offset beyond the file, a truncated file
  const badDir = Buffer.from(good.bytes); badDir.writeUInt32LE(good.bytes.length + 1000, good.bytes.length - 22 + 16);
  const e2 = await codeOf(listEntries(new Blob([badDir]))); assert.ok(e2 && ['corrupt', 'not-zip'].includes(e2.code), String(e2 && e2.code));
  const e3 = await codeOf(listEntries(new Blob([good.bytes.subarray(0, good.bytes.length - 10)]))); assert.ok(e3 && ['corrupt', 'not-zip'].includes(e3.code), String(e3 && e3.code));
  const e4 = await codeOf(listEntries(new Blob([good.bytes.subarray(0, 40)]))); assert.ok(e4 && ['corrupt', 'not-zip'].includes(e4.code));
});

// ---------------------------------------------------------------- 37
test('37. maxBytes refuses a too large entry BEFORE any of its data is read; the default refuses a declared 4 GB', async () => {
  const { listEntries, readEntryText } = await Z();
  const { bytes, entries } = buildZip([{ name: 'big.csv', data: 'x'.repeat(1000), method: 'store' }, { name: 'liar.csv', data: 'tiny', method: 'store', size: 4000000000 }]);
  const blob = spyBlob(bytes), list = await listEntries(blob);
  blob.log.length = 0;
  await rejectsWith(readEntryText(blob, list[0], { maxBytes: 999 }), 'too-big', /too large/i);
  assert.equal(blob.touched(entries[0].dataOffset, entries[0].dataEnd), false, 'no data of the refused entry was read');
  assert.equal((await readEntryText(blob, list[0], { maxBytes: 1000 })).length, 1000);
  blob.log.length = 0;
  await rejectsWith(readEntryText(blob, list[1]), 'too-big', /too large/i);
  assert.equal(blob.touched(entries[1].dataOffset, entries[1].dataEnd), false);
});

// ---------------------------------------------------------------- 38
test('38. an aborted signal rejects with code aborted (and name AbortError) before anything is read', async () => {
  const { listEntries, readEntryText } = await Z();
  const { bytes } = buildZip([{ name: 'a.txt', data: 'hello' }]), spy = spyBlob(bytes);
  const [entry] = await listEntries(zipBlob([{ name: 'a.txt', data: 'hello' }]));
  const ac = new AbortController(); ac.abort();
  const e1 = await rejectsWith(listEntries(spy, { signal: ac.signal }), 'aborted', /^Cancelled\.$/); assert.equal(e1.name, 'AbortError'); assert.equal(spy.log.length, 0);
  const e2 = await rejectsWith(readEntryText(spy, entry, { signal: ac.signal }), 'aborted'); assert.equal(e2.name, 'AbortError'); assert.equal(spy.log.length, 0);
});

// ---------------------------------------------------------------- 39
test('39. only the needed byte ranges are read: a 5 MB zip with two big unrelated entries, one small wanted entry', async () => {
  const { listEntries, readEntryText } = await Z();
  const wanted = 'timestamp,steps,data source\n' + '2026-11-05T12:00:00Z,5,Versa 2\n'.repeat(60);
  const { bytes, entries } = buildZip([{ name: 'Takeout/Fit/All Data/big1.bin', data: randomBytes(3e6), method: 'store' }, { name: 'Takeout/steps.csv', data: wanted },
    { name: 'Takeout/Fit/All Data/big2.bin', data: randomBytes(2e6), method: 'store' }, { name: 'Takeout/zzz-filler.bin', data: randomBytes(150000), method: 'store' }]);   // the filler takes the end-record search window
  const blob = spyBlob(bytes), list = await listEntries(blob);
  assert.equal(await readEntryText(blob, list.find(e => e.name === 'Takeout/steps.csv')), wanted);   // any whole-file read would have thrown inside the spy
  for (const i of [0, 2]) assert.equal(blob.touched(entries[i].dataOffset, entries[i].dataEnd), false, 'the unrelated entry ' + i + ' must never be read');
  assert.ok(blob.bytesRead() < 150000, 'bytes read: ' + blob.bytesRead() + ' of ' + bytes.length);
  assert.ok(Math.max(...blob.log.map(([s, e]) => e - s)) <= 22 + 65535 + 4096, 'no single slice is larger than the end-record search window');
});

// ---------------------------------------------------------------- 40
test('40. without DecompressionStream a deflated entry says unsupported-browser, a stored one still reads', async () => {
  const { listEntries, readEntryText } = await Z();
  const blob = zipBlob([{ name: 'd.csv', data: 'deflated text' }, { name: 's.csv', data: 'stored text', method: 'store' }]), list = await listEntries(blob);
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  try {
    delete globalThis.DecompressionStream;
    assert.equal(typeof globalThis.DecompressionStream, 'undefined', 'test precondition');
    await rejectsWith(readEntryText(blob, list[0]), 'unsupported-browser', /browser/i);
    assert.equal(await readEntryText(blob, list[1]), 'stored text');
  } finally { if (saved) Object.defineProperty(globalThis, 'DecompressionStream', saved); }
  assert.equal(typeof globalThis.DecompressionStream, 'function', 'restored');
  assert.equal(await readEntryText(blob, list[0]), 'deflated text');
});

// ---------------------------------------------------------------- 41-43: readTakeout
const HEAD_S = 'timestamp,steps,data source', HEAD_SLEEP = 'sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source';
const HEAD_EX = 'exercise_id,exercise_start,exercise_end,utc_offset,activity_name,log_type,tracker_total_calories,tracker_total_steps,tracker_total_distance_mm,tracker_avg_heart_rate,tracker_peak_heart_rate,extra';
const sl = (id, asleep, a, b) => [id, 'STAGES', '', 0, 5, asleep, 10, 5, 5, '-06:00', a, '-06:00', b, 'Versa 2'].join(',');
const ex = (id, a, b, name, kcal = '') => [id, a, b, '-06:00', name, 'auto', kcal, '', '', '', '', 'x'].join(',');
const P = 'Takeout/Google Health/Physical Activity_GoogleData/Steps/', S = 'Takeout/Google Health/Health Fitness Data_GoogleData/';
const take = () => buildZip([
  { name: 'Takeout/archive_browser.html', data: '<html>index</html>' },
  { name: 'Takeout/Fit/All Data/junk.bin', data: randomBytes(1e6), method: 'store' },
  { name: P + 'steps_2020-01-01.csv', data: [HEAD_S, '2020-01-15T12:00:00Z,777,Versa 2'].join('\n') },
  { name: P + 'steps_2025-10-01.csv', data: [HEAD_S, '2025-10-15T12:00:00Z,888,Versa 2'].join('\n') },
  { name: P + 'steps_2025-11-01.csv', data: [HEAD_S, '2025-11-12T23:00:00Z,1000,Versa 2', '2025-11-13T05:59:00Z,50,Versa 2', '2025-11-13T06:00:00Z,200,Versa 2', '2025-11-13T12:00:00Z,150,Phone Health Connect',
    '2025-11-30T20:00:00Z,100,Versa 2', '2025-11-30T21:00:00Z,450,Phone Health Connect'].join('\r\n') },
  { name: P + 'steps_2025-12-01.csv', data: [HEAD_S, '2025-12-01T03:00:00Z,400,Versa 2', '2025-12-01T12:00:00Z,300,Versa 2'].join('\n') },
  { name: P + 'steps_readme.txt', data: 'steps readme' },
  { name: P + 'notsteps_2025-11-01.csv', data: [HEAD_S, '2025-11-15T12:00:00Z,5555,Versa 2'].join('\n') },
  { name: '__MACOSX/' + P + 'steps_2025-11-01.csv', data: [HEAD_S, '2025-11-14T12:00:00Z,99999,Versa 2'].join('\n') },
  { name: S + 'UserSleepStages_2025.csv', data: randomBytes(200000), method: 'store' },
  { name: S + 'UserSleeps_2025.csv', data: [HEAD_SLEEP, sl('s1', 420, '2025-11-30T05:00:00Z', '2025-11-30T13:00:00Z'), sl('s2', 400, '2025-11-01T05:00:00Z', '2025-11-01T13:00:00Z')].join('\n') },
  { name: S + 'UserExercises_2025.csv', data: [HEAD_EX, ex('e1', '2025-11-30T14:00:00Z', '2025-11-30T14:45:00Z', 'Walk', 210), ex('e2', '2025-11-02T14:00:00Z', '2025-11-02T14:20:00Z', 'Run')].join('\n') },
  // the last 64 KB of any zip are read to find the end record: a big last entry keeps that window away from the entries the tests watch
  { name: 'Takeout/zzz-filler.bin', data: randomBytes(150000), method: 'store' },
]);
const opts = (over = {}) => ({ scope: 'year', today: '2026-11-13', tz: () => -360, ...over });
const ignored = ['Takeout/archive_browser.html', 'Takeout/Fit/All Data/junk.bin', P + 'steps_readme.txt', P + 'notsteps_2025-11-01.csv', '__MACOSX/' + P + 'steps_2025-11-01.csv', S + 'UserSleepStages_2025.csv'];

test('41. readTakeout (last year): a hand-computed result; unwanted entries are never read', async () => {
  const { readTakeout } = await G(), z = take(), blob = spyBlob(z.bytes), at = n => z.entries.find(e => e.name === n);
  const out = await readTakeout(blob, opts());
  // since = 2025-11-13. Nov 13 (UTC-6): Versa 200 (the 05:59Z row is Nov 12), phone 150 -> 200. Nov 30: Versa 100 + 400 (the Dec 1 03:00Z row is 21:00 on Nov 30) = 500, phone 450 -> 500.
  assert.deepEqual(out.days, {
    '2025-11-13': { steps: 200 },
    '2025-11-30': { steps: 500, sleepMinutes: 420, sleepStart: '2025-11-30T05:00:00Z', sleepEnd: '2025-11-30T13:00:00Z', workouts: [{ id: 'e1', name: 'Walk', start: '2025-11-30T14:00:00Z', minutes: 45, kcal: 210 }] },
    '2025-12-01': { steps: 300 },
  });
  assert.deepEqual(out.counts, { stepDays: 3, sleepDays: 1, workouts: 1 });
  assert.equal(out.left, 3, 'Nov 12 (steps), Nov 1 (sleep) and Nov 2 (workout) were read but are older than the cutoff');
  assert.equal(out.files, 4, 'steps Nov, steps Dec, sleeps, exercises');
  for (const n of ignored) assert.equal(blob.touched(at(n).dataOffset, at(n).dataEnd), false, 'must not be read: ' + n);
  for (const n of [P + 'steps_2020-01-01.csv', P + 'steps_2025-10-01.csv']) assert.equal(blob.touched(at(n).dataOffset, at(n).dataEnd), false, 'a month that cannot reach the cutoff is not read: ' + n);
  for (const n of [P + 'steps_2025-11-01.csv', P + 'steps_2025-12-01.csv', S + 'UserSleeps_2025.csv', S + 'UserExercises_2025.csv']) assert.equal(blob.touched(at(n).dataOffset, at(n).dataEnd), true, 'must be read: ' + n);
});

test('42. readTakeout (all years): every wanted file is read, nothing is left out; a local day spanning two monthly files is merged BEFORE the source rule', async () => {
  const { readTakeout } = await G(), z = take(), blob = spyBlob(z.bytes), at = n => z.entries.find(e => e.name === n);
  const out = await readTakeout(blob, opts({ scope: 'all' }));
  assert.deepEqual(out.days, {
    '2020-01-15': { steps: 777 }, '2025-10-15': { steps: 888 },
    '2025-11-01': { sleepMinutes: 400, sleepStart: '2025-11-01T05:00:00Z', sleepEnd: '2025-11-01T13:00:00Z' },
    '2025-11-02': { workouts: [{ id: 'e2', name: 'Run', start: '2025-11-02T14:00:00Z', minutes: 20 }] },
    '2025-11-12': { steps: 1050 },
    '2025-11-13': { steps: 200 },
    '2025-11-30': { steps: 500, sleepMinutes: 420, sleepStart: '2025-11-30T05:00:00Z', sleepEnd: '2025-11-30T13:00:00Z', workouts: [{ id: 'e1', name: 'Walk', start: '2025-11-30T14:00:00Z', minutes: 45, kcal: 210 }] },
    '2025-12-01': { steps: 300 },
  });
  assert.deepEqual(out.counts, { stepDays: 6, sleepDays: 2, workouts: 2 }); assert.equal(out.left, 0); assert.equal(out.files, 6);
  for (const n of [P + 'steps_2020-01-01.csv', P + 'steps_2025-10-01.csv']) assert.equal(blob.touched(at(n).dataOffset, at(n).dataEnd), true, n);
  for (const n of ignored) assert.equal(blob.touched(at(n).dataOffset, at(n).dataEnd), false, 'must not be read: ' + n);
  const dflt = await readTakeout(zipBlob([{ name: P + 'steps_2020-01-01.csv', data: [HEAD_S, '2020-01-15T12:00:00Z,777,Versa 2'].join('\n') }, { name: P + 'steps_2026-11-01.csv', data: [HEAD_S, '2026-11-12T12:00:00Z,5,Versa 2'].join('\n') }]), { today: '2026-11-13', tz: () => -360 });
  assert.deepEqual(Object.keys(dflt.days), ['2026-11-12'], 'scope defaults to the last year');
});

test('43. readTakeout: progress, cancel, no data, errors pass through', async () => {
  const { readTakeout } = await G();
  const calls = []; const z = take();
  await readTakeout(new Blob([z.bytes]), opts({ onProgress: p => calls.push({ ...p }) }));
  assert.equal(calls.length, 5, 'once before the first file, then once per file'); assert.equal(calls[0].done, 0); assert.equal(calls[0].total, 4);
  assert.deepEqual(calls.map(c => c.done), [0, 1, 2, 3, 4]); assert.ok(calls.every(c => c.total === 4));
  // cancel after the first file: no further file is read
  const z2 = take(), spy = spyBlob(z2.bytes), ac = new AbortController(), at = n => z2.entries.find(e => e.name === n);
  const e = await rejectsWith(readTakeout(spy, opts({ signal: ac.signal, onProgress: p => { if (p.done === 1) ac.abort(); } })), 'aborted'); assert.equal(e.name, 'AbortError');
  for (const n of [P + 'steps_2025-12-01.csv', S + 'UserSleeps_2025.csv', S + 'UserExercises_2025.csv']) assert.equal(spy.touched(at(n).dataOffset, at(n).dataEnd), false, 'read after cancel: ' + n);
  const pre = new AbortController(); pre.abort(); const spy2 = spyBlob(take().bytes);
  await rejectsWith(readTakeout(spy2, opts({ signal: pre.signal })), 'aborted'); assert.ok(spy2.log.every(([s, en]) => en - s <= 70000), 'nothing big was read');
  // no wanted entry at all
  const msg = /^No steps, sleep or workout files were found in this zip\./;
  await rejectsWith(readTakeout(zipBlob([{ name: 'Takeout/archive_browser.html', data: '<html></html>' }]), opts()), 'no-data', msg);
  await rejectsWith(readTakeout(zipBlob([{ name: P + 'steps_readme.txt', data: 'x' }, { name: S + 'UserSleepStages_2025.csv', data: 'a,b' }, { name: 'Takeout/Fit/Activities/a.tcx', data: '<x/>' }]), opts()), 'no-data', msg);
  await rejectsWith(readTakeout(zipBlob([]), opts()), 'no-data', msg);
  // errors pass through unchanged
  await rejectsWith(readTakeout(new Blob(['hello']), opts()), 'not-zip', /^This file is not a zip file\.$/);
  await rejectsWith(readTakeout(zipBlob([{ name: S + 'UserSleeps_2025.csv', data: 'x', method: 'store', flags: 1 }]), opts()), 'encrypted');
  await rejectsWith(readTakeout(zipBlob([{ name: S + 'UserSleeps_2025.csv', data: 'x', crc: 5 }]), opts()), 'corrupt');
  await rejectsWith(readTakeout(zipBlob([{ name: 'a.csv', data: 'x' }], { zip64: true }), opts()), 'zip64');
  // a wanted file that is empty or garbage is not an error: nothing found in it
  const empty = await readTakeout(zipBlob([{ name: S + 'UserSleeps_2025.csv', data: '' }]), opts());
  assert.deepEqual(empty, { days: {}, counts: { stepDays: 0, sleepDays: 0, workouts: 0 }, left: 0, files: 1 });
  const junk = await readTakeout(zipBlob([{ name: S + 'UserExercises_2025.csv', data: 'not,a,real\n"unterminated' }, { name: P + 'steps_2026-11-01.csv', data: randomBytes(5000), method: 'store' }]), opts());
  assert.deepEqual(junk.days, {}); assert.equal(junk.files, 2);
  const only = await readTakeout(zipBlob([{ name: S + 'UserSleeps_2025.csv', data: [HEAD_SLEEP, sl('s1', 420, '2026-11-12T05:00:00Z', '2026-11-12T13:00:00Z')].join('\n') }]), opts({ onProgress: p => calls.push({ ...p, only: true }) }));
  assert.deepEqual(Object.keys(only.days), ['2026-11-12']); assert.ok(calls.filter(c => c.only).every(c => c.total === 1));
});
