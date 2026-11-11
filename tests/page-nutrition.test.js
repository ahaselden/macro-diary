// Tests for docs/specs/page-nutrition.md (schema v6, recipeNutrition source, plan/autoplan, importer nutrition + servings from yield).
// Written before the implementation exists. Every golden value is hand computed (see comments); modules that do not exist yet
// are imported dynamically so each test fails on its own. Titles carry the behaviour number (N1..N38).
// All recipes and sites here are INVENTED (reserved domains); no third-party recipe text is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { defaults, migrate, sanitize, sanitizeRecipe, SCHEMA_VERSION } from '../js/core/schema.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { newRecipe } from '../js/domain/recipes.js';
import { addPlanItem, recipeItem, itemNutrition, dayNutrition, logItem, logDay, monthSummary } from '../js/domain/plan.js';
import { mergeRestore } from '../js/domain/backup.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { clone } from './helpers.js';

const rn = () => import('../js/domain/recipes.js');
const imp = () => import('../js/domain/recipe-import.js');
const ap = () => import('../js/domain/autoplan.js');
const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b}`);
const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/site-corpus/${name}`, import.meta.url), 'utf8'));

const NOTE = 'Calories and macros come from the page (per serving), so treat them as an estimate: link foods to replace them.';
const ST = { k: 336, p: 31.8, c: 46.7, f: 3.7, per: '1.5 cups' };
const food = (k, p, c, f) => ({ name: 'F', brand: '', source: 'custom', per100: { k, p, c, f }, servingG: 0, servingLabel: '' });
// 400 g flour (100 kcal, 5 p, 20 c, 1 f per 100 g) -> total 400/20/80/4
const flour = () => ({ id: 'i1', raw: '400 g flour', name: 'flour', qty: 400, unit: 'g', prep: '', food: food(100, 5, 20, 1), grams: 400 });
const onion = (linked = false) => ({ id: 'i2', raw: '1 onion', name: 'onion', qty: 1, unit: '', prep: '', food: linked ? food(40, 1, 9, 0) : null, grams: linked ? 100 : null });
const rec = (over = {}) => ({ id: 'r1', name: 'Stew', description: '', source: '', servings: 4, totalTime: null, tags: [], steps: [], ingredients: [flour(), onion()], favorite: false, stated: null, updatedAt: 1, ...over });
const WEIRD = [null, undefined, true, false, 5, 0, -1, NaN, Infinity, 'x', '', '300', [], [1], {}, { k: 1 }, () => 1];

// ---- schema v6 --------------------------------------------------------------------------------------------------

test('N1 SCHEMA_VERSION is 6, defaults() carries it, STORAGE_KEY is unchanged', () => {
  assert.equal(SCHEMA_VERSION, 6);
  assert.equal(defaults().schemaVersion, 6);
  assert.equal(STORAGE_KEY, 'macrodiary.v1');
});

test('N2 migrate v5 -> v6: recipes without `stated` load with stated null and NOTHING else changes', () => {
  const r1 = { id: 'r1', name: 'Chili', description: 'd', source: 'https://example.test/c', servings: 6, totalTime: 30, tags: ['a'], steps: ['x'], favorite: true, updatedAt: 777,
    ingredients: [{ id: 'i1', raw: '1 cup beans', name: 'beans', qty: 1, unit: 'cup', prep: '', food: { name: 'Beans', brand: '', source: 'custom', per100: { k: 90, p: 6, c: 16, f: 1 }, servingG: 0, servingLabel: '' }, grams: 180 }] };
  const day = { updatedAt: 5, slots: { Breakfast: [], Lunch: [{ id: 'p1', type: 'recipe', recipeId: 'r1', name: '', servings: 2, food: null, grams: null, entryId: '' }], Dinner: [], Snacks: [] } };
  const old = { schemaVersion: 5, recipes: { r1: clone(r1) }, plan: { '2025-01-06': clone(day) }, shopping: { checks: {}, extras: {} }, tombstones: { gone: 5 }, days: { '2025-01-01': [] }, goals: { k: 1800, p: 100, c: 150, f: 50 } };
  const d = migrate(clone(old));
  assert.equal(d.schemaVersion, 6);
  assert.deepEqual(d.recipes.r1, { ...r1, stated: null });
  assert.equal(d.recipes.r1.updatedAt, 777, 'migration must not re-stamp the recipe');
  assert.deepEqual(d.plan['2025-01-06'], day);
  assert.deepEqual(d.tombstones, { gone: 5 });
  assert.deepEqual(d.goals, old.goals);
  assert.deepEqual(d.days, old.days);
  for (const v of [undefined, 1, 2, 3, 4]) assert.equal(migrate({ ...(v ? { schemaVersion: v } : {}), recipes: { a: { name: 'x' } } }).schemaVersion, 6, `from ${v}`);
  assert.equal(migrate({ schemaVersion: 4, recipes: { a: { name: 'x' } } }).recipes.a.stated, null);
});

test('N3 sanitizeRecipe keeps a valid `stated` exactly, including the bounds and an empty or 40-char `per`', () => {
  const ok = [ST, { k: 0, p: 0, c: 0, f: 0, per: '' }, { k: 20000, p: 5000, c: 5000, f: 5000, per: 'x'.repeat(40) }, { k: 0.5, p: 0.25, c: 0.1, f: 0.05, per: '1 cookie' }];
  for (const s of ok) assert.deepEqual(sanitizeRecipe({ name: 'x', stated: clone(s) }, 'r').stated, s, JSON.stringify(s));
  assert.deepEqual(Object.keys(sanitizeRecipe({ name: 'x' }, 'r')).sort(), ['description', 'favorite', 'id', 'ingredients', 'name', 'servings', 'source', 'stated', 'steps', 'tags', 'totalTime', 'updatedAt']);
  assert.equal(sanitizeRecipe({ name: '', stated: ST }, 'r'), null, 'a nameless recipe is still rejected');
  assert.deepEqual(sanitize({ recipes: { a: { name: 'x', stated: clone(ST) } } }).recipes.a.stated, ST);
  const src = clone(ST); sanitizeRecipe({ name: 'x', stated: src }, 'r'); assert.deepEqual(src, ST, 'input not mutated');
});

