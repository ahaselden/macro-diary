// Sync the USDA key (docs/specs/sync-usda-key.md, behaviours B1..B16). Written BEFORE the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHEMA_VERSION, defaults, migrate, sanitize } from '../js/core/schema.js';
import { createStore } from '../js/core/store.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { exportFiles, xData } from '../js/domain/reports.js';
import { addEntry } from '../js/domain/entries.js';
import { fixture, clone } from './helpers.js';

const per100 = { k: 100, p: 1, c: 1, f: 1 };
const entry = id => ({ id, meal: 'Lunch', name: id, brand: '', source: 'x', per100, grams: 100 });
const st = (over = {}) => ({ ...defaults(), ...over });
const settingsOf = s => toRecords(s).find(r => r.key === 'settings');
const rec = (value, updatedAt = 500) => ({ key: 'settings', value, updatedAt });
const remoteVal = (over = {}) => ({ goals: { k: 2000, p: 150, c: 200, f: 65 }, weightUnit: 'g', useUSDA: true, useOFF: true, settingsUpdatedAt: 500, ...over });
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const fakeStorage = raw => ({ getItem: () => raw, setItem() {} });

// ---------- schema ----------
test('B1 schema is v7 and defaults have syncApiKey false', () => {
  assert.equal(SCHEMA_VERSION, 7);
  assert.equal(defaults().syncApiKey, false);
  assert.equal(defaults().schemaVersion, 7);
});

test('B2 v6 and older data migrate to v7 with syncApiKey false, nothing lost', () => {
  const v6 = { schemaVersion: 6, apiKey: 'mykey', goals: { k: 1800, p: 100, c: 100, f: 50 }, weightUnit: 'oz', days: { '2024-05-01': [entry('a')] }, settingsUpdatedAt: 77 };
  const m = migrate(clone(v6));
  assert.equal(m.schemaVersion, 7); assert.equal(m.syncApiKey, false);
  assert.equal(m.apiKey, 'mykey'); assert.deepEqual(m.days, v6.days); assert.equal(m.weightUnit, 'oz'); assert.equal(m.settingsUpdatedAt, 77);
  for (const f of ['state', 'backup']) {
    const old = fixture(f), mm = migrate(clone(old));
    assert.equal(mm.schemaVersion, 7, f); assert.equal(mm.syncApiKey, false, f);
    assert.deepEqual(Object.keys(mm.days).sort(), Object.keys(old.days).sort(), f);
    for (const d of Object.keys(old.days)) assert.deepEqual(mm.days[d].map(e => e.id), old.days[d].map(e => e.id), f + d);
  }
  const v1 = migrate({ days: { a: [] } });
  assert.equal(v1.schemaVersion, 7); assert.equal(v1.syncApiKey, false);
  const s = createStore(fakeStorage(JSON.stringify(v6)));
  assert.equal(s.state.schemaVersion, 7); assert.equal(s.state.syncApiKey, false); assert.equal(s.state.apiKey, 'mykey');
});

test('B3 sanitize forces syncApiKey to a strict boolean', () => {
  for (const bad of ['true', 1, 'yes', {}, [], null, undefined, 0, 'false']) {
    assert.equal(sanitize({ ...defaults(), syncApiKey: bad }).syncApiKey, false, String(bad));
  }
  assert.equal(sanitize({ ...defaults(), syncApiKey: true }).syncApiKey, true);
  assert.equal(migrate({ schemaVersion: 6, syncApiKey: 'x' }).syncApiKey, false);
});

// ---------- toRecords ----------
test('B4 switch off: settings record has syncApiKey false and no apiKey property anywhere', () => {
  const s = st({ apiKey: 'TOPSECRET', syncApiKey: false, settingsUpdatedAt: 170, theme: 'dark', recent: [{ name: 'r', brand: '', source: 's', per100 }] });
  const r = settingsOf(s);
  assert.equal(r.value.syncApiKey, false);
  assert.equal('apiKey' in r.value, false);
  assert.equal(r.updatedAt, 170); assert.equal(r.value.settingsUpdatedAt, 170);
  assert.deepEqual(r.value.goals, s.goals); assert.equal(r.value.weightUnit, 'g'); assert.equal(r.value.useUSDA, true); assert.equal(r.value.useOFF, true);
  const all = JSON.stringify(toRecords(s));
  assert.ok(!all.includes('TOPSECRET')); assert.ok(!all.includes('theme')); assert.ok(!all.includes('recent'));
});

