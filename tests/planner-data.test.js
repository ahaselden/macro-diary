// Stage 3a: the data model for recipes, the meal plan and shopping state — sanitising, merging, syncing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, migrate, sanitize, sanitizeRecipe, sanitizePlanDay, sanitizeShopping, SCHEMA_VERSION } from '../js/core/schema.js';
import { mergeStates } from '../js/domain/merge.js';
import { removeEntry } from '../js/domain/entries.js';
import { toRecords, applyRecords, isSyncKey } from '../js/domain/sync-records.js';
import { createSyncEngine } from '../js/services/sync/engine.js';
import { createMemoryAdapter } from '../js/services/sync/memory-adapter.js';
import { fixture, clone } from './helpers.js';

const per100 = { k: 100, p: 1, c: 1, f: 1 };
const food = { name: 'Flour', brand: '', source: 'USDA', per100, servingG: 0 };
const recipe = (id, over = {}) => ({ id, name: 'Recipe ' + id, description: '', source: '', servings: 4, totalTime: null, tags: [], steps: [], ingredients: [], favorite: false, updatedAt: 0, ...over });
const planDay = (items = [], updatedAt = 0) => ({ updatedAt, slots: { Breakfast: [], Lunch: items, Dinner: [], Snacks: [] } });
const item = (id, recipeId) => ({ id, type: 'recipe', recipeId, name: '', servings: 1, food: null, grams: null, entryId: '' });
const base = (over = {}) => ({ ...defaults(), ...over });

