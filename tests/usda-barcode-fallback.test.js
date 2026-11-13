// Spec: docs/specs/usda-barcode-fallback.md
// Behaviours 1-5 pure domain, 6-11 service (stubbed fetch), 12-20 searchAll (stubbed fetch),
// 21-24 STATIC TEXT checks over shipped source (weak: they prove wording/wiring exists, NOT that the UI works).
// Functions that do not exist yet are reached through a namespace import so each test fails on its own
// ("is not a function"), not with one link error for the whole file.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as B from '../js/domain/barcode.js';
import * as U from '../js/services/usda.js';
import { searchAll } from '../js/services/foods.js';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const orig = globalThis.fetch;
let urls;
afterEach(() => { globalThis.fetch = orig; });
beforeEach(() => { urls = []; });

const UPCA = '036000291452', EAN13 = '4006381333931', EAN8 = '96385074';
const resp = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const brandedFood = (gtinUpc, over = {}) => ({
  description: 'COCA COLA', brandOwner: 'Acme', fdcId: 99, gtinUpc, dataType: 'Branded',
  foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 42 }, { nutrientNumber: '203', value: 1.5 },
    { nutrientNumber: '205', value: 10 }, { nutrientNumber: '204', value: 2 }], ...over,
});
// what mapUSDA must produce for brandedFood() (hand-derived from the mapper's documented shape)
const mapped = (over = {}) => ({ name: 'Coca cola', brand: 'Acme', source: 'USDA', per100: { k: 42, p: 1.5, c: 10, f: 2 }, servingG: 0, servingLabel: '', fdcId: 99, barcode: UPCA, ...over });
const q = u => new URL(u).searchParams;
const usdaUrls = () => urls.filter(u => u.includes('api.nal.usda.gov'));
const offUrls = () => urls.filter(u => u.includes('openfoodfacts'));
function route({ off, usda }) {
  globalThis.fetch = async u => { urls.push(u); return u.includes('openfoodfacts') ? off(u) : usda(u); };
}
const offHit = () => resp({ status: 1, product: { product_name: 'OffThing', nutriments: { 'energy-kcal_100g': 7 } } });
const offNone = () => resp({ status: 0 });

// ---------- domain: usdaBarcodeQueries ----------
test('1. usdaBarcodeQueries: valid codes; 13/14-digit codes with leading 0 list their 12-digit form first', () => {
  assert.deepEqual(B.usdaBarcodeQueries(UPCA), [UPCA]);
  assert.deepEqual(B.usdaBarcodeQueries('0036000291452'), ['036000291452', '0036000291452']);
  assert.deepEqual(B.usdaBarcodeQueries('00012345678905'), ['012345678905', '00012345678905']);
  assert.deepEqual(B.usdaBarcodeQueries(EAN13), [EAN13]);
  assert.deepEqual(B.usdaBarcodeQueries(EAN8), [EAN8]);
  assert.deepEqual(B.usdaBarcodeQueries('10614141000415'), ['10614141000415'], '14 digits not starting with 0 are left alone');
});
test('2. usdaBarcodeQueries: trims; no check digit needed (a mistyped code is still looked up)', () => {
  assert.deepEqual(B.usdaBarcodeQueries(`  ${EAN13}\n`), [EAN13]);
  assert.deepEqual(B.usdaBarcodeQueries('12345678'), ['12345678'], 'bad check digit is still queried');
  assert.deepEqual(B.usdaBarcodeQueries('\t4006381333932 '), ['4006381333932']);
});
test('3. usdaBarcodeQueries: [] for anything that is not 8-14 ASCII digits (wrong lengths, text, unicode digits, non-strings)', () => {
  for (const s of ['', '   ', 'abc', '1234567', '123456789012345', EAN13 + 'x', '4006 381333931', '4006381333931.0', '-4006381333931',
    '<b>4006381333931</b>', '4006381333931\u0000', '４００６３８１３３３９３１', '1'.repeat(1e6)]) {
    assert.deepEqual(B.usdaBarcodeQueries(s), [], JSON.stringify(s).slice(0, 40));
  }
});
test('4. usdaBarcodeQueries never throws and returns [] for non-strings', () => {
  const evil = { toString() { throw new Error('boom'); }, valueOf() { throw new Error('boom'); } };
  for (const v of [undefined, null, 123, 4006381333931, NaN, true, {}, [], [EAN13], evil, Symbol('x'), 10n, () => EAN13, new String(EAN13)]) {
    assert.deepEqual(B.usdaBarcodeQueries(v), [], String(typeof v));
  }
  assert.deepEqual(B.usdaBarcodeQueries(), []);
});

