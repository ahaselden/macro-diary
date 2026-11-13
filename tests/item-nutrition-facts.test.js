// Item nutrition facts (docs/specs/item-nutrition-facts.md, behaviours 1..13). Written BEFORE the implementation.
// Expected values are hand-calculated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHEMA_VERSION, NUT_KEYS, defaults, sanitize } from '../js/core/schema.js';
import * as schemaNs from '../js/core/schema.js';
import * as barcodeNs from '../js/domain/barcode.js';
import { mapOFF } from '../js/services/off.js';
import { mapUSDA } from '../js/services/usda.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { mergeRestore } from '../js/domain/backup.js';
import { copyEntries } from '../js/domain/entries.js';

let ns = {};
try { ns = await import('../js/domain/details.js'); } catch { /* fails below with a clear message */ }
const itemFacts = (...a) => { assert.equal(typeof ns.itemFacts, 'function', 'js/domain/details.js must export itemFacts'); return ns.itemFacts(...a); };
const formatNut = (...a) => { assert.equal(typeof ns.formatNut, 'function', 'js/domain/details.js must export formatNut'); return ns.formatNut(...a); };
const dayDetails = (...a) => ns.dayDetails(...a);
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const near = (a, b, m) => assert.ok(typeof a === 'number' && Math.abs(a - b) < 1e-9, `${m || ''} expected ${b} got ${a}`);
const FULL = { fiber: 3, sugars: 4, satFat: 5, sodium: 600, cholesterol: 70 };
const food = nut => ({ name: 'x', per100: { k: 100, p: 1, c: 1, f: 1 }, ...(nut === undefined ? {} : { nut }) });
const totalsOf = r => r.map(x => x.total);
const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

test('1 itemFacts: five entries in NUT_KEYS order, scaled by grams/100', () => {
  const r = itemFacts(food(FULL), 50);
  assert.equal(r.length, 5);
  assert.deepEqual(r.map(x => x.key), NUT_KEYS);
  [1.5, 2, 2.5, 300, 35].forEach((v, i) => near(r[i].total, v, NUT_KEYS[i] + '@50'));
  const r2 = itemFacts(food(FULL), 250);
  [7.5, 10, 12.5, 1500, 175].forEach((v, i) => near(r2[i].total, v, NUT_KEYS[i] + '@250'));
});

test('2 itemFacts: missing nutrient is null, reported 0 is 0', () => {
  const r = itemFacts(food({ fiber: 0, sodium: 400 }), 100);
  assert.equal(r[0].total, 0);
  assert.equal(r[1].total, null);
  assert.equal(r[2].total, null);
  near(r[3].total, 400);
  assert.equal(r[4].total, null);
});

test('3 itemFacts: no usable nut gives five nulls', () => {
  for (const f of [food(), food(undefined), food(null), food([]), food('fiber'), food(5), food({})])
    assert.deepEqual(totalsOf(itemFacts(f, 100)), [null, null, null, null, null]);
});

test('4 itemFacts: grams 0 and invalid grams count as 0, never NaN or Infinity', () => {
  const f = food({ fiber: 3, sodium: 600 });
  for (const g of [0, NaN, Infinity, -50, '100', undefined, null, {}]) {
    const r = itemFacts(f, g);
    assert.equal(r[0].total, 0, 'fiber @' + String(g));
    assert.equal(r[3].total, 0, 'sodium @' + String(g));
    assert.equal(r[1].total, null);
    for (const x of r) assert.ok(x.total === null || Number.isFinite(x.total));
  }
});

test('5 itemFacts: huge grams stay finite and exact', () => {
  near(itemFacts(food({ fiber: 3 }), 1e6)[0].total, 30000);
});