test('N4 sanitizeRecipe: missing or invalid `stated` becomes null (never undefined, never a half-valid object)', () => {
  assert.strictEqual(sanitizeRecipe({ name: 'x' }, 'r').stated, null);
  const bad = [...WEIRD, { ...ST, k: NaN }, { ...ST, k: Infinity }, { ...ST, k: -1 }, { ...ST, k: 20001 }, { ...ST, k: 1e308 }, { ...ST, p: -0.1 }, { ...ST, p: 5001 },
    { ...ST, c: 5001 }, { ...ST, f: -5 }, { ...ST, k: {} }, { ...ST, k: [336] }, { ...ST, k: null }, { ...ST, k: true }, { ...ST, p: undefined }, { ...ST, per: 5 }, { ...ST, per: {} }, { ...ST, per: null },
    { ...ST, extra: 1 }, { k: 100, p: 1, c: 1 }, { p: 1, c: 1, f: 1, per: '' },
    JSON.parse('{"k":100,"p":1,"c":1,"f":1,"per":"","__proto__":{"k":1}}'), JSON.parse('{"__proto__":{"k":100,"p":1,"c":1,"f":1,"per":""}}')];
  for (const b of bad) assert.strictEqual(sanitizeRecipe({ name: 'x', stated: b }, 'r').stated, null, String(JSON.stringify(b)));
  assert.equal({}.k, undefined); assert.equal(Object.prototype.k, undefined);
});

test('N5 newRecipe has stated: null', () => {
  assert.strictEqual(newRecipe('r1', 5).stated, null);
  assert.deepEqual(newRecipe('r1', 5), { id: 'r1', name: '', description: '', source: '', servings: 4, totalTime: null, tags: [], steps: [], ingredients: [], favorite: false, stated: null, updatedAt: 5 });
});

test('N6 backup restore: `stated` survives a restore, an old (v5) backup restores with null, a hostile one is dropped', () => {
  const bk = { schemaVersion: 6, days: {}, plan: {}, shopping: { checks: {}, extras: {} }, recipes: { r1: { name: 'A', servings: 2, updatedAt: 9, stated: clone(ST) }, r2: { name: 'B', updatedAt: 9, stated: { ...clone(ST), k: 1e9 } },
    r3: { name: 'C', updatedAt: 9, stated: 'lots' }, r4: { name: 'D', updatedAt: 9, stated: { ...clone(ST), x: 1 } } } };
  const m = mergeRestore(defaults(), JSON.parse(JSON.stringify(bk))).recipes;
  assert.deepEqual(m.r1.stated, ST);
  for (const id of ['r2', 'r3', 'r4']) assert.strictEqual(m[id].stated, null, id);
  const old = { schemaVersion: 5, days: {}, recipes: { r1: { name: 'Old', description: 'd', source: '', servings: 2, totalTime: null, tags: ['t'], steps: ['s'], ingredients: [], favorite: false, updatedAt: 9 } }, plan: {}, shopping: { checks: {}, extras: {} } };
  assert.deepEqual(mergeRestore(defaults(), old).recipes.r1, { id: 'r1', name: 'Old', description: 'd', source: '', servings: 2, totalTime: null, tags: ['t'], steps: ['s'], ingredients: [], favorite: false, stated: null, updatedAt: 9 });
});

test('N7 sync records: a recipe record round-trips with `stated`; a hostile `stated` in a record is dropped to null', () => {
  const s = defaults(); s.recipes.r1 = rec({ updatedAt: 7, stated: clone(ST), ingredients: [] }); s.recipes.r2 = rec({ id: 'r2', updatedAt: 8, ingredients: [] });
  const wire = JSON.parse(JSON.stringify(toRecords(s)));
  const back = applyRecords(defaults(), wire);
  assert.deepEqual(back.recipes.r1.stated, ST);
  assert.strictEqual(back.recipes.r2.stated, null);
  for (const bad of [{ ...ST, k: NaN }, { ...ST, k: -5 }, { ...ST, k: 1e9 }, 'x', 5, [ST], { ...ST, hack: '<img onerror=1>' }, { ...ST, p: 'lots' }]) {
    const out = applyRecords(defaults(), [{ key: 'recipe:z', value: { recipe: { name: 'Z', updatedAt: 3, stated: bad } }, updatedAt: 3 }]);
    assert.ok(out.recipes.z, 'the recipe itself still arrives');
    assert.strictEqual(out.recipes.z.stated, null, JSON.stringify(bad));
  }
});

// ---- recipeNutrition --------------------------------------------------------------------------------------------

test('N8 recipeNutrition WITHOUT stated is unchanged and reports source and estimated (foods / none)', async () => {
  const { recipeNutrition } = await rn();
  const partial = recipeNutrition(rec());                               // flour linked, onion not
  assert.equal(partial.source, 'foods'); assert.strictEqual(partial.estimated, false);
  assert.equal(partial.linked, 1); assert.equal(partial.count, 2); assert.equal(partial.complete, false); assert.deepEqual(partial.missing, ['onion']); assert.equal(partial.totalGrams, 400);
  assert.deepEqual(partial.total, { k: 400, p: 20, c: 80, f: 4 });
  assert.deepEqual(partial.perServing, { k: 100, p: 5, c: 20, f: 1 });
  const full = recipeNutrition(rec({ ingredients: [flour(), onion(true)] }));
  assert.equal(full.source, 'foods'); assert.strictEqual(full.estimated, false); assert.equal(full.complete, true);
  assert.deepEqual(full.total, { k: 440, p: 21, c: 89, f: 4 });
  assert.deepEqual(full.perServing, { k: 110, p: 5.25, c: 22.25, f: 1 });
  const none = recipeNutrition(rec({ ingredients: [onion()] }));
  assert.equal(none.source, 'none'); assert.strictEqual(none.estimated, false); assert.equal(none.linked, 0); assert.equal(none.complete, false);
  assert.equal(recipeNutrition(rec({ ingredients: [] })).source, 'none');
  const noField = rec(); delete noField.stated;
  assert.equal(recipeNutrition(noField).source, 'foods', 'a recipe object with no `stated` property at all (old data) behaves like null');
  assert.equal(recipeNutrition({ ...rec(), stated: undefined }).source, 'foods');
});

