import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, fixture, clone, unmark } from './helpers.js';
import { validEntry, newEntries, mergeBackup } from '../js/domain/backup.js';

const g = golden('backup');
const state = fixture('state');
const backup = fixture('backup');

test('validEntry matches golden for every case', () => {
  for (const c of g.validEntry) assert.equal(!!validEntry(unmark(c.v)), !!c.out, JSON.stringify(c.v));
});

test('newEntries(state, backup) matches golden', () => {
  assert.deepEqual(newEntries(state, backup), g.newEntries);
});

test('newEntries on the merged state equals golden.newEntriesAfterMerge (captured after the original merge)', () => {
  const merged = mergeBackup(clone(state), clone(backup));
  assert.deepEqual(newEntries(merged, backup), g.newEntriesAfterMerge);
});

test('goals are left untouched by the merge (golden.beforeUnchanged)', () => {
  assert.deepEqual(mergeBackup(clone(state), clone(backup)).goals, g.beforeUnchanged);
});

test('mergeBackup result matches golden', () => {
  const r = mergeBackup(clone(state), clone(backup));
  for (const k of ['days', 'custom', 'recent', 'measures', 'goals', 'theme', 'weightUnit'])
    assert.deepEqual(r[k], g.mergeResult[k], k);
});

test('mergeBackup does not mutate its inputs', () => {
  const s = clone(state), b = clone(backup);
  mergeBackup(s, b);
  assert.deepEqual(s, state);
  assert.deepEqual(b, backup);
});

test('mergeBackup is idempotent: nothing new after merging', () => {
  const merged = mergeBackup(clone(state), clone(backup));
  assert.deepEqual(newEntries(merged, backup), {});
  assert.deepEqual(mergeBackup(merged, backup), merged);
});
