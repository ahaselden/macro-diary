// Tests for docs/specs/saved-food-ids.md (written by the test designer BEFORE the implementation). Numbers match the spec's behaviour list.
// Golden ids are the FNV-1a 64-bit hash (spec D-A) of the hand-built strings, checked against the published FNV test vectors; they were not produced by the new code.
// Items 33-35 are WEAK source/doc checks (wording and wiring only). The screens are covered by the headless checklist C1..C9 in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as schema from '../js/core/schema.js';
import * as food from '../js/domain/food.js';
import { foodKey } from '../js/domain/food.js';
import { unitsFor } from '../js/domain/units.js';
import { resolveGrams, recipeNutrition } from '../js/domain/recipes.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { toRecords, applyRecords, stableStringify } from '../js/domain/sync-records.js';
import { defaults, migrate, sanitize, sanitizeFood, SCHEMA_VERSION } from '../js/core/schema.js';
import { createStore } from '../js/core/store.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { fixture, clone } from './helpers.js';

// wrappers: a missing export fails the single test (TypeError) instead of the whole file
const isFoodId = (...a) => schema.isFoodId(...a);
const legacyFoodId = (...a) => schema.legacyFoodId(...a);
const makeFoodId = (...a) => food.makeFoodId(...a);
const measuresKey = (...a) => food.measuresKey(...a);
const addCustomFood = (...a) => food.addCustomFood(...a);
const updateCustomFood = (...a) => food.updateCustomFood(...a);

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const P = { k: 500, p: 10, c: 60, f: 25 };
const cf = (name, over = {}) => ({ name, brand: '', source: 'Custom', servingG: 30, per100: { ...P }, updatedAt: 1000, ...over });
const base = (over = {}) => ({ ...defaults(), ...over });
const v8 = (over = {}) => ({ ...defaults(), schemaVersion: 8, ...over });
const byLabel = l => [...l].map(m => [m.label, m.g, m.updatedAt]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const entry = (id, over = {}) => ({ id, meal: 'Lunch', name: 'x', brand: '', source: 'Custom', per100: { ...P }, grams: 100, ...over });
const view = s => ({ custom: s.custom, measures: s.measures, tombstones: s.tombstones });
const DUO = 'f-c7e47751c795d5a1', CHILI = 'f-a07ed5344605c4a3';

// ---------------------------------------------------------------- ids
test('1. isFoodId accepts generated and derived ids and rejects everything else', () => {
  for (const ok of ['fduo0001', 'fabcdef', 'f' + 'z'.repeat(24), 'f-c7e47751c795d5a1', 'f-0000000000000000']) assert.equal(isFoodId(ok), true, ok);
  const bad = ['', 'f', 'fabcde', 'f' + 'z'.repeat(25), 'Fduo0001', 'fDUO0001', 'duo00001', 'f-C7E47751C795D5A1', 'f-c7e47751c795d5a', 'f-c7e47751c795d5a1x', 'f-', 'f-c7e47751c795d5a1 ', ' fduo0001',
    '__proto__', 'constructor', 'toString', 'prototype', '<img src=x onerror=1>', 'fduo 0001', 'fduo_0001', 'mh1abcd0001', 'Cheez-it Duo||Custom', 123, null, undefined, {}, [], ['fduo0001'], true, NaN, () => 'fduo0001'];
  for (const v of bad) assert.equal(isFoodId(v), false, String(typeof v) + ' ' + String(v));
});

test('2. makeFoodId: f + time in base 36 + 4 random base-36 characters, injectable, always a valid id', () => {
  assert.equal(makeFoodId(1700000000000, () => 0.5), 'floyw3v28i000');
  assert.equal(makeFoodId(1700000000000, () => 0), 'floyw3v280000');
  assert.equal(makeFoodId(1700000000000, () => 0.9999999999), 'floyw3v28zzzz');
  const a = makeFoodId(1700000000000, () => 0.1), b = makeFoodId(1700000000001, () => 0.1), c = makeFoodId(1700000000000, () => 0.2);
  assert.equal(new Set([a, b, c]).size, 3);
  for (const id of [a, b, c]) { assert.equal(isFoodId(id), true); assert.ok(!id.includes('-')); }
  for (const now of [NaN, undefined, null, 'x', -5, Infinity, {}, [], 1e300]) for (const rnd of [() => NaN, () => -1, () => 7, () => undefined, () => 'a', Math.random]) {
    let id; assert.doesNotThrow(() => { id = makeFoodId(now, rnd); }, String(now));
    assert.equal(isFoodId(id), true, `now ${String(now)}: ${id}`);
  }
  assert.doesNotThrow(() => makeFoodId());
  assert.equal(isFoodId(makeFoodId()), true);
  assert.equal(new Set(Array.from({ length: 500 }, () => makeFoodId(1700000000000, Math.random))).size > 495, true);   // 36^4 random values: collisions are rare
});

test('3. legacyFoodId golden values (FNV-1a 64 of "name|brand|source|barcode")', () => {
  assert.equal(legacyFoodId(cf('Chili')), 'f-a07ed5344605c4a3');
  assert.equal(legacyFoodId(cf('Cheez-it Duo')), 'f-c7e47751c795d5a1');
  assert.equal(legacyFoodId(cf('=cmd|calc')), 'f-ec77da65057a9fea');
  assert.equal(legacyFoodId(cf('')), 'f-62eb5657dc2d9dd6');
  assert.equal(legacyFoodId(cf('Rice bar', { barcode: '5012345678900' })), 'f-8689d988c3fb7226');
  assert.equal(legacyFoodId(cf('Rice bar', { barcode: '4006381333931' })), 'f-6fcd96980c7234ac');
  assert.equal(legacyFoodId(cf('Rice bar', { barcode: '036000291452' })), legacyFoodId(cf('Rice bar', { barcode: '36000291452' })));
  assert.equal(legacyFoodId(cf('Rice bar', { barcode: '036000291452' })), 'f-48fb9f5df5e9719e');
  for (const id of ['f-a07ed5344605c4a3', 'f-c7e47751c795d5a1']) assert.equal(isFoodId(id), true);
});

test('4. legacyFoodId depends only on name, brand, source and barcode; is pure; never throws', () => {
  const f = cf('Chili'), id = legacyFoodId(f);
  assert.equal(legacyFoodId({ ...f, per100: { k: 1, p: 1, c: 1, f: 1 }, updatedAt: 99, tag: 'My food', id: 'fother0001', foodId: 'fother0002', servingG: 7, nut: { fiber: 1 } }), id);
  assert.notEqual(legacyFoodId({ ...f, brand: 'Acme' }), id);
  assert.notEqual(legacyFoodId({ ...f, source: 'USDA' }), id);
  assert.notEqual(legacyFoodId({ ...f, name: 'chili' }), id);
  const a = legacyFoodId({ ...f, barcode: '5012345678900' }), b = legacyFoodId({ ...f, barcode: '4006381333931' });
  assert.ok(a !== b && a !== id && b !== id, 'same key, different barcodes are different foods');
  for (const barcode of ['1234567', 'abc12345678', '123456789012345', '12 34', 5, null, {}]) assert.equal(legacyFoodId({ ...f, barcode }), id, 'invalid barcode counts as none: ' + String(barcode));
  const frozen = deepFreeze(cf('Chili', { barcode: '5012345678900', nut: { fiber: 1 } }));
  assert.equal(legacyFoodId(frozen), a); assert.equal(legacyFoodId(frozen), a);
  for (const v of [null, undefined, 5, 'x', [], true]) assert.equal(legacyFoodId(v), null, String(v));
  assert.doesNotThrow(() => legacyFoodId({ name: { toString() { throw new Error('boom'); } }, brand: [], source: null }));
  assert.equal(isFoodId(legacyFoodId({ name: { toString() { throw new Error('boom'); } } })), true);
  assert.equal(legacyFoodId({ name: 5, brand: undefined, source: {} }), legacyFoodId({ name: '', brand: '', source: '' }));
  assert.equal(isFoodId(legacyFoodId(JSON.parse('{"__proto__":{"polluted":1},"name":"__proto__"}'))), true);
  assert.equal({}.polluted, undefined);
  assert.equal(legacyFoodId(cf('x'.repeat(1e6))).length, 18);
  // agrees with foodKey (the derivation hashes foodKey + '|' + barcodePart)
  assert.equal(foodKey(f), 'Chili||Custom');
});

// ---------------------------------------------------------------- schema and migration
test('5. SCHEMA_VERSION is 9, defaults carry it, STORAGE_KEY is unchanged', () => {
  assert.equal(SCHEMA_VERSION, 9);
  assert.equal(defaults().schemaVersion, 9);
  assert.equal(STORAGE_KEY, 'macrodiary.v1');
  assert.match(read('js/core/schema.js'), /export const SCHEMA_VERSION = 9;/);
});

test('6. migrate v8 -> v9 gives every saved food its derived id, changes nothing else, is idempotent, and two devices agree', () => {
  const foods = [cf('Cheez-it Duo', { nut: { fiber: 1 } }), cf('Homemade chili', { servingG: 250, updatedAt: 900 }), cf('Rice bar', { barcode: '5012345678900', updatedAt: 800 })];
  const m = migrate(v8({ custom: clone(foods) }));
  assert.equal(m.schemaVersion, 9);
  assert.deepEqual(m.custom.map(f => f.name), foods.map(f => f.name));
  m.custom.forEach((f, i) => { const { id, ...rest } = f; assert.equal(id, legacyFoodId(foods[i])); assert.deepEqual(rest, foods[i]); });
  assert.equal(m.custom[0].id, DUO);
  assert.deepEqual(migrate(clone(m)), m);
  // two devices: different list around the same food, different order
  const devA = migrate(v8({ custom: [cf('Homemade chili', { servingG: 250, updatedAt: 900 })] }));
  const devB = migrate(v8({ custom: [cf('Zed'), cf('Cheez-it Duo'), cf('Homemade chili', { servingG: 250, updatedAt: 900 }), cf('Rice bar', { barcode: '5012345678900' })] }));
  assert.equal(devA.custom[0].id, devB.custom.find(f => f.name === 'Homemade chili').id);
  assert.equal(devA.custom[0].id, 'f-7b677d3dbd34a367');
  // merging the two independent migrations does not duplicate anything
  assert.equal(mergeStates(devA, devB).custom.filter(f => f.name === 'Homemade chili').length, 1);
});

test('6b. a save with NO schemaVersion (v1) loaded through the store is migrated the same way (the store spreads defaults first)', () => {
  const v1 = fixture('state');
  assert.equal(v1.schemaVersion, undefined);
  const st = createStore({ getItem: () => JSON.stringify(v1), setItem() {} }).state;
  assert.equal(st.schemaVersion, 9);
  assert.equal(st.custom[0].id, 'f-ec77da65057a9fea');
  const bk = fixture('backup'), st2 = createStore({ getItem: () => JSON.stringify(bk), setItem() {} }).state;
  assert.equal(st2.custom.find(f => f.name === 'Chili').id, CHILI);
  assert.deepEqual(byLabel(st2.measures[CHILI]), byLabel([{ label: 'cup', g: 240 }]));
  assert.ok(!('Chili||Custom' in st2.measures));
});

test('7. a valid id is kept; an invalid or hostile one is replaced by the derived id; no food is dropped', () => {
  const m = migrate(v8({ custom: [cf('Keep', { id: 'fkeep0001' }), cf('A', { id: '__proto__' }), cf('B', { id: 'x'.repeat(10000) }), cf('C', { id: 123 }), cf('D', { id: {} }), cf('E', { id: ['fabc12345'] }),
    cf('F', { id: '<img src=x onerror=1>' }), cf('G', { id: '' }), cf('H', { id: 'FUPPER001' }), cf('I', { id: null })] }));
  assert.equal(m.custom.length, 10);
  assert.equal(m.custom[0].id, 'fkeep0001');
  for (const f of m.custom.slice(1)) assert.equal(f.id, legacyFoodId({ name: f.name, brand: '', source: 'Custom' }), f.name);
  assert.equal(migrate(clone(m)).custom[0].id, 'fkeep0001');
  const s = sanitize(base({ custom: [cf('S', { id: 'fsane00001' }), cf('T', { id: 'constructor' })] }));
  assert.deepEqual(s.custom.map(f => isFoodId(f.id)), [true, true]);
  assert.equal(s.custom[0].id, 'fsane00001');
});

test('8. duplicates of one derived id collapse to the newest (tie: larger JSON) in any order; twins and the cap are left alone', () => {
  const old = cf('Dup', { updatedAt: 5 }), neu = cf('Dup', { updatedAt: 9, per100: { k: 1, p: 1, c: 1, f: 1 } });
  for (const list of [[old, neu], [neu, old]]) { const m = migrate(v8({ custom: clone(list) })); assert.equal(m.custom.length, 1); assert.equal(m.custom[0].updatedAt, 9); }
  const t1 = cf('Tie', { updatedAt: 5, per100: { k: 100, p: 1, c: 1, f: 1 } }), t2 = cf('Tie', { updatedAt: 5, per100: { k: 200, p: 1, c: 1, f: 1 } });
  const w1 = migrate(v8({ custom: clone([t1, t2]) })).custom, w2 = migrate(v8({ custom: clone([t2, t1]) })).custom;
  assert.equal(w1.length, 1); assert.deepEqual(w1, w2); assert.equal(w1[0].per100.k, 200);
  const twins = migrate(v8({ custom: [cf('Twin', { barcode: '5012345678900' }), cf('Twin', { barcode: '4006381333931' })] })).custom;
  assert.equal(twins.length, 2); assert.notEqual(twins[0].id, twins[1].id);
  assert.equal(migrate(v8({ custom: [cf('Z'), cf('Z')] })).custom.length, 1);
  const many = Array.from({ length: 101 }, (_, i) => cf('Food ' + i, { updatedAt: i }));
  assert.equal(migrate(v8({ custom: many })).custom.length, 101);
  assert.equal(migrate(v8({ custom: [cf('', { barcode: '5012345678900' }), cf('', { barcode: '4006381333931' })] })).custom.length, 2);   // barcode-only foods
});

test('9. migrate moves a saved food\'s measures from its foodKey to its id (merging lists), copies shared keys, leaves other foods alone', () => {
  const m1 = migrate(v8({ custom: [cf('Cheez-it Duo')], measures: { 'Cheez-it Duo||Custom': [{ label: 'box', g: 200, updatedAt: 1000 }], 'Oats|Quaker|OFF': [{ label: 'scoop', g: 30 }] } }));
  assert.deepEqual(Object.keys(m1.measures).sort(), [DUO, 'Oats|Quaker|OFF'].sort());
  assert.deepEqual(m1.measures[DUO], [{ label: 'box', g: 200, updatedAt: 1000 }]);
  assert.deepEqual(m1.measures['Oats|Quaker|OFF'], [{ label: 'scoop', g: 30 }]);
  // both exist: merged by label, newer wins, missing updatedAt counts as 0
  const m2 = migrate(v8({ custom: [cf('Cheez-it Duo', { id: 'fduo00001' })], measures: {
    'Cheez-it Duo||Custom': [{ label: 'box', g: 200, updatedAt: 5 }, { label: 'bag', g: 50 }, { label: 'tub', g: 10 }], fduo00001: [{ label: 'box', g: 210, updatedAt: 9 }, { label: 'tub', g: 11 }] } }));
  assert.deepEqual(Object.keys(m2.measures), ['fduo00001']);
  assert.deepEqual(byLabel(m2.measures.fduo00001), [['bag', 50, undefined], ['box', 210, 9], ['tub', 11, undefined]]);
  // a key shared by two saved foods (different barcodes): both get the list
  const m3 = migrate(v8({ custom: [cf('Twin', { barcode: '5012345678900' }), cf('Twin', { barcode: '4006381333931' })], measures: { 'Twin||Custom': [{ label: 'wrapper', g: 20, updatedAt: 3 }] } }));
  assert.equal(m3.custom.length, 2);
  for (const f of m3.custom) assert.deepEqual(m3.measures[f.id], [{ label: 'wrapper', g: 20, updatedAt: 3 }]);
  assert.ok(!('Twin||Custom' in m3.measures));
  // nothing saved: measures untouched
  const keep = { 'A||Custom': [{ label: 'x', g: 1 }] };
  assert.deepEqual(migrate(v8({ custom: [], measures: clone(keep) })).measures, keep);
  for (const measures of [undefined, null, {}, 'x', []]) assert.doesNotThrow(() => migrate(v8({ custom: [cf('Q')], measures })));
});

test('10. migrate stamps foodId on copies of saved foods (entries, recents, recipe and plan foods) that match exactly one saved food', () => {
  const twinA = cf('Twin', { barcode: '5012345678900' }), twinB = cf('Twin', { barcode: '4006381333931' }), duo = cf('Cheez-it Duo');
  const copy = (f, over = {}) => ({ name: f.name, brand: f.brand, source: f.source, per100: { ...f.per100 }, servingG: f.servingG, servingLabel: '', ...over });
  const oats = { name: 'Oats', brand: 'Quaker', source: 'OFF', per100: { ...P }, servingG: 0, servingLabel: '' };
  const day = '2025-01-06';
  const old = v8({
    custom: [clone(duo), clone(twinA), clone(twinB)],
    recent: [copy(duo), copy(oats), copy(twinA, { barcode: '5012345678900' }), copy(twinA)],
    days: { [day]: [entry('e1', { ...copy(duo), updatedAt: 1000 }), entry('e2', { ...copy(oats), updatedAt: 1000 }), entry('e3', { ...copy(twinB, { barcode: '4006381333931' }), updatedAt: 7 })] },
    recipes: { r1: { name: 'R', servings: 2, updatedAt: 5, ingredients: [{ id: 'i1', raw: '2 box duo', name: 'duo', qty: 2, unit: 'box', prep: '', food: copy(duo), grams: null }, { id: 'i2', raw: 'oats', name: 'oats', qty: 1, unit: 'cup', prep: '', food: copy(oats), grams: null }] } },
    plan: { [day]: { updatedAt: 3, slots: { Breakfast: [{ id: 'p1', type: 'food', name: 'Duo', servings: 1, food: copy(duo), grams: 30, entryId: '' }], Lunch: [], Dinner: [], Snacks: [] } } },
  });
  const m = migrate(clone(old));
  const duoId = m.custom[0].id, aId = m.custom[1].id, bId = m.custom[2].id;
  assert.equal(duoId, DUO);
  assert.equal(m.recent[0].foodId, duoId);
  assert.ok(!('foodId' in m.recent[1]), 'a database food is not a saved food');
  assert.equal(m.recent[2].foodId, aId, 'barcode of one of two same-key foods picks that food');
  assert.ok(!('foodId' in m.recent[3]), 'no barcode and two candidates: ambiguous, nothing stamped');
  const [e1, e2, e3] = m.days[day];
  assert.equal(e1.foodId, duoId); assert.equal(e1.id, 'e1'); assert.equal(e1.updatedAt, 1000);
  assert.ok(!('foodId' in e2)); assert.equal(e3.foodId, bId); assert.equal(e3.updatedAt, 7);
  assert.equal(m.recipes.r1.ingredients[0].food.foodId, duoId);
  assert.ok(!('foodId' in m.recipes.r1.ingredients[1].food));
  assert.equal(m.plan[day].slots.Breakfast[0].food.foodId, duoId);
  // nothing else on the copies changed
  const strip = ({ foodId, ...r }) => r;
  assert.deepEqual(strip(m.recent[0]), old.recent[0]);
  assert.deepEqual(m.days[day].map(strip), old.days[day]);
});

test('11. the fixtures survive: state.json and backup.json migrate with everything intact and the right ids', () => {
  for (const name of ['state', 'backup']) {
    const old = fixture(name), m = migrate(clone(old));
    assert.equal(m.schemaVersion, 9, name);
    assert.equal(m.custom.length, old.custom.length, name);
    old.custom.forEach((f, i) => { const { id, ...rest } = m.custom.find(x => x.name === f.name); assert.deepEqual(rest, f, name + ' ' + f.name); assert.equal(isFoodId(id), true); assert.equal(id, legacyFoodId(f)); });
    assert.deepEqual(Object.keys(m.days).sort(), Object.keys(old.days).sort(), name);
    for (const d of Object.keys(old.days)) if (Array.isArray(old.days[d])) assert.deepEqual(m.days[d].map(e => e && e.id), old.days[d].map(e => e && e.id), name + d);
    assert.deepEqual(m.goals, old.goals);
    assert.deepEqual(m.measures['Oats|Quaker|OFF'].slice(0, 1), old.measures['Oats|Quaker|OFF'].slice(0, 1));
  }
  assert.equal(migrate(clone(fixture('state'))).custom[0].id, 'f-ec77da65057a9fea');
  const bk = migrate(clone(fixture('backup')));
  assert.deepEqual(bk.measures[CHILI], [{ label: 'cup', g: 240 }]);
  assert.ok(!('Chili||Custom' in bk.measures));
});

test('12. sanitize / sanitizeFood keep a valid foodId and drop hostile ones everywhere a copy lives; sanitizeFood turns a valid id into foodId', () => {
  const day = '2025-01-06', good = 'fduo0001';
  const copy = (foodId, extra = {}) => ({ name: 'Duo', brand: '', source: 'Custom', per100: { ...P }, servingG: 30, servingLabel: '', foodId, ...extra });
  const hostile = ['<img src=x onerror=1>', '__proto__', 5, 'f' + 'z'.repeat(30), 'FDUO0001', {}, ['fduo0001'], '', null];
  for (const h of hostile) {
    const d = sanitize(base({ recent: [copy(h)], days: { [day]: [entry('e1', { foodId: h })] },
      recipes: { r1: { name: 'R', ingredients: [{ id: 'i', raw: '', name: 'd', qty: 1, unit: '', prep: '', food: copy(h), grams: null }] } },
      plan: { [day]: { updatedAt: 1, slots: { Breakfast: [{ id: 'p', type: 'food', name: 'd', servings: 1, food: copy(h), grams: 10, entryId: '' }], Lunch: [], Dinner: [], Snacks: [] } } } }));
    assert.ok(!('foodId' in d.recent[0]), 'recent ' + String(h));
    assert.ok(!('foodId' in d.days[day][0]), 'entry ' + String(h));
    assert.ok(!('foodId' in d.recipes.r1.ingredients[0].food), 'recipe ' + String(h));
    assert.ok(!('foodId' in d.plan[day].slots.Breakfast[0].food), 'plan ' + String(h));
  }
  const d = sanitize(base({ recent: [copy(good)], days: { [day]: [entry('e1', { foodId: good })] },
    recipes: { r1: { name: 'R', ingredients: [{ id: 'i', raw: '', name: 'd', qty: 1, unit: '', prep: '', food: copy(good), grams: null }] } } }));
  assert.equal(d.recent[0].foodId, good); assert.equal(d.days[day][0].foodId, good); assert.equal(d.recipes.r1.ingredients[0].food.foodId, good);
  assert.equal(sanitizeFood(copy(good)).foodId, good);
  const viaId = sanitizeFood({ ...copy(undefined), id: good });
  assert.equal(viaId.foodId, good); assert.ok(!('id' in viaId));
  assert.ok(!('id' in sanitizeFood(copy(good, { id: 'mh1abcd0001' }))) && !('foodId' in sanitizeFood({ ...copy(undefined), id: 'mh1abcd0001' })));
});

test('13. a JSON round trip of migrated state is stable', () => {
  const m = migrate(v8({ custom: [cf('A'), cf('B', { barcode: '5012345678900' })], measures: { 'A||Custom': [{ label: 'x', g: 5, updatedAt: 1 }] }, tombstones: { fgone0001: 5 } }));
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(m))), m);
  assert.deepEqual(sanitize(JSON.parse(JSON.stringify(m))), m);
  assert.ok(m.custom.every(f => isFoodId(f.id)), 'the round trip must be of data that HAS ids');
});

