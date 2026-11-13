import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, defaults, migrate, SCHEMA_VERSION } from '../js/core/store.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { fixture, clone } from './helpers.js';

const fakeStorage = (initial, failWrites = false) => {
  const m = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { if (failWrites) throw new Error('quota'); m.set(k, v); }, m };
};

const noFoodId = days => JSON.parse(JSON.stringify(days, (k, v) => (k === 'foodId' ? undefined : v)));

test('storage key is unchanged (existing users data lives here)', () => assert.equal(STORAGE_KEY, 'macrodiary.v1'));

test('empty storage gives defaults', () => {
  const { state } = createStore(fakeStorage());
  assert.deepEqual(state, defaults());
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
});

test('no storage at all (e.g. node) gives defaults', () => assert.deepEqual(createStore(null).state, defaults()));

test('corrupt JSON falls back to defaults without throwing', () => assert.deepEqual(createStore(fakeStorage('{not json')).state, defaults()));

test('a v1 save (no schemaVersion) loads intact and is stamped to the current version', () => {
  const v1 = fixture('state');
  assert.equal(v1.schemaVersion, undefined);
  const { state } = createStore(fakeStorage(JSON.stringify(v1)));
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(noFoodId(state.days), v1.days);   // saved-food-ids: migration may stamp foodId on copies of saved foods
  assert.deepEqual(state.goals, v1.goals);
  assert.deepEqual(state.measures, v1.measures);
});

test('keys missing from an old save are filled from defaults', () => {
  const { state } = createStore(fakeStorage(JSON.stringify({ goals: { k: 1800, p: 1, c: 1, f: 1 } })));
  assert.equal(state.goals.k, 1800);
  assert.equal(state.weightUnit, 'g');
  assert.deepEqual(state.days, {});
});

test('save writes JSON under the storage key and returns true', () => {
  const st = fakeStorage(); const s = createStore(st);
  s.state.goals.k = 1234;
  assert.equal(s.save(), true);
  assert.equal(JSON.parse(st.m.get(STORAGE_KEY)).goals.k, 1234);
});

test('failed save returns false and calls onSaveError', () => {
  const s = createStore(fakeStorage(undefined, true)); let called = 0; s.onSaveError = () => called++;
  assert.equal(s.save(), false);
  assert.equal(called, 1);
});

test('replace keeps object identity, drops old keys, migrates and fills defaults', () => {
  const s = createStore(fakeStorage()); const ref = s.state;
  s.state.extraOld = 1; s.state.days = { '2025-01-01': [{ id: 'x' }] };
  s.replace(clone(fixture('state')));
  assert.equal(s.state, ref);
  assert.equal('extraOld' in s.state, false);
  assert.equal(s.state.schemaVersion, SCHEMA_VERSION);
  assert.equal(Object.keys(s.state.days).length, Object.keys(fixture('state').days).length);
});

test('a hostile backup cannot smuggle markup through goals, units or theme', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const s = createStore(fakeStorage()); s.replace({ goals: { k: evil, p: -5, c: null, f: '' }, weightUnit: evil, theme: { a: 1 }, apiKey: 7, days: [1], measures: 'x', recent: {}, custom: 3 });
  assert.deepEqual(s.state.goals, defaults().goals);
  assert.equal(s.state.weightUnit, 'g');
  assert.equal(s.state.theme, 'auto');
  assert.equal(s.state.apiKey, '');
  assert.deepEqual(s.state.days, {});
  assert.deepEqual(s.state.measures, {});
  assert.deepEqual(s.state.recent, []);
  assert.deepEqual(s.state.custom, []);
});

test('sane goals (numbers or numeric strings) are kept as numbers', () => {
  const s = createStore(fakeStorage()); s.replace({ goals: { k: '1800', p: 120, c: 0, f: 55.5 } });
  assert.deepEqual(s.state.goals, { k: 1800, p: 120, c: 0, f: 55.5 });
});

test('sanitising leaves valid diary data untouched', () => {
  const v1 = fixture('state'), s = createStore(fakeStorage()); s.replace(clone(v1));
  assert.deepEqual(noFoodId(s.state.days), v1.days);   // saved-food-ids: see above
  assert.deepEqual(s.state.measures, v1.measures);
  assert.equal(s.state.theme, v1.theme);
  assert.equal(s.state.weightUnit, v1.weightUnit);
});

test('migrate never removes data and never lowers the version', () => {
  assert.equal(migrate({ days: { a: [] } }).schemaVersion, SCHEMA_VERSION);
  assert.equal(migrate({ schemaVersion: 7 }).schemaVersion, 9);
});

test('v3+ adds tombstones + settingsUpdatedAt to old data without touching entries', () => {
  const v1 = fixture('state'), s = createStore(fakeStorage(JSON.stringify(v1)));
  assert.deepEqual(s.state.tombstones, {});
  assert.equal(s.state.settingsUpdatedAt, 0);
  assert.equal(s.state.schemaVersion, SCHEMA_VERSION);
  const first = Object.values(s.state.days)[0][0];
  assert.equal('updatedAt' in first, false);            // not rewritten: missing means 0
});

test('tombstones from untrusted input are cleaned to id -> non-negative number', () => {
  const s = createStore(fakeStorage()); s.replace({ tombstones: { a: 5, b: 'x', c: -1, d: '7' }, settingsUpdatedAt: 'nope' });
  assert.deepEqual(s.state.tombstones, { a: 5, d: 7 });
  assert.equal(s.state.settingsUpdatedAt, 0);
});