test('N9 recipeNutrition with stated and nothing linked: source stated, per serving = the page numbers, total = per serving x servings', async () => {
  const { recipeNutrition } = await rn();
  const n = recipeNutrition(rec({ servings: 4, ingredients: [onion(), { ...onion(), id: 'i3', name: 'carrot', raw: '2 carrots' }], stated: clone(ST) }));
  assert.equal(n.source, 'stated'); assert.strictEqual(n.estimated, true); assert.strictEqual(n.complete, true);
  assert.deepEqual(n.perServing, { k: 336, p: 31.8, c: 46.7, f: 3.7 });
  close(n.total.k, 1344); close(n.total.p, 127.2); close(n.total.c, 186.8); close(n.total.f, 14.8);
  assert.deepEqual(Object.keys(n.perServing).sort(), ['c', 'f', 'k', 'p']); assert.deepEqual(Object.keys(n.total).sort(), ['c', 'f', 'k', 'p']);
  assert.equal(n.linked, 0); assert.equal(n.count, 2); assert.deepEqual(n.missing, ['onion', 'carrot']); assert.equal(n.totalGrams, 0);
  const frac = recipeNutrition(rec({ servings: 2.5, ingredients: [], stated: { k: 200, p: 10, c: 20, f: 8, per: '' } }));
  close(frac.total.k, 500); close(frac.total.f, 20); assert.equal(frac.perServing.k, 200);
});

test('N10 stated with servings 0, negative, missing or garbage uses 1 serving (finite numbers only)', async () => {
  const { recipeNutrition } = await rn();
  for (const sv of [0, -3, NaN, undefined, null, 'many']) {
    const n = recipeNutrition(rec({ servings: sv, ingredients: [], stated: { k: 200, p: 10, c: 20, f: 8, per: '' } }));
    assert.equal(n.perServing.k, 200, String(sv)); assert.equal(n.total.k, 200, String(sv)); assert.equal(n.source, 'stated');
  }
});

test('N11 stated + PARTLY linked: stated numbers are used, linked/count/missing/totalGrams are still the foods numbers', async () => {
  const { recipeNutrition } = await rn();
  const n = recipeNutrition(rec({ stated: clone(ST) }));          // flour linked (400 g), onion not
  assert.equal(n.source, 'stated'); assert.strictEqual(n.estimated, true); assert.strictEqual(n.complete, true);
  assert.deepEqual(n.perServing, { k: 336, p: 31.8, c: 46.7, f: 3.7 });
  assert.equal(n.linked, 1); assert.equal(n.count, 2); assert.deepEqual(n.missing, ['onion']); assert.equal(n.totalGrams, 400);
});

test('N12 stated + ALL ingredients linked: linked foods win (source foods, not estimated, foods numbers)', async () => {
  const { recipeNutrition } = await rn();
  const n = recipeNutrition(rec({ ingredients: [flour(), onion(true)], stated: { k: 999, p: 99, c: 99, f: 99, per: 'x' } }));
  assert.equal(n.source, 'foods'); assert.strictEqual(n.estimated, false); assert.equal(n.complete, true);
  assert.deepEqual(n.perServing, { k: 110, p: 5.25, c: 22.25, f: 1 }); assert.deepEqual(n.total, { k: 440, p: 21, c: 89, f: 4 });
  const ign = recipeNutrition(rec({ ingredients: [flour(), { ...onion(), name: 'salt', raw: 'salt', unit: '' }], stated: clone(ST) }));
  assert.equal(ign.source, 'foods', 'an ignorable (salt) unlinked ingredient does not stop the foods from being complete');
});

test('N13 stated on a recipe with NO ingredients is used (manual entry); invalid stated is ignored like absent', async () => {
  const { recipeNutrition } = await rn();
  const n = recipeNutrition(rec({ ingredients: [], stated: clone(ST) }));
  assert.equal(n.source, 'stated'); assert.equal(n.perServing.k, 336); assert.equal(n.count, 0); assert.strictEqual(n.complete, true);
  for (const bad of [...WEIRD, { ...ST, k: NaN }, { ...ST, k: -1 }, { ...ST, k: 20001 }, { ...ST, p: 5001 }, { k: 1, p: 1, c: 1 }, { ...ST, per: 5 }]) {
    const x = recipeNutrition(rec({ ingredients: [onion()], stated: bad }));
    assert.equal(x.source, 'none', JSON.stringify(bad)); assert.strictEqual(x.estimated, false); assert.equal(x.perServing.k, 0);
  }
});

test('N14 recipeNutrition with stated never throws, never mutates, and returns fresh numbers objects', async () => {
  const { recipeNutrition } = await rn();
  for (const r of [null, undefined, {}, { stated: clone(ST) }, { servings: 'x', stated: clone(ST) }, { ingredients: undefined, stated: clone(ST), servings: -1 }, { ingredients: [], stated: Object.create(ST) }]) {
    let n; assert.doesNotThrow(() => { n = recipeNutrition(r); }, String(JSON.stringify(r)));
    assert.ok(['foods', 'stated', 'none'].includes(n.source)); assert.equal(typeof n.estimated, 'boolean');
    for (const v of [n.perServing.k, n.perServing.p, n.perServing.c, n.perServing.f, n.total.k]) assert.ok(Number.isFinite(v));
  }
  assert.equal(recipeNutrition({ stated: clone(ST) }).source, 'stated');
  assert.equal(recipeNutrition(null).source, 'none');
  const r = rec({ ingredients: [], stated: clone(ST) });
  const frozen = JSON.stringify(r);
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  const n = recipeNutrition(deepFreeze(r));
  assert.equal(JSON.stringify(r), frozen);
  const m = recipeNutrition(rec({ ingredients: [], stated: clone(ST) })); m.perServing.k = -1; m.total.k = -1;
  const again = rec({ ingredients: [], stated: clone(ST) }); recipeNutrition(again).perServing.k = -1;
  assert.equal(again.stated.k, 336, 'changing the result cannot change the recipe');
  assert.equal(n.perServing.k, 336);
});

// ---- plan.js ----------------------------------------------------------------------------------------------------

const stateWith = (...recipes) => { const s = defaults(); for (const r of recipes) s.recipes[r.id] = r; return s; };
const statedRec = (over = {}) => rec({ id: 's1', name: 'Page stew', servings: 2, ingredients: [onion()], stated: { k: 300, p: 20, c: 30, f: 10, per: '1 bowl' }, ...over });
let n = 0; const idGen = () => 'id' + (++n);

test('N15 plan.itemNutrition of a stated recipe: perServing x item servings, complete true, estimated true; foods recipes estimated false', () => {
  const s = stateWith(statedRec(), rec());
  const a = itemNutrition(s, recipeItem('a', 's1', 2));
  assert.deepEqual([a.k, a.p, a.c, a.f], [600, 40, 60, 20]); assert.strictEqual(a.complete, true); assert.strictEqual(a.estimated, true); assert.equal(a.name, 'Page stew');
  const b = itemNutrition(s, recipeItem('b', 'r1', 1));            // foods, partial: 100 kcal per serving, incomplete
  assert.equal(b.k, 100); assert.strictEqual(b.complete, false); assert.strictEqual(b.estimated, false);
  const c = itemNutrition(s, recipeItem('c', 'gone', 1));
  assert.strictEqual(c.complete, false); assert.ok(!c.estimated);
});