// ---------------------------------------------------------------- domain
test('14. measuresKey: foodId, else id, else foodKey; invalid ids are ignored', () => {
  const f = cf('Duo');
  assert.equal(measuresKey(f), 'Duo||Custom');
  assert.equal(measuresKey({ ...f, id: 'fduo0001' }), 'fduo0001');
  assert.equal(measuresKey({ ...f, foodId: 'fcopy0001' }), 'fcopy0001');
  assert.equal(measuresKey({ ...f, id: 'fduo0001', foodId: 'fcopy0001' }), 'fcopy0001');
  assert.equal(measuresKey({ ...f, id: 'mh1abcd0001' }), 'Duo||Custom', 'an entry id is not a food id');
  for (const bad of ['__proto__', '', 5, null, {}, 'FDUO0001']) { assert.equal(measuresKey({ ...f, foodId: bad }), 'Duo||Custom'); assert.equal(measuresKey({ ...f, id: bad }), 'Duo||Custom'); }
  assert.equal(measuresKey({ ...f, foodId: '__proto__', id: 'fduo0001' }), 'fduo0001');
  assert.equal(measuresKey(deepFreeze({ ...f, id: 'f-c7e47751c795d5a1' })), 'f-c7e47751c795d5a1');
});

test('15. unitsFor reads a food\'s measures by its id or foodId; the foodKey bucket only for foods without an id', () => {
  const measures = { fduo0001: [{ label: 'box', g: 200 }], 'Cheez-it Duo||Custom': [{ label: 'bag', g: 50 }], fother0001: [{ label: 'other', g: 9 }] };
  const keys = f => unitsFor(f, measures).map(u => u.key);
  const saved = cf('Cheez-it Duo', { id: 'fduo0001' });
  assert.ok(keys(saved).includes('p:box')); assert.ok(!keys(saved).includes('p:bag')); assert.ok(!keys(saved).includes('p:other'));
  const copy = cf('Cheez-it Duo', { foodId: 'fduo0001' });
  assert.ok(keys(copy).includes('p:box')); assert.ok(!keys(copy).includes('p:bag'));
  const none = cf('Cheez-it Duo');
  assert.ok(keys(none).includes('p:bag')); assert.ok(!keys(none).includes('p:box'));
  const nobucket = cf('Cheez-it Duo', { id: 'fnobucket1' });
  assert.ok(!keys(nobucket).includes('p:bag'), 'a food with an id does not read the foodKey bucket');
  const u = unitsFor(saved, measures).find(x => x.key === 'p:box'); assert.equal(u.g, 200); assert.equal(u.label, 'box (200 g)');
  assert.doesNotThrow(() => unitsFor(saved, undefined)); assert.doesNotThrow(() => unitsFor(saved, null));
});