// ---------- domain: usdaBarcodeMatch ----------
test('5a. usdaBarcodeMatch returns the first raw record (same object) whose own gtinUpc is the same product, else null', () => {
  const a = brandedFood('999999999999', { fdcId: 1 }), b = brandedFood(UPCA, { fdcId: 2 }), c = brandedFood(UPCA, { fdcId: 3 });
  const foods = [a, b, c];
  assert.equal(B.usdaBarcodeMatch(UPCA, foods), b);
  assert.equal(B.usdaBarcodeMatch('0036000291452', foods), b, 'EAN-13 with leading 0 equals the 12-digit gtinUpc');
  assert.equal(B.usdaBarcodeMatch(UPCA, [brandedFood('0036000291452')]).gtinUpc, '0036000291452', 'and the other way round');
  assert.equal(B.usdaBarcodeMatch(EAN8, [brandedFood(EAN8)]).gtinUpc, EAN8);
  assert.equal(B.usdaBarcodeMatch(UPCA, [a]), null);
  assert.equal(B.usdaBarcodeMatch(UPCA, []), null);
});
test('5b. usdaBarcodeMatch: a different product with the same trailing digits must NOT match', () => {
  assert.equal(B.usdaBarcodeMatch(UPCA, [brandedFood('136000291452')]), null, 'one extra leading digit is another product');
  assert.equal(B.usdaBarcodeMatch(UPCA, [brandedFood('291452')]), null, 'trailing 6 digits only');
  assert.equal(B.usdaBarcodeMatch(UPCA, [brandedFood('36000291452X')]), null);
  assert.equal(B.usdaBarcodeMatch('0000012345', [brandedFood('12345')]), null, 'sameBarcode needs 6+ digits after zero-stripping');
});
test('5c. usdaBarcodeMatch ignores hostile gtinUpc values (numbers, objects, arrays, null, huge strings) and missing fields', () => {
  const evilStr = { toString() { return UPCA; } };
  const hostile = [brandedFood(36000291452), brandedFood(Number(UPCA)), brandedFood(evilStr), brandedFood([UPCA]), brandedFood(null),
    brandedFood(undefined), brandedFood(true), brandedFood('1'.repeat(1e6)), brandedFood(''), { description: 'no gtin' }, null, undefined, 5, 'str', []];
  assert.equal(B.usdaBarcodeMatch(UPCA, hostile), null);
  const good = brandedFood(UPCA, { fdcId: 7 });
  assert.equal(B.usdaBarcodeMatch(UPCA, [...hostile, good]), good, 'junk is skipped, the good record is still found');
});
test('5d. usdaBarcodeMatch reads own properties of plain objects only (no prototype tricks), skips throwing getters', () => {
  const inherited = Object.create({ gtinUpc: UPCA });
  class Rec { constructor() { this.gtinUpc = UPCA; } }
  const viaJson = JSON.parse('{"__proto__":{"gtinUpc":"' + UPCA + '"},"constructor":{"gtinUpc":"' + UPCA + '"}}');
  const thrower = { get gtinUpc() { throw new Error('boom'); } };
  assert.equal(B.usdaBarcodeMatch(UPCA, [inherited, new Rec(), viaJson]), null);
  const good = brandedFood(UPCA);
  assert.equal(B.usdaBarcodeMatch(UPCA, [thrower, good]), good);
  const nullProto = Object.assign(Object.create(null), { gtinUpc: UPCA });
  assert.equal(B.usdaBarcodeMatch(UPCA, [nullProto]), nullProto, 'null-prototype objects count as plain (same rule as barcodeOffer)');
});
test('5e. usdaBarcodeMatch: non-array foods -> null; bad code -> null; never throws; never mutates', () => {
  for (const v of [undefined, null, 'abc', 5, {}, { length: 1, 0: brandedFood(UPCA) }, new Set([brandedFood(UPCA)])]) assert.equal(B.usdaBarcodeMatch(UPCA, v), null, String(v));
  for (const c of ['', undefined, null, 'abc', {}]) assert.equal(B.usdaBarcodeMatch(c, [brandedFood(''), brandedFood('abc')]), null, String(c));
  const foods = [brandedFood(UPCA)], snap = JSON.stringify(foods);
  Object.freeze(foods); foods.forEach(Object.freeze);
  assert.equal(B.usdaBarcodeMatch(UPCA, foods), foods[0]);
  assert.equal(JSON.stringify(foods), snap);
});