test('N16 dayNutrition and monthSummary count a stated recipe and treat it as complete', () => {
  const s = stateWith(statedRec());
  addPlanItem(s, '2025-11-20', 'Lunch', recipeItem('a', 's1', 1.5), 1);     // 300 x 1.5 = 450
  const d = dayNutrition(s, '2025-11-20');
  assert.equal(d.total.k, 450); assert.equal(d.complete, true); assert.equal(d.items, 1);
  const m = monthSummary(s, '2025-11-20')['2025-11-20'];
  assert.equal(m.k, 450); assert.equal(m.complete, true); assert.equal(m.items, 1);
});

test('N17 logging a stated recipe with nothing linked makes a diary entry (per100 from a 100 g serving); idempotent', () => {
  const s = stateWith(statedRec());
  addPlanItem(s, '2025-11-20', 'Dinner', recipeItem('a', 's1', 2), 1);
  const e = logItem(s, '2025-11-20', 'Dinner', 'a', 50, idGen);
  assert.ok(e, 'an entry is created');
  assert.deepEqual(e.per100, { k: 300, p: 20, c: 30, f: 10 }); assert.equal(e.servingG, 100); assert.equal(e.grams, 200); assert.equal(e.amount, 2);
  assert.equal(e.source, 'Recipe'); assert.equal(e.name, 'Page stew'); assert.equal(e.meal, 'Dinner'); assert.equal(e.disp, '2 servings'); assert.equal(e.servingLabel, '1 serving');
  close(e.per100.k * e.grams / 100, 600);                                   // what the diary will count: 2 x 300
  assert.equal(s.days['2025-11-20'].length, 1); assert.equal(s.plan['2025-11-20'].slots.Dinner[0].entryId, e.id);
  assert.equal(logItem(s, '2025-11-20', 'Dinner', 'a', 60, idGen), null, 'second log is a no-op');
  assert.equal(s.days['2025-11-20'].length, 1);
});

test('N18 logging a stated recipe that is partly linked logs the STATED calories per serving', () => {
  const s = stateWith(rec({ id: 'p1', servings: 4, stated: clone(ST) }));      // flour linked (100 kcal/serving by foods), stated says 336
  addPlanItem(s, '2025-11-20', 'Lunch', recipeItem('a', 'p1', 1.5), 1);
  const e = logItem(s, '2025-11-20', 'Lunch', 'a', 50, idGen);
  assert.ok(e);
  close(e.per100.k * e.grams / 100, 504, 1e-6);                                // 336 x 1.5
  close(e.per100.p * e.grams / 100, 31.8 * 1.5, 1e-6);
});

test('N19 recipes with no linked food and no stated still cannot be logged; logDay counts stated ones', () => {
  const s = stateWith(statedRec(), rec({ id: 'n1', ingredients: [onion()], name: 'Nothing' }));
  addPlanItem(s, '2025-11-21', 'Lunch', recipeItem('a', 'n1', 1), 1);
  addPlanItem(s, '2025-11-21', 'Dinner', recipeItem('b', 's1', 1), 1);
  assert.equal(logItem(s, '2025-11-21', 'Lunch', 'a', 5, idGen), null);
  assert.equal(logDay(s, '2025-11-21', 6, idGen), 1);
  assert.equal(s.days['2025-11-21'].length, 1);
  assert.equal(s.days['2025-11-21'][0].name, 'Page stew');
});

// ---- autoplan ---------------------------------------------------------------------------------------------------

const D0 = '2025-11-17';
test('N20 auto-fill proposes a stated recipe, using the stated kcal and counting it as complete', async () => {
  const { proposePlan } = await ap();
  // stated 280 kcal/serving; the foods would say 100 kcal (flour 400 g / 4 servings): target 600 -> proposed at exactly 1 serving (owner decision 2026-11-11; the old rule gave 2)
  const s = stateWith(rec({ id: 'a', servings: 4, stated: { k: 280, p: 1, c: 1, f: 1, per: '' } })); s.goals.k = 600;
  const p = proposePlan(s, { dates: [D0], slots: ['Lunch'] });
  const x = p.days[D0] && p.days[D0].Lunch && p.days[D0].Lunch[0];
  assert.ok(x, 'a stated recipe is a candidate without includeIncomplete');
  assert.equal(x.recipeId, 'a'); assert.equal(x.servings, 1); assert.equal(x.complete, true);
  const onlyStated = stateWith(statedRec({ id: 'z', ingredients: [] })); onlyStated.goals.k = 300;
  assert.equal(proposePlan(onlyStated, { dates: [D0], slots: ['Lunch'] }).days[D0].Lunch[0].recipeId, 'z');
});

test('N21 auto-fill still ignores recipes with neither linked foods nor stated, even with includeIncomplete', async () => {
  const { proposePlan } = await ap();
  const s = stateWith(rec({ id: 'n', ingredients: [onion()] })); s.goals.k = 600;
  for (const o of [{}, { includeIncomplete: true }]) {
    const p = proposePlan(s, { dates: [D0], slots: ['Lunch'], ...o });
    assert.deepEqual(p.days, {}); assert.ok(p.notes.length >= 1);
  }
  const bad = stateWith(rec({ id: 'b', ingredients: [onion()], stated: { k: NaN, p: 1, c: 1, f: 1, per: '' } })); bad.goals.k = 600;
  assert.deepEqual(proposePlan(bad, { dates: [D0], slots: ['Lunch'] }).days, {});
});

// ---- importer: nutrition ----------------------------------------------------------------------------------------

const fromLd = async node => (await imp()).importFromJsonLd(node);
const node = (extra = {}) => ({ '@type': 'Recipe', name: 'T', recipeYield: '4 servings', recipeIngredient: ['1 egg'], recipeInstructions: ['Cook.'], ...extra });
const nutOf = async (nutrition, extra) => (await fromLd(node({ nutrition, ...extra }))).nutrition;
const KEYS = ['description', 'ingredients', 'name', 'nutrition', 'servings', 'steps', 'tags', 'totalTime', 'warnings'];
const hasW = (r, re) => r.warnings.some(w => re.test(w));
const ALL = { calories: '300', proteinContent: '20 g', carbohydrateContent: '30 g', fatContent: '10 g' };