test('B5 switch on: key is in the record (empty key as empty string); turning off removes it', () => {
  const on = st({ apiKey: 'KEY-1', syncApiKey: true, settingsUpdatedAt: 5 });
  const r = settingsOf(on);
  assert.equal(r.value.syncApiKey, true); assert.equal(r.value.apiKey, 'KEY-1');
  const empty = settingsOf(st({ apiKey: '', syncApiKey: true, settingsUpdatedAt: 5 }));
  assert.equal(Object.hasOwn(empty.value, 'apiKey'), true); assert.equal(empty.value.apiKey, '');
  const off = settingsOf({ ...on, syncApiKey: false });
  assert.equal('apiKey' in off.value, false);
  assert.ok(!JSON.stringify(toRecords({ ...on, syncApiKey: false })).includes('KEY-1'));
});

// ---------- incoming sanitising ----------
const adoptKey = rawKey => applyRecords(st({ settingsUpdatedAt: 1 }), [rec(remoteVal({ syncApiKey: true, apiKey: rawKey, settingsUpdatedAt: 500 }))]);

test('B6 remote key is trimmed, control characters stripped, capped, HTML kept literal', () => {
  assert.equal(adoptKey('  KEY  ').apiKey, 'KEY');
  assert.equal(adoptKey('ab\u0000c\u0007d').apiKey, 'abcd');
  const huge = adoptKey('A'.repeat(1e6)).apiKey;
  assert.ok(huge.length > 0 && huge.length <= 200); assert.ok(/^A+$/.test(huge));
  const html = '<img src=x onerror=1>';
  assert.equal(adoptKey(html).apiKey, html);
  assert.equal(adoptKey('KEY').syncApiKey, true);
});

test('B7 remote syncApiKey that is not literal true does not adopt the key', () => {
  for (const flag of ['true', 1, {}, [], null]) {
    const r = applyRecords(st({ apiKey: 'LOCAL', settingsUpdatedAt: 1 }), [rec(remoteVal({ syncApiKey: flag, apiKey: 'REMOTE', settingsUpdatedAt: 500 }))]);
    assert.equal(r.apiKey, 'LOCAL', String(flag)); assert.equal(r.syncApiKey, false, String(flag));
  }
});

// ---------- merge ----------
const dev = (over = {}) => st(over);

test('B8 newer remote settings with syncApiKey true: local adopts key and flag, either order', () => {
  const older = dev({ apiKey: 'OLD', syncApiKey: false, settingsUpdatedAt: 100 });
  const newer = dev({ apiKey: 'NEW', syncApiKey: true, settingsUpdatedAt: 200 });
  for (const m of [mergeStates(older, newer), mergeStates(newer, older)]) {
    assert.equal(m.apiKey, 'NEW'); assert.equal(m.syncApiKey, true); assert.equal(m.settingsUpdatedAt, 200);
  }
  const olderOn = dev({ apiKey: 'OLD', syncApiKey: true, settingsUpdatedAt: 100 });
  assert.equal(mergeStates(olderOn, newer).apiKey, 'NEW'); assert.equal(mergeStates(newer, olderOn).apiKey, 'NEW');
});

test('B9 winning record with sync on and empty key clears the local key', () => {
  const local = dev({ apiKey: 'OLD', syncApiKey: true, settingsUpdatedAt: 100 });
  const remote = dev({ apiKey: '', syncApiKey: true, settingsUpdatedAt: 200 });
  assert.equal(mergeStates(local, remote).apiKey, '');
  assert.equal(mergeStates(remote, local).apiKey, '');
  assert.equal(mergeStates(local, remote).syncApiKey, true);
});