test('16. recipes resolve a saved food\'s measure through foodId, and fall back to the foodKey bucket when it is absent', () => {
  const measures = { fduo0001: [{ label: 'box', g: 200 }] };
  const copy = { name: 'Cheez-it Duo', brand: '', source: 'Custom', per100: { ...P }, servingG: 30, servingLabel: '' };
  const ing = f => ({ id: 'i1', raw: '2 box duo', name: 'duo', qty: 2, unit: 'box', prep: '', food: f, grams: null });
  assert.equal(resolveGrams(ing({ ...copy, foodId: 'fduo0001' }), measures), 400);
  assert.equal(resolveGrams(ing(copy), measures), 60);                           // no foodId: foodKey bucket (empty): 2 x the 30 g serving
  assert.equal(resolveGrams(ing(copy), { 'Cheez-it Duo||Custom': [{ label: 'box', g: 200 }] }), 400);
  const r = { servings: 4, ingredients: [ing({ ...copy, foodId: 'fduo0001' })] };
  const n = recipeNutrition(r, measures);
  assert.equal(n.totalGrams, 400);
  assert.ok(Math.abs(n.total.k - 2000) < 1e-9);
  assert.ok(Math.abs(n.perServing.k - 500) < 1e-9);
});

test('17. addCustomFood: ids from makeId, replacing keeps the id, extra replaced ids get tombstones, cap without tombstone, invalid input refused', () => {
  const mk = () => ({ ...defaults(), custom: [cf('Cheez-it Duo', { id: 'fduo0001' }), cf('Chili', { id: 'fchili001' })], tombstones: {}, measures: { fduo0001: [{ label: 'box', g: 200 }] } });
  const neu = (name, over = {}) => ({ name, brand: '', source: 'Custom', servingG: 40, servingLabel: '', per100: { k: 1, p: 1, c: 1, f: 1 }, ...over });
  let calls = 0; const makeId = () => { calls++; return 'fnew000001'; };
  const s = mk(), input = deepFreeze(neu('New bar'));
  const r = addCustomFood(s, input, 7000, makeId);
  assert.ok(r); assert.equal(r.id, 'fnew000001'); assert.equal(r.updatedAt, 7000); assert.equal(r.name, 'New bar');
  assert.equal(s.custom.length, 3); assert.equal(s.custom[0], r); assert.equal(calls, 1);
  assert.deepEqual(s.custom.slice(1).map(f => f.id), ['fduo0001', 'fchili001']);
  assert.ok(!('id' in input) && !('updatedAt' in input));
  // replacing: same product keeps the id (so measures and other devices follow), no tombstone
  const s2 = mk(), r2 = addCustomFood(s2, neu('Cheez-it Duo', { servingG: 30 }), 8000, () => 'fshould001');
  assert.equal(r2.id, 'fduo0001'); assert.equal(s2.custom.length, 2); assert.equal(s2.custom[0], r2); assert.equal(s2.custom[1].id, 'fchili001');
  assert.deepEqual(s2.tombstones, {}); assert.deepEqual(s2.measures, { fduo0001: [{ label: 'box', g: 200 }] });
  // two saved foods replaced at once: first keeps its id, the other id is tombstoned
  const s3 = { ...defaults(), custom: [cf('X', { id: 'fxone0001' }), cf('X', { id: 'fxtwo0001', barcode: '5012345678900' }), cf('Y', { id: 'fy0000001' })], tombstones: {}, measures: {} };
  const r3 = addCustomFood(s3, neu('X', { barcode: '5012345678900' }), 9000, makeId);
  assert.equal(r3.id, 'fxone0001'); assert.deepEqual(s3.custom.map(f => f.id), ['fxone0001', 'fy0000001']); assert.deepEqual(s3.tombstones, { fxtwo0001: 9000 });
  // a different barcode is a different product: not replaced
  const s4 = { ...defaults(), custom: [cf('X', { id: 'fxone0001', barcode: '5012345678900' })], tombstones: {}, measures: {} };
  assert.equal(addCustomFood(s4, neu('X', { barcode: '4006381333931' }), 1, () => 'fxnew0001').id, 'fxnew0001'); assert.equal(s4.custom.length, 2);
  // cap: the 101st drops the oldest (last) food, and that is NOT a tombstone
  const full = { ...defaults(), custom: Array.from({ length: 100 }, (_, i) => cf('F' + i, { id: 'ff' + String(i).padStart(6, '0'), updatedAt: 100 - i })), tombstones: {}, measures: {} };
  const last = full.custom[99].id;
  addCustomFood(full, neu('Newest'), 5000, () => 'fnewest001');
  assert.equal(full.custom.length, 100); assert.equal(full.custom[0].id, 'fnewest001'); assert.ok(!full.custom.some(f => f.id === last)); assert.deepEqual(full.tombstones, {});
  // an id used again clears its tombstone
  const s5 = mk(); s5.tombstones = { fnew000001: 100, other: 5 };
  addCustomFood(s5, neu('Back'), 6000, makeId); assert.deepEqual(s5.tombstones, { other: 5 });
  // refused, state untouched
  const before = (() => { const x = mk(); return [x, structuredClone(x)]; })();
  for (const [st, f, now, mid] of [[before[0], neu('A'), 1, () => 'BAD'], [before[0], neu('A'), 1, () => 'fduo0001'], [before[0], neu('A'), 1, null], [before[0], neu('A'), NaN, makeId], [before[0], neu('A'), 'now', makeId],
    [before[0], { name: '', per100: { k: 1, p: 1, c: 1, f: 1 } }, 1, makeId], [before[0], { name: 'A' }, 1, makeId], [before[0], null, 1, makeId], [null, neu('A'), 1, makeId], [{}, neu('A'), 1, makeId], [{ custom: 'x' }, neu('A'), 1, makeId]]) {
    let out; assert.doesNotThrow(() => { out = addCustomFood(st, f, now, mid); });
    assert.equal(out, null);
  }
  assert.deepEqual(before[0], before[1]);
});

