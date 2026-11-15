// Spec: docs/specs/water.md (backlog item 23). Test-designer file, written BEFORE the implementation. All data is made up.
// Golden values are hand-computed (the arithmetic is in the comments), never taken from the code under test.
// Tests W20-W22 are WEAK source-text checks (words in files); the screens themselves are proved by the headless scenarios C1-C14 in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SCHEMA from '../js/core/schema.js';
import * as ENTRIES from '../js/domain/entries.js';
import { createStore } from '../js/core/store.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { toRecords, applyRecords, isSyncKey } from '../js/domain/sync-records.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { touchSettings } from '../js/domain/entries.js';
import { dialModel } from '../js/domain/dials.js';
import { clone } from './helpers.js';

// the two new modules are loaded dynamically so that, until they exist, each test fails on its own with a clear message instead of the whole file failing to load
const load = async p => { try { return await import(p); } catch (e) { return new Proxy({}, { get: (_, k) => { if (k === 'then') return undefined; throw new Error('module not found: ' + p); } }); } };
const DOMAIN = await load('../js/domain/water.js'), UI = await load('../js/ui/water.js');
// namespace imports: a missing export fails only the tests that use it (not the whole file)
const { defaults, migrate, sanitize, SCHEMA_VERSION, DEFAULT_WATER_CUPS, sanitizeWaterCups, sanitizeWaterTap, sanitizeWaterDay } = SCHEMA;
const waterModel = (...a) => DOMAIN.waterModel(...a), nextHalves = (...a) => DOMAIN.nextHalves(...a);
const { setWater } = ENTRIES;
const waterHtml = (...a) => UI.waterHtml(...a);
const D = '2026-11-14', Y = '2026-11-13';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };
const BAD_WORDS = /NaN|Infinity|undefined|null|\[object|[<>]/;
const clean = (m, msg) => { for (const s of strings(m)) assert.doesNotMatch(s, BAD_WORDS, `${msg || ''} string "${s}"`); };
const fakeStorage = initial => { const m = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, m }; };
const count = (s, n) => s.split(n).length - 1;
const tagOf = (src, id) => { const m = src.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>')); assert.ok(m, 'missing #' + id); return m[0]; };
const mk = ({ water = {}, unit = 'g', waterCups, tap } = {}) => {
  const s = defaults(); s.water = water; s.weightUnit = unit;
  if (waterCups !== undefined) s.goals = { ...s.goals, waterCups }; if (tap !== undefined) s.waterTap = tap; return s;
};
const wm = (halves, opts) => waterModel(mk({ ...opts, water: { [D]: { updatedAt: 1, halves } } }), D);
const GOALS13 = { k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8, waterCups: 8 };

// ================================================================ saved shape
test('W1. SCHEMA_VERSION 13; defaults carry water {}, waterTap half, goals.waterCups 8; STORAGE_KEY unchanged', () => {
  assert.equal(SCHEMA_VERSION, 13); assert.equal(defaults().schemaVersion, 13);
  assert.equal(DEFAULT_WATER_CUPS, 8);
  assert.deepEqual(defaults().water, {}); assert.notStrictEqual(defaults().water, defaults().water);
  defaults().water.x = 1; assert.deepEqual(defaults().water, {}, 'mutating one default must not change the next');
  assert.equal(defaults().waterTap, 'half');
  assert.deepEqual(defaults().goals, GOALS13, 'the other goals are untouched');
  assert.equal(STORAGE_KEY, 'macrodiary.v1');
  assert.match(read('js/core/schema.js'), /export const SCHEMA_VERSION = 13;/); assert.match(read('js/core/schema.js'), /v < 13/, 'a migrate step for version 13');
});

test('W2. sanitizeWaterCups keeps integers 1..40 and gives 8 for everything else; sanitizeWaterTap keeps half and whole, else half', () => {
  for (const ok of [1, 2, 8, 12, 39, 40]) assert.equal(sanitizeWaterCups(ok), ok, String(ok));
  for (const bad of [0, -1, -3, 41, 100, 1e9, 7.5, 0.4, 40.5, NaN, Infinity, -Infinity, null, undefined, true, false, {}, [], [8], 1e-9]) assert.equal(sanitizeWaterCups(bad), 8, String(bad));
  assert.equal(sanitizeWaterTap('half'), 'half'); assert.equal(sanitizeWaterTap('whole'), 'whole');
  for (const bad of ['Whole', 'HALF', ' whole', 'whole ', '', 'x', null, undefined, 0, 1, true, {}, ['whole'], '<img>', '__proto__']) assert.equal(sanitizeWaterTap(bad), 'half', JSON.stringify(bad));
});

test('W3. sanitizeWaterDay: integer halves 0..80 kept, anything else drops the record; updatedAt defaults to 0; a new object with two keys', () => {
  for (const h of [0, 1, 17, 79, 80]) assert.deepEqual(sanitizeWaterDay({ updatedAt: 5, halves: h }), { updatedAt: 5, halves: h }, 'halves ' + h);
  for (const h of [81, -1, 2.5, NaN, Infinity, '4', '', null, undefined, true, [], {}, 1e9]) assert.equal(sanitizeWaterDay({ updatedAt: 5, halves: h }), null, 'halves ' + JSON.stringify(h));
  for (const junk of [null, undefined, 5, 'x', [], [{ halves: 2 }], true, {}, { updatedAt: 5 }]) assert.equal(sanitizeWaterDay(junk), null, JSON.stringify(junk));
  for (const u of [undefined, null, 'x', NaN, -5, Infinity, {}, '7']) assert.deepEqual(sanitizeWaterDay({ updatedAt: u, halves: 3 }), { updatedAt: 0, halves: 3 }, 'updatedAt ' + String(u));
  const src = { updatedAt: 9, halves: 4, evil: '<img>', __proto__: { polluted: 1 } }, out = sanitizeWaterDay(src);
  assert.deepEqual(Object.keys(out).sort(), ['halves', 'updatedAt']); assert.notStrictEqual(out, src); assert.equal(({}).polluted, undefined);
  assert.doesNotThrow(() => sanitizeWaterDay(deepFreeze({ updatedAt: 1, halves: 2 })));
});

test('W4. sanitize() applies it: day records kept or dropped, only real dates are buckets, goal and tap cleaned, other goals untouched, idempotent', () => {
  const raw = JSON.parse('{"water":{"2026-11-14":{"updatedAt":9,"halves":6,"x":1},"2026-11-13":{"updatedAt":3,"halves":0},"2026-11-12":{"updatedAt":1,"halves":99},"2026-02-30":{"updatedAt":1,"halves":2},"x":{"updatedAt":1,"halves":2},"__proto__":{"updatedAt":1,"halves":2},"constructor":{"updatedAt":1,"halves":2}},"waterTap":"whole","goals":{"k":1800,"p":120,"c":150,"f":50,"steps":7000,"sleepH":7.5,"waterCups":12}}');
  const s = sanitize(raw);
  assert.deepEqual(s.water, { '2026-11-14': { updatedAt: 9, halves: 6 }, '2026-11-13': { updatedAt: 3, halves: 0 } }, 'a halves 0 day stays; bad days and keys go');
  assert.equal(Object.getPrototypeOf(s.water), Object.prototype); assert.equal(({}).halves, undefined);
  assert.equal(s.waterTap, 'whole'); assert.deepEqual(s.goals, { k: 1800, p: 120, c: 150, f: 50, steps: 7000, sleepH: 7.5, waterCups: 12 });
  assert.deepEqual(sanitize(clone(s)), s, 'idempotent');
  for (const junk of [undefined, null, 'x', 5, [], true, [{ halves: 2 }]]) assert.deepEqual(sanitize({ water: junk }).water, {}, JSON.stringify(junk));
  const g = sanitize({ goals: { k: 1800, p: 120, c: 150, f: 50, steps: 7000, sleepH: 7.5, waterCups: 99 }, waterTap: 'x' });
  assert.equal(g.goals.waterCups, 8, 'unusable goal gives the default, not 40'); assert.equal(g.goals.steps, 7000); assert.equal(g.waterTap, 'half');
  const none = sanitize({}); assert.equal(none.goals.waterCups, 8); assert.equal(none.waterTap, 'half'); assert.deepEqual(none.water, {});
});

const oldSave = v => { const s = { ...clone(defaults()), schemaVersion: v, goals: { k: 1800, p: 120, c: 0, f: 55.5, steps: 5000, sleepH: 7 }, theme: 'dark', weightUnit: 'oz', settingsUpdatedAt: 77, tombstones: { x: 5 },
  days: { [Y]: [{ id: 'e1', meal: 'Lunch', name: 'Rice', brand: '', source: 'custom', per100: { k: 100, p: 10, c: 20, f: 5 }, grams: 300, updatedAt: 1 }] },
  activity: { [Y]: { updatedAt: 1, source: 'google-health', steps: 5000, sleepMinutes: 400 } } }; delete s.water; delete s.waterTap; return s; };
const kept = s => JSON.stringify([s.days, s.tombstones, s.settingsUpdatedAt, s.theme, s.weightUnit, s.activity, { k: s.goals.k, p: s.goals.p, c: s.goals.c, f: s.goals.f, steps: s.goals.steps, sleepH: s.goals.sleepH }]);

test('W5. migration from every older version (1, 2, 5, 8, 9, 10, 11, 12) keeps every value and adds water {}, waterCups 8, waterTap half; a version 13 save keeps its choices; store round trip', () => {
  for (const v of [1, 2, 5, 8, 9, 10, 11, 12]) {
    const src = oldSave(v), m = migrate(clone(src));
    assert.equal(m.schemaVersion, 13, 'from ' + v); assert.deepEqual(m.water, {}, 'from ' + v); assert.equal(m.waterTap, 'half', 'from ' + v); assert.equal(m.goals.waterCups, 8, 'from ' + v);
    assert.equal(kept(m), kept(src), 'from ' + v);
  }
  const v13 = { ...oldSave(13), schemaVersion: 13, water: { [D]: { updatedAt: 9, halves: 7 }, [Y]: { updatedAt: 3, halves: 0 } }, waterTap: 'whole', goals: { ...GOALS13, waterCups: 12 } };
  const m = migrate(clone(v13)); assert.deepEqual(m.water, v13.water, 'a halves 0 day survives'); assert.equal(m.waterTap, 'whole'); assert.equal(m.goals.waterCups, 12); assert.equal(m.schemaVersion, 13);
  const st = fakeStorage(JSON.stringify(oldSave(12))), s = createStore(st);
  assert.equal(s.state.schemaVersion, 13); assert.deepEqual(s.state.water, {}); assert.equal(kept(s.state), kept(oldSave(12)));
  assert.equal(setWater(s.state, D, 5, 1000).halves, 5); s.state.waterTap = 'whole'; s.state.goals.waterCups = 10; assert.equal(s.save(), true);
  const saved = JSON.parse(st.m.get(STORAGE_KEY)); assert.equal(saved.schemaVersion, 13); assert.deepEqual(saved.water, { [D]: { updatedAt: 1000, halves: 5 } });
  const again = createStore(fakeStorage(st.m.get(STORAGE_KEY))).state; assert.deepEqual(again.water, saved.water); assert.equal(again.waterTap, 'whole'); assert.equal(again.goals.waterCups, 10);
  const rep = createStore(fakeStorage()); rep.replace({ goals: { k: 1800, p: 120, c: 150, f: 50 } }); assert.equal(rep.state.goals.waterCups, 8); assert.deepEqual(rep.state.water, {});
});

// ================================================================ domain: the tap rule
// before = 2*(cup-1); own = clamp(current - before, 0, 2); next own: half mode 0->1 1->2 2->0, whole mode 0->2 1->2 2->0; result = before + next
test('W6. nextHalves in half mode: tapping cup N fills the cups before it; empty -> half -> full -> empty; a full cup empties itself and everything after it', () => {
  const rows = [  // [current, cup, expected]
    [0, 1, 1], [1, 1, 2], [2, 1, 0], [6, 1, 0], [80, 1, 0],       // cup 1: 0 -> half -> full -> empty; a full cup 1 empties the whole row
    [0, 3, 5],                                                     // 4 halves before cup 3 plus half
    [5, 3, 6], [6, 3, 4], [6, 2, 2],                               // cup 3 half -> full; full cup 3 on 6 -> 4; full cup 2 on 6 -> 2
    [1, 2, 3], [2, 2, 3],                                          // cup 2 empty: cup 1 gets filled, cup 2 half (3 = 2 + 1)
    [3, 5, 9], [8, 5, 9], [9, 5, 10], [10, 5, 8],                  // beyond the filled cups: 8 before + 1; half -> full; full -> 8
    [4, 2, 2],                                                     // cup 2 full on 4 -> 2
    [0, 40, 79], [79, 40, 80], [80, 40, 78], [80, 39, 76]];        // top of the range never passes 80
  for (const [cur, cup, want] of rows) assert.equal(nextHalves(cur, cup, 'half'), want, `current ${cur}, cup ${cup}`);
  let h = 0; const seq = []; for (let i = 0; i < 4; i++) { h = nextHalves(h, 1, 'half'); seq.push(h); } assert.deepEqual(seq, [1, 2, 0, 1], 'one cup of one: half, full, empty, half');
  h = 0; h = nextHalves(h, 3, 'half'); h = nextHalves(h, 3, 'half'); h = nextHalves(h, 3, 'half'); assert.equal(h, 4, 'three taps on cup 3: 5, 6, 4');
});

test('W7. nextHalves in whole mode, unknown modes, bad cups and bad current; property over every current, cup and mode', () => {
  const rows = [[0, 1, 2], [1, 1, 2], [2, 1, 0], [0, 3, 6], [6, 3, 4], [6, 1, 0], [5, 3, 6], [3, 5, 10], [4, 2, 2], [3, 2, 4], [0, 40, 80], [80, 40, 78]];
  for (const [cur, cup, want] of rows) assert.equal(nextHalves(cur, cup, 'whole'), want, `whole: current ${cur}, cup ${cup}`);
  for (const mode of ['bogus', undefined, null, '', 'WHOLE', 'Half', 5, {}]) { assert.equal(nextHalves(0, 1, mode), 1, 'mode ' + String(mode)); assert.equal(nextHalves(3, 2, mode), nextHalves(3, 2, 'half'), 'mode ' + String(mode)); }
  for (const cup of [0, -1, 41, 1.5, NaN, Infinity, '3', '', null, undefined, {}, [], true]) for (const mode of ['half', 'whole']) assert.equal(nextHalves(5, cup, mode), 5, `cup ${String(cup)} leaves the total unchanged`);
  for (const cup of [0, 41, NaN, '2']) assert.equal(nextHalves(-4, cup, 'half'), 0, 'bad cup and bad current give 0');
  for (const cur of [NaN, -4, 81, 2.5, '4', null, undefined, Infinity, {}, true]) { assert.equal(nextHalves(cur, 2, 'half'), 3, 'bad current ' + String(cur) + ' counts as 0'); assert.equal(nextHalves(cur, 1, 'whole'), 2); }
  for (let cur = 0; cur <= 80; cur++) for (let cup = 1; cup <= 40; cup++) for (const mode of ['half', 'whole']) {
    const r = nextHalves(cur, cup, mode), before = 2 * (cup - 1), own = Math.min(2, Math.max(0, cur - before));
    assert.ok(Number.isInteger(r) && r >= 0 && r <= 80, `range: ${cur}/${cup}/${mode} gave ${r}`);
    assert.ok(r - before >= 0 && r - before <= 2, `cups before the tapped one are full and the ones after are empty: ${cur}/${cup}/${mode} gave ${r}`);
    assert.equal(r - before, own === 2 ? 0 : mode === 'half' ? own + 1 : 2, `${cur}/${cup}/${mode}`);
  }
});

test('W8. setWater stamps, creates the map, keeps a day with 0, keeps days independent, rejects bad input without changing anything', () => {
  const s = defaults(), before = JSON.stringify(s);
  const r = setWater(s, D, 5, 1234); assert.deepEqual(r, { updatedAt: 1234, halves: 5 }); assert.deepEqual(s.water, { [D]: { updatedAt: 1234, halves: 5 } });
  assert.deepEqual(setWater(s, D, 0, 2000), { updatedAt: 2000, halves: 0 }); assert.deepEqual(s.water[D], { updatedAt: 2000, halves: 0 }); assert.ok(Object.hasOwn(s.water, D), 'a day with 0 is kept (an explicit undo must win a sync)');
  setWater(s, Y, 80, 2100); assert.deepEqual(s.water[Y], { updatedAt: 2100, halves: 80 }); assert.deepEqual(s.water[D], { updatedAt: 2000, halves: 0 });
  assert.equal(s.settingsUpdatedAt, 0); assert.deepEqual(s.tombstones, {}); assert.deepEqual(s.days, {});
  const bare = { days: {} }; assert.deepEqual(setWater(bare, D, 3, 7), { updatedAt: 7, halves: 3 }); assert.deepEqual(bare.water, { [D]: { updatedAt: 7, halves: 3 } });
  const t = defaults(); const snap = JSON.stringify(t);
  for (const day of ['2026-02-30', '2026-13-01', 'x', '', '__proto__', 'constructor', 5, null, undefined, '2026-11-14 ', '2026-1-14']) assert.equal(setWater(t, day, 2, 1), null, 'day ' + String(day));
  for (const h of [-1, 81, 2.5, NaN, Infinity, '4', null, undefined, true, {}, []]) assert.equal(setWater(t, D, h, 1), null, 'halves ' + String(h));
  for (const now of [NaN, -1, Infinity, '5', null, undefined]) assert.equal(setWater(t, D, 2, now), null, 'now ' + String(now));
  assert.equal(JSON.stringify(t), snap, 'a rejected call changes nothing'); assert.equal(({}).halves, undefined); assert.equal(({}).updatedAt, undefined);
  assert.notEqual(JSON.stringify(s), before);
});

// ================================================================ domain: the model
test('W9. waterModel basics: goal 8 with 5 halves, units, labels, texts, at the goal, goal of 1', () => {
  const m = wm(5, { unit: 'g' });   // 5 halves = 2.5 cups = 600 ml (5 x 120) = 20 oz (5 x 4)
  assert.equal(m.halves, 5); assert.equal(m.goalCups, 8); assert.equal(m.unit, 'ml'); assert.equal(m.over, false);
  assert.deepEqual(m.cups.map(c => c.state), ['full', 'full', 'half', 'empty', 'empty', 'empty', 'empty', 'empty']);
  assert.ok(m.cups.every(c => c.over === false)); assert.equal(m.cups[0].label, 'Cup 1 of 8, full'); assert.equal(m.cups[2].label, 'Cup 3 of 8, half full'); assert.equal(m.cups[3].label, 'Cup 4 of 8, empty'); assert.equal(m.cups[7].label, 'Cup 8 of 8, empty');
  assert.equal(m.text, '2.5 of 8 cups, 600 ml'); assert.equal(m.goalText, '8 cups, 1920 ml');   // 8 x 240 = 1920
  const o = wm(5, { unit: 'oz' }); assert.equal(o.unit, 'oz'); assert.equal(o.text, '2.5 of 8 cups, 20 oz'); assert.equal(o.goalText, '8 cups, 64 oz');
  assert.equal(wm(6, { unit: 'g' }).text, '3 of 8 cups, 720 ml'); assert.equal(wm(6, { unit: 'oz' }).text, '3 of 8 cups, 24 oz');
  const z = wm(0, { unit: 'oz' }); assert.equal(z.text, '0 of 8 cups, 0 oz'); assert.equal(z.cups.length, 8); assert.ok(z.cups.every(c => c.state === 'empty'));
  const at = wm(16, { unit: 'oz' }); assert.equal(at.over, false, 'exactly the goal is not over'); assert.equal(at.text, '8 of 8 cups, 64 oz'); assert.equal(at.cups.length, 8); assert.ok(at.cups.every(c => c.state === 'full' && !c.over));
  const one = wm(1, { unit: 'oz', waterCups: 1 }); assert.equal(one.text, '0.5 of 1 cup, 4 oz'); assert.equal(one.goalText, '1 cup, 8 oz'); assert.equal(one.cups.length, 1); assert.equal(one.cups[0].label, 'Cup 1 of 1, half full');
  assert.equal(wm(0, { unit: 'g', waterCups: 12 }).goalText, '12 cups, 2880 ml'); assert.equal(wm(0, { unit: 'oz', waterCups: 12 }).goalText, '12 cups, 96 oz');
  clean(m); clean(o); clean(one);
});

test('W10. over the goal: extra cups are shown and over in words; a bigger goal shows more empty cups; 40 cups at most', () => {
  const g12 = wm(18, { unit: 'oz', waterCups: 12 });   // 9 cups of a goal of 12
  assert.equal(g12.cups.length, 12); assert.equal(g12.text, '9 of 12 cups, 72 oz'); assert.equal(g12.over, false);
  assert.deepEqual(g12.cups.map(c => c.state), [...Array(9).fill('full'), ...Array(3).fill('empty')]); assert.ok(g12.cups.every(c => !c.over));
  const o = wm(18, { unit: 'oz' });   // 9 cups of a goal of 8 = 72 oz
  assert.equal(o.cups.length, 9); assert.equal(o.over, true); assert.equal(o.text, '9 of 8 cups, 72 oz, over goal'); assert.equal(wm(18, { unit: 'g' }).text, '9 of 8 cups, 2160 ml, over goal');   // 18 x 120
  assert.equal(o.cups[8].over, true); assert.equal(o.cups[8].state, 'full'); assert.equal(o.cups[8].label, 'Cup 9 of 9, full, over goal');
  assert.equal(o.cups[7].over, false); assert.equal(o.cups[7].label, 'Cup 8 of 9, full'); assert.ok(o.cups.slice(0, 8).every(c => !c.over));
  const h = wm(17, { unit: 'oz' }); assert.equal(h.cups.length, 9, 'a half cup past the goal still shows the 9th cup'); assert.equal(h.over, true);
  assert.equal(h.cups[8].state, 'half'); assert.equal(h.cups[8].over, true); assert.equal(h.cups[8].label, 'Cup 9 of 9, half full, over goal'); assert.equal(h.text, '8.5 of 8 cups, 68 oz, over goal');
  const max = wm(80, { unit: 'oz' }); assert.equal(max.cups.length, 40); assert.equal(max.text, '40 of 8 cups, 320 oz, over goal'); assert.equal(max.cups.filter(c => c.over).length, 32);
  assert.equal(wm(0, { waterCups: 40 }).cups.length, 40);
  const small = wm(5, { unit: 'oz', waterCups: 2 }); assert.equal(small.cups.length, 3); assert.equal(small.cups[2].over, true); assert.equal(small.text, '2.5 of 2 cups, 20 oz, over goal');
  clean(o); clean(h); clean(max);
});

test('W11. waterModel is per day, tolerant of junk, pure and never prints NaN', () => {
  const s = mk({ unit: 'oz', water: { [D]: { updatedAt: 1, halves: 6 }, [Y]: { updatedAt: 1, halves: 3 } } });
  assert.equal(waterModel(s, D).text, '3 of 8 cups, 24 oz'); assert.equal(waterModel(s, Y).text, '1.5 of 8 cups, 12 oz'); assert.equal(waterModel(s, '2026-01-01').text, '0 of 8 cups, 0 oz', 'no record means no water');
  for (const st of [null, undefined, {}, 5, 'x', [], { water: null }, { water: 'x', goals: null }]) for (const day of [D, undefined, null, 5, '', '__proto__', 'constructor']) {
    let m; assert.doesNotThrow(() => { m = waterModel(st, day); }, JSON.stringify(st) + ' ' + String(day)); assert.equal(m.halves, 0); assert.equal(m.goalCups, 8); assert.equal(m.cups.length, 8); clean(m, JSON.stringify(st));
  }
  for (const bad of ['x', 99, -1, 2.5, null, NaN, [], {}]) assert.equal(waterModel(mk({ water: { [D]: { updatedAt: 1, halves: bad } } }), D).halves, 0, 'halves ' + JSON.stringify(bad));
  assert.equal(waterModel(mk({ water: JSON.parse('{"__proto__":{"updatedAt":1,"halves":4}}') }), '__proto__').halves, 0);
  for (const goal of [0, 99, 'x', null, 7.5, -3]) assert.equal(waterModel(mk({ waterCups: goal }), D).goalCups, 8, 'goal ' + String(goal));
  const frozen = deepFreeze(mk({ water: { [D]: { updatedAt: 1, halves: 6 } } })), snap = JSON.stringify(frozen); waterModel(frozen, D); assert.equal(JSON.stringify(frozen), snap);
  const a = waterModel(s, D); a.cups.push({}); a.cups[0].state = 'x'; assert.equal(waterModel(s, D).cups.length, 8); assert.equal(waterModel(s, D).cups[0].state, 'full', 'the model does not hand out state');
});

test('W12. water is not nutrition: the dial model for a state with water equals the one without; reports.js does not mention water', () => {
  const entry = { id: 'e1', meal: 'Lunch', name: 'Rice', brand: '', source: 'custom', per100: { k: 100, p: 10, c: 20, f: 5 }, grams: 800, updatedAt: 1 };   // 800 kcal
  const a = mk({ unit: 'oz' }); a.days = { [D]: [entry] }; const b = clone(a); setWater(b, D, 80, 5);
  assert.deepEqual(dialModel(b, D), dialModel(a, D)); assert.equal(dialModel(b, D).nutrition.centre.text, '1200');
  assert.doesNotMatch(read('js/domain/reports.js'), /water/i, 'the report JSON and CSV are unchanged');
  assert.doesNotMatch(read('js/domain/nutrition.js'), /water/i);
});

// ================================================================ sync and backup
test('W13. toRecords: water:YYYY-MM-DD per valid day (also 0), value and stamp as specified; nothing for none; hostile keys skipped; settings carries waterCups and waterTap', () => {
  const s = mk({ tap: 'whole', waterCups: 12, water: { [D]: { updatedAt: 50, halves: 6 }, [Y]: { updatedAt: 40, halves: 0 } } });
  const recs = toRecords(s), w = recs.filter(r => r.key.startsWith('water:'));
  assert.deepEqual(w.map(r => r.key), ['water:' + Y, 'water:' + D], 'sorted by day');
  assert.deepEqual(w[1], { key: 'water:' + D, value: { water: { updatedAt: 50, halves: 6 } }, updatedAt: 50 }); assert.deepEqual(w[0], { key: 'water:' + Y, value: { water: { updatedAt: 40, halves: 0 } }, updatedAt: 40 }, 'an undo (0) is a record too');
  const set = recs.find(r => r.key === 'settings'); assert.equal(set.value.goals.waterCups, 12); assert.equal(set.value.waterTap, 'whole');
  assert.equal(toRecords(mk()).filter(r => r.key.startsWith('water:')).length, 0);
  assert.doesNotThrow(() => toRecords({ ...defaults(), water: undefined })); assert.doesNotThrow(() => toRecords({ ...defaults(), water: 'x' })); assert.doesNotThrow(() => toRecords({ ...defaults(), water: null }));
  const hostile = { ...defaults(), water: JSON.parse('{"__proto__":{"updatedAt":1,"halves":2},"x":{"updatedAt":1,"halves":2},"2026-02-30":{"updatedAt":1,"halves":2},"2026-11-12":{"updatedAt":1,"halves":2},"2026-11-11":5}') };
  assert.deepEqual(toRecords(hostile).filter(r => r.key.startsWith('water:')).map(r => r.key), ['water:2026-11-12']);
  assert.equal(isSyncKey('water:' + D), true); for (const k of ['water:__proto__', 'water:', 'water:x', 'water:2026-11-14x', 'waters:2026-11-14']) assert.equal(isSyncKey(k), false, k);
});

test('W14. applyRecords for water: round trip, newer wins, older does not, an undo with a newer stamp wins, junk and hostile records change nothing', () => {
  const src = mk({ water: { [D]: { updatedAt: 170, halves: 6 }, [Y]: { updatedAt: 171, halves: 0 } } });
  const got = applyRecords(defaults(), clone(toRecords(src))); assert.deepEqual(got.water, src.water, 'round trip, including the 0 day');
  const rec = (day, halves, updatedAt, extra = {}) => ({ key: 'water:' + day, value: { water: { updatedAt, halves, ...extra } }, updatedAt });
  const local = mk({ water: { [D]: { updatedAt: 100, halves: 4 } } });
  assert.deepEqual(applyRecords(clone(local), [rec(D, 6, 200)]).water[D], { updatedAt: 200, halves: 6 });
  assert.deepEqual(applyRecords(clone(local), [rec(D, 6, 50)]).water[D], { updatedAt: 100, halves: 4 }, 'an older record does not win');
  assert.deepEqual(applyRecords(clone(local), [rec(D, 0, 300)]).water[D], { updatedAt: 300, halves: 0 }, 'an undo wins and the record is kept');
  assert.deepEqual(applyRecords(clone(local), [rec(Y, 2, 5)]).water, { [D]: { updatedAt: 100, halves: 4 }, [Y]: { updatedAt: 5, halves: 2 } }, 'other days are added');
  assert.deepEqual(applyRecords(clone(local), [rec(D, 6, 200, { evil: '<img>' })]).water[D], { updatedAt: 200, halves: 6 }, 'extra fields are dropped');
  const same = JSON.stringify(local.water);
  for (const bad of [{ updatedAt: 500, halves: 'x' }, { updatedAt: 500, halves: 99 }, { updatedAt: 500, halves: 2.5 }, { updatedAt: 500, halves: -1 }, { updatedAt: 500 }, null, 'x', 5, []]) {
    let out; assert.doesNotThrow(() => { out = applyRecords(clone(local), [{ key: 'water:' + D, value: { water: bad }, updatedAt: 500 }]); }, JSON.stringify(bad)); assert.equal(JSON.stringify(out.water), same, 'junk ' + JSON.stringify(bad));
  }
  for (const v of [null, 'x', 5, [], {}]) assert.doesNotThrow(() => applyRecords(clone(local), [{ key: 'water:' + D, value: v, updatedAt: 500 }]));
  for (const key of ['water:__proto__', 'water:2026-13-01', 'water:constructor', 'water:', 'water:x']) assert.equal(JSON.stringify(applyRecords(clone(local), [{ key, value: { water: { updatedAt: 500, halves: 4 } }, updatedAt: 500 }]).water), same, key);
  const evil = applyRecords(clone(local), [{ key: 'water:' + D, value: JSON.parse('{"water":{"updatedAt":900,"halves":2,"__proto__":{"polluted":1}}}'), updatedAt: 900 }]);
  assert.deepEqual(evil.water[D], { updatedAt: 900, halves: 2 }); assert.equal(({}).polluted, undefined);
});

test('W15. mergeStates and mergeRestore for water: same result in both orders (also on a tie), preferLocal keeps the local on a tie, union of days, hostile keys never become buckets', () => {
  const a = mk({ water: { [D]: { updatedAt: 100, halves: 4 }, [Y]: { updatedAt: 9, halves: 2 } } }), b = mk({ water: { [D]: { updatedAt: 200, halves: 6 }, '2026-11-12': { updatedAt: 1, halves: 3 } } });
  for (const [x, y] of [[a, b], [b, a]]) assert.deepEqual(mergeStates(clone(x), clone(y)).water, { [Y]: { updatedAt: 9, halves: 2 }, [D]: { updatedAt: 200, halves: 6 }, '2026-11-12': { updatedAt: 1, halves: 3 } });
  const t1 = mk({ water: { [D]: { updatedAt: 300, halves: 4 } } }), t2 = mk({ water: { [D]: { updatedAt: 300, halves: 9 } } });
  assert.deepEqual(mergeStates(clone(t1), clone(t2)).water, mergeStates(clone(t2), clone(t1)).water, 'equal stamps: the same winner whichever side is local');
  assert.deepEqual(mergeStates(clone(t1), clone(t2), { preferLocal: true }).water[D], { updatedAt: 300, halves: 4 }); assert.deepEqual(mergeStates(clone(t2), clone(t1), { preferLocal: true }).water[D], { updatedAt: 300, halves: 9 });
  const undo = mk({ water: { [D]: { updatedAt: 400, halves: 0 } } }); assert.deepEqual(mergeStates(clone(t1), clone(undo)).water[D], { updatedAt: 400, halves: 0 }); assert.deepEqual(mergeStates(clone(undo), clone(t1)).water[D], { updatedAt: 400, halves: 0 });
  const remote = { ...defaults(), water: JSON.parse('{"__proto__":{"updatedAt":9,"halves":2},"constructor":{"updatedAt":9,"halves":2},"x":{"updatedAt":9,"halves":2},"2026-13-01":{"updatedAt":9,"halves":2},"2026-11-14":{"updatedAt":1,"halves":2}}') };
  for (const [x, y] of [[a, remote], [remote, a]]) { const m = mergeStates(clone(x), clone(y)); assert.deepEqual(Object.keys(m.water).sort(), [Y, D].sort()); assert.equal(Object.getPrototypeOf(m.water), Object.prototype); assert.equal(({}).halves, undefined); assert.equal(m.water.constructor, Object); }
  const none = { ...defaults() }, noWater = { ...defaults() }; delete noWater.water; assert.deepEqual(mergeStates(clone(none), clone(noWater)).water, {}); assert.deepEqual(mergeStates(clone(noWater), clone(noWater)).water, {}, 'water is always present after a merge');
  const bk = { ...clone(defaults()), water: { [D]: { updatedAt: 300, halves: 9 }, [Y]: { updatedAt: 5, halves: 2 } } };
  const r = mergeRestore(clone(t1), bk); assert.deepEqual(r.water, { [D]: { updatedAt: 300, halves: 4 }, [Y]: { updatedAt: 5, halves: 2 } }, 'a tie keeps this device, new days are added');
  const newer = mergeRestore(clone(t1), { ...bk, water: { [D]: { updatedAt: 301, halves: 9 } } }); assert.deepEqual(newer.water[D], { updatedAt: 301, halves: 9 });
});

const settingsRec = (goals, stamp, extra = {}) => ({ key: 'settings', value: { goals, weightUnit: 'g', useUSDA: true, useOFF: true, syncApiKey: false, settingsUpdatedAt: stamp, ...extra }, updatedAt: stamp });

test('W16. settings sync: waterCups and waterTap round trip; the newer record wins whole in both orders; an old-device record keeps this device\'s values; junk is ignored', () => {
  const s = mk({ tap: 'whole', waterCups: 12 }); touchSettings(s, 170);
  const back = applyRecords(defaults(), clone(toRecords(s))); assert.equal(back.goals.waterCups, 12); assert.equal(back.waterTap, 'whole'); assert.equal(back.settingsUpdatedAt, 170);
  const a = { ...mk({ tap: 'half', waterCups: 8 }), settingsUpdatedAt: 100 }, b = { ...mk({ tap: 'whole', waterCups: 12 }), settingsUpdatedAt: 200 };
  for (const [x, y] of [[a, b], [b, a]]) { const m = mergeStates(clone(x), clone(y)); assert.equal(m.goals.waterCups, 12); assert.equal(m.waterTap, 'whole'); assert.equal(m.settingsUpdatedAt, 200); }
  const t1 = { ...mk({ tap: 'half', waterCups: 6 }), settingsUpdatedAt: 300 }, t2 = { ...mk({ tap: 'whole', waterCups: 10 }), settingsUpdatedAt: 300 };
  const m1 = mergeStates(clone(t1), clone(t2)), m2 = mergeStates(clone(t2), clone(t1)); assert.deepEqual([m1.goals.waterCups, m1.waterTap], [m2.goals.waterCups, m2.waterTap], 'equal stamps converge');
  assert.equal(applyRecords(clone(b), [settingsRec(a.goals, 100, { waterTap: 'half' })]).goals.waterCups, 12, 'an older record does not win');
  const local = { ...mk({ tap: 'whole', waterCups: 12 }), settingsUpdatedAt: 50 };
  const old = applyRecords(clone(local), [settingsRec({ k: 1800, p: 100, c: 100, f: 50, steps: 7000, sleepH: 6 }, 100)]);   // an old device: no waterTap, no waterCups
  assert.equal(old.goals.waterCups, 12, 'a record without waterCups keeps this device\'s goal'); assert.equal(old.waterTap, 'whole', 'a record without waterTap keeps this device\'s choice');
  assert.equal(old.goals.k, 1800, 'its other goals are still applied'); assert.equal(old.goals.steps, 7000); assert.equal(old.settingsUpdatedAt, 100);
  const fresh = applyRecords(clone(local), [settingsRec({ ...GOALS13, waterCups: 10 }, 100, { waterTap: 'half' })]); assert.equal(fresh.goals.waterCups, 10); assert.equal(fresh.waterTap, 'half');
  for (const bad of ['x', 5, null, {}, [], true, '', 'Whole']) assert.equal(applyRecords(clone(local), [settingsRec(GOALS13, 100, { waterTap: bad })]).waterTap, 'whole', 'waterTap ' + JSON.stringify(bad));
  for (const bad of ['x', 0, 99, -1, 7.5, null, true, [], {}]) { const g = applyRecords(clone(local), [settingsRec({ ...GOALS13, waterCups: bad }, 100)]).goals.waterCups; assert.ok(Number.isInteger(g) && g >= 1 && g <= 40, 'waterCups ' + JSON.stringify(bad) + ' left ' + g); }
  const proto = applyRecords(clone(local), [{ key: 'settings', value: JSON.parse('{"goals":{"k":1,"p":1,"c":1,"f":1,"waterCups":9},"waterTap":"half","__proto__":{"waterTap":"x","polluted":1},"settingsUpdatedAt":100}'), updatedAt: 100 }]);
  assert.equal(proto.goals.waterCups, 9); assert.equal(proto.waterTap, 'half'); assert.equal(({}).polluted, undefined); assert.equal(({}).waterTap, undefined);
  for (const bad of [null, 'x', 5, [], { waterCups: 'x' }]) assert.doesNotThrow(() => applyRecords(clone(local), [settingsRec(bad, 100)]));
});

test('W17. backup: a newer backup brings goal, tap and water; older or untimestamped keeps ours; a legacy backup keeps our goal and tap; the saved JSON carries all three', () => {
  const local = { ...mk({ tap: 'whole', waterCups: 12, water: { [Y]: { updatedAt: 5, halves: 4 } } }), settingsUpdatedAt: 100 };
  const bk = (stamp, goal, tap) => ({ ...clone(defaults()), goals: { ...defaults().goals, k: 1500, waterCups: goal }, waterTap: tap, settingsUpdatedAt: stamp, water: { [D]: { updatedAt: 9, halves: 7 } } });
  const newer = mergeRestore(clone(local), bk(500, 10, 'half')); assert.equal(newer.goals.k, 1500, 'the backup really won the settings'); assert.equal(newer.goals.waterCups, 10); assert.equal(newer.waterTap, 'half');
  assert.deepEqual(newer.water, { [Y]: { updatedAt: 5, halves: 4 }, [D]: { updatedAt: 9, halves: 7 } }, 'water days merge');
  for (const stamp of [50, 0]) { const r = mergeRestore(clone(local), bk(stamp, 10, 'half')); assert.equal(r.goals.waterCups, 12, 'stamp ' + stamp); assert.equal(r.waterTap, 'whole', 'stamp ' + stamp); }
  const legacy = bk(500, undefined, undefined); delete legacy.goals.waterCups; delete legacy.waterTap; delete legacy.water; legacy.schemaVersion = 12;
  const r = mergeRestore(clone(local), legacy); assert.equal(r.goals.k, 1500, 'the legacy backup won the settings'); assert.equal(r.goals.waterCups, 12, 'but it does not reset the goal'); assert.equal(r.waterTap, 'whole', 'or the tap mode'); assert.deepEqual(r.water, local.water, 'or the water');
  const noVersion = clone(legacy); delete noVersion.schemaVersion; assert.equal(mergeRestore(clone(local), noVersion).goals.waterCups, 12);
  for (const junk of ['x', 5, null, {}, true]) assert.equal(mergeRestore(clone(local), bk(500, 10, junk)).waterTap, 'whole', 'junk tap ' + JSON.stringify(junk));
  const st = fakeStorage(), s = createStore(st); setWater(s.state, D, 3, 11); s.state.waterTap = 'whole'; s.state.goals.waterCups = 9; s.save();
  const saved = JSON.parse(st.m.get(STORAGE_KEY)); assert.deepEqual(saved.water, { [D]: { updatedAt: 11, halves: 3 } }); assert.equal(saved.waterTap, 'whole'); assert.equal(saved.goals.waterCups, 9);
  assert.match(read('js/ui/settings-view.js'), /JSON\.stringify\(state\)/, 'Backup export is the whole state, so water travels with it');
});

// ================================================================ ui strings
const cupButtons = html => [...html.matchAll(/<button\b[^>]*\bdata-cup="([^"]*)"[^>]*>/g)].map(m => ({ tag: m[0], n: m[1], at: m.index }));
const attr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? m[1] : null; };
// the markup of cup i: from its button to the next button (or the end)
const cupMarkup = (html, i) => { const b = cupButtons(html); return html.slice(b[i].at, i + 1 < b.length ? b[i + 1].at : html.length); };

