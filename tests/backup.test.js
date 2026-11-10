import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, fixture, clone, unmark } from './helpers.js';
import { validEntry, newEntries, mergeRestore } from '../js/domain/backup.js';
import { defaults } from '../js/core/schema.js';
import { foodKey } from '../js/domain/food.js';

const g = golden('backup');
const raw = fixture('state');                                  // a v1 save, as an existing user would have
const state = { ...defaults(), ...clone(raw) };
const backup = fixture('backup');

// The merge rules changed on purpose (see DECISIONS D9): result ORDER may differ from the original, so compare contents.
const byId = (a, b) => (a.id < b.id ? -1 : 1);
const normDays = days => Object.fromEntries(Object.entries(days).map(([d, l]) => [d, [...l].sort(byId)]));
const normFoods = l => Object.fromEntries(l.map(f => [foodKey(f), f]));
const normMeasures = m => Object.fromEntries(Object.entries(m).map(([k, l]) => [k, [...l].sort((a, b) => (a.label < b.label ? -1 : 1))]));

test('validEntry matches golden for every case', () => {
  for (const c of g.validEntry) assert.equal(!!validEntry(unmark(c.v)), !!c.out, JSON.stringify(c.v));
});

test('newEntries(state, backup) matches golden', () => assert.deepEqual(newEntries(state, backup), g.newEntries));

test('mergeRestore brings in exactly the same data the original merge did (order aside)', () => {
  const r = mergeRestore(clone(state), clone(backup));
  assert.deepEqual(normDays(r.days), normDays(g.mergeResult.days));
  assert.deepEqual(normFoods(r.custom), normFoods(g.mergeResult.custom));
  assert.deepEqual(normFoods(r.recent), normFoods(g.mergeResult.recent));
  assert.deepEqual(normMeasures(r.measures), normMeasures(g.mergeResult.measures));
});

test('settings are left untouched by a restore-merge of an old (untimestamped) backup', () => {
  const r = mergeRestore(clone(state), clone(backup));
  assert.deepEqual(r.goals, g.beforeUnchanged);
  assert.equal(r.theme, g.mergeResult.theme);
  assert.equal(r.weightUnit, g.mergeResult.weightUnit);
});

test('on a timestamp tie this device wins: the edited shared entry keeps the local grams', () => {
  const r = mergeRestore(clone(state), clone(backup));
  const day = Object.keys(backup.days)[0];
  const sharedLocal = state.days[day].find(e => e.id === backup.days[day][1].id);
  assert.equal(r.days[day].find(e => e.id === sharedLocal.id).grams, sharedLocal.grams);
  assert.notEqual(backup.days[day][1].grams, sharedLocal.grams);       // proves the backup really differed
});

test('mergeRestore does not mutate its inputs', () => {
  const s = clone(state), b = clone(backup);
  mergeRestore(s, b);
  assert.deepEqual(s, state); assert.deepEqual(b, backup);
});

test('mergeRestore is idempotent: nothing new after merging, same content twice', () => {
  const once = mergeRestore(clone(state), clone(backup));
  assert.deepEqual(newEntries(once, backup), {});
  assert.deepEqual(normDays(mergeRestore(once, backup).days), normDays(once.days));
});

test('a restore applies deletions recorded in the backup, and newer edits', () => {
  const day = Object.keys(state.days)[0], victim = state.days[day][0], edited = state.days[day][1];
  const bk = { ...defaults(), tombstones: { [victim.id]: 5000 }, days: { [day]: [{ ...edited, grams: 1234, updatedAt: 6000 }] } };
  const local = clone(state); local.days[day][0].updatedAt = 100; local.days[day][1].updatedAt = 100;
  const r = mergeRestore(local, bk);
  assert.equal(r.days[day].some(e => e.id === victim.id), false);
  assert.equal(r.days[day].find(e => e.id === edited.id).grams, 1234);
});

test('a hostile backup is sanitised before merging', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const r = mergeRestore(clone(state), { goals: { k: evil }, weightUnit: evil, days: { d: [{ id: 'z', per100: { k: 1, p: 1, c: 1, f: 1 }, grams: 5, name: 'n', meal: 'Lunch' }] }, settingsUpdatedAt: 9e12 });
  assert.equal(JSON.stringify(r.goals).includes('<'), false);
  assert.equal(r.weightUnit === 'g' || r.weightUnit === 'oz', true);
});