test('N22 the import result has a `nutrition` key (null when the page has none) on all three routes and on empty input', async () => {
  const m = await imp();
  const r = m.importFromJsonLd(node());
  assert.deepEqual(Object.keys(r).sort(), KEYS); assert.strictEqual(r.nutrition, null);
  assert.deepEqual(r.warnings, [], 'a complete recipe with no nutrition has no warnings');
  for (const bad of [null, undefined, 'x', 42, [], {}]) { const x = m.importFromJsonLd(bad); assert.deepEqual(Object.keys(x).sort(), KEYS); assert.strictEqual(x.nutrition, null); }
  for (const bad of ['', undefined, null, 42, 'Ingredients', 'Pie\nIngredients\n- 1 egg\nMethod\n1. Cook.']) { const x = m.importFromText(bad); assert.deepEqual(Object.keys(x).sort(), KEYS); assert.strictEqual(x.nutrition, null); }
  assert.strictEqual(m.importFromHtml(`<script type="application/ld+json">${JSON.stringify(node())}</script>`).nutrition, null);
});

test('N23 calories: plain numbers, "calories", "kcal", "cal", thousands comma and surrounding space are accepted', async () => {
  const table = [['336', 336], ['434 calories', 434], ['172 kcal', 172], ['1,200 kcal', 1200], ['336 cal', 336], ['336 Calories', 336], ['336 KCAL', 336], ['  336  ', 336], ['336.5', 336.5], ['20000', 20000]];
  for (const [text, k] of table) assert.deepEqual(await nutOf({ calories: text }), { k, p: 0, c: 0, f: 0, per: '' }, text);
});

test('N24 calories are REQUIRED: no value, a kJ-only value, junk, out-of-bounds or wrong-typed values give nutrition null', async () => {
  const bad = ['1400 kJ', '1,400 KJ', '1400 kj', '', '   ', 'lots', 'kcal', 'NaN', 'Infinity', '1e999', '-336', '12 apples', 'about 300 kcal', 'x336', '20001', '99999999999', '3 4', null, true, {}, [], ['336'], { a: 1 }, { toString() { throw new Error('boom'); } }];
  for (const b of bad) assert.strictEqual(await nutOf({ ...ALL, calories: b }), null, String(typeof b === 'object' ? JSON.stringify(b) : b));
  assert.strictEqual(await nutOf({ proteinContent: '20 g', carbohydrateContent: '30 g', fatContent: '10 g' }), null, 'macros without calories');
  assert.strictEqual(await nutOf({ '@type': 'NutritionInformation', servingSize: '1 cup' }), null);
});

test('N25 macros: grams with or without the unit, decimals, mg converted to grams; bare numbers are grams', async () => {
  const fields = [['proteinContent', 'p'], ['carbohydrateContent', 'c'], ['fatContent', 'f']];
  const table = [['31.8g', 31.8], ['80', 80], ['3.7 g', 3.7], ['250 mg', 0.25], ['0 g', 0], ['0', 0], ['12 G', 12], ['0.5g', 0.5], ['5000', 5000], ['  7  ', 7]];
  for (const [field, key] of fields) for (const [text, g] of table) {
    const out = await nutOf({ calories: '300', [field]: text });
    assert.equal(out.k, 300); assert.equal(out[key], g, `${field} ${text}`);
    for (const [, other] of fields) if (other !== key) assert.equal(out[other], 0, `${field} ${text}: ${other} not listed -> 0`);
  }
  assert.deepEqual(await nutOf({ '@type': 'NutritionInformation', calories: '336', fatContent: '3.7g', carbohydrateContent: '46.7g', proteinContent: '31.8g', servingSize: '1.5 cups' }), { k: 336, p: 31.8, c: 46.7, f: 3.7, per: '1.5 cups' });
  assert.deepEqual(Object.keys(await nutOf(ALL)), ['k', 'p', 'c', 'f', 'per'], 'key order is fixed (goldens compare serialised JSON)');
});

test('N26 a missing or unusable macro becomes 0 and a warning says WHICH macros were not listed', async () => {
  const full = await fromLd(node({ nutrition: ALL }));
  const extra = r => r.warnings.filter(w => !full.warnings.includes(w));
  const onlyP = await fromLd(node({ nutrition: { calories: '300', proteinContent: '20 g' } }));
  assert.deepEqual(onlyP.nutrition, { k: 300, p: 20, c: 0, f: 0, per: '' });
  const e1 = extra(onlyP);
  assert.ok(e1.some(w => /carb/i.test(w) && /fat/i.test(w)), e1.join(' | ')); assert.ok(!e1.some(w => /protein/i.test(w)), 'protein WAS listed');
  const onlyK = extra(await fromLd(node({ nutrition: { calories: '300' } })));
  assert.ok(onlyK.some(w => /protein/i.test(w) && /carb/i.test(w) && /fat/i.test(w)), onlyK.join(' | '));
  const junkFat = await fromLd(node({ nutrition: { ...ALL, fatContent: 'a lot', carbohydrateContent: ['x'] } }));
  assert.deepEqual(junkFat.nutrition, { k: 300, p: 20, c: 0, f: 0, per: '' });
  const e3 = extra(junkFat);
  assert.ok(e3.some(w => /fat/i.test(w) && /carb/i.test(w)), e3.join(' | ')); assert.ok(!e3.some(w => /protein/i.test(w)));
  assert.equal(new Set(onlyP.warnings).size, onlyP.warnings.length, 'no duplicate warnings');
});

test('N27 warnings: when nutrition IS used the plain note appears (exact text); listed-but-unusable keeps a nutrition warning; empty adds none', async () => {
  const full = await fromLd(node({ nutrition: ALL }));
  assert.deepEqual(full.warnings, [NOTE]);
  assert.match(NOTE, /come from the page/); assert.match(NOTE, /link foods/);
  const partial = await fromLd(node({ nutrition: { calories: '300' } }));
  assert.equal(partial.warnings.length, 2, 'the note plus ONE warning about the macros that were not listed');
  assert.ok(partial.warnings.includes(NOTE));
  for (const unusable of [{ calories: 'lots' }, { calories: '1400 kJ', proteinContent: '5 g' }, 'high in protein', { calories: '' }]) {
    const r = await fromLd(node({ nutrition: unusable }));
    assert.strictEqual(r.nutrition, null);
    assert.ok(hasW(r, /nutrition/i), `listed but unusable is reported: ${JSON.stringify(unusable)}`);
    assert.ok(!r.warnings.includes(NOTE) && !hasW(r, /come from the page/i));
  }
  for (const none of [undefined, {}, null, '', '  ']) {
    const r = await fromLd(node({ nutrition: none }));
    assert.strictEqual(r.nutrition, null); assert.ok(!hasW(r, /nutrition/i) && !hasW(r, /come from the page/i), JSON.stringify(none));
  }
  assert.ok(!full.warnings.some(w => /not imported/i.test(w)), 'the old "not imported" warning is gone');
});

