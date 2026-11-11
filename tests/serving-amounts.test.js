import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapOFF } from '../js/services/off.js';
import * as units from '../js/domain/units.js';
import * as food from '../js/domain/food.js';

// Looked up lazily so a missing export fails each test (not the whole file at import time).
const parseServingText = (...a) => units.parseServingText(...a);
const startingUnit = (...a) => units.startingUnit(...a);
const servingSummary = (...a) => food.servingSummary(...a);

const src = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const near = (a, b) => Math.abs(a - b) < 1e-6;

// ---------- parseServingText ----------
test('B1 parseServingText: grams in or beside the text, hand-computed', () => {
  const table = [
    ['37 g', 37], ['37g', 37], ['1 scoop (37 g)', 37], ['1 scoop (37g)', 37], ['30 g (1 scoop)', 30],
    ['2 tbsp (30g)', 30], ['1 bar (60 g)', 60], ['100 grams', 100], ['1.5 oz (42 g)', 42],
    ['3/4 cup (30 g)', 30], ['28.4 g', 28.4], ['5000 g', 5000],
  ];
  for (const [t, g] of table) {
    const r = parseServingText(t);
    assert.ok(r, JSON.stringify(t));
    assert.ok(near(r.g, g), `${t} -> ${r && r.g}`);
    assert.equal(typeof r.label, 'string'); assert.ok(r.label.length > 0 && r.label.length <= 60);
  }
});
test('B1b parseServingText: label is the cleaned text, or "<g> g" for a bare weight', () => {
  assert.equal(parseServingText('1 scoop (37 g)').label, '1 scoop (37 g)');
  assert.equal(parseServingText('  1   bar\n(60 g) ').label, '1 bar (60 g)');
  assert.equal(parseServingText('37 g').label, '37 g');
  assert.equal(parseServingText('28.4 g').label, '28.4 g');
});
test('B2 parseServingText: ounces only when no grams, converted at 28.3495', () => {
  assert.ok(near(parseServingText('1 oz').g, 28.3495));
  assert.ok(near(parseServingText('2 oz').g, 56.699));
  assert.ok(near(parseServingText('1.5 oz (42 g)').g, 42));   // grams win over oz
});
test('B3 parseServingText: volume-only text is not grams', () => {
  for (const t of ['250 ml', '1 cup', '2 tbsp', '1 tsp', '8 fl oz', '8 fl. oz', '1 cup (240 ml)', '33 cl', '1 l', '1 litre'])
    assert.equal(parseServingText(t), null, t);
});
test('B4 parseServingText: garbage, zero, negative, huge, non-finite -> null', () => {
  for (const t of ['', '   ', 'abc', 'N/A', '0 g', '0.0 g', '-5 g', '1e999 g', '5001 g', '6000 g', '99999999 g', 'g', 'one scoop', '37'])
    assert.equal(parseServingText(t), null, JSON.stringify(t));
});
test('B5 parseServingText: non-strings and hostile objects never throw, give null', () => {
  const hostile = [null, undefined, 37, NaN, true, {}, [], ['37 g'], () => 1, Symbol('x'), 10n,
    { toString() { throw new Error('boom'); } }, { toString: () => '37 g' }, Object.create(null), '__proto__', 'constructor'];
  for (const h of hostile) { let r; assert.doesNotThrow(() => { r = parseServingText(h); }); assert.equal(r, null, String(typeof h)); }
});
test('B6 parseServingText: tags stripped, long and nested input bounded', () => {
  const r = parseServingText('<b>1 scoop</b> (37g)');
  assert.ok(r && near(r.g, 37)); assert.ok(!/[<>]/.test(r.label), r.label);
  const long = '1 scoop (37 g) ' + 'x'.repeat(100000);
  const t0 = Date.now(); const l = parseServingText(long);
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(l === null || (near(l.g, 37) && l.label.length <= 60));
  const t1 = Date.now();
  for (const s of ['('.repeat(100000), '1 '.repeat(50000) + 'g', '9'.repeat(100000) + ' g', ' '.repeat(100000) + '1 g'])
    { const x = parseServingText(s); assert.ok(x === null || (x.g > 0 && x.g <= 5000 && x.label.length <= 60)); }
  assert.ok(Date.now() - t1 < 3000, 'no catastrophic backtracking');
  const n = parseServingText('1 scoop ((37 g))'); assert.ok(n === null || near(n.g, 37));
  assert.ok(parseServingText('x'.repeat(200) + ' (37 g)').label.length <= 60);
});

// ---------- mapOFF ----------
const P = extra => ({ product_name: 'Test Powder', brands: 'Acme', nutriments: { 'energy-kcal_100g': 400 }, ...extra });