test('18. updateCustomFood addresses a food by id: the id never changes, twins are separately editable, a foodKey or a missing id finds nothing', () => {
  const mk = () => ({ ...defaults(), custom: [cf('Twin bar', { id: 'ftwina001', barcode: '5012345678900' }), cf('Twin bar', { id: 'ftwinb001', barcode: '4006381333931', servingG: 40 }), cf('Plain', { id: 'fplain001' })],
    measures: { ftwina001: [{ label: 'wrapper', g: 20 }], ftwinb001: [{ label: 'wrapper', g: 20 }] } });
  const s = mk(), a = structuredClone(s.custom[0]), measures = structuredClone(s.measures);
  const r = updateCustomFood(s, 'ftwinb001', { servingG: 40, k: 120 }, 5000);
  assert.ok(r); assert.equal(r, s.custom[1]); assert.equal(r.id, 'ftwinb001'); assert.equal(r.updatedAt, 5000);
  assert.ok(Math.abs(r.per100.k - 300) < 1e-9);
  assert.deepEqual(s.custom[0], a);
  const r2 = updateCustomFood(s, 'ftwina001', { name: 'Twin bar mini', brand: 'Acme' }, 6000);
  assert.equal(r2.id, 'ftwina001'); assert.equal(r2.name, 'Twin bar mini'); assert.equal(s.custom[1].updatedAt, 5000);
  assert.deepEqual(s.measures, measures);
  const refuse = (st, id) => { const b = structuredClone(st); assert.equal(updateCustomFood(st, id, { name: 'Zzz' }, 9), null); assert.deepEqual(st, b); };
  for (const id of ['Plain||Custom', 'Twin bar||Custom', 'fnotthere', '__proto__', 'constructor', '', undefined, null, 5]) refuse(mk(), id);
  const legacy = { ...defaults(), custom: [cf('Old')] };
  for (const id of [undefined, 'undefined', 'Old||Custom', '']) refuse(legacy, id);
  const clash = mk();                                                                                          // twin renamed to the other twin's identity with the same barcode: refused
  const b0 = structuredClone(clash); assert.equal(updateCustomFood(clash, 'ftwinb001', { barcode: '5012345678900' }, 9), null); assert.deepEqual(clash, b0);
});

