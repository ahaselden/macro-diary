import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, unmark } from './helpers.js';
import { frac, volOf, unitsFor } from '../js/domain/units.js';

const g = golden('units');

test('unitsFor matches golden', () => {
  g.unitsFor.forEach((c, i) => assert.deepEqual(unitsFor(unmark(c.food), unmark(c.measures)), c.out, `case ${i}`));
});
test('volOf matches golden', () => {
  g.volOf.forEach(c => assert.equal(volOf(unmark(c.l)), c.out, JSON.stringify(c.l)));
});
test('frac matches golden', () => {
  g.frac.forEach(c => assert.equal(frac(c.t), c.out, JSON.stringify(c.t)));
});