test('B7 mapOFF: serving_quantity still wins (number, numeric string)', () => {
  assert.equal(mapOFF(P({ serving_quantity: 30, serving_size: '1 scoop (37 g)' })).servingG, 30);
  assert.equal(mapOFF(P({ serving_quantity: '30', serving_size: '1 scoop' })).servingG, 30);
  assert.equal(mapOFF(P({ serving_quantity: '12.5' })).servingG, 12.5);
});
test('B8 mapOFF: no quantity, serving_size with grams -> servingG from text, label is the text', () => {
  const f = mapOFF(P({ serving_size: '1 scoop (37 g)' }));
  assert.equal(f.servingG, 37); assert.equal(f.servingLabel, '1 scoop (37 g)');
  assert.equal(mapOFF(P({ serving_quantity: null, serving_size: '30 g (1 scoop)' })).servingG, 30);
  assert.equal(mapOFF(P({ serving_quantity: '', serving_size: '2 tbsp (30g)' })).servingG, 30);
});
test('B9 mapOFF: both missing -> 0 and empty label', () => {
  const f = mapOFF(P({}));
  assert.equal(f.servingG, 0); assert.equal(f.servingLabel, '');
});
test('B10 mapOFF: bad quantity (0, negative, NaN, text) falls back to the text, else 0', () => {
  for (const q of ['0', 0, -5, '-5', NaN, 'abc', Infinity, '1e999']) {
    assert.equal(mapOFF(P({ serving_quantity: q, serving_size: '2 tbsp (30 g)' })).servingG, 30, String(q));
    assert.equal(mapOFF(P({ serving_quantity: q })).servingG, 0, String(q));
  }
});
test('B11 mapOFF: unparseable or volume-only serving_size keeps the text as label, servingG 0', () => {
  const f = mapOFF(P({ serving_size: '1 cup' }));
  assert.equal(f.servingG, 0); assert.equal(f.servingLabel, '1 cup');
  assert.equal(mapOFF(P({ serving_size: 'N/A' })).servingG, 0);
  assert.equal(mapOFF(P({ serving_size: '<b>x</b> 0 g' })).servingG, 0);
});
test('B12 mapOFF: other fields unchanged', () => {
  const f = mapOFF(P({ serving_size: '1 scoop (37 g)' }));
  assert.equal(f.name, 'Test Powder'); assert.equal(f.brand, 'Acme'); assert.equal(f.source, 'OFF'); assert.equal(f.per100.k, 400);
});

// ---------- startingUnit ----------
const W = [{ key: 'w:g', g: 1 }, { key: 'w:oz', g: 28.3495 }, { key: 'w:lb', g: 453.592 }];
const U = (...keys) => [...W, ...keys.map(k => ({ key: k, g: 10 }))];