// ---------------------------------------------------------------- merge
const renameScenario = () => {
  const F0 = cf('Cheez-it Duo', { updatedAt: 1000 });
  const base0 = { ...F0, id: DUO };
  return { F0, base0, A: base({ custom: [{ ...base0, name: 'Duo snacks', updatedAt: 2000 }] }), B: base({ custom: [{ ...base0 }] }) };
};
const names = m => m.custom.map(f => f.name);

test('19. merge matches saved foods by id: newest wins as a whole; a rename converges to one food in both orders', () => {
  const x = base({ custom: [cf('One', { id: 'fsame00001', updatedAt: 5 })] }), y = base({ custom: [cf('Two', { id: 'fsame00001', updatedAt: 9, per100: { k: 1, p: 1, c: 1, f: 1 } })] });
  for (const m of [mergeStates(x, y), mergeStates(y, x)]) { assert.equal(m.custom.length, 1); assert.equal(m.custom[0].name, 'Two'); assert.equal(m.custom[0].per100.k, 1); }
  const { base0, A, B } = renameScenario();
  for (const m of [mergeStates(A, B), mergeStates(B, A)]) { assert.deepEqual(names(m), ['Duo snacks']); assert.equal(m.custom[0].id, DUO); }
  // B edits the numbers of the OLD-named food later: B's whole record wins (old name, new numbers)
  const B2 = base({ custom: [{ ...base0, per100: { k: 111, p: 1, c: 1, f: 1 }, updatedAt: 3000 }] });
  for (const m of [mergeStates(A, B2), mergeStates(B2, A)]) { assert.deepEqual(names(m), ['Cheez-it Duo']); assert.equal(m.custom[0].per100.k, 111); assert.equal(m.custom[0].updatedAt, 3000); }
  const B3 = base({ custom: [{ ...base0, per100: { k: 111, p: 1, c: 1, f: 1 }, updatedAt: 1500 }] });
  for (const m of [mergeStates(A, B3), mergeStates(B3, A)]) { assert.deepEqual(names(m), ['Duo snacks']); assert.equal(m.custom[0].per100.k, 500); }
});

test('20. legacy convergence: two devices migrated the same food, one renamed it; an old-app side without ids joins without a duplicate', () => {
  const a0 = migrate(v8({ custom: [cf('Cheez-it Duo')] })), b0 = migrate(v8({ custom: [cf('Cheez-it Duo'), cf('Other')] }));
  assert.equal(a0.custom[0].id, b0.custom[0].id);
  const A = clone(a0); A.custom[0] = { ...A.custom[0], name: 'Duo snacks', updatedAt: 2000 };
  for (const m of [mergeStates(A, b0), mergeStates(b0, A)]) { assert.equal(m.custom.filter(f => f.name === 'Duo snacks').length, 1); assert.equal(m.custom.filter(f => f.name === 'Cheez-it Duo').length, 0); assert.equal(m.custom.length, 2); }
  const oldApp = v8({ custom: [cf('Cheez-it Duo', { updatedAt: 1000 })] });                         // no ids at all
  for (const m of [mergeStates(A, oldApp), mergeStates(oldApp, A)]) { assert.deepEqual(names(m), ['Duo snacks']); assert.equal(m.custom[0].id, DUO); }
  const oldNewer = v8({ custom: [cf('Cheez-it Duo', { updatedAt: 3000, per100: { k: 7, p: 1, c: 1, f: 1 } })] });
  for (const m of [mergeStates(A, oldNewer), mergeStates(oldNewer, A)]) { assert.deepEqual(names(m), ['Cheez-it Duo']); assert.equal(m.custom[0].per100.k, 7); assert.equal(m.custom[0].id, DUO); }
});