test('N28 `per` is the page serving text: cleaned like other text, cut to 40 characters, empty when absent or not a string', async () => {
  const per = async servingSize => (await nutOf({ calories: '300', servingSize })).per;
  assert.equal(await per('1.5 cups'), '1.5 cups');
  assert.equal(await per('  12   Wings '), '12 Wings');
  assert.equal(await per('<b>12</b> Wings &amp; fries'), '12 Wings & fries');
  assert.equal(await per('x'.repeat(100)), 'x'.repeat(40));
  assert.equal(await per('y'.repeat(40)), 'y'.repeat(40));
  for (const bad of [undefined, null, 5, {}, [], ['1 cup'], true]) assert.equal(await per(bad), '', String(JSON.stringify(bad)));
  const stuff = await per('<img src=x onerror=alert(1)>1 cup');
  assert.ok(!/[<>]/.test(stuff), stuff);
});

test('N29 hostile nutrition: huge or non-finite numbers, objects, arrays, __proto__, inherited fields, cycles, giant strings', async () => {
  const inBounds = o => o === null || (o.k >= 0 && o.k <= 20000 && [o.p, o.c, o.f].every(v => Number.isFinite(v) && v >= 0 && v <= 5000) && typeof o.per === 'string' && o.per.length <= 40
    && Object.keys(o).join() === 'k,p,c,f,per');
  for (const v of ['1e999', 'calories: 1e999', '9'.repeat(400), '-1', '1e308', 'NaN', 'Infinity', '-Infinity', '0x10', '1_000', '１２３', '12\u0000', '<b>300</b> kcal<script>', 'x'.repeat(1e6), '1'.repeat(1e6)]) {
    for (const field of ['proteinContent', 'carbohydrateContent', 'fatContent']) assert.ok(inBounds(await nutOf({ calories: '300', [field]: v })), `${field}=${v.slice(0, 20)}`);
    assert.ok(inBounds(await nutOf({ calories: v })), `calories=${v.slice(0, 20)}`);
  }
  for (const bad of [{ a: 1 }, [], ['300'], [[['300']]], () => 1, { toString() { throw new Error('boom'); } }, { valueOf() { throw new Error('boom'); } }])
    assert.ok(inBounds(await nutOf({ ...ALL, calories: bad, proteinContent: bad, fatContent: bad })));
  assert.strictEqual(await nutOf(JSON.parse('{"__proto__":{"calories":"300"}}')), null, 'own __proto__ is not data');
  assert.strictEqual(await nutOf(Object.create({ calories: '300' })), null, 'inherited calories are ignored');
  assert.strictEqual(await nutOf(JSON.parse('{"constructor":{"prototype":{"calories":"300"}}}')), null);
  assert.equal({}.calories, undefined); assert.equal(Object.prototype.calories, undefined);
  const cyc = { calories: '300' }; cyc.self = cyc; cyc.proteinContent = cyc;
  assert.equal((await nutOf(cyc)).k, 300);
  for (const wrong of [5, true, 'str', [1, 2], ['calories']]) { const r = await fromLd(node({ nutrition: wrong })); assert.strictEqual(r.nutrition, null); assert.deepEqual(Object.keys(r).sort(), KEYS); }
  const frozen = { '@type': 'NutritionInformation', calories: '300', proteinContent: '20 g', servingSize: '1 cup' };
  const snapshot = clone(frozen);
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  assert.equal((await nutOf(deepFreeze(frozen))).k, 300); assert.deepEqual(frozen, snapshot);
});

test('N30 pasted text: optional Calories / Protein / Carbs / Fat lines before the first section fill nutrition and are not ingredients, steps or title', async () => {
  const { importFromText } = await imp();
  const text = 'Test Chili\nServes 4\nCalories: 336\nProtein 31 g\nCarbs 46 g\nFat 4 g\nIngredients\n- 1 cup beans\nMethod\n1. Cook.';
  const r = importFromText(text);
  assert.deepEqual(r.nutrition, { k: 336, p: 31, c: 46, f: 4, per: '' });
  assert.equal(r.name, 'Test Chili'); assert.equal(r.servings, 4); assert.deepEqual(r.ingredients, ['1 cup beans']); assert.deepEqual(r.steps, ['Cook.']);
  assert.equal(r.description, '', 'nutrition lines are not description text either');
  assert.deepEqual(r.warnings, [NOTE]);
  const variants = ['CALORIES 336 kcal\nprotein: 31g\ncarbs 46 G\nFAT 4', 'calories: 336\nProtein: 31 g\nCarbohydrates: 46 g\nfat: 4 g', 'Calories 336\nProtein 31\nCarbs 46\nFat 4'];
  for (const v of variants) assert.deepEqual(importFromText(`Test Chili\n${v}\nIngredients\n- 1 cup beans\nMethod\n1. Cook.`).nutrition, { k: 336, p: 31, c: 46, f: 4, per: '' }, v);
  const crlf = importFromText(text.replace(/\n/g, '\r\n')); assert.deepEqual(crlf.nutrition, r.nutrition);
  const onlyK = importFromText('Test Chili\nCalories: 336\nIngredients\n- 1 cup beans\nMethod\n1. Cook.');
  assert.deepEqual(onlyK.nutrition, { k: 336, p: 0, c: 0, f: 0, per: '' });
  assert.ok(onlyK.warnings.some(w => /protein/i.test(w) && /carb/i.test(w) && /fat/i.test(w)), 'which macros were missing');
  const noCal = importFromText('Test Chili\nProtein 31 g\nFat 4 g\nIngredients\n- 1 cup beans\nMethod\n1. Cook.');
  assert.strictEqual(noCal.nutrition, null, 'calories are required');
  assert.ok(!noCal.ingredients.some(l => /protein|fat/i.test(l)) && !noCal.steps.some(l => /protein|fat/i.test(l)));
  const after = importFromText('Pie\nIngredients\n- 1 cup flour\nCalories: 336\nMethod\n1. Bake.');
  assert.strictEqual(after.nutrition, null, 'only lines BEFORE the first section count');
  assert.deepEqual(after.ingredients, ['1 cup flour', 'Calories: 336']);
  const none = importFromText('Pie\nIngredients\n- 1 cup flour\nMethod\n1. Bake.'); assert.strictEqual(none.nutrition, null);
});

