import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRecipe, newIngredient, resolveGrams, recipeNutrition, saveRecipe, deleteRecipe, searchRecipes, scaleIngredientText } from '../js/domain/recipes.js';
import { formatQty } from '../js/domain/ingredient-parse.js';

const close = (a, b, e = 0.01) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b}`);
const food = (extra = {}) => ({ name: 'X', brand: '', source: 'custom', per100: { k: 100, p: 10, c: 20, f: 5 }, servingG: 0, servingLabel: '', ...extra });
const ing = (text, f, id = 'i') => ({ ...newIngredient(text, id), food: f });

test('newRecipe / newIngredient shapes', () => {
  assert.deepEqual(newRecipe('r1', 5), { id: 'r1', name: '', description: '', source: '', servings: 4, totalTime: null, tags: [], steps: [], ingredients: [], updatedAt: 5 });
  assert.deepEqual(newIngredient('2 cups flour, sifted', 'a'), { id: 'a', raw: '2 cups flour, sifted', name: 'flour', qty: 2, unit: 'cup', prep: 'sifted', food: null, grams: null });
});

test('resolveGrams: no food -> null', () => assert.equal(resolveGrams(newIngredient('1 cup flour', 'a')), null));
test('resolveGrams: weights', () => {
  assert.equal(resolveGrams(ing('250 g flour', food())), 250);
  assert.equal(resolveGrams(ing('1.5 kg flour', food())), 1500);
  close(resolveGrams(ing('2 oz flour', food())), 56.699);
  close(resolveGrams(ing('1 lb flour', food())), 453.592);
  assert.equal(resolveGrams({ ...ing('flour', food()), unit: 'g', qty: null }), null);
});
test('resolveGrams: cups with density from a portion', () => {
  const f = food({ portions: [{ label: '1 cup', g: 125 }] });
  close(resolveGrams(ing('2 cups flour', f)), 250);
  close(resolveGrams(ing('1/2 cup flour', f)), 62.5);
  close(resolveGrams(ing('1 tbsp flour', f)), 125 / 16, 0.1);
  close(resolveGrams(ing('1 tsp flour', f)), 125 / 48, 0.1);
  close(resolveGrams(ing('250 ml flour', f)), 250 * 125 / 236.588, 0.01);
  close(resolveGrams(ing('1 l flour', f)), 1000 * 125 / 236.588, 0.1);
  close(resolveGrams(ing('1 fl oz flour', f)), 125 / 8, 0.1);
});
test('resolveGrams: density from the serving label', () => {
  close(resolveGrams(ing('1 cup milk', food({ servingG: 244, servingLabel: '1 cup' }))), 244);
});
test('resolveGrams: cups with NO density -> null', () => {
  assert.equal(resolveGrams(ing('1 cup flour', food({ servingG: 30, servingLabel: '1 scoop' }))), null);
  assert.equal(resolveGrams(ing('1 cup flour', food())), null);
});
test('resolveGrams: count items via portions', () => {
  const egg = food({ portions: [{ label: 'small', g: 38 }, { label: 'medium', g: 44 }, { label: 'large', g: 50 }] });
  assert.equal(resolveGrams(ing('2 large eggs', egg)), 100);
  assert.equal(resolveGrams(ing('2 eggs', egg)), 88);          // default = medium
  assert.equal(resolveGrams(ing('1 small egg', egg)), 38);
  const garlic = food({ portions: [{ label: '1 clove', g: 3 }, { label: '1 medium bulb', g: 40 }] });
  assert.equal(resolveGrams(ing('3 cloves garlic, minced', garlic)), 9);   // unit word beats the default 'medium'
  const bread = food({ portions: [{ label: '2 slices', g: 56 }] });
  assert.equal(resolveGrams(ing('3 slices bread', bread)), 84);           // label with a number is per-unit
});
test('resolveGrams: count qty null only for real portions', () => {
  const egg = food({ portions: [{ label: 'large', g: 50 }] });
  assert.equal(resolveGrams({ ...ing('egg', egg), qty: null }), 50);
  assert.equal(resolveGrams({ ...ing('salt', food({ servingG: 6 })), qty: null }), null);
});
test('resolveGrams: serving fallback', () => {
  assert.equal(resolveGrams(ing('2 bagels', food({ servingG: 90, servingLabel: '1 bagel' }))), 180);
  assert.equal(resolveGrams(ing('2 bagels', food({ servingG: 0 }))), null);
});
test('resolveGrams: can size from prep, pinch constant', () => {
  close(resolveGrams(ing('2 (14 oz) cans tomatoes', food())), 2 * 14 * 28.3495);
  close(resolveGrams(ing('1 can (400 g) beans', food())), 400);
  close(resolveGrams(ing('2 pinches salt', food({ servingG: 100 }))), 0.8);
});
test('resolveGrams: bad qty -> null', () => {
  assert.equal(resolveGrams({ ...ing('1 cup', food()), qty: -1 }), null);
  assert.equal(resolveGrams({ ...ing('1 cup', food()), qty: 0 }), null);
});

const recipe = (ings, servings = 2) => ({ ...newRecipe('r', 1), servings, ingredients: ings });
test('recipeNutrition complete + per serving', () => {
  const r = recipe([ing('200 g rice', food()), ing('100 g chicken', food({ per100: { k: 200, p: 30, c: 0, f: 8 } }), 'j')]);
  const n = recipeNutrition(r);
  assert.deepEqual(n.total, { k: 400, p: 50, c: 40, f: 18 });
  assert.deepEqual(n.perServing, { k: 200, p: 25, c: 20, f: 9 });
  assert.equal(n.totalGrams, 300); assert.equal(n.count, 2); assert.equal(n.linked, 2); assert.equal(n.complete, true); assert.deepEqual(n.missing, []);
  assert.equal(recipeNutrition({ ...r, servings: 4 }).perServing.k, 100);
  assert.equal(recipeNutrition({ ...r, servings: 0 }).perServing.k, 400);
});
test('recipeNutrition incomplete', () => {
  const r = recipe([ing('200 g rice', food()), newIngredient('1 cup mystery', 'm'), ing('1 cup flour', food(), 'n')]);
  const n = recipeNutrition(r);
  assert.equal(n.count, 3); assert.equal(n.linked, 1); assert.equal(n.complete, false);
  assert.deepEqual(n.missing, ['mystery', 'flour']);
  assert.equal(n.total.k, 200);
});
test('recipeNutrition: ingredient.grams override', () => {
  const i = { ...ing('1 cup flour', food()), grams: 120 };
  assert.equal(recipeNutrition(recipe([i])).total.k, 120);
});
test('recipeNutrition: ignorable ingredients', () => {
  const r = recipe([ing('200 g rice', food()), newIngredient('2 cups water', 'a'), newIngredient('salt to taste', 'b'), newIngredient('1/2 tsp black pepper', 'c'),
    newIngredient('a pinch of cumin', 'd'), newIngredient('parsley, optional', 'e')]);
  const n = recipeNutrition(r);
  assert.equal(n.count, 1); assert.equal(n.complete, true); assert.deepEqual(n.missing, []);
  const bell = recipeNutrition(recipe([newIngredient('1 red bell pepper', 'x')]));
  assert.equal(bell.count, 1); assert.deepEqual(bell.missing, ['red bell pepper']);
});
test('recipeNutrition: empty recipe is not complete', () => {
  const n = recipeNutrition(recipe([]));
  assert.equal(n.count, 0); assert.equal(n.complete, false); assert.equal(n.total.k, 0);
});

test('saveRecipe / deleteRecipe / tombstones', () => {
  const s = { recipes: {}, tombstones: {} };
  const r = newRecipe('r1', 1); r.name = 'Soup';
  assert.equal(saveRecipe(s, r, 100), r);
  assert.equal(s.recipes.r1.updatedAt, 100);
  assert.equal(deleteRecipe(s, 'r1', 200), true);
  assert.equal(s.recipes.r1, undefined); assert.equal(s.tombstones.r1, 200);
  assert.equal(deleteRecipe(s, 'r1', 300), false); assert.equal(s.tombstones.r1, 200);
  saveRecipe(s, r, 400);
  assert.equal('r1' in s.tombstones, false);
  assert.equal(s.recipes.r1.updatedAt, 400);
});
test('save/delete tolerate missing maps', () => {
  const s = {}; saveRecipe(s, newRecipe('a', 0), 1); assert.ok(s.recipes.a);
  assert.equal(deleteRecipe({}, 'a', 1), false);
});

test('searchRecipes', () => {
  const mk = (id, name, tags, ings) => ({ ...newRecipe(id, 1), name, tags, ingredients: ings.map((n, k) => newIngredient(n, id + k)) });
  const s = { recipes: { a: mk('a', 'banana bread', ['baking'], ['2 cups flour', '3 bananas']), b: mk('b', 'Apple pie', ['dessert', 'baking'], ['1 lb apples']), c: mk('c', 'chili', ['dinner'], ['1 can beans']) } };
  assert.deepEqual(searchRecipes(s, '').map(r => r.id), ['b', 'a', 'c']);
  assert.deepEqual(searchRecipes(s, 'BAKING').map(r => r.id), ['b', 'a']);
  assert.deepEqual(searchRecipes(s, 'apples').map(r => r.id), ['b']);
  assert.deepEqual(searchRecipes(s, 'pie baking').map(r => r.id), ['b']);
  assert.deepEqual(searchRecipes(s, 'flour dinner').map(r => r.id), []);
  assert.deepEqual(searchRecipes({}, 'x'), []);
});

test('scaleIngredientText', () => {
  const f = newIngredient('2 cups flour, sifted', 'a');
  assert.equal(scaleIngredientText(f, 1.5), '3 cups flour, sifted');
  assert.equal(scaleIngredientText(f, 0.25), '1/2 cup flour, sifted');
  assert.equal(scaleIngredientText(f, 0.5), '1 cup flour, sifted');
  assert.equal(scaleIngredientText(newIngredient('3 cloves garlic, minced', 'b'), 1 / 3), '1 clove garlic, minced');
  assert.equal(scaleIngredientText(newIngredient('1 lb. ground beef', 'c'), 2), '2 lb ground beef');
  assert.equal(scaleIngredientText(newIngredient('2 large eggs', 'd'), 1.5), '3 large eggs');
  assert.equal(scaleIngredientText(newIngredient('1 (14 oz) can tomatoes, drained', 'e'), 2), '2 cans tomatoes, drained');
  assert.equal(scaleIngredientText(newIngredient('salt to taste', 'f'), 2), 'salt to taste');
  assert.equal(scaleIngredientText(newIngredient('2 tbsp olive oil', 'g'), 1.5), '3 tbsp olive oil');
  assert.equal(scaleIngredientText(newIngredient('1 cup milk', 'h'), 0.3333), '1/3 cup milk');
});
test('formatQty re-exported behaviour used by scaling', () => assert.equal(formatQty(0.75), '3/4'));

test('resolveGrams never throws on a hostile unit (it is used to build a pattern)', () => {
  const food = { name: 'X', brand: '', source: 'x', per100: { k: 1, p: 0, c: 0, f: 0 }, servingG: 10, servingLabel: '1 serving' };
  for (const unit of ['(', '[', '\\', '.*', '+', '?', '$^', 'a{1', '(?<x']) assert.doesNotThrow(() => resolveGrams({ id: 'i', name: 'x', qty: 1, unit, prep: '', food, grams: null }, {}), unit);
  assert.doesNotThrow(() => recipeNutrition({ id: 'r', name: 'r', servings: 2, ingredients: [{ id: 'i', name: 'x', qty: 1, unit: '(', prep: '', food, grams: null }] }, {}));
});