test('21. twins (same name, different ids) both survive; one id twice on a side collapses; a legacy food and its derived-id copy are one', () => {
  const t1 = cf('Twin', { id: 'ftwina001', barcode: '5012345678900', updatedAt: 3 }), t2 = cf('Twin', { id: 'ftwinb001', barcode: '4006381333931', updatedAt: 2 });
  for (const m of [mergeStates(base({ custom: [t1, t2] }), base()), mergeStates(base(), base({ custom: [t2, t1] })), mergeStates(base({ custom: [t1] }), base({ custom: [t2] }))]) assert.deepEqual(m.custom.map(f => f.id), ['ftwina001', 'ftwinb001']);
  const same = base({ custom: [cf('X', { id: 'fx0000001', updatedAt: 1 }), cf('X renamed', { id: 'fx0000001', updatedAt: 5 })] });
  assert.deepEqual(names(mergeStates(same, base())), ['X renamed']);
  const legacy = base({ custom: [cf('Chili')] }), withId = base({ custom: [cf('Chili', { id: CHILI })] });
  for (const m of [mergeStates(legacy, withId), mergeStates(withId, legacy)]) { assert.equal(m.custom.length, 1); assert.equal(m.custom[0].id, CHILI); }
});

test('22. cap and order: 100 newest kept, updatedAt descending then id ascending, argument order and ties do not matter, preferLocal breaks ties for one id', () => {
  const mkFood = (i, at) => cf('F' + i, { id: 'fx' + String(i).padStart(5, '0'), updatedAt: at });
  const A = base({ custom: Array.from({ length: 60 }, (_, i) => mkFood(i, i + 1)) }), B = base({ custom: Array.from({ length: 41 }, (_, i) => mkFood(60 + i, 61 + i)) });
  const m = mergeStates(A, B);
  assert.equal(m.custom.length, 100);
  assert.ok(!m.custom.some(f => f.name === 'F0'), 'the oldest of 101 is dropped');
  assert.deepEqual(m.custom.map(f => f.updatedAt), Array.from({ length: 100 }, (_, i) => 101 - i));
  assert.deepEqual(mergeStates(B, A).custom.map(f => f.id), m.custom.map(f => f.id));
  const tied = base({ custom: ['fx00003', 'fx00001', 'fx00002'].map(id => cf(id, { id, updatedAt: 5 })) });
  assert.deepEqual(mergeStates(tied, base()).custom.map(f => f.id), ['fx00001', 'fx00002', 'fx00003']);
  assert.deepEqual(mergeStates(base(), tied).custom.map(f => f.id), ['fx00001', 'fx00002', 'fx00003']);
  const l = base({ custom: [cf('Local', { id: 'fsame00001', updatedAt: 5 })] }), r = base({ custom: [cf('Remote', { id: 'fsame00001', updatedAt: 5 })] });
  assert.equal(mergeStates(l, r, { preferLocal: true }).custom[0].name, 'Local');
  assert.equal(mergeStates(r, l, { preferLocal: true }).custom[0].name, 'Remote');
  assert.equal(mergeStates(l, r).custom[0].name, mergeStates(r, l).custom[0].name);
});

test('23. tombstones for foods: hide an older or equal copy, lose to a later edit, spare other ids, hold against an old-app copy', () => {
  const food1 = cf('Gone', { id: 'fgone0001', updatedAt: 400 });
  const tomb = base({ tombstones: { fgone0001: 500 } });
  for (const m of [mergeStates(base({ custom: [food1] }), tomb), mergeStates(tomb, base({ custom: [food1] }))]) { assert.deepEqual(m.custom, []); assert.equal(m.tombstones.fgone0001, 500); }
  const eq = cf('Gone', { id: 'fgone0001', updatedAt: 500 });
  assert.deepEqual(mergeStates(base({ custom: [eq] }), tomb).custom, []);
  const later = cf('Gone', { id: 'fgone0001', updatedAt: 600 });
  for (const m of [mergeStates(base({ custom: [later] }), tomb), mergeStates(tomb, base({ custom: [later] }))]) assert.deepEqual(names(m), ['Gone']);
  // other ids are not touched: entry, recipe and a food with another id
  const withOthers = base({ custom: [cf('Keep', { id: 'fkeep0001', updatedAt: 1 })], days: { '2025-01-01': [entry('e1', { updatedAt: 1 })] }, recipes: { r1: { id: 'r1', name: 'R', updatedAt: 1, ingredients: [] } } });
  const m = mergeStates(withOthers, tomb);
  assert.deepEqual(names(m), ['Keep']); assert.equal(m.days['2025-01-01'].length, 1); assert.ok(m.recipes.r1);
  // an old-app copy (no id, no timestamp) of a food whose derived id is tombstoned stays deleted
  const oldCopy = base({ custom: [cf('Chili', { updatedAt: undefined })] });
  const delTomb = base({ tombstones: { [CHILI]: 100 } });
  for (const x of [mergeStates(oldCopy, delTomb), mergeStates(delTomb, oldCopy)]) assert.deepEqual(x.custom, []);
});

test('24. hostile ids on either side become valid derived ids; nothing is lost, polluted or keyed by a hostile id', () => {
  const ids = ['__proto__', 'constructor', 'toString', '<img src=x onerror=window.__pwned=1>', 'x'.repeat(10000), 123, {}, [], ['fabc12345'], '', 'FUPPER001', null, { toString() { throw new Error('boom'); } }];
  const bad = ids.map((id, i) => cf('Hostile ' + i, { id }));
  const evil = JSON.parse('{"__proto__":{"polluted":1},"name":"Proto food","brand":"","source":"Custom","per100":{"k":1,"p":1,"c":1,"f":1},"id":"__proto__"}');
  for (const [a, b] of [[base({ custom: bad }), base()], [base(), base({ custom: bad })]]) {
    let m; assert.doesNotThrow(() => { m = mergeStates(a, b); });
    assert.equal(m.custom.length, bad.length);
    for (const f of m.custom) assert.equal(isFoodId(f.id), true, f.name + ' ' + String(f.id));
    for (const f of m.custom) assert.equal(f.id, legacyFoodId(f), f.name);
  }
  const m2 = mergeStates(base({ custom: [evil] }), base({ custom: [cf('Proto food', { id: 'constructor' })] }));
  assert.equal(m2.custom.length, 2 - 1, 'same key on both sides: one food'); assert.equal({}.polluted, undefined); assert.equal(isFoodId(m2.custom[0].id), true);
  // measures: a bucket named after a prototype key is dropped, not set as the prototype
  const hm = JSON.parse('{"__proto__":[{"label":"a","g":1}],"constructor":[{"label":"b","g":2}],"fduo0001":[{"label":"box","g":200}]}');
  const m3 = mergeStates(base({ custom: [cf('Duo', { id: 'fduo0001' })] }), base({ measures: hm }));
  assert.equal(Object.getPrototypeOf(m3.measures), Object.prototype); assert.deepEqual(Object.keys(m3.measures), ['fduo0001']); assert.equal({}.a, undefined);
  assert.equal(globalThis.__pwned, undefined);
});

