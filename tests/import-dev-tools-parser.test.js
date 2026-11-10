// Spec: docs/specs/import-dev-tools.md (Part C). Parser fixes found on a real page; all inputs here are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importFromJsonLd, importFromText } from '../js/domain/recipe-import.js';

const base = { name: 'T', recipeIngredient: ['1 egg'], recipeInstructions: ['Cook.'], recipeYield: '2' };
const tags = extra => importFromJsonLd({ ...base, ...extra }).tags;
const ings = v => importFromJsonLd({ ...base, recipeIngredient: v }).ingredients;

test('31 category and cuisine are split on commas (strings and array elements)', () => {
  assert.deepEqual(tags({ recipeCategory: 'Dinner, Meal Prep' }), ['Dinner', 'Meal Prep']);
  assert.deepEqual(tags({ recipeCuisine: 'Thai,Vietnamese ,  Lao' }), ['Thai', 'Vietnamese', 'Lao']);
  assert.deepEqual(tags({ recipeCategory: ['Lunch, Snack', 'Brunch'] }), ['Lunch', 'Snack', 'Brunch']);
  assert.deepEqual(tags({ recipeCategory: ', ,Dinner,,' }), ['Dinner']);
  assert.deepEqual(tags({ recipeCategory: ',,,' }), []);
  assert.deepEqual(tags({ recipeCategory: 'Dinner', recipeCuisine: 'Italian' }), ['Dinner', 'Italian']);
});

test('32 split tags are de-duplicated case-insensitively in category, cuisine, keywords order and stay bounded', () => {
  assert.deepEqual(tags({ recipeCategory: 'Dinner, Meal Prep', recipeCuisine: ['Soup, Stew', 'dinner'], keywords: 'Easy, meal prep' }), ['Dinner', 'Meal Prep', 'Soup', 'Stew', 'Easy']);
  const many = Array.from({ length: 60 }, (_, i) => 'tag' + i).join(', ');
  const t = tags({ recipeCategory: many });
  assert.equal(t.length, 20);
  assert.deepEqual(t.slice(0, 3), ['tag0', 'tag1', 'tag2']);
  const long = tags({ recipeCategory: 'x'.repeat(100) + ', short' });
  assert.ok(long.every(s => s.length <= 40));
  assert.ok(long.includes('short'));
  assert.deepEqual(tags({ recipeCategory: 'constructor, __proto__' }), ['constructor', '__proto__']);
  assert.deepEqual(tags({ recipeCategory: [1, null, {}, 'A, B'] }), ['A', 'B']);
});

test('33 ingredient sub-headings (ends with ":" and no digit) are dropped, array and string forms', () => {
  assert.deepEqual(ings(['Optional Toppings:', '1 cup rice', 'For the sauce:', '2 tbsp soy sauce']), ['1 cup rice', '2 tbsp soy sauce']);
  assert.deepEqual(ings(['Optional Toppings:  ', '1 cup rice', '  For the sauce: ']), ['1 cup rice']);
  assert.deepEqual(ings('For the sauce:\n1 cup stock\nTopping:\n2 spring onions'), ['1 cup stock', '2 spring onions']);
  assert.deepEqual(ings(['Garnish:']), []);
  assert.ok(importFromJsonLd({ ...base, recipeIngredient: ['Garnish:'] }).warnings.some(w => /ingredient/i.test(w)), 'empty list still warns');
});

test('34 lines with a digit, a mid-line colon or no trailing colon are kept, in order', () => {
  assert.deepEqual(ings(['Dressing, 2 parts:', 'Sauce: 2 tbsp soy', 'Optional: a pinch of salt', 'Mix 1:', 'plain salt', 'Toppings:']), ['Dressing, 2 parts:', 'Sauce: 2 tbsp soy', 'Optional: a pinch of salt', 'Mix 1:', 'plain salt']);
  assert.deepEqual(ings(['a', 'b', 'c']), ['a', 'b', 'c']);
});

test('35 unchanged behaviour: keywords, empty input, text import still drops headings', () => {
  assert.deepEqual(tags({ keywords: 'a, b, A' }), ['a', 'b']);
  assert.deepEqual(tags({ keywords: ['x', 'y'] }), ['x', 'y']);
  assert.deepEqual(importFromJsonLd({}).tags, []);
  assert.deepEqual(importFromJsonLd(null).ingredients, []);
  const r = importFromText('Soup\nIngredients\nFor the sauce:\n1 cup stock\nMethod\nHeat it.');
  assert.deepEqual(r.ingredients, ['1 cup stock']);
});

test('36 the synthetic committed fixture yields its hand-written golden through the corpus runner', async () => {
  const { runCorpus, checkSite } = await import('../scripts/lib/site-corpus.mjs');
  const dir = new URL('./fixtures/site-corpus/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const r = await runCorpus(dir);
  assert.ok(r.total >= 1);
  assert.deepEqual(r.failed, []);
  const fx = JSON.parse(readFileSync(new URL('./fixtures/site-corpus/synthetic-lentil-soup.json', import.meta.url), 'utf8'));
  const ex = JSON.parse(readFileSync(new URL('./fixtures/site-corpus/synthetic-lentil-soup.expected.json', import.meta.url), 'utf8'));
  assert.deepEqual(importFromJsonLd(fx.node), ex);
  assert.equal(checkSite(fx, ex).ok, true);
  assert.equal(checkSite(fx, { ...ex, tags: ['Dinner, Meal Prep'] }).ok, false);
});
