// Nutrition details (docs/specs/nutrition-details.md, behaviours D1..D19). Written BEFORE the implementation.
// Expected values are hand-calculated, not produced by running the new code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHEMA_VERSION, defaults, migrate, sanitize, sanitizeFood, sanitizeRecipe, sanitizePlanDay } from '../js/core/schema.js';
import * as schemaNs from '../js/core/schema.js';   // namespace imports: a missing export fails one test, not the whole file
import { createStore } from '../js/core/store.js';
import { mapOFF } from '../js/services/off.js';
import { mapUSDA } from '../js/services/usda.js';
import { totals } from '../js/domain/nutrition.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { copyEntries } from '../js/domain/entries.js';
import { updateCustomFood, foodKey } from '../js/domain/food.js';
import { fixture, clone } from './helpers.js';

let detailsNs = {};
try { detailsNs = await import('../js/domain/details.js'); } catch { /* not built yet: tests below fail with a clear message */ }
const NUT_KEYS = schemaNs.NUT_KEYS || ['fiber', 'sugars', 'satFat', 'sodium', 'cholesterol'];
const sanitizeNut = (...a) => { assert.equal(typeof schemaNs.sanitizeNut, 'function', 'schema.js must export sanitizeNut'); return schemaNs.sanitizeNut(...a); };
const dayDetails = (...a) => { assert.equal(typeof detailsNs.dayDetails, 'function', 'js/domain/details.js must export dayDetails'); return detailsNs.dayDetails(...a); };
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const per100 = { k: 100, p: 1, c: 1, f: 1 };
const entry = (id, over = {}) => ({ id, meal: 'Lunch', name: id, brand: '', source: 'x', per100: { ...per100 }, grams: 100, ...over });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ${b} got ${a}`);
const fakeStorage = raw => ({ getItem: () => raw, setItem() {} });
const FULL = { fiber: 3, sugars: 4, satFat: 5, sodium: 600, cholesterol: 70 };

// ---------- schema ----------
test('D1 schema is v8, defaults carry it, NUT_KEYS is the five keys in order', () => {
  assert.equal(SCHEMA_VERSION, 10);
  assert.equal(defaults().schemaVersion, 10);
  assert.deepEqual(schemaNs.NUT_KEYS, ['fiber', 'sugars', 'satFat', 'sodium', 'cholesterol']);
});

test('D2 v7 and older data migrate to v8 with nothing added or lost', () => {
  const v7 = { schemaVersion: 7, apiKey: 'k', syncApiKey: false, goals: { k: 1800, p: 100, c: 100, f: 50 }, days: { '2024-05-01': [entry('a'), entry('b', { updatedAt: 5 })] },
    custom: [{ name: 'Mine', brand: '', source: 'custom', per100: { ...per100 }, servingG: 0, servingLabel: '' }], recent: [] };
  const m = migrate(clone(v7));
  assert.equal(m.schemaVersion, 10);
  assert.deepEqual(m.days, v7.days);
  assert.ok(!('nut' in m.days['2024-05-01'][0]));
  assert.ok(!('nut' in m.custom[0]));
  assert.equal(m.apiKey, 'k');
  for (const f of ['state', 'backup']) {
    const old = fixture(f), mm = migrate(clone(old));
    assert.equal(mm.schemaVersion, 10, f);
    for (const d of Object.keys(old.days)) if (Array.isArray(old.days[d])) assert.deepEqual(mm.days[d].map(e => e && e.id), old.days[d].map(e => e && e.id), f + d);
  }
  assert.equal(migrate({ days: { a: [] } }).schemaVersion, 10);
  const s = createStore(fakeStorage(JSON.stringify(v7)));
  assert.equal(s.state.schemaVersion, 10);
  assert.deepEqual(s.state.days, v7.days);
});

test('D3 sanitizeNut keeps valid keys (a reported 0 too) and never invents absent ones', () => {
  assert.deepEqual(sanitizeNut({ ...FULL }), FULL);
  assert.deepEqual(sanitizeNut({ fiber: 0, sodium: 0 }), { fiber: 0, sodium: 0 });
  const part = sanitizeNut({ sugars: 2.5 });
  assert.deepEqual(part, { sugars: 2.5 });
  assert.ok(!('fiber' in part) && !('sodium' in part));
  assert.equal(sanitizeNut({}), undefined);
  const src = { ...FULL }; const out = sanitizeNut(src);
  assert.notEqual(out, src);
});

test('D4 sanitizeNut hostile input', () => {
  const bad = ['3', '', 'abc', -1, -0.0001, NaN, Infinity, -Infinity, null, undefined, true, false, [], {}, [3], { v: 1 }, 1e308];
  for (const k of NUT_KEYS) for (const v of bad) assert.equal(sanitizeNut({ [k]: v }), undefined, `${k}=${String(v)}`);
  for (const v of [null, undefined, 5, 'x', true, [], [{ fiber: 1 }], () => 1]) assert.equal(sanitizeNut(v), undefined, String(v));
  // boundaries inclusive, one step beyond dropped
  assert.deepEqual(sanitizeNut({ fiber: 100, sugars: 100, satFat: 100, sodium: 40000, cholesterol: 5000 }), { fiber: 100, sugars: 100, satFat: 100, sodium: 40000, cholesterol: 5000 });
  assert.equal(sanitizeNut({ fiber: 100.01 }), undefined);
  assert.equal(sanitizeNut({ sodium: 40001 }), undefined);
  assert.equal(sanitizeNut({ cholesterol: 5001 }), undefined);
  // good keys survive next to bad ones; extra keys vanish
  assert.deepEqual(sanitizeNut({ fiber: 2, sugars: 'x', sodium: -3, bogus: 1, calcium: 5 }), { fiber: 2 });
  // prototype keys, as JSON.parse creates them
  const evil = JSON.parse('{"__proto__":{"polluted":1,"fiber":9},"constructor":{"fiber":1},"prototype":1,"fiber":4}');
  const out = sanitizeNut(evil);
  assert.deepEqual(out, { fiber: 4 });
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(({}).polluted, undefined);
  assert.equal(sanitizeNut(JSON.parse('{"__proto__":{"fiber":9}}')), undefined);
  assert.equal(Object.keys(sanitizeNut({ fiber: 1, sodium: 2 })).sort().join(), 'fiber,sodium');
});

test('D5 sanitize cleans nut on day entries, recent and custom foods without dropping any', () => {
  const food = (name, nut) => ({ name, brand: '', source: 'x', per100: { ...per100 }, servingG: 0, servingLabel: '', ...(nut === undefined ? {} : { nut }) });
  const d = sanitize({ schemaVersion: 8, days: { '2025-01-01': [entry('ok', { nut: { ...FULL } }), entry('hostile', { nut: { fiber: '9', sodium: -1, sugars: 2, zzz: 1 } }),
      entry('allbad', { nut: { fiber: NaN } }), entry('str', { nut: 'lots' }), entry('arr', { nut: [1, 2] }), entry('none')] },
    recent: [food('r1', { ...FULL }), food('r2', { fiber: -1 })], custom: [food('c1', { sodium: 40001, fiber: 0 }), food('c2')] });
  const [ok, hostile, allbad, str, arr, none] = d.days['2025-01-01'];
  assert.deepEqual(ok.nut, FULL);
  assert.deepEqual(hostile.nut, { sugars: 2 });
  for (const e of [allbad, str, arr, none]) assert.ok(!('nut' in e), e.id);
  assert.equal(d.days['2025-01-01'].length, 6);
  assert.deepEqual(d.recent.map(f => f.name), ['r1', 'r2']);
  assert.deepEqual(d.recent[0].nut, FULL); assert.ok(!('nut' in d.recent[1]));
  assert.deepEqual(d.custom.map(f => f.name), ['c1', 'c2']);
  assert.deepEqual(d.custom[0].nut, { fiber: 0 }); assert.ok(!('nut' in d.custom[1]));
  assert.equal(ok.per100.k, 100); assert.deepEqual(Object.keys(ok.per100).sort(), ['c', 'f', 'k', 'p']);
});

test('D6 sanitizeFood / recipe ingredients / plan items carry nut through and add none when absent', () => {
  const f = { name: 'Beans', brand: '', source: 'USDA', per100: { ...per100 }, servingG: 0, servingLabel: '', nut: { fiber: 6, sodium: 'x', bogus: 1 } };
  assert.deepEqual(sanitizeFood(clone(f)).nut, { fiber: 6 });
  assert.deepEqual(Object.keys(sanitizeFood(clone(f)).per100).sort(), ['c', 'f', 'k', 'p']);
  assert.ok(!('nut' in sanitizeFood({ ...clone(f), nut: undefined })));
  assert.ok(!('nut' in sanitizeFood({ ...clone(f), nut: { fiber: -2 } })));
  const r = sanitizeRecipe({ name: 'Chili', ingredients: [{ id: 'i1', raw: 'beans', name: 'beans', food: clone(f), grams: 100 }, { id: 'i2', raw: 'x', name: 'x', food: { ...clone(f), nut: undefined }, grams: 1 }] }, 'r1');
  assert.deepEqual(r.ingredients[0].food.nut, { fiber: 6 });
  assert.ok(!('nut' in r.ingredients[1].food));
  const day = sanitizePlanDay({ updatedAt: 1, slots: { Lunch: [{ id: 'p1', type: 'food', name: 'Beans', food: clone(f), grams: 100 }] } });
  assert.deepEqual(day.slots.Lunch[0].food.nut, { fiber: 6 });
});

// ---------- sources ----------
test('D7 mapOFF reads the five nutrients, converts sodium and cholesterol g -> mg', () => {
  const base = { product_name: 'Bar', brands: 'B', serving_quantity: 50, nutriments: { 'energy-kcal_100g': 400, proteins_100g: 10, carbohydrates_100g: 50, fat_100g: 20 } };
  const full = mapOFF({ ...base, nutriments: { ...base.nutriments, fiber_100g: 7, sugars_100g: 12, 'saturated-fat_100g': 3, sodium_100g: 0.5, cholesterol_100g: 0.02 } });
  assert.deepEqual(Object.keys(full.nut).sort(), [...NUT_KEYS].sort());
  near(full.nut.fiber, 7); near(full.nut.sugars, 12); near(full.nut.satFat, 3); near(full.nut.sodium, 500); near(full.nut.cholesterol, 20);
  assert.deepEqual(full.per100, { k: 400, p: 10, c: 50, f: 20 });
  const part = mapOFF({ ...base, nutriments: { ...base.nutriments, fiber_100g: 0, sodium_100g: 0 } });
  assert.deepEqual(part.nut, { fiber: 0, sodium: 0 });                       // reported 0 kept, unreported absent
  const junk = mapOFF({ ...base, nutriments: { ...base.nutriments, fiber_100g: -2, sugars_100g: NaN, sodium_100g: null, 'saturated-fat_100g': 3 } });
  assert.deepEqual(junk.nut, { satFat: 3 });
  const none = mapOFF(clone(base));
  assert.ok(!('nut' in none));
  assert.deepEqual(Object.keys(none.per100).sort(), ['c', 'f', 'k', 'p']);
});

test('D8 mapUSDA reads nutrient numbers 291 269 606 307 601', () => {
  const n = (num, value, unitName) => ({ nutrientNumber: String(num), value, unitName });
  const base = [n(208, 250, 'KCAL'), n(203, 5, 'G'), n(205, 30, 'G'), n(204, 9, 'G')];
  const f = extra => ({ description: 'Granola', brandOwner: 'Acme', fdcId: 77, foodNutrients: [...base, ...extra] });
  const full = mapUSDA(f([n(291, 6.5, 'G'), n(269, 18, 'G'), n(606, 2.1, 'G'), n(307, 430, 'MG'), n(601, 12, 'MG')]));
  assert.deepEqual(full.nut, { fiber: 6.5, sugars: 18, satFat: 2.1, sodium: 430, cholesterol: 12 });
  assert.deepEqual(full.per100, { k: 250, p: 5, c: 30, f: 9 });
  const zero = mapUSDA(f([n(291, 0, 'G'), n(601, 0, 'MG')]));
  assert.deepEqual(zero.nut, { fiber: 0, cholesterol: 0 });                  // a reported 0 must survive
  assert.ok(!('nut' in mapUSDA(f([]))));
  assert.deepEqual(mapUSDA(f([n(307, 'x', 'MG'), n(291, -1, 'G'), n(269, 4, 'G')])).nut, { sugars: 4 });
});

// ---------- dayDetails ----------
test('D9 dayDetails scales by grams/100 and sums', () => {
  // fiber: 10*50/100 = 5 ; 2*300/100 = 6  -> 11.  sodium: 400*50/100 = 200 plus 400*25/100 = 100 -> 300
  const r = dayDetails([entry('a', { grams: 50, nut: { fiber: 10, sodium: 400 } }), entry('b', { grams: 300, nut: { fiber: 2 } }), entry('c', { grams: 25, nut: { sodium: 400, sugars: 8 } })], { k: 2000, p: 150, c: 200, f: 65 });
  assert.equal(r.items, 3);
  near(r.nutrients.fiber.total, 11); assert.equal(r.nutrients.fiber.recorded, 2); assert.equal(r.nutrients.fiber.missing, 1);
  near(r.nutrients.sodium.total, 300); assert.equal(r.nutrients.sodium.recorded, 2);
  near(r.nutrients.sugars.total, 2); assert.equal(r.nutrients.sugars.recorded, 1); assert.equal(r.nutrients.sugars.missing, 2);
  assert.deepEqual(Object.keys(r.nutrients), NUT_KEYS);
});

test('D10 dayDetails mixed recorded and missing: "from 3 of 5 items"', () => {
  const es = [entry('1', { nut: { fiber: 1 } }), entry('2', { nut: { fiber: 2 } }), entry('3', { nut: { fiber: 3 } }), entry('4'), entry('5', { nut: { sodium: 10 } })];
  const r = dayDetails(es, {});
  assert.equal(r.items, 5);
  assert.deepEqual(r.nutrients.fiber, { total: 6, recorded: 3, missing: 2 });
  assert.deepEqual(r.nutrients.sodium, { total: 10, recorded: 1, missing: 4 });
  assert.deepEqual(r.nutrients.cholesterol, { total: null, recorded: 0, missing: 5 });
});

test('D11 dayDetails: reported 0 is recorded with total 0, absent is null never 0', () => {
  const r = dayDetails([entry('z', { grams: 200, nut: { fiber: 0 } }), entry('y')], {});
  assert.deepEqual(r.nutrients.fiber, { total: 0, recorded: 1, missing: 1 });
  assert.equal(r.nutrients.sugars.total, null);
  assert.notEqual(r.nutrients.sugars.total, 0);
  assert.equal(dayDetails([entry('only')], {}).nutrients.fiber.total, null);
});

test('D12 dayDetails tolerates malformed entries and input, and does not mutate', () => {
  const empty = { total: null, recorded: 0, missing: 0 };
  for (const bad of [[], undefined, null, 'x', 5, {}, [null, undefined, 3, 'a', []]]) {
    const r = dayDetails(bad, { k: 1, p: 1, c: 1, f: 1 });
    assert.equal(r.items, 0); assert.deepEqual(r.macros, { k: 0, p: 0, c: 0, f: 0 });
    for (const k of NUT_KEYS) assert.deepEqual(r.nutrients[k], empty, k);
  }
  const es = [entry('good', { nut: { fiber: 2 } }), entry('g0', { grams: 0, nut: { fiber: 99 } }), entry('gneg', { grams: -5, nut: { fiber: 99 } }), entry('gnan', { grams: NaN, nut: { fiber: 99 } }),
    { id: 7, per100, grams: 100, nut: { fiber: 99 } }, { id: 'nop', grams: 100, nut: { fiber: 99 } }, entry('strnut', { nut: 'x' }), entry('badvals', { nut: { fiber: '5', sugars: -1, sodium: NaN, satFat: Infinity, cholesterol: null } }),
    entry('arr', { nut: [1] }), entry('proto', { nut: JSON.parse('{"__proto__":{"fiber":50}}') })];
  const before = JSON.stringify(es);
  const r = dayDetails(es, { k: 2000, p: 150, c: 200, f: 65 });
  assert.equal(JSON.stringify(es), before);
  assert.equal(r.items, 5);                                                   // good, strnut, badvals, arr, proto
  assert.deepEqual(r.nutrients.fiber, { total: 2, recorded: 1, missing: 4 });
  for (const k of ['sugars', 'sodium', 'satFat', 'cholesterol']) assert.deepEqual(r.nutrients[k], { total: null, recorded: 0, missing: 5 }, k);
  assert.doesNotThrow(() => dayDetails([entry('h', { grams: 1e7, nut: { fiber: 100 } })], undefined));
  near(dayDetails([entry('h', { grams: 1e7, nut: { fiber: 100 } })], {}).nutrients.fiber.total, 1e7);
});

test('D13 dayDetails macros equal totals(); pct rounds and is null for a bad goal', () => {
  const es = [entry('a', { per100: { k: 200, p: 20, c: 30, f: 10 }, grams: 100 }), entry('b', { per100: { k: 50, p: 1, c: 2, f: 3 }, grams: 150 })];
  const r = dayDetails(es, { k: 2000, p: 150, c: 200, f: 65 });
  const t = totals(es);
  for (const k of ['k', 'p', 'c', 'f']) near(r.macros[k], t[k], k);
  // hand: k 200+75=275 -> 13.75% -> 14 ; p 20+1.5=21.5 /150 = 14.33 -> 14 ; c 30+3=33 /200 = 16.5 -> 17 ; f 10+4.5=14.5 /65 = 22.3 -> 22
  assert.deepEqual(r.pct, { k: 14, p: 14, c: 17, f: 22 });
  const z = dayDetails(es, { k: 0, p: -5, c: NaN, f: 'x' });
  assert.deepEqual(z.pct, { k: null, p: null, c: null, f: null });
  assert.deepEqual(dayDetails(es, undefined).pct, { k: null, p: null, c: null, f: null });
  assert.deepEqual(dayDetails([], { k: 2000, p: 1, c: 1, f: 1 }).pct, { k: 0, p: 0, c: 0, f: 0 });
});

// ---------- sync / backup ----------
const dayRec = (day, entries, updatedAt = 10) => ({ key: 'day:' + day, value: { entries }, updatedAt });

test('D14 sync records carry nut, sanitise hostile nut, accept devices without it', () => {
  const s = { ...defaults(), days: { '2025-02-01': [entry('a', { nut: { ...FULL }, updatedAt: 5 }), entry('b', { updatedAt: 5 })] } };
  const rec = toRecords(s).find(r => r.key === 'day:2025-02-01');
  assert.deepEqual(rec.value.entries[0].nut, FULL);
  const got = applyRecords({ ...defaults() }, JSON.parse(JSON.stringify(toRecords(s))));
  assert.deepEqual(got.days['2025-02-01'].find(e => e.id === 'a').nut, FULL);
  assert.ok(!('nut' in got.days['2025-02-01'].find(e => e.id === 'b')));
  const hostile = JSON.parse('{"fiber":"9","sodium":-1,"sugars":2,"__proto__":{"polluted":1},"zzz":1}');
  const h = applyRecords({ ...defaults() }, [dayRec('2025-02-02', [entry('h', { nut: hostile, updatedAt: 5 }), entry('s', { nut: 'lots', updatedAt: 5 })])]);
  const [e1, e2] = [h.days['2025-02-02'].find(e => e.id === 'h'), h.days['2025-02-02'].find(e => e.id === 's')];
  assert.ok(e1 && e2, 'entries must still arrive');
  assert.deepEqual(e1.nut, { sugars: 2 });
  assert.ok(!('nut' in e2));
  assert.equal(({}).polluted, undefined);
});

test('D15 merge: whole-entry last writer wins including nut; converges; stale lack of nut does not erase', () => {
  const withNut = entry('x', { nut: { fiber: 4 }, updatedAt: 100 }), without = entry('x', { updatedAt: 200 });
  const A = { ...defaults(), days: { '2025-03-01': [withNut] } }, B = { ...defaults(), days: { '2025-03-01': [without] } };
  assert.ok(!('nut' in mergeStates(A, B).days['2025-03-01'][0]));              // newer edit has no nut: it wins as a whole
  assert.ok(!('nut' in mergeStates(B, A).days['2025-03-01'][0]));
  // the device lacking nut holds an OLDER copy: nut survives
  const old = entry('x', { updatedAt: 50 });
  const C = { ...defaults(), days: { '2025-03-01': [old] } };
  assert.deepEqual(mergeStates(A, C).days['2025-03-01'][0].nut, { fiber: 4 });
  assert.deepEqual(mergeStates(C, A).days['2025-03-01'][0].nut, { fiber: 4 });
  // equal stamps: both orders give the same entry
  const t1 = entry('y', { nut: { fiber: 1 }, updatedAt: 9 }), t2 = entry('y', { updatedAt: 9 });
  const m1 = mergeStates({ ...defaults(), days: { d: [t1] } }, { ...defaults(), days: { d: [t2] } });
  const m2 = mergeStates({ ...defaults(), days: { d: [t2] } }, { ...defaults(), days: { d: [t1] } });
  assert.deepEqual(m1.days.d, m2.days.d);
  // an entry that is only on the device lacking nut stays as is
  const only = mergeStates(A, { ...defaults(), days: { '2025-03-01': [entry('z', { updatedAt: 1 })] } });
  assert.equal(only.days['2025-03-01'].length, 2);
});

test('D16 backup: nut comes through mergeRestore sanitised; old v7 backups merge as before; JSON round trip', () => {
  const local = { ...defaults(), days: { '2025-04-01': [entry('l', { updatedAt: 1 })] } };
  const bk = JSON.parse(JSON.stringify({ ...defaults(), schemaVersion: 8, days: { '2025-04-02': [entry('n', { nut: { ...FULL }, updatedAt: 2 }), entry('h', { nut: { fiber: -1, sodium: '5', sugars: 1 }, updatedAt: 2 })] } }));
  const m = mergeRestore(local, bk);
  const d2 = m.days['2025-04-02'];
  assert.deepEqual(d2.find(e => e.id === 'n').nut, FULL);
  assert.deepEqual(d2.find(e => e.id === 'h').nut, { sugars: 1 });
  assert.equal(m.days['2025-04-01'].length, 1);
  const old = JSON.parse(JSON.stringify({ ...defaults(), schemaVersion: 7, days: { '2025-04-03': [entry('o', { updatedAt: 3 })] } }));
  const m2 = mergeRestore(local, old);
  assert.ok(!('nut' in m2.days['2025-04-03'][0]));
  assert.equal(m2.schemaVersion, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(m)).days['2025-04-02'].find(e => e.id === 'n').nut, FULL);
});

// ---------- keep nut when copying / editing ----------
test('D17 copyEntries copies nut as a deep copy', () => {
  const s = { ...defaults(), days: { '2025-05-01': [entry('a', { nut: { ...FULL } })] } };
  let n = 0;
  const [c] = copyEntries(s, '2025-05-01', ['a'], '2025-05-02', 'Dinner', 99, () => 'copy' + (++n));
  assert.deepEqual(c.nut, FULL);
  assert.notEqual(c.nut, s.days['2025-05-01'][0].nut);
  c.nut.fiber = 999;
  assert.equal(s.days['2025-05-01'][0].nut.fiber, 3);
});

test('D18 editing a saved custom food keeps its nut', () => {
  const food = { id: 'fmine0001', name: 'Mine', brand: '', source: 'custom', per100: { k: 100, p: 1, c: 1, f: 1 }, servingG: 100, servingLabel: '', nut: { ...FULL } };
  const s = { ...defaults(), custom: [food], measures: {} };
  const r = updateCustomFood(s, food.id, { name: 'Mine renamed', k: 120 }, 5);
  assert.ok(r, 'the edit itself must succeed');
  assert.deepEqual(s.custom[0].nut, FULL);
  assert.equal(s.custom[0].name, 'Mine renamed');
});

// ---------- source text ----------
test('D19 UI and domain source text: nut carried, #summary is a keyboard button, details.js stays pure', () => {
  for (const f of ['../js/ui/amount-picker.js', '../js/ui/plan-view.js', '../js/ui/recipe-editor.js']) assert.match(read(f), /\bnut\b/, f);
  const diary = read('../js/ui/diary.js'), html = read('../index.html');
  assert.ok(/dayDetails/.test(diary), 'diary.js must use dayDetails');
  assert.ok(/id="summary"[^>]*role="button"|role="button"[^>]*id="summary"|#summary'\)\.setAttribute\('role',\s*'button'\)/.test(diary + html), '#summary needs role=button');
  assert.match(diary + html, /tabindex/);
  assert.match(diary, /Enter/); assert.match(diary, /' '|Space|\bkey\b/);
  let d = ''; try { d = read('../js/domain/details.js'); } catch { assert.fail('js/domain/details.js does not exist'); }
  assert.doesNotMatch(d, /from '\.\.\/(ui|services)\//);
  assert.doesNotMatch(d, /\b(document|localStorage|fetch)\b/);
});