test('25. measures merge: an old-app foodKey bucket of a saved food folds into its id bucket in either order; others are untouched', () => {
  const local = base({ custom: [cf('Cheez-it Duo', { id: 'fduo0001' })], measures: { fduo0001: [{ label: 'box', g: 210, updatedAt: 9 }, { label: 'tub', g: 11 }], 'Oats|Quaker|OFF': [{ label: 'scoop', g: 30 }], fgone0001: [{ label: 'orphan', g: 3 }] } });
  const remote = base({ measures: { 'Cheez-it Duo||Custom': [{ label: 'box', g: 200, updatedAt: 5 }, { label: 'bag', g: 50, updatedAt: 2 }], 'Oats|Quaker|OFF': [{ label: 'bowl', g: 80 }] } });
  for (const m of [mergeStates(local, remote), mergeStates(remote, local)]) {
    assert.ok(!('Cheez-it Duo||Custom' in m.measures));
    assert.deepEqual(byLabel(m.measures.fduo0001), byLabel([{ label: 'bag', g: 50, updatedAt: 2 }, { label: 'box', g: 210, updatedAt: 9 }, { label: 'tub', g: 11 }]));
    assert.deepEqual(byLabel(m.measures['Oats|Quaker|OFF']), byLabel([{ label: 'scoop', g: 30 }, { label: 'bowl', g: 80 }]));
    assert.deepEqual(m.measures.fgone0001, [{ label: 'orphan', g: 3 }]);
  }
  // the saved food arrives from the OTHER side than the bucket
  const onlyFood = base({ custom: [cf('Cheez-it Duo')] }), onlyBucket = base({ measures: { 'Cheez-it Duo||Custom': [{ label: 'box', g: 200, updatedAt: 5 }] } });
  for (const m of [mergeStates(onlyFood, onlyBucket), mergeStates(onlyBucket, onlyFood)]) { assert.deepEqual(Object.keys(m.measures), [DUO]); assert.deepEqual(m.measures[DUO], [{ label: 'box', g: 200, updatedAt: 5 }]); }
  // a bucket for a food that is NOT saved stays under its key
  const m = mergeStates(base({ measures: { 'Oats|Quaker|OFF': [{ label: 'scoop', g: 30 }] } }), base({ custom: [cf('Cheez-it Duo')] }));
  assert.deepEqual(Object.keys(m.measures), ['Oats|Quaker|OFF']);
});

test('26. merge of foods, measures and tombstones is commutative, associative and idempotent over a mixed set of states', () => {
  const s = [
    base({ custom: [cf('Cheez-it Duo', { id: DUO, name: 'Duo snacks', updatedAt: 2000 }), cf('Twin', { id: 'ftwina001', barcode: '5012345678900', updatedAt: 5 })], measures: { [DUO]: [{ label: 'box', g: 200, updatedAt: 1 }] } }),
    base({ custom: [cf('Cheez-it Duo', { updatedAt: 1000 }), cf('Twin', { id: 'ftwinb001', barcode: '4006381333931', updatedAt: 6 })], measures: { 'Cheez-it Duo||Custom': [{ label: 'box', g: 205, updatedAt: 3 }, { label: 'bag', g: 5 }] } }),
    base({ custom: [cf('Cheez-it Duo', { id: DUO, updatedAt: 3000, per100: { k: 9, p: 1, c: 1, f: 1 } }), cf('Chili', { id: '__proto__' })], tombstones: { ftwina001: 10 } }),
    base({ custom: [cf('Chili', { updatedAt: 7 }), cf('Dup', { id: 'fdup000001', updatedAt: 1 }), cf('Dup', { id: 'fdup000001', updatedAt: 2 })], tombstones: { [CHILI]: 6 }, measures: { fdup000001: [{ label: 'x', g: 1 }] } }),
  ];
  const v = x => stableStringify(view(x));
  assert.ok(mergeStates(s[0], s[1]).custom.every(f => isFoodId(f.id)), 'merged foods carry valid ids');
  for (const a of s) for (const b of s) {
    assert.equal(v(mergeStates(a, b)), v(mergeStates(b, a)), 'commutative');
    const ab = mergeStates(a, b);
    assert.equal(v(mergeStates(ab, ab)), v(ab), 'idempotent');
    assert.equal(v(mergeStates(ab, a)), v(ab), 'absorbs');
    for (const c of s) assert.equal(v(mergeStates(ab, c)), v(mergeStates(a, mergeStates(b, c))), 'associative');
  }
});

test('27. merge accepts deeply frozen inputs (legacy and id foods) and leaves them unchanged', () => {
  const a = deepFreeze(base({ custom: [cf('Legacy'), cf('Hostile', { id: '__proto__' }), cf('Id', { id: 'fid0000001' })], measures: { 'Legacy||Custom': [{ label: 'x', g: 1 }] } }));
  const b = deepFreeze(base({ custom: [cf('Legacy', { updatedAt: 5 })], tombstones: { fid0000001: 1 } }));
  const before = JSON.stringify([a, b]);
  let m; assert.doesNotThrow(() => { m = mergeStates(a, b); });
  assert.equal(JSON.stringify([a, b]), before);
  assert.equal(m.custom.length, 3);
  assert.ok(m.custom.every(f => isFoodId(f.id)));
});

// ---------------------------------------------------------------- sync records
test('28. toRecords: the custom record carries ids and is stamped by the newest food; the measures record is keyed by id', () => {
  const s = base({ custom: [cf('A', { id: 'fa00000001', updatedAt: 10 }), cf('B', { id: 'fb00000001', updatedAt: 30 })], measures: { fa00000001: [{ label: 'x', g: 5, updatedAt: 40 }] }, tombstones: { fgone0001: 50 } });
  const recs = toRecords(s);
  assert.deepEqual(recs.map(r => r.key), ['settings', 'custom', 'measures', 'tombstones']);
  const c = recs.find(r => r.key === 'custom'); assert.equal(c.updatedAt, 30); assert.deepEqual(c.value.custom.map(f => f.id), ['fa00000001', 'fb00000001']);
  assert.deepEqual(Object.keys(recs.find(r => r.key === 'measures').value.measures), ['fa00000001']);
  assert.equal(recs.find(r => r.key === 'measures').updatedAt, 40);
  assert.deepEqual(recs.find(r => r.key === 'tombstones').value.tombstones, { fgone0001: 50 });
});

test('29. applyRecords: old-app records (no ids, foodKey measures) fold in either order; hostile ids and foodIds are cleaned', () => {
  const customRec = { key: 'custom', updatedAt: 1000, value: { custom: [cf('Cheez-it Duo'), cf('Chili')] } };
  const measRec = { key: 'measures', updatedAt: 5, value: { measures: { 'Cheez-it Duo||Custom': [{ label: 'box', g: 200, updatedAt: 5 }], 'Oats|Quaker|OFF': [{ label: 'scoop', g: 30 }] } } };
  for (const recs of [[customRec, measRec], [measRec, customRec]]) {
    const r = applyRecords(base(), clone(recs));
    assert.deepEqual(r.custom.map(f => f.id).sort(), [CHILI, DUO].sort());
    assert.deepEqual(r.measures[DUO], [{ label: 'box', g: 200, updatedAt: 5 }]);
    assert.ok(!('Cheez-it Duo||Custom' in r.measures));
    assert.deepEqual(r.measures['Oats|Quaker|OFF'], [{ label: 'scoop', g: 30 }]);
  }
  const hostile = applyRecords(base(), [{ key: 'custom', updatedAt: 1, value: { custom: [cf('H1', { id: '__proto__' }), cf('H2', { id: '<b>x</b>' }), cf('H3', { id: 5 }), cf('Ok', { id: 'fok0000001' })] } }]);
  assert.equal(hostile.custom.length, 4);
  assert.deepEqual(hostile.custom.map(f => isFoodId(f.id)), [true, true, true, true]);
  assert.equal(hostile.custom.find(f => f.name === 'Ok').id, 'fok0000001');
  assert.equal(hostile.custom.find(f => f.name === 'H1').id, legacyFoodId(cf('H1')));
  const day = applyRecords(base(), [{ key: 'day:2025-01-06', updatedAt: 1, value: { entries: [entry('e1', { foodId: 'fduo0001' }), entry('e2', { foodId: '<b>x</b>' }), entry('e3', { foodId: '__proto__' })] } }]);
  const es = day.days['2025-01-06'];
  assert.equal(es.find(e => e.id === 'e1').foodId, 'fduo0001'); assert.ok(!('foodId' in es.find(e => e.id === 'e2'))); assert.ok(!('foodId' in es.find(e => e.id === 'e3')));
  const pr = applyRecords(base(), [{ key: 'measures', updatedAt: 1, value: { measures: JSON.parse('{"__proto__":[{"label":"a","g":1}],"fduo0001":[{"label":"box","g":2}]}') } }]);
  assert.equal(Object.getPrototypeOf(pr.measures), Object.prototype); assert.deepEqual(Object.keys(pr.measures), ['fduo0001']);
});

