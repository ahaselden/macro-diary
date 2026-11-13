// Spec: docs/specs/off-barcode-404.md
// Open Food Facts answers an UNKNOWN barcode with HTTP 404 (+ JSON {"status":0,"status_verbose":"product not found"}).
// That must be an empty result, not an error. All other failures stay errors.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchOFF } from '../js/services/off.js';
import { searchAll } from '../js/services/foods.js';

const orig = globalThis.fetch;
let urls;
afterEach(() => { globalThis.fetch = orig; });
beforeEach(() => { urls = []; });

const CODE = '810030528814', UPCA = '036000291452';
// response stub offering BOTH json() and text() so the implementation may read the body either way
const resp = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const notJson = (status, text = '<html><body>Not Found</body></html>') => ({
  ok: false, status, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }, text: async () => text,
});
const off404Body = { code: '0810030528814', status: 0, status_verbose: 'product not found' };
const brandedFood = gtinUpc => ({ description: 'COCA COLA', brandOwner: 'Acme', fdcId: 99, gtinUpc, dataType: 'Branded',
  foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 42 }, { nutrientNumber: '203', value: 1.5 }, { nutrientNumber: '205', value: 10 }, { nutrientNumber: '204', value: 2 }] });
const q = u => new URL(u).searchParams;
const usdaUrls = () => urls.filter(u => u.includes('api.nal.usda.gov'));
const offUrls = () => urls.filter(u => u.includes('openfoodfacts'));
function route({ off, usda }) { globalThis.fetch = async u => { urls.push(u); return u.includes('openfoodfacts') ? off(u) : usda(u); }; }

test('1. searchOFF barcode: HTTP 404 with the JSON "product not found" body -> [] (resolves, does not throw)', async () => {
  globalThis.fetch = async u => { urls.push(u); return resp(off404Body, 404); };
  assert.deepEqual(await searchOFF(CODE), []);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes(`/api/v2/product/${CODE}.json`));
});
test('2. searchOFF barcode: HTTP 404 with a non-JSON body (HTML / empty text) -> []', async () => {
  globalThis.fetch = async () => notJson(404);
  assert.deepEqual(await searchOFF(CODE), []);
  globalThis.fetch = async () => notJson(404, '');
  assert.deepEqual(await searchOFF(CODE), []);
});
test('3. searchOFF barcode: 404 with an odd JSON body (null, {}, array) -> [] ("any 404 on that product endpoint")', async () => {
  for (const b of [null, {}, [], { status: 1 }, { status: 0 }]) {
    globalThis.fetch = async () => resp(b, 404);
    assert.deepEqual(await searchOFF(CODE), [], JSON.stringify(b));
  }
});
test('4. searchOFF barcode: HTTP 500 still rejects with exactly "HTTP 500"; so do 502, 503', async () => {
  for (const s of [500, 502, 503]) {
    globalThis.fetch = async () => resp({}, s);
    await assert.rejects(searchOFF(CODE), { message: 'HTTP ' + s });
  }
  globalThis.fetch = async () => resp(off404Body, 500);   // a 500 carrying the not-found JSON is still a failure
  await assert.rejects(searchOFF(CODE), { message: 'HTTP 500' });
});
test('5. searchOFF barcode: other failures unchanged: network error, 429, 403, 400, 410', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(searchOFF(CODE), { message: 'network error' });
  globalThis.fetch = async () => resp({}, 429);
  await assert.rejects(searchOFF(CODE), /rate limited/);
  for (const s of [400, 403, 410]) {
    globalThis.fetch = async () => resp({}, s);
    await assert.rejects(searchOFF(CODE), { message: 'HTTP ' + s }, String(s));
  }
});
test('6. searchOFF barcode: HTTP 200 status 1 product is mapped as before; 200 status 0 -> []', async () => {
  globalThis.fetch = async () => resp({ status: 1, product: { product_name: 'Bar', brands: 'Acme, Other', serving_quantity: 40, nutriments: { 'energy-kcal_100g': 400, proteins_100g: 10, carbohydrates_100g: 50, fat_100g: 20 } } });
  assert.deepEqual(await searchOFF(CODE), [{ name: 'Bar', brand: 'Acme', source: 'OFF', per100: { k: 400, p: 10, c: 50, f: 20 }, servingG: 40, servingLabel: '' }]);
  globalThis.fetch = async () => resp({ status: 0, status_verbose: 'product not found' });
  assert.deepEqual(await searchOFF(CODE), []);
});
test('7. searchOFF by NAME: a 404 is still an error "HTTP 404" (only the barcode endpoint is relaxed); 500 and 200 unchanged', async () => {
  globalThis.fetch = async u => { urls.push(u); return resp(off404Body, 404); };
  await assert.rejects(searchOFF('apple'), { message: 'HTTP 404' });
  assert.ok(urls[0].includes('/cgi/search.pl'));
  globalThis.fetch = async () => resp({}, 500);
  await assert.rejects(searchOFF('apple'), { message: 'HTTP 500' });
  globalThis.fetch = async () => resp({ products: [{ product_name: 'Apple', nutriments: { 'energy-kcal_100g': 52 } }] });
  assert.deepEqual((await searchOFF('apple')).map(x => x.name), ['Apple']);
});
test('8. searchAll barcode: OFF 404 -> errors [] and USDA branded fallback is still asked and its match returned', async () => {
  route({ off: () => resp(off404Body, 404), usda: () => resp({ foods: [brandedFood(UPCA)] }) });
  const r = await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.results.map(x => [x.name, x.source]), [['Coca cola', 'USDA']]);
  assert.equal(offUrls().length, 1);
  assert.equal(usdaUrls().length, 1);
  assert.equal(q(usdaUrls()[0]).get('query'), UPCA);
  assert.equal(q(usdaUrls()[0]).get('dataType'), 'Branded');
});
test('9. searchAll barcode: OFF 404 (JSON or non-JSON) and USDA finds nothing -> { results: [], errors: [] } (UI shows "not found")', async () => {
  route({ off: () => resp(off404Body, 404), usda: () => resp({ foods: [] }) });
  assert.deepEqual(await searchAll(CODE, { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: [] });
  route({ off: () => notJson(404), usda: () => resp({ foods: [] }) });
  assert.deepEqual(await searchAll(CODE, { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: [] });
  route({ off: () => resp(off404Body, 404), usda: () => resp({ foods: [] }) });
  assert.deepEqual(await searchAll(CODE, { useOFF: true, useUSDA: false }), { results: [], errors: [] }, 'OFF only: still no error');
});
test('10. searchAll barcode: OFF 404 does not hide a real USDA failure; OFF 500 is still reported', async () => {
  route({ off: () => resp(off404Body, 404), usda: () => resp({}, 500) });
  assert.deepEqual(await searchAll(CODE, { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: ['USDA: HTTP 500'] });
  route({ off: () => resp({}, 500), usda: () => resp({ foods: [] }) });
  assert.deepEqual((await searchAll(CODE, { useOFF: true, useUSDA: true, apiKey: 'k' })).errors, ['Open Food Facts: HTTP 500']);
});
test('11. searchAll NAME search: OFF 404 is still reported as "Open Food Facts: HTTP 404"; no barcode fallback', async () => {
  route({ off: () => resp(off404Body, 404), usda: () => resp({ foods: [] }) });
  const r = await searchAll('apple', { useOFF: true, useUSDA: true, apiKey: 'k' });
  assert.deepEqual(r.errors, ['Open Food Facts: HTTP 404']);
  assert.equal(usdaUrls().length, 2, 'generic + branded name searches only');
});