test('6 itemFacts: hostile nut and food', () => {
  const bad = { fiber: '5', sugars: NaN, satFat: Infinity, sodium: -1, cholesterol: null, junk: 9, toString: 3 };
  assert.deepEqual(totalsOf(itemFacts(food(bad), 100)), [null, null, null, null, null]);
  assert.deepEqual(totalsOf(itemFacts(food({ fiber: true, sugars: {}, satFat: [], sodium: '', cholesterol: undefined }), 100)), [null, null, null, null, null]);
  assert.deepEqual(totalsOf(itemFacts(food(JSON.parse('{"__proto__":{"fiber":5},"constructor":{"sodium":5}}')), 100)), [null, null, null, null, null]);
  assert.deepEqual(totalsOf(itemFacts(food(Object.create({ fiber: 5 })), 100)), [null, null, null, null, null]);
  for (const f of [null, undefined, 'str', 7, [], [1, 2]]) {
    const r = itemFacts(f, 100);
    assert.equal(r.length, 5);
    assert.deepEqual(totalsOf(r), [null, null, null, null, null]);
  }
});

test('7 itemFacts: pure (frozen input, no shared objects between calls)', () => {
  const f = deepFreeze(food({ ...FULL }));
  const snap = JSON.stringify(f);
  const a = itemFacts(f, 120), b = itemFacts(f, 120);
  assert.equal(JSON.stringify(f), snap);
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
  assert.notEqual(a[0], b[0]);
  a[0].total = 999;
  assert.notEqual(itemFacts(f, 120)[0].total, 999);
});

test('8 itemFacts agrees with dayDetails for one entry', () => {
  const e = { id: 'a', meal: 'Lunch', name: 'a', brand: '', source: 'x', per100: { k: 100, p: 1, c: 1, f: 1 }, grams: 137, nut: { ...FULL } };
  assert.equal(typeof ns.dayDetails, 'function', 'dayDetails must exist');
  const d = dayDetails([e], { k: 2000, p: 100, c: 200, f: 60 });
  for (const x of itemFacts(e, e.grams)) near(x.total, d.nutrients[x.key].total, x.key);
});

test('9 formatNut formats values with a unit', () => {
  const cases = [[3.5, 'g', '3.5 g'], [500, 'mg', '500 mg'], [0, 'g', '0 g'], [0.04, 'mg', '<0.1 mg'], [0.1, 'g', '0.1 g'], [2.46, 'g', '2.5 g'], [1234.56, 'mg', '1234.6 mg'], [7, 'g', '7 g']];
  for (const [n, u, want] of cases) assert.equal(formatNut(n, u), want, `${n} ${u}`);
});

test('10 formatNut: null and unusable totals read Not recorded', () => {
  for (const n of [null, undefined, NaN, Infinity, '5', -1, {}])
    for (const u of ['g', 'mg']) assert.equal(formatNut(n, u), 'Not recorded', String(n));
});

test('11 formatNut matches the day page rule', () => {
  for (const n of [0, 0.04, 0.05, 0.1, 0.25, 1, 1.5, 12.34, 500, 1234.56]) {
    const want = (n > 0 && n < 0.1 ? '<0.1' : String(Math.round(n * 10) / 10)) + ' mg';
    assert.equal(formatNut(n, 'mg'), want, String(n));
  }
});

test('12 amount-picker source wires the facts block and keeps the card', () => {
  const s = read('../js/ui/amount-picker.js'), d = read('../js/domain/details.js');
  assert.match(s, /import\s*\{[^}]*\bitemFacts\b[^}]*\}\s*from\s*'\.\.\/domain\/details\.js'/, 'imports itemFacts');
  assert.match(s, /import\s*\{[^}]*\bformatNut\b[^}]*\}\s*from\s*'\.\.\/domain\/details\.js'/, 'imports formatNut');
  const upd = s.slice(s.indexOf('const upd'), s.indexOf('fill(startKey)'));
  assert.ok(upd.length > 20 && /itemFacts\(/.test(upd), 'upd() calls itemFacts');
  assert.ok(s.includes('Nutrition facts'), 'heading');
  assert.ok(s.includes('itemFacts') && /id="itemFacts"/.test(s), 'container id');
  for (const l of ['Fiber', 'Sugars', 'Saturated fat', 'Sodium', 'Cholesterol']) assert.ok(s.includes(l) || d.includes(l), 'label ' + l);
  for (const keep of ['rd(p.k * f)', 'Protein', 'Carbs', 'Fat', 'id="prev2"', 'r1(p.p * f)']) assert.ok(s.includes(keep), 'kept ' + keep);
});

