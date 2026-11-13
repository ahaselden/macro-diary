// Added after the review of PR #45 (not from the test-designer): the merged key must always be a string, never undefined.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults } from '../js/core/schema.js';
import { mergeStates } from '../js/domain/merge.js';

const A = 'abcdefghijklmnopqrstuvwxyz0123456789f3a9';
const dev = (apiKey, on, t) => ({ ...defaults(), ...(apiKey === undefined ? {} : { apiKey }), syncApiKey: on, settingsUpdatedAt: t });

test('X1 the merged apiKey is a string for every pair of keys, and a placeholder never becomes undefined', () => {
  const keys = ['', 'DEMO_KEY', A, undefined];
  for (const kl of keys) for (const kr of keys) for (const onl of [true, false]) for (const onr of [true, false]) for (const [tl, tr] of [[1, 5], [5, 1], [3, 3]]) {
    const m = mergeStates(dev(kl, onl, tl), dev(kr, onr, tr));
    assert.equal(typeof m.apiKey, 'string', `${kl}|${onl}|${tl} vs ${kr}|${onr}|${tr}`);
  }
  // the reported case: a local empty key, a newer remote record with the switch on and no key
  const remote = { ...defaults(), syncApiKey: true, settingsUpdatedAt: 5 }; delete remote.apiKey;
  assert.equal(mergeStates({ ...defaults(), apiKey: '', syncApiKey: true, settingsUpdatedAt: 1 }, remote).apiKey, '');
  assert.equal(mergeStates({ ...defaults(), apiKey: 'DEMO_KEY', syncApiKey: true, settingsUpdatedAt: 1 }, remote).apiKey, 'DEMO_KEY');
});