// ---------- service: searchUSDAByBarcode ----------
test('6. searchUSDAByBarcode: one request to the FDC search endpoint (query=digits, dataType=Branded, api_key), returns [mapUSDA(match)]', async () => {
  globalThis.fetch = async u => { urls.push(u); return resp({ foods: [brandedFood('111111111111', { fdcId: 5 }), brandedFood(UPCA)] }); };
  const out = await U.searchUSDAByBarcode(UPCA, 'mykey');
  assert.deepEqual(out, [mapped()]);
  assert.equal(urls.length, 1);
  const u = new URL(urls[0]);
  assert.equal(u.origin + u.pathname, 'https://api.nal.usda.gov/fdc/v1/foods/search');
  assert.equal(u.searchParams.get('query'), UPCA);
  assert.equal(u.searchParams.get('dataType'), 'Branded');
  assert.equal(u.searchParams.get('api_key'), 'mykey');
});
test('7. searchUSDAByBarcode: key is trimmed, blank/missing -> DEMO_KEY, and "&" "=" "#" " " in a key are URL-encoded', async () => {
  globalThis.fetch = async u => { urls.push(u); return resp({ foods: [] }); };
  await U.searchUSDAByBarcode(UPCA, '  mykey  ');
  await U.searchUSDAByBarcode(UPCA, '   ');
  await U.searchUSDAByBarcode(UPCA);
  await U.searchUSDAByBarcode(UPCA, 'a&b=c#d e');
  assert.deepEqual(urls.map(u => q(u).get('api_key')), ['mykey', 'DEMO_KEY', 'DEMO_KEY', 'a&b=c#d e']);
  assert.equal(q(urls[3]).has('b'), false, 'an "&" in the key must not create a new parameter');
  assert.equal(q(urls[3]).get('query'), UPCA);
});
test('8. searchUSDAByBarcode: EAN-13 with leading 0 asks the 12-digit form first and stops after a hit; else asks the original too', async () => {
  globalThis.fetch = async u => { urls.push(u); return resp({ foods: [brandedFood(UPCA)] }); };
  assert.deepEqual(await U.searchUSDAByBarcode('0036000291452', 'k'), [mapped()]);
  assert.deepEqual(urls.map(u => q(u).get('query')), [UPCA], 'no second request after a hit');
  urls = [];
  globalThis.fetch = async u => { urls.push(u); return resp({ foods: q(u).get('query') === '0036000291452' ? [brandedFood(UPCA)] : [] }); };
  assert.deepEqual(await U.searchUSDAByBarcode('0036000291452', 'k'), [mapped()]);
  assert.deepEqual(urls.map(u => q(u).get('query')), [UPCA, '0036000291452'], 'queries are tried in order');
  urls = [];
  globalThis.fetch = async u => { urls.push(u); return resp({ foods: [] }); };
  assert.deepEqual(await U.searchUSDAByBarcode('0036000291452', 'k'), []);
  assert.equal(urls.length, 2);
});
test('9. searchUSDAByBarcode: only an equal-product record is accepted (different product, hostile gtinUpc, EAN-8)', async () => {
  globalThis.fetch = async u => { urls.push(u); return resp({ foods: [brandedFood('136000291452'), brandedFood('291452'), brandedFood(36000291452), brandedFood(null), { description: 'x' }, null] }); };
  assert.deepEqual(await U.searchUSDAByBarcode(UPCA, 'k'), []);
  globalThis.fetch = async u => { urls.push(u); return resp({ foods: [brandedFood(EAN8, { fdcId: 8 })] }); };
  assert.deepEqual(await U.searchUSDAByBarcode(EAN8, 'k'), [mapped({ fdcId: 8, barcode: EAN8 })]);
  assert.equal(usdaUrls().length, 2);
});
test('10. searchUSDAByBarcode: invalid code -> [] and NO request', async () => {
  globalThis.fetch = async u => { urls.push(u); return resp({ foods: [] }); };
  for (const c of ['', 'apple', '1234567', '123456789012345', null, undefined, 123, {}]) assert.deepEqual(await U.searchUSDAByBarcode(c, 'k'), [], String(c));
  assert.deepEqual(urls, []);
});
test('11. searchUSDAByBarcode: odd 200 bodies give [] (no foods key, null, non-array foods, match without calories); name stays data', async () => {
  for (const body of [{}, { foods: null }, { foods: 'x' }, { foods: {} }, null, []]) {
    globalThis.fetch = async () => resp(body);
    assert.deepEqual(await U.searchUSDAByBarcode(UPCA, 'k'), [], JSON.stringify(body));
  }
  globalThis.fetch = async () => resp({ foods: [{ description: 'No kcal', gtinUpc: UPCA, foodNutrients: [] }] });
  assert.deepEqual(await U.searchUSDAByBarcode(UPCA, 'k'), [], 'mapUSDA gives null without calories: filtered, not returned as null');
  globalThis.fetch = async () => resp({ foods: [brandedFood(UPCA, { description: '<b>X</b>', brandOwner: '"><script>' })] });
  const [f] = await U.searchUSDAByBarcode(UPCA, 'k');
  assert.equal(f.name, '<b>X</b>'); assert.equal(f.brand, '"><script>'); assert.equal(f.source, 'USDA');
});
test('12. searchUSDAByBarcode rejects with the request error: HTTP 500, rate limit, network, malformed JSON', async () => {
  globalThis.fetch = async () => resp({}, 500);
  await assert.rejects(U.searchUSDAByBarcode(UPCA, 'k'), { message: 'HTTP 500' });
  globalThis.fetch = async () => resp({}, 429);
  await assert.rejects(U.searchUSDAByBarcode(UPCA, 'k'), /rate limited/);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(U.searchUSDAByBarcode(UPCA, 'k'), { message: 'network error' });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
  await assert.rejects(U.searchUSDAByBarcode(UPCA, 'k'));
  globalThis.fetch = async u => { urls.push(u); return resp({}, 500); };
  urls = [];
  await assert.rejects(U.searchUSDAByBarcode('0036000291452', 'k'), { message: 'HTTP 500' });
});

