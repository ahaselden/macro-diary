import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShoppingList, aisleOf, nameKey, displayAmount, setChecked, addExtra, toggleExtra, removeExtra, clearTicks, extrasList, shoppingText, shoppingCsv, AISLES } from '../js/domain/shopping.js';
import { addPlanItem, recipeItem, foodItem } from '../js/domain/plan.js';
import { defaults } from '../js/core/schema.js';
import { mergeStates } from '../js/domain/merge.js';

const ing = (name, qty, unit, id = name) => ({ id, raw: `${qty ?? ''} ${unit} ${name}`.trim(), name, qty, unit, prep: '', food: null, grams: null });
const rec = (id, name, servings, ingredients) => ({ id, name, description: '', source: '', servings, totalTime: null, tags: [], steps: [], ingredients, updatedAt: 1 });
const find = (list, name) => list.items.find(i => i.name === name);
function setup() {
  const s = defaults();
  s.recipes.r1 = rec('r1', 'Pancakes', 4, [ing('flour', 2, 'cup'), ing('egg', 2, ''), ing('milk', 1, 'cup'), ing('salt', null, '')]);
  s.recipes.r2 = rec('r2', 'Bread', 2, [ing('flour', 500, 'g'), ing('Eggs', 1, ''), ing('milk', 120, 'ml'), ing('olive oil', 2, 'tbsp')]);
  return s;
}

test('the same ingredient is summed across recipes when units are compatible, scaled by planned servings', () => {
  const s = setup();
  addPlanItem(s, '2025-11-17', 'Breakfast', recipeItem('a', 'r1', 8), 1);   // 2x the recipe: 4 cups flour, 4 eggs, 2 cups milk
  addPlanItem(s, '2025-11-18', 'Lunch', recipeItem('b', 'r2', 2), 1);       // 1x: 500 g flour, 1 egg, 120 ml milk, 2 tbsp oil
  const l = buildShoppingList(s, '2025-11-17', '2025-11-23');
  assert.equal(find(l, 'egg').display, '5');                                  // 4 + 1, "Eggs" and "egg" grouped
  assert.equal(find(l, 'milk').display, '2 1/2 cups');                        // 2 cups + 120 ml (~0.51 cup) -> 2.5 cups
  assert.equal(find(l, 'olive oil').display, '2 tbsp');
});

test('weight and volume of the same ingredient are kept as SEPARATE lines (no guessed density)', () => {
  const s = setup(); addPlanItem(s, '2025-11-17', 'Breakfast', recipeItem('a', 'r1', 4), 1); addPlanItem(s, '2025-11-17', 'Lunch', recipeItem('b', 'r2', 2), 1);
  const flours = buildShoppingList(s, '2025-11-17', '2025-11-17').items.filter(i => i.name === 'flour');
  assert.equal(flours.length, 2); assert.deepEqual(flours.map(f => f.display).sort(), ['2 cups', '500 g']);
});

test('weight display follows the user unit and switches to kg / lb when large', () => {
  assert.deepEqual(displayAmount('w', 500, 'g'), [500, 'g']); assert.deepEqual(displayAmount('w', 1500, 'g'), [1.5, 'kg']);
  assert.equal(displayAmount('w', 100, 'oz')[1], 'oz'); assert.equal(displayAmount('w', 500, 'oz')[1], 'lb');
  assert.equal(displayAmount('v', 15, 'g')[1], 'tbsp'); assert.equal(displayAmount('v', 5, 'g')[1], 'tsp'); assert.equal(displayAmount('v', 700, 'g')[1], 'cup');
});

test('items with no amount (to taste) are listed once without a quantity', () => {
  const s = setup(); addPlanItem(s, '2025-11-17', 'Lunch', recipeItem('a', 'r1', 4), 1); addPlanItem(s, '2025-11-17', 'Dinner', recipeItem('b', 'r1', 4), 1);
  const salt = buildShoppingList(s, '2025-11-17', '2025-11-17').items.filter(i => i.name === 'salt'); assert.equal(salt.length, 1); assert.equal(salt[0].display, ''); assert.deepEqual(salt[0].from, ['Pancakes']);
});

test('only plan days inside the range count; deleted recipes are reported, not fatal; planned foods are included', () => {
  const s = setup(); addPlanItem(s, '2025-11-16', 'Lunch', recipeItem('a', 'r1', 4), 1); addPlanItem(s, '2025-11-17', 'Lunch', recipeItem('b', 'gone', 1), 1);
  addPlanItem(s, '2025-11-17', 'Snacks', foodItem('c', { name: 'Almonds', brand: '', source: 'USDA', per100: { k: 600, p: 20, c: 20, f: 50 } }, 250), 1);
  const l = buildShoppingList(s, '2025-11-17', '2025-11-23');
  assert.equal(find(l, 'flour'), undefined); assert.equal(l.skipped.length, 1); assert.equal(find(l, 'almonds').display, '250 g');
  assert.deepEqual(buildShoppingList(s, '2030-01-01', '2030-01-07').items, []);
});