test('B10 winning record with sync off: flag goes false, local key is kept, stale key never adopted', () => {
  const local = dev({ apiKey: 'LOCALKEY', syncApiKey: true, settingsUpdatedAt: 100 });
  const remote = dev({ apiKey: 'STALE', syncApiKey: false, settingsUpdatedAt: 200 });
  const m = mergeStates(local, remote);
  assert.equal(m.syncApiKey, false); assert.equal(m.apiKey, 'LOCALKEY');
  const none = mergeStates(dev({ apiKey: 'LOCALKEY', syncApiKey: false, settingsUpdatedAt: 100 }), remote);
  assert.equal(none.apiKey, 'LOCALKEY'); assert.equal(none.syncApiKey, false);
});

test('B11 an older settings record never overwrites a newer one', () => {
  const newOff = dev({ apiKey: 'L', syncApiKey: false, settingsUpdatedAt: 300 });
  const oldOn = dev({ apiKey: 'R', syncApiKey: true, settingsUpdatedAt: 100 });
  let m = mergeStates(newOff, oldOn);
  assert.equal(m.apiKey, 'L'); assert.equal(m.syncApiKey, false);
  const newOn = dev({ apiKey: 'L', syncApiKey: true, settingsUpdatedAt: 300 });
  m = mergeStates(newOn, oldOn);
  assert.equal(m.apiKey, 'L'); assert.equal(m.syncApiKey, true);
  // reversed roles: this device is the old one, the other is newer
  m = mergeStates(oldOn, newOn);
  assert.equal(m.apiKey, 'L'); assert.equal(m.syncApiKey, true);
  // old record without the field at all (older app)
  const legacy = { ...dev({ settingsUpdatedAt: 50 }) }; delete legacy.syncApiKey; delete legacy.apiKey;
  m = mergeStates(newOn, legacy);
  assert.equal(m.apiKey, 'L'); assert.equal(m.syncApiKey, true);
});

test('B12 ties converge, preferLocal keeps local, idempotent, theme/recent never merged', () => {
  const a = dev({ apiKey: 'AAA', syncApiKey: true, settingsUpdatedAt: 100, theme: 'nord' });
  const b = dev({ apiKey: 'BBB', syncApiKey: true, settingsUpdatedAt: 100, theme: 'paper' });
  assert.equal(mergeStates(a, b).apiKey, mergeStates(b, a).apiKey);
  assert.equal(mergeStates(a, b, { preferLocal: true }).apiKey, 'AAA');
  assert.equal(mergeStates(b, a, { preferLocal: true }).apiKey, 'BBB');
  const m = mergeStates(a, a);
  assert.equal(m.apiKey, 'AAA'); assert.equal(m.syncApiKey, true); assert.equal(m.settingsUpdatedAt, 100);
  const winner = dev({ apiKey: 'W', syncApiKey: true, settingsUpdatedAt: 900, theme: 'paper', recent: [{ name: 'x', brand: '', source: 's', per100 }] });
  const loser = dev({ apiKey: 'L', syncApiKey: false, settingsUpdatedAt: 10, theme: 'nord', recent: [] });
  const mm = mergeStates(loser, winner);
  assert.equal(mm.apiKey, 'W'); assert.equal(mm.theme, 'nord'); assert.deepEqual(mm.recent, []);
});

test('B13 end to end through records: on, then off, then toRecords carries no key', () => {
  const A = dev({ apiKey: '', settingsUpdatedAt: 100 });
  const B = dev({ apiKey: 'BKEY', syncApiKey: true, settingsUpdatedAt: 200 });
  const A2 = applyRecords(A, clone(toRecords(B)));
  assert.equal(A2.apiKey, 'BKEY'); assert.equal(A2.syncApiKey, true);
  assert.equal(settingsOf(A2).value.apiKey, 'BKEY');
  const B2 = { ...B, syncApiKey: false, settingsUpdatedAt: 300 };
  const A3 = applyRecords(A2, clone(toRecords(B2)));
  assert.equal(A3.syncApiKey, false); assert.equal(A3.apiKey, 'BKEY');
  assert.equal('apiKey' in settingsOf(A3).value, false);
  assert.ok(!JSON.stringify(toRecords(A3)).includes('BKEY'));
  // an older record arriving later does not turn it back on
  const A4 = applyRecords(A3, clone(toRecords(B)));
  assert.equal(A4.syncApiKey, false);
});