// ---------- searchAll ----------
test('13. searchAll barcode: OFF empty -> USDA asked; result is the USDA match as an ordinary food, no errors', async () => {
  route({ off: offNone, usda: () => resp({ foods: [brandedFood(UPCA)] }) });
  const r = await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' });
  assert.deepEqual(r, { results: [mapped()], errors: [] });
  assert.equal(offUrls().length, 1);
  assert.equal(usdaUrls().length, 1);
  assert.equal(q(usdaUrls()[0]).get('query'), UPCA);
  assert.equal(q(usdaUrls()[0]).get('dataType'), 'Branded');
});
test('14. searchAll barcode: OFF failed -> USDA asked, USDA result shown, the OFF error is still reported', async () => {
  route({ off: () => resp({}, 500), usda: () => resp({ foods: [brandedFood(UPCA)] }) });
  const r = await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' });
  assert.deepEqual(r.results, [mapped()]);
  assert.deepEqual(r.errors, ['Open Food Facts: HTTP 500']);
});
test('15. searchAll barcode: OFF has a result -> USDA is NOT asked (no extra request)', async () => {
  route({ off: offHit, usda: () => { throw new Error('USDA must not be asked'); } });
  const r = await searchAll(EAN13, { useOFF: true, useUSDA: true, apiKey: 'k' });
  assert.deepEqual(r.results.map(x => x.name), ['OffThing']);
  assert.deepEqual(r.results.map(x => x.source), ['OFF']);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(usdaUrls(), []);
  assert.equal(urls.length, 1);
});
test('16. searchAll barcode: useUSDA off -> USDA never asked (OFF empty, OFF failed); useOFF off + useUSDA on -> USDA asked, OFF not', async () => {
  route({ off: offNone, usda: () => resp({ foods: [brandedFood(UPCA)] }) });
  assert.deepEqual(await searchAll(UPCA, { useOFF: true, useUSDA: false }), { results: [], errors: [] });
  route({ off: () => resp({}, 500), usda: () => resp({ foods: [brandedFood(UPCA)] }) });
  assert.deepEqual(await searchAll(UPCA, { useOFF: true, useUSDA: false }), { results: [], errors: ['Open Food Facts: HTTP 500'] });
  assert.deepEqual(usdaUrls(), []);
  urls = [];
  route({ off: offNone, usda: () => resp({ foods: [brandedFood(UPCA)] }) });
  const r = await searchAll(UPCA, { useOFF: false, useUSDA: true, apiKey: 'k' });
  assert.deepEqual(r, { results: [mapped()], errors: [] });
  assert.deepEqual(offUrls(), []);
});
test('17. searchAll barcode: nothing found anywhere (or only a different product) -> { results: [], errors: [] } so the UI can say "not found"', async () => {
  route({ off: offNone, usda: () => resp({ foods: [] }) });
  assert.deepEqual(await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: [] });
  route({ off: offNone, usda: () => resp({ foods: [brandedFood('136000291452'), brandedFood('291452')] }) });
  assert.deepEqual(await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: [] });
  route({ off: offNone, usda: () => resp({}) });
  assert.deepEqual(await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: [] }, '200 with no foods key');
});
test('18. searchAll barcode: USDA failure is reported as "USDA: <message>" and never hides an OFF error; order OFF then USDA', async () => {
  route({ off: offNone, usda: () => resp({}, 500) });
  assert.deepEqual(await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: ['USDA: HTTP 500'] });
  route({ off: () => resp({}, 500), usda: () => resp({}, 500) });
  assert.deepEqual(await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: ['Open Food Facts: HTTP 500', 'USDA: HTTP 500'] });
  route({ off: () => { throw new TypeError('Failed to fetch'); }, usda: () => { throw new TypeError('Failed to fetch'); } });
  assert.deepEqual((await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'k' })).errors, ['Open Food Facts: network error', 'USDA: network error']);
});
test('19. searchAll barcode: a rate-limited USDA with no own key adds the "add your own key" hint; with an own key or other errors it does not', async () => {
  const hint = ' Add your own USDA key in Settings (the shared key is limited).';
  route({ off: offNone, usda: () => resp({}, 429) });
  for (const key of ['', '   ', undefined]) {
    const { errors } = await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: key });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^USDA: rate limited/);
    assert.ok(errors[0].endsWith(hint), JSON.stringify(key) + ': ' + errors[0]);
  }
  const own = await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: 'mykey' });
  assert.equal(own.errors.length, 1);
  assert.match(own.errors[0], /^USDA: rate limited/);
  assert.doesNotMatch(own.errors[0], /shared key/);
  route({ off: offNone, usda: () => resp({}, 500) });
  assert.deepEqual((await searchAll(UPCA, { useOFF: true, useUSDA: true, apiKey: '' })).errors, ['USDA: HTTP 500'], 'a 500 is not a rate limit');
});
test('20. searchAll barcode: EAN-13 with leading 0, OFF empty -> USDA found by the 12-digit form; OFF itself is asked with the code as given', async () => {
  route({ off: offNone, usda: u => resp({ foods: q(u).get('query') === UPCA ? [brandedFood(UPCA)] : [] }) });
  const r = await searchAll('0036000291452', { useOFF: true, useUSDA: true, apiKey: 'k' });
  assert.deepEqual(r, { results: [mapped()], errors: [] });
  assert.ok(offUrls()[0].includes('/product/0036000291452.json'));
  assert.deepEqual(usdaUrls().map(u => q(u).get('query')), [UPCA]);
});
test('21. searchAll NAME queries are unchanged: no barcode fallback, same request count (OFF + generic + branded)', async () => {
  route({ off: () => resp({ products: [] }), usda: () => resp({ foods: [] }) });
  assert.deepEqual(await searchAll('apple', { useOFF: true, useUSDA: true, apiKey: 'k' }), { results: [], errors: [] });
  assert.equal(urls.length, 3);
  urls = [];
  await searchAll('1234567', { useOFF: true, useUSDA: true, apiKey: 'k' });   // 7 digits is not a barcode: name search
  assert.equal(urls.length, 3);
  assert.ok(usdaUrls().every(u => q(u).get('pageSize') === '8'), 'name searches keep pageSize=8');
  urls = [];
  route({ off: () => resp({}, 500), usda: () => resp({ foods: [brandedFood(UPCA)] }) });
  const r = await searchAll('cola', { useOFF: true, useUSDA: true, apiKey: 'k' });
  assert.deepEqual(r.errors, ['Open Food Facts: HTTP 500']);
  assert.equal(usdaUrls().length, 2, 'an OFF failure on a name search does not trigger extra USDA requests');
});