test('13 schema is still v8 (guard; passes before implementation)', () => {
  assert.equal(SCHEMA_VERSION, 9);
});

// ---------- Part 2: barcode kept (spec "Part 2", B1..B9) ----------
const BC = '810030518914', BC13 = '0810030518914';   // check digit hand-computed: 4
const offP = over => ({ product_name: 'X', nutriments: { 'energy-kcal_100g': 100 }, ...over });
const usF = over => ({ description: 'Thing', fdcId: 1, foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 100 }], ...over });
const ent = (id, over = {}) => ({ id, meal: 'Lunch', name: id, brand: '', source: 'x', per100: { k: 100, p: 1, c: 1, f: 1 }, grams: 100, ...over });
const cfood = (over = {}) => ({ name: 'c', brand: '', source: 'custom', per100: { k: 1, p: 1, c: 1, f: 1 }, servingG: 0, servingLabel: '', ...over });

test('B1 mapOFF keeps a valid code as barcode, otherwise adds nothing', () => {
  assert.equal(mapOFF(offP({ code: BC })).barcode, BC);
  assert.equal(mapOFF(offP({ code: BC13 })).barcode, BC13);
  const plain = mapOFF(offP({}));
  assert.ok(!('barcode' in plain));
  for (const bad of ['810030518915', '123', 'abc12345678', 810030518914, {}, null, ' ' + BC + 'x']) {
    const r = mapOFF(offP({ code: bad }));
    assert.ok(!('barcode' in r), 'code ' + String(bad));
    assert.deepEqual(r, plain);
  }
  const { barcode, ...rest } = mapOFF(offP({ code: BC }));
  assert.deepEqual(rest, plain);
});

test('B2 mapUSDA keeps gtinUpc as barcode, otherwise adds nothing', () => {
  assert.equal(mapUSDA(usF({ gtinUpc: '036000291452' })).barcode, '036000291452');
  const plain = mapUSDA(usF({}));
  assert.ok(!('barcode' in plain));
  for (const bad of ['036000291453', '12', 'x', 36000291452, null]) assert.deepEqual(mapUSDA(usF({ gtinUpc: bad })), plain, String(bad));
  const { barcode, ...rest } = mapUSDA(usF({ gtinUpc: '036000291452' }));
  assert.deepEqual(rest, plain);
});

test('B3 sanitizeBarcode accepts only 8-14 digit strings', () => {
  assert.equal(typeof schemaNs.sanitizeBarcode, 'function', 'schema.js must export sanitizeBarcode');
  for (const ok of [BC, BC13, '12345678', '12345678901234']) assert.equal(schemaNs.sanitizeBarcode(ok), ok);
  for (const bad of [810030518914, ' ' + BC, '8100305189a4', '123456789012345', '1234567', '', null, undefined, {}, [BC], true])
    assert.equal(schemaNs.sanitizeBarcode(bad), undefined, String(bad));
});

test('B4 sanitize() cleans barcode on entries, recent and custom foods', () => {
  const d = sanitize({ ...defaults(), days: { '2025-01-01': [ent('ok', { barcode: BC }), ent('bad', { barcode: '<img src=x onerror=alert(1)>' }), ent('none')] },
    recent: [cfood({ barcode: BC }), cfood({ name: 'g', barcode: 5 })], custom: [cfood({ barcode: BC13 }), cfood({ name: 'h', barcode: 'zz' })] });
  const [a, b, c] = d.days['2025-01-01'];
  assert.equal(a.barcode, BC);
  assert.equal(b.id, 'bad'); assert.ok(!('barcode' in b));
  assert.ok(!('barcode' in c));
  assert.equal(d.recent[0].barcode, BC); assert.ok(!('barcode' in d.recent[1]));
  assert.equal(d.custom[0].barcode, BC13); assert.ok(!('barcode' in d.custom[1]));
});

