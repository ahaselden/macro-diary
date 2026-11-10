import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBarcode, sameBarcode } from '../js/domain/food.js';
import { sanitizeFood } from '../js/core/schema.js';

test('isBarcode accepts 8-14 digits only', () => {
  for (const ok of ['12345678', '012345678905', '0012345678905', '12345678901234', ' 12345678 ']) assert.equal(isBarcode(ok), true, ok);
  for (const bad of ['1234567', '123456789012345', '1234abcd5', 'banana', '', null, undefined, '12 345 678']) assert.equal(isBarcode(bad), false, String(bad));
});
test('sameBarcode ignores leading zeros (UPC-A vs EAN-13)', () => {
  assert.equal(sameBarcode('012345678905', '0012345678905'), true);
  assert.equal(sameBarcode('12345678905', '012345678905'), true);
  assert.equal(sameBarcode('012345678905', '012345678906'), false);
  assert.equal(sameBarcode('', ''), false);
  assert.equal(sameBarcode(undefined, '12345678'), false);
});
test('sanitizeFood keeps a valid barcode and drops junk', () => {
  const base = { name: 'Bar', per100: { k: 1, p: 0, c: 0, f: 0 } };
  assert.equal(sanitizeFood({ ...base, barcode: '012345678905' }).barcode, '012345678905');
  for (const bad of ['abc', '123', 12345678, '<img src=x>', '1234567890123456']) assert.equal('barcode' in sanitizeFood({ ...base, barcode: bad }), false, String(bad));
  assert.equal('barcode' in sanitizeFood(base), false);
});
