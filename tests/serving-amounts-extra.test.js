// Added after the PR #25 review (not written by the test designer): decimal commas and multipack text in parseServingText.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServingText } from '../js/domain/units.js';

test('X1 decimal commas are read as decimals, not as a thousands break', () => {
  assert.equal(parseServingText('1 biscuit (12,5 g)').g, 12.5);
  assert.equal(parseServingText('1,5 g').g, 1.5);
  assert.equal(parseServingText('37 g').g, 37);
});

test('X2 multipack text ("2 x 50 g") is not one serving\'s weight', () => {
  for (const t of ['1 pack of 2 (2 x 50 g)', '2 x 25 g', '3x30g', '4 \u00d7 10 g']) assert.equal(parseServingText(t), null, t);
  assert.equal(parseServingText('1 cookie (28 g)').g, 28);
});