test('B5 sync records carry and clean barcode', () => {
  const s = { ...defaults(), days: { '2025-02-01': [ent('a', { barcode: BC, updatedAt: 5 }), ent('b', { updatedAt: 5 })] } };
  const got = applyRecords({ ...defaults() }, JSON.parse(JSON.stringify(toRecords(s))));
  const es = got.days['2025-02-01'];
  assert.equal(es.find(e => e.id === 'a').barcode, BC);
  assert.ok(!('barcode' in es.find(e => e.id === 'b')));
  const h = applyRecords({ ...defaults() }, [{ key: 'day:2025-02-02', updatedAt: 10, value: { entries: [ent('h', { barcode: '<b>x</b>', updatedAt: 5 }), ent('n', { barcode: 810030518914, updatedAt: 5 })] } }]);
  const hs = h.days['2025-02-02'];
  assert.ok(hs.length === 2 && hs.every(e => !('barcode' in e)));
  const c = applyRecords({ ...defaults() }, [{ key: 'custom', updatedAt: 10, value: { custom: [cfood({ barcode: BC }), cfood({ name: 'd', barcode: 'evil' })] } }]);
  assert.equal(c.custom.find(f => f.name === 'c').barcode, BC);
  assert.ok(!('barcode' in c.custom.find(f => f.name === 'd')));
});

test('B6 backup restore carries and cleans entry barcode', () => {
  const bk = JSON.parse(JSON.stringify({ ...defaults(), days: { '2025-04-02': [ent('n', { barcode: BC, updatedAt: 2 }), ent('h', { barcode: 'x', updatedAt: 2 }), ent('o', { updatedAt: 2 })] } }));
  const d2 = mergeRestore({ ...defaults(), days: {} }, bk).days['2025-04-02'];
  assert.equal(d2.find(e => e.id === 'n').barcode, BC);
  assert.ok(!('barcode' in d2.find(e => e.id === 'h')));
  assert.ok(!('barcode' in d2.find(e => e.id === 'o')));
});

test('B7 copyEntries carries barcode', () => {
  const st = { ...defaults(), days: { '2025-05-01': [ent('a', { barcode: BC })] } };
  const out = copyEntries(st, '2025-05-01', ['a'], '2025-05-02', 'Dinner', 1000, () => 'new1');
  assert.equal(out.length, 1);
  assert.equal(st.days['2025-05-02'][0].barcode, BC);
});

test('B8 pickFoodBarcode: scanned wins when valid, else the found code, else empty', () => {
  const f = (...a) => { assert.equal(typeof barcodeNs.pickFoodBarcode, 'function', 'barcode.js must export pickFoodBarcode'); return barcodeNs.pickFoodBarcode(...a); };
  assert.equal(f(BC, BC13), BC);
  assert.equal(f('', BC13), BC13);
  assert.equal(f(BC, undefined), BC);
  assert.equal(f('junk', BC), BC);
  assert.equal(f(BC, '036000291452'), BC);
  for (const [a, b] of [['junk', 'junk'], [undefined, undefined], [null, 5], [{}, []], ['', ''], [810030518914, 810030518914]]) assert.equal(f(a, b), '', JSON.stringify([a, b]));
});

test('B9 source: amount-picker shows and keeps the barcode, add-food applies the scanned code', () => {
  const s = read('../js/ui/amount-picker.js'), a = read('../js/ui/add-food.js');
  assert.ok(s.includes('Barcode '), 'Barcode line');
  assert.match(s, /food\.barcode/);
  const info = s.slice(s.indexOf('const info'), s.indexOf('addEntry(state, view.day'));
  assert.ok(/barcode/.test(info), 'barcode copied into the entry/recent info');
  assert.match(s, /esc\(\s*(food\.barcode|bc)/, 'barcode is escaped');
  assert.match(a, /pickFoodBarcode/);
});