test('N31 pasted text nutrition: absurd or hostile values give null and never throw', async () => {
  const { importFromText } = await imp();
  for (const cal of ['1e999', '99999999', '-5', 'lots', '1,2,3x', '__proto__', '<b>5</b>']) {
    let r; assert.doesNotThrow(() => { r = importFromText(`Pie\nCalories: ${cal}\nIngredients\n- 1 egg\nMethod\n1. Bake.`); });
    assert.ok(r.nutrition === null || (r.nutrition.k >= 0 && r.nutrition.k <= 20000), cal);
  }
  const huge = importFromText('Pie\nProtein 1e999\nCalories 300\nFat 99999999999\nIngredients\n- 1 egg\nMethod\n1. Bake.');
  assert.ok(huge.nutrition === null || [huge.nutrition.p, huge.nutrition.f].every(v => v >= 0 && v <= 5000));
  assert.equal({}.polluted, undefined);
});

// ---- importer: servings from yield ------------------------------------------------------------------------------

const sfp = async (y, s) => (await imp()).servingsFromPage(y, s);

test('N32 servingsFromPage: yield unit noun + same noun in servingSize -> yield / serving number, 2 decimals (hand computed)', async () => {
  const table = [
    [['12', '12 Wings'], '12 Wings', 1],            // whole batch is one serving
    [['12 Wings', '12'], '12 Wings', 1],            // element order does not matter: prefer the one with a unit
    ['12 Wings', '12 wings', 1],                    // case-insensitive
    ['24 cookies', '1 cookie', 24],                 // plural-insensitive
    ['24 cookies', '2 cookies', 12],
    ['36 cookies', '3 cookies', 12],
    ['Makes 24 cookies', '1 cookie', 24],
    ['10 cookies', '3 cookies', 3.33],              // 3.3333 rounded to 2 decimals
    ['15 cookies', '2 cookies', 7.5],
    ['1 cookie', '2 cookies', 0.5],
    ['6 pancakes', '1 pancake', 6],
    [['6', '6 Pancakes'], '2 pancakes', 3],
  ];
  for (const [y, s, out] of table) assert.equal(await sfp(y, s), out, `${JSON.stringify(y)} / ${s}`);
});

test('N33 servingsFromPage: otherwise the old rule (first number of the yield) applies', async () => {
  const table = [
    ['6 servings', '1.5 cups', 6], [['8', '8 servings'], '1 serving', 8], ['6 servings', '2 servings', 6], ['4 portions', '1 portion', 4], ['6 persons', '2 persons', 6], ['4 people', '1 person', 4],
    ['10 wings', '1 cookie', 10],            // different nouns
    ['12 wings', '1 cup', 12], ['12 wings', 'wings', 12], ['12 wings', '', 12], ['12 wings', undefined, 12], ['12 wings', null, 12], ['12 wings', ['1 wing'], 12], ['12 wings', {}, 12], ['12 wings', 'one serving', 12],
    ['24 cookies', '1 serving', 24], [12, '12 wings', 12], ['Serves 6', '1 cup', 6], ['2-3 servings', '1 cup', 2], [['4', '4 servings'], undefined, 4], ['12', '12 wings', 12], ['12 cookies', undefined, 12],
  ];
  for (const [y, s, out] of table) assert.equal(await sfp(y, s), out, `${JSON.stringify(y)} / ${JSON.stringify(s)}`);
  for (const y of [undefined, null, {}, [], 'lots', '', 0, '0 servings', NaN]) assert.strictEqual(await sfp(y, '1 cup'), null, String(JSON.stringify(y)));
});

test('N34 servingsFromPage is bounded like parseYield (>0, <=1000, finite) and never throws on hostile input', async () => {
  const ok = v => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000);
  const m = await imp();
  for (const [y, s] of [['5000 cookies', '1 cookie'], ['1 cookie', '5000 cookies'], ['12 wings', '0 wings'], ['0 wings', '0 wings'], ['1000 cookies', '0.5 cookies'], ['12 wings', '-1 wings'],
    ['1 wing', '99999999999 wings'], ['12 wings', '1e999 wings'], [Infinity, '1 cup'], ['9'.repeat(400) + ' wings', '1 wing'], ['12 wings', '1.2.3 wings']]) {
    let v; assert.doesNotThrow(() => { v = m.servingsFromPage(y, s); }, `${y} / ${s}`);
    assert.ok(ok(v), `${String(y).slice(0, 20)} / ${String(s).slice(0, 20)} -> ${v}`);
  }
  const t0 = Date.now();
  for (const [y, s] of [['x'.repeat(1e6), '1 cup'], ['12 wings', 'x'.repeat(1e6)], [['12'.repeat(1e5), '12 wings'.repeat(1e5)], '12 wings'], ['1 '.repeat(1e6), '1 '.repeat(1e6)], [Array.from({ length: 1e6 }, () => '12'), '12 wings']]) assert.ok(ok(m.servingsFromPage(y, s)));
  for (const [y, s] of [[Symbol('x'), '1 cup'], ['12 wings', Symbol('x')], [{ toString() { throw new Error('boom'); } }, { toString() { throw new Error('boom'); } }], [() => 1, () => 2], ['__proto__', '__proto__'], [['__proto__'], 'constructor']])
    assert.doesNotThrow(() => m.servingsFromPage(y, s));
  assert.ok(Date.now() - t0 < 10000, `took ${Date.now() - t0} ms`);
});