test('W18. waterHtml: title, text line, goal line, labelled group, one real button per cup in order, svg per cup, fill only on half and full, over words', () => {
  const model = wm(5, { unit: 'oz' }), html = waterHtml(model);
  assert.equal(typeof html, 'string'); assert.match(html, /\bWater\b/);
  assert.match(html, /<[a-z]+[^>]*\bid="waterText"[^>]*>\s*2\.5 of 8 cups, 20 oz\s*</); assert.match(html, /<[a-z]+[^>]*\bid="waterGoal"[^>]*>\s*Goal: 8 cups, 64 oz\s*</);
  assert.match(html, /<div[^>]*\bid="waterCups"[^>]*>/); assert.match(html, /<div[^>]*\brole="group"[^>]*\baria-label="Water cups"|<div[^>]*\baria-label="Water cups"[^>]*\brole="group"/);
  const b = cupButtons(html); assert.equal(b.length, 8); assert.deepEqual(b.map(x => x.n), ['1', '2', '3', '4', '5', '6', '7', '8']);
  b.forEach((x, i) => { assert.match(x.tag, /\btype="button"/); assert.equal(attr(x.tag, 'aria-label'), model.cups[i].label); assert.match(attr(x.tag, 'class'), new RegExp('\\bcup\\b')); assert.match(attr(x.tag, 'class'), new RegExp('\\bcup-' + model.cups[i].state + '\\b')); assert.doesNotMatch(attr(x.tag, 'class'), /\bover\b/); });
  assert.equal(count(html, '<svg'), 8); for (let i = 0; i < 8; i++) { const c = cupMarkup(html, i); assert.match(c, /<svg\b[^>]*\baria-hidden="true"/, 'cup ' + (i + 1)); assert.equal(count(c, '<svg'), 1); assert.equal(count(c, '</button>'), 1, 'the svg is inside the button'); }
  const fills = i => (cupMarkup(html, i).match(/class="[^"]*\bcup-fill\b[^"]*"/g) || []).length;
  assert.deepEqual([0, 1, 2, 3, 7].map(fills), [1, 1, 1, 0, 0], 'full, full, half have a fill; empty cups have none');
  assert.match(cupMarkup(html, 2), /var\(--water\)/); assert.match(cupMarkup(html, 0), /var\(--water\)/); assert.doesNotMatch(cupMarkup(html, 3), /--water/);
  assert.notEqual(cupMarkup(html, 0).replace(/aria-label="[^"]*"|class="[^"]*"|data-cup="\d+"/g, ''), cupMarkup(html, 2).replace(/aria-label="[^"]*"|class="[^"]*"|data-cup="\d+"/g, ''), 'a half cup is drawn differently from a full one');
  assert.doesNotMatch(html, /over goal/i, 'not over: no over words'); assert.doesNotMatch(html, /<img|<script|onclick=|onerror=/i);
  const over = waterHtml(wm(18, { unit: 'oz' })), ob = cupButtons(over); assert.equal(ob.length, 9);
  assert.match(attr(ob[8].tag, 'class'), /\bover\b/); assert.doesNotMatch(attr(ob[7].tag, 'class'), /\bover\b/); assert.equal(attr(ob[8].tag, 'aria-label'), 'Cup 9 of 9, full, over goal');
  assert.match(over, /9 of 8 cups, 72 oz, over goal/); assert.match(over, /Goal: 8 cups, 64 oz/);
  const empty = waterHtml(wm(0)); assert.equal(count(empty, 'cup-fill'), 0); assert.equal(cupButtons(empty).length, 8);
});

