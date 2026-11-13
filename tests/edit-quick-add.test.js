// Tests for docs/specs/edit-quick-add.md. Numbers B1.. match the spec's behaviour list.
// B1-B16 are domain tests: cleanFoodName and updateCustomFood live in js/domain/food.js (not built yet: tests fail until they exist).
// B17 is a WEAK static check: it reads UI source text and proves wording/wiring exists, NOT that any screen works.
// The numbered headless checklist (C1..) in the spec covers the UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as food from '../js/domain/food.js';
import { foodKey } from '../js/domain/food.js';
import { addEntry, updateEntry } from '../js/domain/entries.js';
import { mergeStates } from '../js/domain/merge.js';
import { toRecords } from '../js/domain/sync-records.js';
import { defaults } from '../js/core/store.js';

const cleanFoodName = (...a) => food.cleanFoodName(...a);         // missing export -> TypeError (test fails)
const updateCustomFood = (...a) => food.updateCustomFood(...a);

const DAY = '2026-11-12';
const cf = (name, over = {}) => ({ name, brand: '', source: 'Custom', servingG: 30, per100: { k: 500, p: 10, c: 60, f: 25 }, updatedAt: 1000, ...over });
const fresh = () => {
  const s = { ...defaults(), days: {}, tombstones: {}, recent: [], measures: {} };
  s.custom = [cf('Cheez-it Duo'), cf('Homemade chili', { servingG: 250, per100: { k: 100, p: 8, c: 10, f: 3 }, updatedAt: 900 }), cf('Rice bar', { barcode: '5012345678900' })];
  s.measures = { 'Cheez-it Duo||Custom': [{ label: 'box', g: 200, updatedAt: 1000 }] };
  s.recent = [{ name: 'Cheez-it Duo', brand: '', source: 'Custom', per100: { k: 500, p: 10, c: 60, f: 25 } }];
  addEntry(s, DAY, { id: 'e1', meal: 'Breakfast', name: 'Cheez-it Duo', brand: '', source: 'Custom', per100: { k: 500, p: 10, c: 60, f: 25 }, grams: 30, unitKey: 'w:g', amount: 30, disp: '' }, 1000);
  addEntry(s, DAY, { id: 'e2', meal: 'Breakfast', name: 'Quick add', brand: '', source: 'Custom', per100: { k: 200, p: 5, c: 20, f: 10 }, grams: 100, unitKey: 'w:g', amount: 100, disp: '' }, 1000);
  return s;
};
const KEY = 'Cheez-it Duo||Custom';
const unchanged = (s, fn) => { const before = structuredClone(s); const r = fn(); assert.equal(r, null); assert.deepEqual(s, before); };

test('B1 cleanFoodName trims and collapses whitespace', () => {
  assert.equal(cleanFoodName('  Cheez-it \t Duo\n'), 'Cheez-it Duo');
  assert.equal(cleanFoodName('a    b   c'), 'a b c');
});

test('B2 cleanFoodName returns empty string for empty, blank and non-string input', () => {
  for (const v of ['', '   ', '\t\n', null, undefined, 0, 5, NaN, {}, [], ['a'], true, () => 'x']) assert.equal(cleanFoodName(v), '', String(typeof v));
});

test('B3 cleanFoodName caps at 100 (or the given max) and never leaves a trailing space', () => {
  assert.equal(cleanFoodName('x'.repeat(150)), 'x'.repeat(100));
  assert.equal(cleanFoodName('x'.repeat(100)), 'x'.repeat(100));
  assert.equal(cleanFoodName('a'.repeat(99) + ' b'), 'a'.repeat(99));        // cut falls right after the space
  assert.equal(cleanFoodName('abcdef', 3), 'abc');
});