// ---------- hostile ----------
test('B14 hostile remote values never throw, never pollute, never make apiKey a non-string', () => {
  const junk = [7, NaN, null, true, false, {}, { a: 1 }, [], ['k'], { toString: 'x' }, JSON.parse('{"__proto__":{"polluted":1}}')];
  for (const j of junk) {
    const r = applyRecords(st({ apiKey: 'LOCAL', settingsUpdatedAt: 1 }), [rec(remoteVal({ syncApiKey: true, apiKey: j }))]);
    assert.equal(typeof r.apiKey, 'string');
    assert.ok(!/object|\[|NaN|^7$|^true$|^false$|^null$/.test(r.apiKey) || r.apiKey === 'LOCAL', 'junk adopted: ' + r.apiKey);
    assert.equal(r.schemaVersion, 7); assert.ok(typeof r.syncApiKey === 'boolean');
  }
  const proto = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"prototype":{"polluted":3},"syncApiKey":true,"apiKey":"K","goals":{"__proto__":{"polluted":4}},"weightUnit":"g","useUSDA":true,"useOFF":true,"settingsUpdatedAt":500}');
  const r = applyRecords(st({ settingsUpdatedAt: 1 }), [{ key: 'settings', value: proto, updatedAt: 500 }]);
  assert.equal(({}).polluted, undefined); assert.equal(Object.prototype.polluted, undefined);
  assert.equal(r.polluted, undefined); assert.equal(typeof r.apiKey, 'string');
  assert.doesNotThrow(() => applyRecords(st(), [rec(null), rec('x'), rec([]), { key: 'settings' }, null, 5]));
  // the huge key does not blow up merge or toRecords either
  const big = adoptKey('Z'.repeat(1e6));
  assert.ok(JSON.stringify(toRecords(big)).length < 5000);
});

// ---------- exports ----------
test('B15 report exports never contain the key; an older backup does not replace the local key', () => {
  const s = st({ apiKey: 'SECRETKEY999', syncApiKey: true, settingsUpdatedAt: 500 });
  addEntry(s, '2024-05-01', entry('a1'), 100);
  const files = exportFiles(s, xData(s, 'day', '2024-05-01'), 12345);
  assert.ok(files.length >= 2);
  for (const f of files) { assert.ok(!f.text.includes('SECRETKEY999'), f.name); assert.ok(!/apiKey|syncApiKey/.test(f.text), f.name); }
  const backup = { ...st({ apiKey: 'FROMBACKUP', syncApiKey: true, settingsUpdatedAt: 100 }) };
  const m = mergeRestore(s, backup);
  assert.equal(m.apiKey, 'SECRETKEY999'); assert.equal(m.syncApiKey, true);
});

// ---------- UI (WEAK: reads source text; proves wiring exists, not that it behaves; the browser checklist C1-C11 does) ----------
test('B16 UI source: switch in index.html with exact text, unchecked; settings-view wires it and bumps the timestamp', () => {
  const html = read('../index.html'), view = read('../js/ui/settings-view.js');
  const m = html.match(/<input[^>]*id="syncApiKey"[^>]*>/);
  assert.ok(m, 'no #syncApiKey input');
  assert.match(m[0], /type="checkbox"/); assert.doesNotMatch(m[0], /\bchecked\b/);
  assert.ok(html.includes('Sync my USDA key to my other devices'));
  assert.ok(html.includes('The key is stored in your sync account, readable only by you.'));
  assert.ok(html.indexOf('id="syncApiKey"') > html.indexOf('id="apiKey"') - 600 && html.indexOf('id="syncApiKey"') < html.indexOf('id="syncCard"'), 'switch should sit in the Food databases card');
  assert.match(view, /#syncApiKey/);
  assert.match(view, /state\.syncApiKey\s*=/);
  assert.match(view, /touchSettings/);
  // the always-synced comparison must not include the key unconditionally (switch off => key change must not bump)
  const synced = view.match(/const synced = \(\) => ([^\n]*)/);
  assert.ok(synced, 'synced() snapshot not found');
  assert.match(synced[0], /syncApiKey/);
  assert.doesNotMatch(synced[0].replace(/state\.syncApiKey\s*\?\s*state\.apiKey\s*:\s*[^,\]\)]+/, ''), /state\.apiKey/);
});
