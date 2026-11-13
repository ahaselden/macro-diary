import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toRecords, applyRecords, recordHash } from '../js/domain/sync-records.js';
import { addEntry, removeEntry, touchSettings } from '../js/domain/entries.js';
import { defaults } from '../js/core/schema.js';
import { clone } from './helpers.js';

const per100 = { k: 100, p: 1, c: 1, f: 1 };
const entry = (id, over = {}) => ({ id, meal: 'Lunch', name: id, brand: '', source: 'x', per100, grams: 100, ...over });

function richState() {
  const s = defaults();
  addEntry(s, '2024-05-01', entry('a1'), 100);
  addEntry(s, '2024-05-01', entry('a2'), 110);
  addEntry(s, '2024-05-02', entry('b1'), 120);
  addEntry(s, '2024-05-03', entry('c1'), 130);
  removeEntry(s, '2024-05-03', 'c1', 140);
  s.custom = [{ id: 'fmine0001', name: 'Mine', brand: '', source: 'custom', per100, updatedAt: 150 }];   // saved-food-ids: saved foods carry an id
  s.measures = { fmine0001: [{ label: 'cup', g: 240, updatedAt: 160 }] };               // ...and their measures are keyed by it
  s.goals = { k: 1800, p: 120, c: 150, f: 50 }; s.weightUnit = 'oz'; s.useOFF = false;
  touchSettings(s, 170);
  s.theme = 'dark'; s.apiKey = 'secret'; s.recent = ['x'];
  return s;
}

test('toRecords: shape, empty days skipped, device-only fields excluded', () => {
  const recs = toRecords(richState());
  assert.deepEqual(recs.map(r => r.key), ['settings', 'custom', 'measures', 'tombstones', 'day:2024-05-01', 'day:2024-05-02']);
  assert.equal(recs.find(r => r.key === 'day:2024-05-01').updatedAt, 110);
  assert.equal(recs.find(r => r.key === 'settings').updatedAt, 170);
  assert.equal(recs.find(r => r.key === 'tombstones').updatedAt, 140);
  assert.ok(!JSON.stringify(recs).includes('secret'));
  assert.deepEqual(toRecords(defaults()).map(r => r.key), ['settings']);
});

test('round trip reproduces synced content and leaves device-only fields alone', () => {
  const s = richState();
  const back = applyRecords(defaults(), clone(toRecords(s)));
  for (const k of ['days', 'custom', 'measures', 'tombstones', 'goals', 'weightUnit', 'useUSDA', 'useOFF', 'settingsUpdatedAt']) assert.deepEqual(back[k], s[k], k);
  assert.equal(back.theme, 'auto'); assert.equal(back.apiKey, '');
});

test('junk records are ignored and never throw', () => {
  const s = richState();
  const junk = [null, 5, 'x', [], {}, { key: 'nope', value: {} }, { key: 'day:bad', value: { entries: [] } }, { key: 'day:2024-01-01', value: 7 },
    { key: 'day:2024-01-01', value: { entries: [null, 3, { id: 1 }, { id: 'z', per100, grams: -1 }, { id: 'q' }] } },
    { key: 'custom', value: { custom: 'x' } }, { key: 'custom', value: { custom: [null, 4, { name: 'n' }] } },
    { key: 'measures', value: { measures: { a: 5, b: [null, { label: 'x', g: 'no' }] } } }, { key: 'measures', value: { measures: [] } },
    { key: 'tombstones', value: { tombstones: { x: 'NaN', y: -5, z: null, w: true } } },
    { key: 'settings', value: { goals: 'x', weightUnit: 'stone', settingsUpdatedAt: 'a' } }];
  const out = applyRecords(s, junk);
  assert.deepEqual(out.days, s.days); assert.deepEqual(out.custom, s.custom); assert.deepEqual(out.measures, s.measures);
  assert.deepEqual(out.tombstones, s.tombstones);
  assert.deepEqual(out.goals, s.goals); assert.equal(out.weightUnit, 'oz');
  assert.doesNotThrow(() => applyRecords(s, undefined));
  assert.doesNotThrow(() => applyRecords(s, 'junk'));
});

test('applyRecords does not mutate its input', () => {
  const s = richState(), snap = clone(s);
  applyRecords(s, [{ key: 'day:2024-05-01', value: { entries: [entry('a1', { grams: 5, updatedAt: 999 })] } }]);
  assert.deepEqual(s, snap);
});

test('recordHash is stable under key order and differs for different values', () => {
  const a = { key: 'k', value: { x: 1, y: { p: [1, 2], q: 'z' } } };
  const b = { key: 'k', value: { y: { q: 'z', p: [1, 2] }, x: 1 } };
  assert.equal(recordHash(a), recordHash(b));
  assert.notEqual(recordHash(a), recordHash({ key: 'k', value: { x: 2, y: { p: [1, 2], q: 'z' } } }));
  assert.notEqual(recordHash(a), recordHash({ key: 'k', value: { x: 1, y: { p: [2, 1], q: 'z' } } }));
  assert.equal(typeof recordHash(a), 'string');
});