// ---------- sanitising untrusted data ----------
test('sanitizeRecipe keeps a good recipe and coerces/clamps a hostile one', () => {
  const good = sanitizeRecipe({ name: 'Chili', servings: 6, ingredients: [{ raw: '1 cup beans', name: 'beans', qty: 1, unit: 'cup', food }], steps: ['Cook'], tags: ['dinner'], updatedAt: 5 }, 'r1');
  assert.equal(good.id, 'r1'); assert.equal(good.servings, 6); assert.equal(good.ingredients[0].food.name, 'Flour'); assert.equal(good.updatedAt, 5);
  const bad = sanitizeRecipe({ name: '<img onerror=x>', servings: -3, totalTime: 'soon', tags: 'x', steps: [1, 'ok', {}], ingredients: [null, 5, { qty: '<b>', food: { name: 5 } }], updatedAt: 'now' }, 'r2');
  assert.equal(bad.servings, 4); assert.equal(bad.totalTime, null); assert.deepEqual(bad.tags, []); assert.deepEqual(bad.steps, ['ok']);
  assert.equal(bad.ingredients.length, 1); assert.equal(bad.ingredients[0].qty, null); assert.equal(bad.ingredients[0].food, null); assert.equal(bad.updatedAt, 0);
  assert.equal(bad.name, '<img onerror=x>');                                  // text is kept as text; the UI escapes it
});
test('sanitizeRecipe rejects nameless, id-less or non-object input and caps sizes', () => {
  for (const [r, id] of [[null, 'a'], [{ name: '' }, 'a'], [{ name: '  ' }, 'a'], [{ name: 'x' }, ''], [{ name: 'x' }, 5], [[], 'a']]) assert.equal(sanitizeRecipe(r, id), null);
  const big = sanitizeRecipe({ name: 'x'.repeat(5000), ingredients: Array.from({ length: 500 }, () => ({ raw: 'x' })), steps: Array.from({ length: 500 }, () => 's') }, 'r');
  assert.equal(big.name.length, 200); assert.equal(big.ingredients.length, 200); assert.equal(big.steps.length, 100);
});
test('sanitizePlanDay keeps the four meal slots and drops broken items', () => {
  const d = sanitizePlanDay({ updatedAt: 3, slots: { Lunch: [item('i1', 'r1'), { type: 'recipe' }, null, { type: 'food', food: null }, { type: 'food', food, grams: 150, id: 'f1' }], Brunch: [item('x', 'r')] } });
  assert.deepEqual(Object.keys(d.slots), ['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
  assert.deepEqual(d.slots.Lunch.map(i => i.id), ['i1', 'f1']); assert.equal(sanitizePlanDay('x'), null);
  const logged = sanitizePlanDay({ slots: { Lunch: [{ ...item('i9', 'r1'), entryId: 'e_123' }] } });
  assert.equal(logged.slots.Lunch[0].entryId, 'e_123'); assert.equal(d.slots.Lunch[0].entryId, '');
});
test('sanitizeShopping keeps valid ticks/extras only', () => {
  const s = sanitizeShopping({ checks: { 'flour|g': { on: true, updatedAt: 5 }, bad: 5 }, extras: { e1: { text: 'Milk', on: 1 }, e2: { text: '   ' }, e3: 'x' } });
  assert.deepEqual(s.checks, { 'flour|g': { on: true, updatedAt: 5 } }); assert.deepEqual(Object.keys(s.extras), ['e1']); assert.equal(s.extras.e1.on, false);
  assert.deepEqual(sanitizeShopping(null), { checks: {}, extras: {} });
});
test('sanitize() cleans recipes/plan/shopping on load; bad plan dates are dropped', () => {
  const d = sanitize({ recipes: { r1: { name: 'ok' }, r2: { name: '' }, r3: 7 }, plan: { '2025-01-01': planDay([item('i', 'r1')]), 'not-a-date': planDay(), '2025-01-02': 5 }, shopping: 'x' });
  assert.deepEqual(Object.keys(d.recipes), ['r1']); assert.deepEqual(Object.keys(d.plan), ['2025-01-01']); assert.deepEqual(d.shopping, { checks: {}, extras: {} });
});
test('v1, v2 and v3 saves upgrade to the current version with every entry intact', () => {
  const v1 = fixture('state'), count = s => Object.values(s.days).flat().length;
  for (const ver of [undefined, 2, 3]) {
    const d = migrate({ ...clone(v1), ...(ver ? { schemaVersion: ver } : {}) });
    assert.equal(d.schemaVersion, SCHEMA_VERSION); assert.equal(count(d), count(v1)); assert.deepEqual(d.recipes, {}); assert.deepEqual(d.plan, {});
  }
});

// ---------- merging ----------
test('recipes: newest edit wins; tombstone beats an older edit, a later edit beats the tombstone', () => {
  const a = base({ recipes: { r1: recipe('r1', { name: 'Old', updatedAt: 10 }) } }), b = base({ recipes: { r1: recipe('r1', { name: 'New', updatedAt: 20 }) } });
  assert.equal(mergeStates(a, b).recipes.r1.name, 'New'); assert.equal(mergeStates(b, a).recipes.r1.name, 'New');
  const del = base({ tombstones: { r1: 15 } });
  assert.deepEqual(mergeStates(a, del).recipes, {});                              // edited at 10, deleted at 15 -> gone
  assert.equal(mergeStates(b, del).recipes.r1.name, 'New');                       // edited at 20, after the deletion -> stays
});
test('plan: the newer day record replaces the whole day, including clearing it', () => {
  const a = base({ plan: { '2025-01-01': planDay([item('i1', 'r1')], 10) } });
  const cleared = base({ plan: { '2025-01-01': planDay([], 20) } });
  assert.deepEqual(mergeStates(a, cleared).plan['2025-01-01'].slots.Lunch, []);
  assert.deepEqual(mergeStates(cleared, a).plan['2025-01-01'].slots.Lunch, []);
  const other = base({ plan: { '2025-01-02': planDay([item('i2', 'r2')], 5) } });
  assert.deepEqual(Object.keys(mergeStates(a, other).plan), ['2025-01-01', '2025-01-02']);
});
test('shopping: newest tick wins per item; extras merge by id and honour tombstones', () => {
  const a = base({ shopping: { checks: { 'flour|g': { on: true, updatedAt: 10 } }, extras: { e1: { id: 'e1', text: 'Milk', on: false, updatedAt: 10 } } } });
  const b = base({ shopping: { checks: { 'flour|g': { on: false, updatedAt: 20 }, 'eggs|': { on: true, updatedAt: 1 } }, extras: { e2: { id: 'e2', text: 'Tape', on: false, updatedAt: 3 } }, }, tombstones: { e1: 15 } });
  const m = mergeStates(a, b);
  assert.equal(m.shopping.checks['flour|g'].on, false); assert.equal(m.shopping.checks['eggs|'].on, true);
  assert.deepEqual(Object.keys(m.shopping.extras), ['e2']);                      // e1 was deleted after its last edit
});
test('merge ignores malformed planner records instead of throwing', () => {
  const a = base({ recipes: { r1: recipe('r1') } });
  const junk = { ...defaults(), recipes: { r2: 5, r3: { id: 3 } }, plan: { d: null }, shopping: { checks: { x: null }, extras: { e: 5 } } };
  assert.doesNotThrow(() => mergeStates(a, junk)); assert.deepEqual(Object.keys(mergeStates(a, junk).recipes), ['r1']);
});

// ---------- algebraic properties incl. planner data ----------
let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const stampR = () => Math.floor(rnd() * 5) * 10;
function randomPlannerState() {
  const recipes = {}, plan = {}, checks = {}, extras = {}, tombstones = {};
  for (const id of ['r1', 'r2', 'r3']) if (rnd() < 0.6) recipes[id] = recipe(id, { name: pick(['A', 'B', 'C']), updatedAt: stampR() });
  for (const d of ['2025-02-01', '2025-02-02']) if (rnd() < 0.6) plan[d] = planDay(rnd() < 0.5 ? [item(pick(['i1', 'i2']), pick(['r1', 'r2']))] : [], stampR());
  for (const k of ['a|g', 'b|']) if (rnd() < 0.6) checks[k] = { on: rnd() < 0.5, updatedAt: stampR() };
  for (const id of ['e1', 'e2']) if (rnd() < 0.6) extras[id] = { id, text: pick(['Milk', 'Tape']), on: rnd() < 0.5, updatedAt: stampR() };
  for (const id of ['r1', 'e1']) if (rnd() < 0.3) tombstones[id] = stampR();
  return base({ recipes, plan, shopping: { checks, extras }, tombstones });
}
const norm = s => { const { theme, apiKey, recent, ...rest } = s; return rest; };
test('merge with planner data is commutative, associative and idempotent over 300 random triples', () => {
  for (let i = 0; i < 300; i++) {
    const a = randomPlannerState(), b = randomPlannerState(), c = randomPlannerState(), ab = mergeStates(a, b);
    assert.deepEqual(norm(ab), norm(mergeStates(b, a)), `commutative #${i}`);
    assert.deepEqual(norm(mergeStates(ab, c)), norm(mergeStates(a, mergeStates(b, c))), `associative #${i}`);
    assert.deepEqual(norm(mergeStates(ab, ab)), norm(ab), `idempotent #${i}`);
  }
});

// ---------- sync records ----------
test('toRecords/applyRecords round-trip recipes, plan days and shopping state', () => {
  const s = base({ recipes: { r1: recipe('r1', { updatedAt: 5 }) }, plan: { '2025-03-01': planDay([item('i1', 'r1')], 7) }, shopping: { checks: { 'a|g': { on: true, updatedAt: 3 } }, extras: {} } });
  const recs = toRecords(s);
  assert.deepEqual(recs.map(r => r.key).filter(k => /^(recipe|plan|shopping)/.test(k)).sort(), ['plan:2025-03-01', 'recipe:r1', 'shopping']);
  const back = applyRecords(defaults(), recs);
  assert.deepEqual(back.recipes, s.recipes); assert.deepEqual(back.plan, s.plan); assert.deepEqual(back.shopping, s.shopping);
  assert.equal(isSyncKey('recipe:r1'), true); assert.equal(isSyncKey('plan:2025-03-01'), true); assert.equal(isSyncKey('plan:bad'), false); assert.equal(isSyncKey('recipe:'), false);
});
test('applyRecords ignores malformed recipe/plan/shopping records', () => {
  const out = applyRecords(defaults(), [{ key: 'recipe:r1', value: { recipe: { name: '' } } }, { key: 'recipe:r2', value: {} }, { key: 'plan:2025-01-01', value: { plan: 5 } }, { key: 'shopping', value: { shopping: 5 } }, { key: 'recipe:r3', value: { recipe: { name: 'ok' } } }]);
  assert.deepEqual(Object.keys(out.recipes), ['r3']); assert.deepEqual(out.plan, {});
});

// ---------- two devices ----------
let clock = 5000; const tick = () => ++clock;
class Device {
  constructor(adapter) {
    this.state = defaults(); this.saved = null;
    this.engine = createSyncEngine({ adapter, getState: () => this.state, applyState: s => { this.state = s; }, now: tick,
      meta: { load: () => (this.saved ? clone(this.saved) : null), save: o => { this.saved = clone(o); } } });
  }
  sync() { return this.engine.sync(); }
}
test('two devices: a recipe, a plan day and a shopping tick travel; deleting the recipe propagates', async () => {
  const srv = createMemoryAdapter(), phone = new Device(srv), pc = new Device(srv);
  phone.state.recipes.r1 = recipe('r1', { name: 'Soup', updatedAt: tick() });
  phone.state.plan['2025-04-01'] = planDay([item('i1', 'r1')], tick());
  phone.state.shopping.checks['onion|'] = { on: true, updatedAt: tick() };
  await phone.sync(); await pc.sync();
  assert.equal(pc.state.recipes.r1.name, 'Soup'); assert.equal(pc.state.plan['2025-04-01'].slots.Lunch[0].recipeId, 'r1'); assert.equal(pc.state.shopping.checks['onion|'].on, true);
  delete pc.state.recipes.r1; pc.state.tombstones.r1 = tick();                 // PC deletes the recipe
  await pc.sync(); await phone.sync();
  assert.deepEqual(phone.state.recipes, {}); assert.equal(typeof phone.state.tombstones.r1, 'number');
  await phone.sync(); await pc.sync();                                        // settles
  assert.deepEqual(clone(phone.state.recipes), clone(pc.state.recipes));
});
test('removeEntry style tombstones still work alongside planner data (diary regression)', () => {
  const s = base({ days: { d: [{ id: 'a', meal: 'Lunch', name: 'a', per100, grams: 100 }] }, recipes: { r1: recipe('r1') } });
  removeEntry(s, 'd', 'a', 9); assert.deepEqual(s.days, {}); assert.deepEqual(Object.keys(s.recipes), ['r1']);
});

test('sanitize: units are reduced to letters/spaces/dots, absurd quantities are rejected, unusable custom/recent foods are dropped', () => {
  const r = sanitizeRecipe({ name: 'x', servings: 1e30, ingredients: [{ raw: 'r', unit: 'cup(?<x\\', qty: 1e300, grams: Infinity }] }, 'r1');
  assert.equal(r.ingredients[0].unit, 'cupx'); assert.equal(r.ingredients[0].qty, null); assert.equal(r.ingredients[0].grams, null); assert.equal(r.servings, 4);
  assert.equal(sanitizeRecipe({ name: 'x', updatedAt: 1.7e12 }, 'r').updatedAt, 1.7e12);          // real timestamps still pass
  const d = sanitize({ custom: [{ name: 'ok', per100 }, { name: 'no nutrition' }, null, 5], recent: [{ per100 }, { name: 'r', per100 }] });
  assert.deepEqual(d.custom.map(f => f.name), ['ok']); assert.deepEqual(d.recent.map(f => f.name), ['r']);
});
