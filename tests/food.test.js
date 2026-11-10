import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden } from './helpers.js';
import { foodKey } from '../js/domain/food.js';

test('foodKey matches golden', () => {
  golden('foodkey').forEach(c => assert.equal(foodKey(c.f), c.out));
});