// ---------- STATIC TEXT checks (weak) ----------
const cf = rd('js/ui/custom-food.js');
const fn = cf.slice(cf.indexOf('async function barcodeFromPhoto'));
const fnBody = fn.slice(0, fn.search(/\n}\n/) > 0 ? fn.search(/\n}\n/) : 2500);
test('22. [static] barcodeFromPhoto no longer requires useOFF: looks up when useOFF || useUSDA, and says plainly when neither is on', () => {
  assert.ok(fnBody.length > 100, 'barcodeFromPhoto must still exist');
  assert.doesNotMatch(fnBody, /if\s*\(\s*!\s*state\.useOFF\s*\)/, 'the old "OFF only" gate must be gone');
  assert.match(fnBody, /state\.useOFF\s*\|\|\s*state\.useUSDA|state\.useUSDA\s*\|\|\s*state\.useOFF|!\s*state\.useOFF\s*&&\s*!\s*state\.useUSDA|!\s*state\.useUSDA\s*&&\s*!\s*state\.useOFF/);
  const before = fnBody.slice(0, fnBody.indexOf('searchAll('));
  assert.match(before, /database|Settings|turned off|switched off|enable/i, 'a plain message for "no database enabled" before the lookup');
  assert.match(fnBody, /searchAll\(\s*\w+\s*,\s*\{[^}]*useUSDA\s*:\s*state\.useUSDA[^}]*useOFF\s*:\s*state\.useOFF[^}]*apiKey\s*:\s*state\.apiKey/, 'still the same flags as the Search tab');
});
test('23. [static] add-food.js: the not-found button/message names the sources tried per the switches and still offers a custom food', () => {
  const af = rd('js/ui/add-food.js');
  const sec = af.slice(af.indexOf('function renderResults'), af.indexOf('async function doSearch'));
  const i = sec.indexOf('mkBarcode');
  assert.ok(i > -1, 'the mkBarcode button must still exist');
  const w = sec.slice(Math.max(0, i - 700), i + 700);
  assert.match(w, /Not found/);
  assert.match(w, /Create a custom food/);
  assert.match(w, /Open Food Facts/, 'names Open Food Facts');
  assert.match(w, /USDA/, 'names USDA');
  assert.match(w, /state\.useOFF/, 'depends on the OFF switch');
  assert.match(w, /state\.useUSDA/, 'depends on the USDA switch');
  assert.match(sec, /esc\(\s*add\.q\s*\)/, 'the code is still escaped');
});
test('24. [static] sw.js CACHE bumped past v38; no new shipped file needed', () => {
  const v = rd('sw.js').match(/const CACHE = 'macro-diary-v(\d+)'/);
  assert.ok(v && Number(v[1]) >= 39, `CACHE must be bumped from v38, got ${v && v[1]}`);
});