test('B13 startingUnit: a user-saved measure beats a serving and a household portion', () => {
  const r = startingUnit({}, U('s', 'p:large', 'p:my scoop'), [{ label: 'my scoop', g: 10 }], 'w:oz');
  assert.deepEqual(r, { key: 'p:my scoop', amount: 1 });
});
test('B14 startingUnit: several saved measures -> largest updatedAt, else the last', () => {
  const us = U('p:a', 'p:b', 'p:c');
  assert.deepEqual(startingUnit({}, us, [{ label: 'a', g: 1, updatedAt: 300 }, { label: 'b', g: 1, updatedAt: 100 }, { label: 'c', g: 1, updatedAt: 200 }], 'w:g'), { key: 'p:a', amount: 1 });
  assert.deepEqual(startingUnit({}, us, [{ label: 'a', g: 1 }, { label: 'b', g: 1 }, { label: 'c', g: 1 }], 'w:g'), { key: 'p:c', amount: 1 });
});
test('B15 startingUnit: no user measure -> serving "s" at amount 1 (beats household portions)', () => {
  assert.deepEqual(startingUnit({}, U('s', 'p:large'), undefined, 'w:g'), { key: 's', amount: 1 });
  assert.deepEqual(startingUnit({}, U('s', 'p:large'), [], 'w:oz'), { key: 's', amount: 1 });
});
test('B16 startingUnit: first countable household portion at amount 1', () => {
  assert.deepEqual(startingUnit({}, U('p:large'), undefined, 'w:oz'), { key: 'p:large', amount: 1 });
  assert.deepEqual(startingUnit({}, U('p:cup, chopped', 'p:tbsp', 'p:egg, large', 'p:medium'), undefined, 'w:g'), { key: 'p:egg, large', amount: 1 });
  for (const l of ['large', 'medium', 'slice', 'egg, large', 'scoop', 'Bag', 'package', 'sausage link'])
    assert.equal(startingUnit({}, U('p:' + l), [], 'w:g').key, 'p:' + l, l);
});
test('B17 startingUnit: non-countable labels (volume/weight words, whole-word, any case) are skipped', () => {
  for (const l of ['cup', 'cups', 'cup, chopped', 'CUP', 'tbsp', 'tsp', 'tablespoon', 'teaspoon', '1 fl oz', 'fluid ounce', 'ml', 'milliliter',
    'litre', 'liter', 'quart', 'pint', 'gallon', 'oz', 'ounce', 'lb', 'pound', 'g', 'gram', 'kg', '100 g'])
    assert.deepEqual(startingUnit({}, U('p:' + l), [], 'w:oz'), { key: 'w:oz', amount: 4 }, l);
});
test('B18 startingUnit: saved measure absent from savedMeasures is treated as a household portion (rule c); non-countable first portion is skipped', () => {
  assert.deepEqual(startingUnit({}, U('p:cup', 'p:mine'), [{ label: 'gone', g: 10 }], 'w:g'), { key: 'p:mine', amount: 1 });
  assert.deepEqual(startingUnit({}, U('p:cup'), [{ label: 'cup', g: 10 }], 'w:g'), { key: 'p:cup', amount: 1 });   // a USER measure is chosen even if its label is a volume word
});
test('B19 startingUnit: weight default is exactly today (4 oz / 100 g)', () => {
  assert.deepEqual(startingUnit({}, U(), undefined, 'w:oz'), { key: 'w:oz', amount: 4 });
  assert.deepEqual(startingUnit({}, U(), undefined, 'w:g'), { key: 'w:g', amount: 100 });
  assert.deepEqual(startingUnit({}, [...W], [], 'w:oz'), { key: 'w:oz', amount: 4 });
});
test('B20 startingUnit: keys must exist in units; empty/odd inputs never throw', () => {
  assert.deepEqual(startingUnit({}, U('p:large'), [{ label: 'ghost', g: 5 }], 'w:g'), { key: 'p:large', amount: 1 });
  assert.deepEqual(startingUnit({}, [], [{ label: 'ghost', g: 5 }], 'w:oz'), { key: 'w:oz', amount: 4 });
  assert.deepEqual(startingUnit({}, [], undefined, 'w:g'), { key: 'w:g', amount: 100 });
  for (const bad of [null, undefined, 'x', 5, {}, [null], [undefined, 3, 'q', { key: 5 }, null]])
    assert.doesNotThrow(() => startingUnit({}, bad, bad, 'w:g'), String(bad));
  assert.doesNotThrow(() => startingUnit(null, U('s'), 'junk', undefined));
  assert.doesNotThrow(() => startingUnit(undefined, undefined, undefined, undefined));
  for (const bad of [null, 'x', 5, {}, [null], [{ label: null }, { label: {} }, { label: Symbol('s') }, 7]])
    assert.doesNotThrow(() => startingUnit({}, U('s'), bad, 'w:g'), String(bad));
});
test('B21 startingUnit: hostile labels (HTML, prototype keys, huge) are data, not code', () => {
  const evil = ['<img src=x onerror=alert(1)>', '__proto__', 'constructor', 'x'.repeat(100000)];
  for (const l of evil) {
    const r = startingUnit({}, [...W, { key: 'p:' + l, g: 10 }], [{ label: l, g: 10 }], 'w:g');
    assert.deepEqual(r, { key: 'p:' + l, amount: 1 });
    assert.doesNotThrow(() => startingUnit({}, [...W, { key: 'p:' + l, g: 10 }], undefined, 'w:g'));
  }
});

// ---------- servingSummary ----------
const F = (k, g, label) => ({ per100: { k, p: 0, c: 0, f: 0 }, servingG: g, servingLabel: label });