test('N35 importFromJsonLd uses servingsFromPage: servings come out right for the three page shapes and the default still applies', async () => {
  const sv = async (yieldV, nutrition) => fromLd(node({ recipeYield: yieldV, nutrition }));
  const a = await sv('6 servings', { calories: '336', servingSize: '1.5 cups' }); assert.equal(a.servings, 6);
  const b = await sv(['12', '12 Wings'], { calories: '434 calories', servingSize: '12 Wings' }); assert.equal(b.servings, 1); assert.ok(!hasW(b, /not found/i), 'servings were found');
  const c = await sv(['8', '8 servings'], { calories: '172 kcal', servingSize: '1 serving' }); assert.equal(c.servings, 8);
  assert.equal((await sv('24 cookies', { calories: '100', servingSize: '2 cookies' })).servings, 12);
  assert.equal((await sv('24 cookies', undefined)).servings, 24, 'no nutrition at all: the old rule (parseYield)');
  assert.equal((await sv('12 wings', { calories: '100' })).servings, 12);
  const none = await sv(undefined, { calories: '100', servingSize: '1 cup' });
  assert.equal(none.servings, 4); assert.ok(hasW(none, /4/) && hasW(none, /serving/i), 'unknown servings still default to 4 with the warning');
  const bi = await sv('12 wings', { calories: '100', servingSize: '1 wing' }); assert.equal(bi.servings, 12);
  const { parseYield } = await imp();
  assert.equal(parseYield(['12', '12 Wings']), 12, 'parseYield itself is unchanged');
});

// ---- toRecipe ---------------------------------------------------------------------------------------------------

test('N36 toRecipe copies a valid result.nutrition into recipe.stated; anything invalid becomes null; never throws; the input is not mutated', async () => {
  const { toRecipe } = await imp();
  const base = { name: 'Wings', description: '', servings: 1, totalTime: null, tags: [], steps: [], ingredients: [], warnings: [] };
  const good = { k: 434, p: 80, c: 13, f: 5, per: '12 Wings' };
  const res = { ...base, nutrition: clone(good) }; const before = clone(res);
  const r = toRecipe(res, 'r1', 5, '');
  assert.deepEqual(r.stated, good); assert.deepEqual(res, before);
  assert.deepEqual(sanitizeRecipe(r, r.id), r, 'passes sanitizeRecipe unchanged');
  assert.deepEqual(Object.keys(r).sort(), ['description', 'favorite', 'id', 'ingredients', 'name', 'servings', 'source', 'stated', 'steps', 'tags', 'totalTime', 'updatedAt']);
  r.stated.k = 1; assert.equal(res.nutrition.k, 434, 'the recipe holds its own copy');
  assert.strictEqual(toRecipe(base, 'r1', 5, '').stated, null);
  assert.strictEqual(toRecipe({ ...base, nutrition: null }, 'r1', 5, '').stated, null);
  const bad = [...WEIRD, { ...good, k: NaN }, { ...good, k: -1 }, { ...good, k: 20001 }, { ...good, p: 5001 }, { ...good, per: 5 }, { ...good, extra: 1 }, { k: 100, p: 1, c: 1 },
    JSON.parse('{"__proto__":{"k":100,"p":1,"c":1,"f":1,"per":""}}')];
  for (const b of bad) {
    let x; assert.doesNotThrow(() => { x = toRecipe({ ...base, nutrition: b }, 'r1', 5, ''); }, JSON.stringify(b));
    assert.strictEqual(x.stated, null, JSON.stringify(b)); assert.deepEqual(sanitizeRecipe(x, x.id), x);
  }
  for (const b of [null, undefined, 'x', 42, [], {}, { nutrition: 7 }]) assert.strictEqual(toRecipe(b, 'r9', 5, '').stated, null);
});

// ---- fixtures: three invented pages, end to end -----------------------------------------------------------------

const FIX = [
  { file: 'synthetic-pumpkin-barley-stew', servings: 6, stated: { k: 336, p: 31.8, c: 46.7, f: 3.7, per: '1.5 cups' }, totalK: 2016 },   // 336 x 6
  { file: 'synthetic-baked-wings', servings: 1, stated: { k: 434, p: 80, c: 13, f: 5, per: '12 Wings' }, totalK: 434 },                    // whole batch = 1 serving
  { file: 'synthetic-herb-chicken-strips', servings: 8, stated: { k: 172, p: 26, c: 10, f: 3, per: '1 serving' }, totalK: 1376 },          // 172 x 8
];

test('N37 the three invented corpus pages: servings, nutrition and the plain note are exactly the hand-computed values; recipes become stated and show source "stated"', async () => {
  const { importFromJsonLd, toRecipe } = await imp(); const { recipeNutrition } = await rn();
  for (const f of FIX) {
    const fixture = fx(`${f.file}.json`), expected = fx(`${f.file}.expected.json`);
    assert.ok(/(^|\.)example\.(com|org|net)$|\.test$|\.invalid$|\.example$/.test(new URL(fixture.sourceUrl).hostname), `${f.file}: reserved host`);
    const r = importFromJsonLd(fixture.node);
    assert.equal(r.servings, f.servings, f.file); assert.deepEqual(r.nutrition, f.stated, f.file);
    assert.deepEqual(r.warnings, [NOTE], f.file);
    assert.deepEqual(expected.nutrition, f.stated, `${f.file} golden`); assert.equal(expected.servings, f.servings); assert.deepEqual(expected.warnings, [NOTE]);
    const rec2 = toRecipe(r, 'r1', 1, fixture.sourceUrl);
    assert.deepEqual(rec2.stated, f.stated); assert.equal(rec2.servings, f.servings);
    const n = recipeNutrition(rec2);
    assert.equal(n.source, 'stated', f.file); assert.equal(n.perServing.k, f.stated.k); close(n.total.k, f.totalK, 1e-6);
    assert.equal(n.complete, true); assert.equal(n.estimated, true); assert.equal(n.linked, 0); assert.ok(n.count > 0);
  }
  const shapes = [fx('synthetic-pumpkin-barley-stew.json').node.recipeYield, fx('synthetic-baked-wings.json').node.recipeYield, fx('synthetic-herb-chicken-strips.json').node.recipeYield];
  assert.deepEqual(shapes, ['6 servings', ['12', '12 Wings'], ['8', '8 servings']], 'the fixtures keep the shapes seen on real pages');
});

test('N38 the two earlier corpus goldens gained only `nutrition: null`; all five fixture pairs exist and are json', () => {
  const dir = new URL('./fixtures/site-corpus/', import.meta.url);
  const files = readdirSync(dir);
  for (const f of FIX.map(x => x.file).concat(['synthetic-lentil-soup', 'synthetic-taco-bowl'])) { assert.ok(files.includes(`${f}.json`), f); assert.ok(files.includes(`${f}.expected.json`), f); }
  for (const f of ['synthetic-lentil-soup', 'synthetic-taco-bowl']) {
    const e = fx(`${f}.expected.json`);
    assert.ok(Object.hasOwn(e, 'nutrition')); assert.strictEqual(e.nutrition, null); assert.deepEqual(e.warnings, []);
  }
  assert.ok(files.every(f => f.endsWith('.json')));
});
