import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchAll } from '../js/services/foods.js';
import { getJSON } from '../js/services/http.js';

const orig = globalThis.fetch;
let urls;
afterEach(() => { globalThis.fetch = orig; });
beforeEach(() => { urls = []; });

const resp = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const off = n => ({ products: Array.from({ length: n }, (_, i) => ({ product_name: 'off' + i, nutriments: { 'energy-kcal_100g': 10 } })) });
const usda = ids => ({ foods: ids.map(id => ({ description: id, fdcId: 1, foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 5 }] })) });
function route(handlers) {
  globalThis.fetch = async u => {
    urls.push(u);
    const h = u.includes('openfoodfacts') ? handlers.off : u.includes('dataType=Branded') ? (handlers.branded ?? handlers.usda) : handlers.usda;
    return h(u);
  };
}

test('interleaves OFF and USDA results round-robin', async () => {
  route({ off: () => resp(off(3)), usda: () => resp(usda(['Aaa', 'Bbb'])), branded: () => resp(usda([])) });
  const { results, errors } = await searchAll('apple', { useOFF: true, useUSDA: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(results.map(r => r.name), ['off0', 'Aaa', 'off1', 'Bbb', 'off2']);
});

test('network failure gives "Open Food Facts: network error"; USDA results still returned', async () => {
  route({ off: () => { throw new TypeError('Failed to fetch'); }, usda: () => resp(usda(['Aaa'])), branded: () => resp(usda([])) });
  const { results, errors } = await searchAll('apple', { useOFF: true, useUSDA: true });
  assert.deepEqual(errors, ['Open Food Facts: network error']);
  assert.deepEqual(results.map(r => r.name), ['Aaa']);
});

test('errors are listed in job order (OFF then USDA); 429 mentions rate limited', async () => {
  route({ off: () => resp({}, 500), usda: () => resp({}, 429) });
  const { results, errors } = await searchAll('apple', { useOFF: true, useUSDA: true });
  assert.deepEqual(results, []);
  assert.equal(errors.length, 2);
  assert.equal(errors[0], 'Open Food Facts: HTTP 500');
  assert.match(errors[1], /^USDA: rate limited/);
});

test('branded USDA failure is swallowed, generic results kept', async () => {
  route({ off: () => resp(off(0)), usda: u => u.includes('dataType=Branded') ? resp({}, 500) : resp(usda(['Gen'])) });
  const { results, errors } = await searchAll('x', { useOFF: true, useUSDA: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(results.map(r => r.name), ['Gen']);
});

test('barcode query skips USDA and uses OFF product endpoint', async () => {
  route({ off: () => resp({ status: 1, product: { product_name: 'Bar', nutriments: { 'energy-kcal_100g': 1 } } }) });
  const { results, errors } = await searchAll('12345678', { useOFF: true, useUSDA: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(results.map(r => r.name), ['Bar']);
  assert.deepEqual(urls, ['https://world.openfoodfacts.org/api/v2/product/12345678.json?fields=code,product_name,brands,nutriments,serving_quantity,serving_size']);
});

test('barcode not found (status 0) gives empty results', async () => {
  route({ off: () => resp({ status: 0 }) });
  assert.deepEqual(await searchAll('12345678901', { useOFF: true }), { results: [], errors: [] });
});

test('flags: only USDA / only OFF / neither', async () => {
  route({ off: () => resp(off(1)), usda: () => resp(usda(['U'])) });
  let r = await searchAll('apple', { useUSDA: true, useOFF: false, apiKey: ' mykey ' });
  assert.deepEqual(r.results.map(x => x.name), ['U', 'U']); // generic + branded
  assert.ok(urls.length === 2 && urls.every(u => u.includes('api.nal.usda.gov') && u.includes('api_key=mykey&')));
  urls = [];
  r = await searchAll('apple', { useUSDA: false, useOFF: true });
  assert.deepEqual(r.results.map(x => x.name), ['off0']);
  assert.ok(urls.length === 1 && urls[0].includes('search_terms=apple') && urls[0].includes('page_size=15'));
  urls = [];
  assert.deepEqual(await searchAll('apple', {}), { results: [], errors: [] });
  assert.deepEqual(urls, []);
});

test('missing apiKey falls back to DEMO_KEY', async () => {
  route({ usda: () => resp(usda([])) });
  await searchAll('apple', { useUSDA: true });
  assert.ok(urls.length === 2 && urls.every(u => u.includes('api_key=DEMO_KEY&')));
});

test('getJSON times out with "timed out" when fetch aborts', async () => {
  globalThis.fetch = async () => { const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(getJSON('http://x'), { message: 'timed out' });
});

test('getJSON error mapping', async () => {
  globalThis.fetch = async () => resp({}, 404);
  await assert.rejects(getJSON('http://x'), { message: 'HTTP 404' });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(getJSON('http://x'), { message: 'network error' });
  globalThis.fetch = async () => resp({ a: 1 });
  assert.deepEqual(await getJSON('http://x'), { a: 1 });
});