test('B22 servingSummary: kcal per serving with the label', () => {
  assert.equal(servingSummary(F(400, 37, '1 scoop (37 g)')), '148 kcal per 1 scoop (37 g)');
  assert.equal(servingSummary(F(200, 60, '1 bar (60 g)')), '120 kcal per 1 bar (60 g)');
});
test('B23 servingSummary: no label -> "<rounded g> g"; Math.round rounding', () => {
  assert.equal(servingSummary(F(400, 37, '')), '148 kcal per 37 g');
  assert.equal(servingSummary(F(100, 2.5, '')), '3 kcal per 3 g');          // 2.5 -> 3 both
  assert.equal(servingSummary(F(250, 30.4, undefined)), '76 kcal per 30 g'); // 76.0 ; 30.4 -> 30
  assert.equal(servingSummary(F(0, 30, '')), '0 kcal per 30 g');
  assert.equal(servingSummary(F(333, 50, '')), '167 kcal per 50 g');         // 166.5 -> 167
});
test('B24 servingSummary: no usable serving -> empty string', () => {
  for (const g of [0, -1, NaN, Infinity, -Infinity, undefined, null])
    assert.equal(servingSummary(F(400, g, 'x')), '', String(g));
  for (const f of [null, undefined, {}, [], 'x', 5]) assert.equal(servingSummary(f), '');
});
test('B25 servingSummary: label cleaned and capped; hostile input never throws; no escaping', () => {
  assert.equal(servingSummary(F(400, 37, 'a'.repeat(80))), '148 kcal per ' + 'a'.repeat(60));
  assert.equal(servingSummary(F(400, 37, '  1   scoop\n(37 g) ')), '148 kcal per 1 scoop (37 g)');
  assert.equal(servingSummary(F(400, 37, '<b>1 scoop</b>')), '148 kcal per 1 scoop');   // tags stripped
  assert.equal(typeof servingSummary(F(400, 37, 'x'.repeat(100000))), 'string');
  assert.ok(servingSummary(F(400, 37, 'x'.repeat(100000))).length <= 100);
  for (const f of [{ servingG: 37 }, { servingG: 37, per100: null }, { servingG: 37, per100: { k: NaN } }, { servingG: 37, per100: { k: 'abc' } },
    F(400, 37, {}), F(400, 37, Symbol('s')), F(400, 37, { toString() { throw new Error('boom'); } }), F(400, 37, '__proto__')]) {
    let r; assert.doesNotThrow(() => { r = servingSummary(f); }); assert.equal(typeof r, 'string');
  }
  assert.equal(servingSummary(F(400, 37, '&<>"')).includes('&amp;'), false);   // never pre-escaped
});

// ---------- regression guard: nothing known -> weight default ----------
test('B26 regression: food with no serving and no portions starts at 4 oz / 100 g', () => {
  const f = { name: 'Plain', brand: '', source: 'OFF', per100: { k: 100, p: 0, c: 0, f: 0 }, servingG: 0 };
  const us = units.unitsFor(f, {});
  assert.deepEqual(startingUnit(f, us, undefined, 'w:oz'), { key: 'w:oz', amount: 4 });
  assert.deepEqual(startingUnit(f, us, undefined, 'w:g'), { key: 'w:g', amount: 100 });
});
test('B27 integration: unitsFor + startingUnit for serving, USDA portions, saved measure', () => {
  const base = { name: 'Egg', brand: '', source: 'USDA', per100: { k: 143, p: 12, c: 1, f: 10 }, servingG: 0 };
  const withPorts = { ...base, portions: [{ label: 'cup, chopped', g: 140 }, { label: 'large', g: 50 }] };
  assert.deepEqual(startingUnit(withPorts, units.unitsFor(withPorts, {}), undefined, 'w:oz'), { key: 'p:large', amount: 1 });
  const m = { [food.foodKey(withPorts)]: [{ label: 'my egg', g: 60, updatedAt: 5 }] };
  assert.deepEqual(startingUnit(withPorts, units.unitsFor(withPorts, m), m[food.foodKey(withPorts)], 'w:g'), { key: 'p:my egg', amount: 1 });
  const branded = { ...base, servingG: 37, servingLabel: '1 scoop (37 g)' };
  assert.deepEqual(startingUnit(branded, units.unitsFor(branded, {}), undefined, 'w:oz'), { key: 's', amount: 1 });
});

// ---------- UI wiring (WEAK: static source text; see spec manual checklist) ----------
test('B28 UI (weak): amount-picker uses startingUnit, a touched flag, and re-runs it after portions load', () => {
  const s = src('js/ui/amount-picker.js');
  assert.match(s, /startingUnit/);
  assert.match(s, /touched/);
  assert.ok((s.match(/startingUnit\s*\(/g) || []).length >= 2, 'called at open and again after portions load');
  assert.doesNotMatch(s, /food\.servingG\s*>\s*0\)\s*\{\s*startKey\s*=\s*'s'/, 'old inline serving branch removed');
  assert.match(s, /existing/);
});
test('B29 UI (weak): add-food result rows append servingSummary, escaped', () => {
  const s = src('js/ui/add-food.js');
  assert.match(s, /servingSummary/);
  assert.match(s, /esc\(\s*servingSummary\(/);
});
test('B30 sw.js CACHE bumped above v32 (the value on main)', () => {
  const m = src('sw.js').match(/const CACHE = 'macro-diary-v(\d+)'/);
  assert.ok(m, 'CACHE constant found');
  assert.ok(Number(m[1]) > 32, `CACHE is v${m && m[1]}`);
});
