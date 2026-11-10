import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, weekDates, getDay, recipeItem, foodItem, addPlanItem, updatePlanItem, removePlanItem, clearDay, copyDay, copyWeek, itemNutrition, dayNutrition, logItem, logDay } from '../js/domain/plan.js';
import { entryMacros, totals } from '../js/domain/nutrition.js';
import { removeEntry } from '../js/domain/entries.js';
import { defaults } from '../js/core/schema.js';

const food = (k, p = 0) => ({ name: 'Flour', brand: '', source: 'USDA', per100: { k, p, c: 0, f: 0 }, servingG: 0 });
// 400 g of a 100 kcal/100g food over 4 servings = 100 kcal and 100 g per serving
const soup = (id, over = {}) => ({ id, name: 'Soup', description: '', source: '', servings: 4, totalTime: null, tags: [], steps: [], updatedAt: 1,
  ingredients: [{ id: 'i1', raw: '400 g flour', name: 'flour', qty: 400, unit: 'g', prep: '', food: food(100, 5), grams: 400 }], ...over });
const mk = () => { const s = defaults(); s.recipes.r1 = soup('r1'); return s; };
let n = 0; const idGen = () => 'id' + (++n);

test('weekStart is the Monday of the week and weekDates lists Mon..Sun', () => {
  assert.equal(weekStart('2025-11-20'), '2025-11-17');   // Thursday
  assert.equal(weekStart('2025-11-17'), '2025-11-17');   // Monday
  assert.equal(weekStart('2025-11-23'), '2025-11-17');   // Sunday
  assert.equal(weekStart('2026-01-01'), '2025-12-29');   // across a year boundary
  assert.deepEqual(weekDates('2025-12-29'), ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
});

test('adding, updating and removing plan items stamps the planned day', () => {
  const s = mk(); const it = addPlanItem(s, '2025-11-20', 'Dinner', recipeItem('a', 'r1', 2), 100);
  assert.equal(s.plan['2025-11-20'].updatedAt, 100); assert.equal(it.servings, 2);
  assert.equal(addPlanItem(s, '2025-11-20', 'Brunch', recipeItem('b', 'r1'), 101), null);          // unknown slot refused
  assert.equal(updatePlanItem(s, '2025-11-20', 'Dinner', 'a', { servings: 3 }, 200).servings, 3); assert.equal(s.plan['2025-11-20'].updatedAt, 200);
  assert.equal(updatePlanItem(s, '2025-11-20', 'Dinner', 'nope', {}, 1), null);
  assert.equal(removePlanItem(s, '2025-11-20', 'Dinner', 'a', 300), true); assert.equal(s.plan['2025-11-20'].updatedAt, 300);
  assert.equal(removePlanItem(s, '2025-11-20', 'Dinner', 'a', 400), false);
  assert.deepEqual(Object.keys(getDay(s, '2030-01-01').slots), ['Breakfast', 'Lunch', 'Dinner', 'Snacks']);   // unplanned day reads as empty
});

test('clearing a day keeps an empty, newer record (so the clearing wins a sync)', () => {
  const s = mk(); addPlanItem(s, 'd', 'Lunch', recipeItem('a', 'r1'), 10); clearDay(s, 'd', 20);
  assert.equal(s.plan.d.updatedAt, 20); assert.deepEqual(s.plan.d.slots.Lunch, []);
});

test('copyDay / copyWeek copy with fresh ids, nothing marked logged, and as an independent copy', () => {
  const s = mk(); addPlanItem(s, '2025-11-17', 'Lunch', { ...recipeItem('a', 'r1', 2), entryId: 'e9' }, 10);
  copyDay(s, '2025-11-17', '2025-11-18', 50, idGen);
  const c = s.plan['2025-11-18'].slots.Lunch[0];
  assert.equal(c.recipeId, 'r1'); assert.equal(c.servings, 2); assert.equal(c.entryId, ''); assert.notEqual(c.id, 'a'); assert.equal(s.plan['2025-11-18'].updatedAt, 50);
  c.servings = 9; assert.equal(s.plan['2025-11-17'].slots.Lunch[0].servings, 2);
  copyWeek(s, '2025-11-17', '2025-11-24', 60, idGen);
  assert.equal(s.plan['2025-11-24'].slots.Lunch[0].recipeId, 'r1'); assert.equal(Object.keys(s.plan).filter(d => d >= '2025-11-24').length, 7);
});

test('itemNutrition: recipe servings multiply per-serving values; deleted recipe is flagged; food uses grams', () => {
  const s = mk();
  const r = itemNutrition(s, recipeItem('a', 'r1', 2)); assert.equal(Math.round(r.k), 200); assert.equal(r.complete, true); assert.equal(r.name, 'Soup');
  const gone = itemNutrition(s, recipeItem('b', 'deleted')); assert.equal(gone.k, 0); assert.equal(gone.missing, true); assert.equal(gone.complete, false);
  const f = itemNutrition(s, foodItem('c', food(50), 300)); assert.equal(Math.round(f.k), 150); assert.equal(f.complete, true);
  assert.equal(itemNutrition(s, foodItem('d', food(50), null)).complete, false);
});

test('dayNutrition totals per meal and flags incomplete days', () => {
  const s = mk();
  addPlanItem(s, 'd', 'Lunch', recipeItem('a', 'r1', 1), 1); addPlanItem(s, 'd', 'Dinner', recipeItem('b', 'r1', 2), 1);
  const n = dayNutrition(s, 'd'); assert.equal(Math.round(n.total.k), 300); assert.equal(Math.round(n.byMeal.Dinner.k), 200); assert.equal(n.complete, true); assert.equal(n.items, 2);
  addPlanItem(s, 'd', 'Snacks', recipeItem('c', 'gone'), 1); assert.equal(dayNutrition(s, 'd').complete, false);
  assert.equal(dayNutrition(s, 'empty-day').items, 0);
});

test('logItem creates a diary entry with the planned calories, once; deleting that entry allows logging again', () => {
  const s = mk(); addPlanItem(s, 'd', 'Dinner', recipeItem('a', 'r1', 2), 1);
  const e = logItem(s, 'd', 'Dinner', 'a', 500, idGen);
  assert.equal(Math.round(entryMacros(e).k), 200); assert.equal(e.grams, 200);            // 2 servings x 100 g
  assert.equal(e.unitKey, 's'); assert.equal(e.disp, '2 servings'); assert.equal(e.meal, 'Dinner'); assert.equal(e.updatedAt, 500);
  assert.equal(s.days.d.length, 1); assert.equal(s.plan.d.slots.Dinner[0].entryId, e.id);
  assert.equal(logItem(s, 'd', 'Dinner', 'a', 600, idGen), null); assert.equal(s.days.d.length, 1);   // idempotent
  removeEntry(s, 'd', e.id, 700);
  assert.ok(logItem(s, 'd', 'Dinner', 'a', 800, idGen)); assert.equal(s.days.d.length, 1);           // can log again
});

test('a recipe with NO linked ingredients logs nothing; a partly linked one logs just what is linked', () => {
  const s = mk(); s.recipes.r2 = soup('r2', { ingredients: [{ id: 'i', raw: 'x', name: 'x', qty: null, unit: '', prep: '', food: null, grams: null }] });
  addPlanItem(s, 'd', 'Lunch', recipeItem('a', 'r2', 1), 1);
  assert.equal(logItem(s, 'd', 'Lunch', 'a', 5, idGen), null); assert.equal(s.days.d, undefined);
  s.recipes.r3 = soup('r3'); s.recipes.r3.ingredients.push({ id: 'i2', raw: '1 cup mystery', name: 'mystery', qty: 1, unit: 'cup', prep: '', food: null, grams: null });
  addPlanItem(s, 'd', 'Dinner', recipeItem('b', 'r3', 1), 1);
  const e = logItem(s, 'd', 'Dinner', 'b', 6, idGen); assert.ok(e); assert.equal(Math.round(entryMacros(e).k), 100);   // only the linked flour
  assert.equal(itemNutrition(s, s.plan.d.slots.Dinner[0]).complete, false);                                          // ...and the plan knows it is incomplete
});

test('logItem for a planned food and for a deleted recipe', () => {
  const s = mk(); addPlanItem(s, 'd', 'Snacks', foodItem('f', food(200), 150), 1); addPlanItem(s, 'd', 'Lunch', recipeItem('g', 'gone'), 1);
  const e = logItem(s, 'd', 'Snacks', 'f', 9, idGen); assert.equal(Math.round(entryMacros(e).k), 300); assert.equal(e.unitKey, 'w:g');
  assert.equal(logItem(s, 'd', 'Lunch', 'g', 9, idGen), null);
});

test('logDay logs every unlogged item and reports how many', () => {
  const s = mk(); addPlanItem(s, 'd', 'Lunch', recipeItem('a', 'r1', 1), 1); addPlanItem(s, 'd', 'Dinner', recipeItem('b', 'r1', 1), 1); addPlanItem(s, 'd', 'Snacks', recipeItem('c', 'gone'), 1);
  assert.equal(logDay(s, 'd', 10, idGen), 2); assert.equal(logDay(s, 'd', 11, idGen), 0);
  assert.equal(Math.round(totals(s.days.d).k), 200);
});