test('W19. waterHtml is injection safe, never prints NaN, and caps the buttons', () => {
  const hostile = { halves: 'x', goalCups: NaN, unit: '<u>', text: '<script>alert(1)</script>', goalText: '"><img src=x onerror=1>', over: 'yes',
    cups: [{ state: 'full', over: false, label: '<img src=x onerror=1>' }, { state: 'bogus', over: 1, label: 5 }, null, 'x', { state: 'half', label: '"><svg onload=1>' }, {}, undefined, 7] };
  let html; assert.doesNotThrow(() => { html = waterHtml(hostile); });
  assert.doesNotMatch(html, /<img|<script|<svg onload|onerror=1>|<u>/i, 'nothing from the model becomes markup'); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /NaN|Infinity|undefined|\[object|\bnull\b/);
  const b = cupButtons(html); b.forEach((x, i) => assert.equal(x.n, String(i + 1), 'data-cup is the position, never model data')); assert.ok(b.length <= 8);
  for (const m of [null, undefined, {}, 5, 'x', [], { cups: 'x' }, { cups: null }]) { let h; assert.doesNotThrow(() => { h = waterHtml(m); }, JSON.stringify(m)); assert.equal(typeof h, 'string'); assert.doesNotMatch(h, /NaN|Infinity|undefined|\[object|\bnull\b/, JSON.stringify(m)); assert.equal(cupButtons(h).length, 0, 'no cups in the model, no buttons: ' + JSON.stringify(m)); }
  const huge = waterHtml({ halves: 0, goalCups: 8, unit: 'oz', text: 't', goalText: 'g', over: false, cups: Array.from({ length: 1000 }, () => ({ state: 'empty', over: false, label: 'c' })) });
  assert.ok(cupButtons(huge).length <= 40, 'at most 40 buttons');
});

// ================================================================ wiring (WEAK static checks)
test('W20. index.html: #water card after #activityLine and before #meals; #gWater and #waterTap with labels and options; --water in :root and every theme, a blue', () => {
  const html = read('index.html');
  assert.equal(count(html, 'id="water"'), 1); const card = tagOf(html, 'water'); assert.match(card, /class="[^"]*\bcard\b/); assert.doesNotMatch(card, /role="button"|tabindex/);
  const iv = html.indexOf('id="v-diary"'), id = html.indexOf('id="dials"'), ia = html.indexOf('id="activityLine"'), iw = html.indexOf('id="water"'), im = html.indexOf('id="meals"');
  assert.ok(iv > -1 && iv < id && id < ia && ia < iw && iw < im, 'order: #dials, #activityLine, #water, #meals inside #v-diary');
  assert.equal(count(html, 'id="gWater"'), 1); const g = tagOf(html, 'gWater'); assert.match(g, /<input\b/); assert.match(g, /type="number"/); assert.match(g, /\bmin="1"/); assert.match(g, /\bmax="40"/); assert.match(g, /\bstep="1"/);
  assert.match(html, /<label[^>]*\bfor="gWater"[^>]*>[^<]*[Ww]ater[^<]*<\/label>/); assert.match(html, /<label[^>]*\bfor="waterTap"[^>]*>[^<]+<\/label>/);
  const sel = html.indexOf('id="waterTap"'); assert.ok(sel > -1); assert.match(tagOf(html, 'waterTap'), /<select\b/);
  const body = html.slice(sel, html.indexOf('</select>', sel)); const opts = [...body.matchAll(/<option\b[^>]*\bvalue="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(m => [m[1], m[2].trim()]);
  assert.deepEqual(opts, [['half', 'Half cups'], ['whole', 'Whole cups']]);
  for (const i of ['gK', 'gP', 'gC', 'gF', 'gSteps', 'gSleep']) assert.equal(count(html, `id="${i}"`), 1, '#' + i + ' is still there');
  const css = read('css/themes.css'), blocks = [...css.matchAll(/(:root|\[data-theme=[a-z]+\])\s*\{([^}]*)\}/g)].filter(m => /--bg:/.test(m[2]));
  assert.ok(blocks.length >= 14, 'found :root and the 13 theme palettes, got ' + blocks.length);
  for (const [, name, body2] of blocks) {
    const m = body2.match(/--water:\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/); assert.ok(m, name + ' defines --water as a hex colour');
    const hex = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1], [r, gr, bl] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    assert.ok(bl >= gr && bl > r + 30, `${name}: --water #${hex} must be a blue`);
  }
});

