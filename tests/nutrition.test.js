import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, fixture } from './helpers.js';
import { entryMacros, totals } from '../js/domain/nutrition.js';

const g = golden('nutrition');

test('entryMacros matches golden', () => {
  g.entryMacros.forEach((c, i) => assert.deepEqual(entryMacros(c.e), c.out, `case ${i}`));
});
test('totals matches golden for each fixture day', () => {
  const st = fixture('state');
  for (const [day, out] of Object.entries(g.totals)) assert.deepEqual(totals(st.days[day]), out, day);
});
test('totals of empty list', () => {
  assert.deepEqual(totals([]), g.empty);
});