test('B4 cleanFoodName keeps hostile text as plain data and never throws', () => {
  assert.equal(cleanFoodName('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
  assert.equal(cleanFoodName('__proto__'), '__proto__');
  assert.equal(cleanFoodName('"quoted" & <b>'), '"quoted" & <b>');
  assert.doesNotThrow(() => cleanFoodName('x'.repeat(1e6)));
  assert.equal(cleanFoodName('x'.repeat(1e6)).length, 100);
  assert.doesNotThrow(() => cleanFoodName('\ud800 ok'));
  assert.equal(cleanFoodName({ toString() { throw new Error('boom'); } }), '');
});

test('B5 updateCustomFood renames in place: stamped, same position, nothing else moved', () => {
  const s = fresh(), others = structuredClone([s.custom[1], s.custom[2]]);
  const r = updateCustomFood(s, KEY, { name: '  Cheez-it   Duo 2pk ' }, 5000);
  assert.ok(r);
  assert.equal(s.custom.length, 3);
  assert.equal(s.custom[0], r);
  assert.equal(r.name, 'Cheez-it Duo 2pk');
  assert.equal(r.updatedAt, 5000);
  assert.equal(r.source, 'Custom');
  assert.deepEqual([s.custom[1], s.custom[2]], others);
});

test('B6 updateCustomFood stores per-serving numbers per 100 g (30 g: 150 kcal, 3 P, 18 C, 7.5 F -> 500/10/60/25)', () => {
  const s = fresh();
  const r = updateCustomFood(s, 'Homemade chili||Custom', { servingG: 30, k: 150, p: 3, c: 18, f: 7.5 }, 7000);
  assert.ok(r);
  assert.equal(r.servingG, 30);
  for (const [k, v] of Object.entries({ k: 500, p: 10, c: 60, f: 25 })) assert.ok(Math.abs(r.per100[k] - v) < 1e-9, k + ' ' + r.per100[k]);
  // name-only patch leaves numbers alone
  const s2 = fresh(), before = structuredClone(s2.custom[1]);
  const r2 = updateCustomFood(s2, 'Homemade chili||Custom', { name: 'Chili' }, 7000);
  assert.deepEqual(r2.per100, before.per100);
  assert.equal(r2.servingG, before.servingG);
});

test('B7 a rename moves saved measures to the new key; a key-preserving edit leaves measures alone', () => {
  const s = fresh();
  updateCustomFood(s, KEY, { name: 'Duo box' }, 5000);
  assert.deepEqual(Object.keys(s.measures), ['Duo box||Custom']);
  assert.equal(s.measures['Duo box||Custom'].length, 1);
  assert.equal(s.measures['Duo box||Custom'][0].label, 'box');
  assert.equal(s.measures['Duo box||Custom'][0].g, 200);
  const s2 = fresh(), m = structuredClone(s2.measures);
  updateCustomFood(s2, KEY, { k: 160 }, 5000);
  assert.deepEqual(s2.measures, m);
  const s3 = fresh();
  updateCustomFood(s3, KEY, { brand: 'Sunshine' }, 5000);       // brand is part of the key too
  assert.deepEqual(Object.keys(s3.measures), ['Cheez-it Duo|Sunshine|Custom']);
});

test('B8 empty, blank or non-string name is refused with state unchanged', () => {
  for (const name of ['', '   ', null, 5, {}, ['x']]) {
    const s = fresh();
    unchanged(s, () => updateCustomFood(s, KEY, { name }, 5000));
  }
});

test('B9 collision with a DIFFERENT saved food is refused; own name and different-barcode twins are allowed', () => {
  const s = fresh();
  unchanged(s, () => updateCustomFood(s, 'Homemade chili||Custom', { name: 'Cheez-it Duo' }, 5000));   // both have no barcode
  const s2 = fresh();
  unchanged(s2, () => updateCustomFood(s2, KEY, { barcode: '5012345678900' }, 5000));                  // same barcode as Rice bar
  const s3 = fresh();
  assert.ok(updateCustomFood(s3, KEY, { name: 'Cheez-it Duo', k: 160 }, 5000));                         // itself: not a collision
  const s4 = fresh();
  assert.ok(updateCustomFood(s4, KEY, { name: 'Rice bar', barcode: '4006381333931' }, 5000));           // same name, different barcodes: two products
  assert.equal(s4.custom.filter(f => f.name === 'Rice bar').length, 2);
});

test('B10 unknown key is refused (including prototype keys)', () => {
  for (const key of ['nope||Custom', '', '__proto__', 'constructor', 'toString', undefined, null, 5]) {
    const s = fresh();
    unchanged(s, () => updateCustomFood(s, key, { name: 'X' }, 5000));
  }
});

test('B11 barcode: valid stored, empty string removes it, invalid refused', () => {
  const s = fresh();
  assert.equal(updateCustomFood(s, KEY, { barcode: '036000291452' }, 5000).barcode, '036000291452');
  const r = updateCustomFood(s, 'Rice bar||Custom', { barcode: '' }, 5001);
  assert.ok(r);
  assert.ok(!r.barcode);
  for (const barcode of ['1234567', 'abc12345678', '123456789012345', '12 34']) {
    const t = fresh();
    unchanged(t, () => updateCustomFood(t, KEY, { barcode }, 5000));
  }
});

test('B12 hostile numbers and input: refused or safe, never throws, never pollutes', () => {
  for (const patch of [{ k: NaN }, { k: Infinity }, { k: -1 }, { p: -0.5 }, { c: NaN }, { f: 'abc' }, { servingG: 0 }, { servingG: -5 }, { servingG: NaN }, { servingG: 'x' }]) {
    const s = fresh();
    unchanged(s, () => updateCustomFood(s, KEY, patch, 5000));
  }
  const big = fresh();
  assert.doesNotThrow(() => updateCustomFood(big, KEY, { k: 1e308, servingG: 1e-300 }, 5000));
  for (const v of Object.values(big.custom[0].per100)) assert.ok(Number.isFinite(v));
  const evil = JSON.parse('{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"name":"Safe"}');
  const s = fresh();
  assert.doesNotThrow(() => updateCustomFood(s, KEY, evil, 5000));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(s.custom[0].polluted, undefined);
  assert.equal(Object.hasOwn(s.custom[0], 'constructor'), false);
  for (const [st, patch, now] of [[null, {}, 1], [undefined, {}, 1], [{}, {}, 1], [{ custom: 'x' }, {}, 1], [fresh(), null, 1], [fresh(), 'str', 1], [fresh(), [1], 1], [fresh(), { name: 'Y' }, NaN], [fresh(), { name: 'Y' }, 'now']]) {
    let out; assert.doesNotThrow(() => { out = updateCustomFood(st, KEY, patch, now); });
    assert.equal(out, null);
  }
});

test('B13 HTML in a new name or brand is stored literally', () => {
  const s = fresh();
  const r = updateCustomFood(s, KEY, { name: '<img src=x onerror=alert(1)>', brand: '<b>Acme</b> & "co"' }, 5000);
  assert.equal(r.name, '<img src=x onerror=alert(1)>');
  assert.equal(r.brand, '<b>Acme</b> & "co"');
});

test('B14 editing a food never changes past diary entries or recent', () => {
  const s = fresh(), days = structuredClone(s.days), recent = structuredClone(s.recent);
  assert.ok(updateCustomFood(s, KEY, { name: 'Renamed', k: 999, servingG: 50 }, 5000));
  assert.deepEqual(s.days, days);
  assert.deepEqual(s.recent, recent);
  assert.deepEqual(s.tombstones, {});
});

test('B15 renaming an entry changes only that entry (name + updatedAt)', () => {
  const s = fresh(), e1 = structuredClone(s.days[DAY][0]), custom = structuredClone(s.custom);
  const name = cleanFoodName('  Cheez-it   Duo bites ');
  assert.equal(name, 'Cheez-it Duo bites');
  const e2 = updateEntry(s, DAY, 'e2', { name }, 6000);
  assert.equal(e2.name, 'Cheez-it Duo bites');
  assert.equal(e2.updatedAt, 6000);
  assert.equal(e2.grams, 100);
  assert.equal(e2.meal, 'Breakfast');
  assert.deepEqual(e2.per100, { k: 200, p: 5, c: 20, f: 10 });
  assert.deepEqual(s.days[DAY][0], e1);
  assert.deepEqual(s.custom, custom);
  assert.equal(cleanFoodName('   '), '');                       // what the UI must refuse instead of sending
});

test('B16 sync: edited food and renamed entry win a merge over their older copies; custom record stamped by the edit', () => {
  const older = fresh(), newer = structuredClone(older);
  updateCustomFood(newer, KEY, { k: 300, p: 6, c: 36, f: 15 }, 9000);
  assert.equal(toRecords(newer).find(r => r.key === 'custom').updatedAt, 9000);
  for (const [a, b] of [[older, newer], [newer, older]]) {
    const m = mergeStates(a, b);
    const f = m.custom.find(x => x.name === 'Cheez-it Duo');
    assert.equal(f.updatedAt, 9000);
    assert.ok(Math.abs(f.per100.k - 1000) < 1e-9);
    assert.equal(m.custom.filter(x => x.name === 'Cheez-it Duo').length, 1);
  }
  const o2 = fresh(), n2 = structuredClone(o2);
  updateEntry(n2, DAY, 'e2', { name: 'Duo bites' }, 9000);
  for (const [a, b] of [[o2, n2], [n2, o2]]) {
    const e = mergeStates(a, b).days[DAY].find(x => x.id === 'e2');
    assert.equal(e.name, 'Duo bites');
    assert.equal(e.updatedAt, 9000);
  }
  const o3 = structuredClone(n2); updateEntry(o3, DAY, 'e2', { name: 'Older rename' }, 8000);   // an older rename loses
  for (const [a, b] of [[o3, n2], [n2, o3]]) assert.equal(mergeStates(a, b).days[DAY].find(x => x.id === 'e2').name, 'Duo bites');
});

test('B17 WEAK: UI source has the wording and wiring (proves text exists, not that it works)', () => {
  const cust = readFileSync(new URL('../js/ui/custom-food.js', import.meta.url), 'utf8');
  const amt = readFileSync(new URL('../js/ui/amount-picker.js', import.meta.url), 'utf8');
  const addf = readFileSync(new URL('../js/ui/add-food.js', import.meta.url), 'utf8');
  assert.ok(!cust.includes('Quick add'), 'custom-food.js must not default the name to "Quick add"');
  assert.ok(cust.includes('cleanFoodName') && cust.includes('updateCustomFood'));
  assert.ok(cust.includes('Edit food') && cust.includes('Enter a name'));
  assert.ok(amt.includes('cleanFoodName') && amt.includes('eName'));
  assert.ok(addf.includes('data-edit-food'));
});