test('W21. wiring: diary renders the card, ui/water.js uses nextHalves + setWater + save and esc, settings-view handles both fields with touchSettings, domain stays pure', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const diary = read('js/ui/diary.js'), ui = strip(read('js/ui/water.js')), dom = strip(read('js/domain/water.js')), sv = read('js/ui/settings-view.js');
  assert.match(diary, /renderWater\(\)/); assert.match(ui, /export function waterHtml\b/); assert.match(ui, /export function renderWater\b/);
  assert.match(ui, /import\s*\{[^}]*\bnextHalves\b[^}]*\}\s*from\s*'\.\.\/domain\/water\.js'/); assert.match(ui, /import\s*\{[^}]*\bsetWater\b[^}]*\}\s*from\s*'\.\.\/domain\/entries\.js'/);
  assert.match(ui, /setWater\(/); assert.match(ui, /\bsave\(/); assert.match(ui, /\besc\b/); assert.match(ui, /data-cup/); assert.match(ui, /\bfocus\(/);
  assert.doesNotMatch(ui, /state\.water\s*(\[[^\]]*\]|\.[A-Za-z_$]+)\s*=[^=]/, 'the record is written through setWater, never by hand');
  assert.doesNotMatch(ui, /from\s+'\.\.\/services\//); assert.doesNotMatch(ui, /insertAdjacentHTML|document\.write|\beval\b|new Function|outerHTML\s*=/);
  for (const m of ui.matchAll(/\.innerHTML\s*=\s*([^;\n]+)/g)) assert.match(m[1], /waterHtml\(/, 'innerHTML is assigned only from waterHtml(): ' + m[1]);
  for (const w of ['gWater', 'waterTap', 'waterCups', 'touchSettings']) assert.ok(sv.includes(w), w + ' appears in settings-view.js');
  for (const m of dom.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^(\.\/[a-z0-9-]+\.js|\.\.\/core\/(constants|format|dates|schema)\.js)$/, 'domain/water.js may not import ' + m[1]);
  assert.doesNotMatch(dom, /\b(document|window|localStorage|sessionStorage|fetch|navigator|globalThis)\b/, 'domain/water.js must stay pure');
  for (const f of ['waterModel', 'nextHalves']) assert.match(dom, new RegExp('export (function|const) ' + f + '\\b'));
  const sch = strip(read('js/core/schema.js')); for (const f of ['DEFAULT_WATER_CUPS', 'sanitizeWaterCups', 'sanitizeWaterTap', 'sanitizeWaterDay']) assert.match(sch, new RegExp('export (function|const) ' + f + '\\b'));
  assert.match(strip(read('js/domain/entries.js')), /export (function|const) setWater\b/); assert.match(read('js/domain/sync-records.js'), /water/); assert.match(read('js/domain/merge.js'), /water/);
});

test('W22. shipping: both new files in SHELL, CACHE bumped above 63 (the value on this branch when written; never an exact number), decision D58 and architecture notes', () => {
  const sw = read('sw.js');
  const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of ['js/domain/water.js', 'js/ui/water.js', 'js/core/schema.js', 'index.html', 'css/themes.css']) assert.ok(shell.includes(f), f + ' must be in SHELL');
  const cache = Number(sw.match(/const CACHE = 'macro-diary-v(\d+)'/)[1]); assert.ok(cache > 63, 'CACHE must be bumped above 63, is ' + cache);
  const dec = read('docs/DECISIONS.md'), at = dec.search(/^## D58\./m); assert.ok(at > -1, 'DECISIONS.md needs ## D58.');
  const sec = dec.slice(at, (dec.indexOf('\n## D', at + 5) + 1 || dec.length)); assert.match(sec, /water/i); assert.match(sec, /\b13\b/); assert.match(sec, /half/i); assert.match(sec, /sync/i);
  assert.match(read('docs/ARCHITECTURE.md'), /water\.js/);
});