test('aisles: specific words win and the list is ordered aisle-then-name', () => {
  assert.equal(aisleOf('frozen peas'), 'Frozen'); assert.equal(aisleOf('garlic powder'), 'Spices'); assert.equal(aisleOf('tomato paste'), 'Pantry');
  assert.equal(aisleOf('Chicken breast'), 'Meat & seafood'); assert.equal(aisleOf('eggs'), 'Dairy & eggs'); assert.equal(aisleOf('onions'), 'Produce'); assert.equal(aisleOf('mystery thing'), 'Other');
  const s = setup(); addPlanItem(s, '2025-11-17', 'Lunch', recipeItem('a', 'r1', 4), 1);
  const aisles = buildShoppingList(s, '2025-11-17', '2025-11-17').items.map(i => AISLES.indexOf(i.aisle)); assert.deepEqual(aisles, [...aisles].sort((a, b) => a - b));
});

test('nameKey groups plurals', () => { assert.equal(nameKey('Tomatoes'), nameKey('tomato')); assert.equal(nameKey('Berries'), nameKey('berry')); assert.equal(nameKey('  Olive  Oil! '), 'olive oil'); assert.equal(nameKey('hummus'), 'hummus'); });

test('ticks and extras: stamped, persistent across rebuilds, and merge between devices', () => {
  const s = setup(); addPlanItem(s, '2025-11-17', 'Lunch', recipeItem('a', 'r1', 4), 1);
  const key = find(buildShoppingList(s, '2025-11-17', '2025-11-17'), 'egg').key;
  setChecked(s, key, true, 10);
  assert.equal(find(buildShoppingList(s, '2025-11-17', '2025-11-17'), 'egg').checked, true);                         // survives a rebuild (key is stable)
  addExtra(s, '  paper towels ', 'e1', 11); assert.equal(addExtra(s, '   ', 'e2', 12), null);
  assert.equal(extrasList(s).length, 1); assert.equal(toggleExtra(s, 'e1', true, 20), true); assert.equal(s.shopping.extras.e1.on, true);
  const other = defaults(); setChecked(other, key, false, 50);
  assert.equal(mergeStates(s, other).shopping.checks[key].on, false);                              // the newer tick wins on the other device
  assert.equal(removeExtra(s, 'e1', 30), true); assert.equal(s.tombstones.e1, 30); assert.equal(removeExtra(s, 'e1', 31), false);
  clearTicks(s, 60); assert.equal(s.shopping.checks[key].on, false);
});

test('shoppingText groups by aisle with check boxes; CSV is spreadsheet-safe', () => {
  const s = setup(); addPlanItem(s, '2025-11-17', 'Lunch', recipeItem('a', 'r1', 4), 1);
  const l = buildShoppingList(s, '2025-11-17', '2025-11-17'); setChecked(s, find(l, 'egg').key, true, 1); addExtra(s, '=HYPERLINK("x")', 'e1', 2);
  const l2 = buildShoppingList(s, '2025-11-17', '2025-11-17'), text = shoppingText(s, l2, 'My list');
  assert.match(text, /^My list/); assert.match(text, /DAIRY & EGGS\n\[x\] 2 egg\n\[ \] 1 cup milk/); assert.match(text, /EXTRAS\n\[ \] =HYPERLINK/);
  const csv = shoppingCsv(s, l2); assert.ok(csv.startsWith('﻿Aisle,Item')); assert.ok(csv.includes("'=HYPERLINK"));   // formula injection neutralised
});

test('a bad or reversed range gives an empty list immediately (no endless loop), and huge ranges are capped', () => {
  const s = setup(); addPlanItem(s, '2025-11-17', 'Lunch', recipeItem('a', 'r1', 4), 1);
  for (const [a, b] of [['', ''], ['x', 'y'], ['2025-11-20', '2025-11-17'], [undefined, undefined], ['2025-13-45', '2025-99-99']]) assert.deepEqual(buildShoppingList(s, a, b).items, []);
  assert.ok(buildShoppingList(s, '2025-11-17', '2099-12-31').items.length > 0);   // terminates (cap) and still finds the planned day
});

test('size words do not split a shopping line: "2 large eggs" + "3 eggs" = 5 eggs', () => {
  assert.equal(nameKey('Large Eggs'), nameKey('egg')); assert.equal(nameKey('extra virgin olive oil'), 'extra virgin olive oil');
  const s = defaults(); s.recipes.a = rec('a', 'A', 1, [ing('large eggs', 2, '')]); s.recipes.b = rec('b', 'B', 1, [ing('eggs', 3, '')]);
  addPlanItem(s, '2025-11-17', 'Lunch', recipeItem('x', 'a', 1), 1); addPlanItem(s, '2025-11-17', 'Dinner', recipeItem('y', 'b', 1), 1);
  const items = buildShoppingList(s, '2025-11-17', '2025-11-17').items; assert.equal(items.length, 1); assert.equal(items[0].display, '5'); assert.deepEqual(items[0].from, ['A', 'B']);
});