test('30. records round trip, and a rename converges through records in both directions', () => {
  const A = base({ custom: [cf('Duo snacks', { id: DUO, updatedAt: 2000 }), cf('Twin', { id: 'ftwina001', barcode: '5012345678900' }), cf('Twin', { id: 'ftwinb001', barcode: '4006381333931' })], measures: { [DUO]: [{ label: 'box', g: 200, updatedAt: 3 }] }, tombstones: { fgone0001: 9 } });
  const back = applyRecords(base(), clone(toRecords(A)));
  assert.deepEqual(back.custom.map(f => f.id).sort(), A.custom.map(f => f.id).sort());
  assert.deepEqual(back.custom.find(f => f.id === DUO), A.custom[0]);
  assert.deepEqual(back.measures, A.measures); assert.deepEqual(back.tombstones, A.tombstones);
  const B = base({ custom: [cf('Cheez-it Duo', { id: DUO, updatedAt: 1000 })], measures: { [DUO]: [{ label: 'box', g: 200, updatedAt: 3 }] } });
  const bNew = applyRecords(B, clone(toRecords(A)));
  assert.deepEqual(bNew.custom.filter(f => f.id === DUO).map(f => f.name), ['Duo snacks']); assert.equal(bNew.custom.filter(f => f.name === 'Cheez-it Duo').length, 0);
  const aKeeps = applyRecords(A, clone(toRecords(B)));
  assert.deepEqual(aKeeps.custom.filter(f => f.id === DUO).map(f => f.name), ['Duo snacks']);
  // B still on the old app (no ids): its records do not bring the old name back
  const oldRecs = clone(toRecords(v8({ custom: [cf('Cheez-it Duo', { updatedAt: 1000 })] })));
  assert.deepEqual(applyRecords(A, oldRecs).custom.filter(f => f.id === DUO).map(f => f.name), ['Duo snacks']);
  assert.equal(applyRecords(A, oldRecs).custom.length, 3);
});

// ---------------------------------------------------------------- backup
test('31. mergeRestore of the old backup fixture: no duplicate foods, new food gets its derived id and measures under it, measure lists unioned with this device winning ties', () => {
  const local = migrate({ ...defaults(), ...clone(fixture('state')), schemaVersion: 1 });
  local.measures['Oats|Quaker|OFF'] = [{ label: 'scoop', g: 31 }];
  const r = mergeRestore(clone(local), clone(fixture('backup')));
  assert.equal(r.custom.length, 2);
  assert.equal(r.custom.filter(f => f.name === '=cmd|calc').length, 1);
  const chili = r.custom.find(f => f.name === 'Chili');
  assert.equal(chili.id, CHILI);
  assert.deepEqual(r.measures[CHILI], [{ label: 'cup', g: 240 }]);
  assert.ok(!('Chili||Custom' in r.measures));
  assert.deepEqual(byLabel(r.measures['Oats|Quaker|OFF']), byLabel([{ label: 'scoop', g: 31 }, { label: 'bowl', g: 80 }]));
  // an UNMIGRATED local state (as the existing backup tests pass it) works too
  const raw = mergeRestore({ ...defaults(), ...clone(fixture('state')) }, clone(fixture('backup')));
  assert.equal(raw.custom.length, 2); assert.ok(raw.custom.every(f => isFoodId(f.id)));
});

test('32. mergeRestore after a local rename keeps one food with this device\'s name; hostile ids and foodIds in a backup are sanitised', () => {
  const local = base({ custom: [cf('Chili stew', { id: CHILI, updatedAt: 5000 })] });
  const backup = { goals: { k: 2000, p: 150, c: 200, f: 65 }, days: {}, recent: [], custom: [cf('Chili', { updatedAt: undefined })], measures: {} };
  const r = mergeRestore(clone(local), clone(backup));
  assert.deepEqual(names(r), ['Chili stew']);
  const tie = base({ custom: [cf('Chili stew', { id: CHILI, updatedAt: 0 })] });
  assert.deepEqual(names(mergeRestore(clone(tie), clone(backup))), ['Chili stew']);
  const evil = { schemaVersion: 8, goals: { k: 2000, p: 150, c: 200, f: 65 }, days: {}, measures: {},
    custom: [cf('H1', { id: '__proto__' }), cf('H2', { id: '<img src=x onerror=1>' }), cf('Ok', { id: 'fok0000001' })],
    recent: [{ name: 'R1', brand: '', source: 'Custom', per100: { ...P }, foodId: '<b>' }, { name: 'R2', brand: '', source: 'Custom', per100: { ...P }, foodId: 'fok0000001' }] };
  const e = mergeRestore(base(), clone(evil));
  assert.deepEqual(e.custom.map(f => isFoodId(f.id)), [true, true, true]);
  assert.equal(e.custom.find(f => f.name === 'Ok').id, 'fok0000001');
  assert.ok(!('foodId' in e.recent.find(f => f.name === 'R1'))); assert.equal(e.recent.find(f => f.name === 'R2').foodId, 'fok0000001');
  assert.equal({}.polluted, undefined);
});

// ---------------------------------------------------------------- weak static checks
test('33. WEAK: UI wiring (source text only): addCustomFood and edit by id, measuresKey in the amount picker, foodId passed by the pickers', () => {
  const cust = read('js/ui/custom-food.js'), amt = read('js/ui/amount-picker.js');
  assert.ok(cust.includes('addCustomFood'), 'custom-food.js must save through addCustomFood');
  assert.ok(/updateCustomFood\(\s*state\s*,\s*editing\.id\b/.test(cust), 'custom-food.js must edit by editing.id');
  assert.ok(!/foodKey\(editing\)/.test(cust), 'no foodKey edit key any more');
  assert.ok(amt.includes('measuresKey'), 'amount-picker.js must use measuresKey');
  assert.ok(!/state\.measures\[foodKey\(/.test(amt), 'amount-picker.js must not read or write measures by foodKey directly');
  for (const f of ['js/ui/add-food.js', 'js/ui/plan-view.js', 'js/ui/recipe-editor.js']) assert.ok(read(f).includes('foodId'), f + ' must pass foodId for saved foods');
});

test('34. WEAK: sw.js CACHE is above the previous main value (57); the store still uses STORAGE_KEY', () => {
  const m = /const CACHE = 'macro-diary-v(\d+)'/.exec(read('sw.js'));
  assert.ok(m); assert.ok(Number(m[1]) > 57, 'CACHE is v' + m[1] + ', main had v57');
  assert.ok(read('js/core/store.js').includes('STORAGE_KEY'));
});

test('35. WEAK: docs updated (issue 55 fixed, a decision after D52 about saved food ids, SYNC.md mentions the id)', () => {
  const row = read('docs/KNOWN-ISSUES.md').split('\n').find(l => /^\| 55 \|/.test(l));
  assert.ok(row, 'row 55 exists'); assert.ok(!/\|\s*Open\s*\|\s*$/.test(row), 'row 55 must no longer be Open'); assert.match(row, /Fixed/);
  const dec = read('docs/DECISIONS.md');
  assert.match(dec.slice(dec.indexOf('## D52.') + 10), /^## D5[3-9]\.[^\n]*\bid/im, 'a decision after D52 whose title mentions ids');
  assert.match(read('docs/SYNC.md'), /\bid\b[^\n]*(saved|custom) food|(saved|custom) food[^\n]*\bid\b/i);
});
