// Spec: docs/specs/split-topping-lists.md. All text here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importFromJsonLd, importFromText } from '../js/domain/recipe-import.js';

const ing = list => importFromJsonLd({ '@type': 'Recipe', name: 'T', recipeIngredient: list }).ingredients;
const txt = lines => importFromText(['Title', 'Ingredients', ...lines, 'Instructions', 'Cook.'].join('\n')).ingredients;
const LINE = 'sour cream, salsa, olives, pickled radish, shredded lettuce';
const SPLIT = ['sour cream', 'salsa', 'olives', 'pickled radish', 'shredded lettuce'];
const letters = n => { let s = ''; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } while (n > 0); return s; };

test('1 label then a 5-item no-digit line splits into 5 ingredients (array form)', () => {
  assert.deepEqual(ing(['Garnish Ideas:', LINE]), SPLIT);
  assert.deepEqual(ing(['1 cup rice', 'Garnish Ideas:', LINE]), ['1 cup rice', ...SPLIT]);
});

test('2 string form with newlines splits the same way', () => {
  assert.deepEqual(ing('1 cup rice\nGarnish Ideas:\n' + LINE), ['1 cup rice', ...SPLIT]);
  assert.deepEqual(ing('Garnish Ideas:\r\n' + LINE + '\r\n'), SPLIT);
});

test('3 a 2-part line after a label is not split; neither is a line with a digit', () => {
  assert.deepEqual(ing(['Toppings:', 'salt, plus more to taste']), ['salt, plus more to taste']);
  assert.deepEqual(ing(['Toppings:', 'salt, pepper']), ['salt, pepper']);
  assert.deepEqual(ing(['Toppings:', 'sour cream, 2 jars salsa, olives']), ['sour cream, 2 jars salsa, olives']);
  assert.deepEqual(ing(['Toppings:', '1 cup rice, beans, corn, salsa']), ['1 cup rice, beans, corn, salsa']);
});

test('4 a line NOT after a label is never split', () => {
  assert.deepEqual(ing(['sour cream, salsa, olives']), ['sour cream, salsa, olives']);
  assert.deepEqual(ing(['1 cup rice', 'sour cream, salsa, olives']), ['1 cup rice', 'sour cream, salsa, olives']);
  assert.deepEqual(ing('sour cream, salsa, olives'), ['sour cream, salsa, olives']);
});

test('5 a digit line ends the rule: a later no-digit comma line is not split until a new label', () => {
  assert.deepEqual(ing(['Toppings:', '2 tbsp oil', 'a, b, c']), ['2 tbsp oil', 'a, b, c']);
  assert.deepEqual(ing(['Toppings:', '2 tbsp oil', 'a, b, c', 'More:', 'd, e, f']), ['2 tbsp oil', 'a, b, c', 'd', 'e', 'f']);
});

test('6 the rule continues over non-splittable no-digit lines until a digit or label', () => {
  assert.deepEqual(ing(['Toppings:', 'salt, pepper', 'a, b, c', 'oil', 'd, e, f']), ['salt, pepper', 'a', 'b', 'c', 'oil', 'd', 'e', 'f']);
  assert.deepEqual(ing(['Toppings:', 'a, b, c', 'd, e, f']), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('7 commas inside parentheses and brackets are not counted or split on', () => {
  assert.deepEqual(ing(['T:', 'a (b, c), d']), ['a (b, c), d']);
  assert.deepEqual(ing(['T:', 'a (b, c), d, e']), ['a (b, c)', 'd', 'e']);
  assert.deepEqual(ing(['T:', 'a [b, c], d, e']), ['a [b, c]', 'd', 'e']);
  assert.deepEqual(ing(['T:', 'a (b (c, d), e), f, g']), ['a (b (c, d), e)', 'f', 'g']);
  assert.deepEqual(ing(['T:', 'a (b, c), [d, e]']), ['a (b, c), [d, e]']);
});

test('8 two labels in a row: the rule applies to the next ingredient line; a second label restarts it', () => {
  assert.deepEqual(ing(['A:', 'B:', 'x, y, z']), ['x', 'y', 'z']);
  assert.deepEqual(ing(['A:', 'a, b', 'B:', 'x, y, z']), ['a, b', 'x', 'y', 'z']);
});

test('9 each part is trimmed and empty parts are dropped', () => {
  assert.deepEqual(ing(['T:', '  a ,b,   c  , ']), ['a', 'b', 'c']);
  assert.deepEqual(ing(['T:', 'a, b, c,']), ['a', 'b', 'c']);
});

test('10 order is preserved and duplicates are kept', () => {
  assert.deepEqual(ing(['T:', 'b, a, b, a']), ['b', 'a', 'b', 'a']);
  assert.deepEqual(ing(['b', 'T:', 'b, c, d']), ['b', 'b', 'c', 'd']);
});

test('11 unbalanced brackets do not throw or hang, and give an array', () => {
  const t0 = Date.now();
  for (const l of ['(a, b, c, d', '[a, b, c, d', 'a, b, c) d, e', ')))a, b, c', 'a (b, c, d, e (f, g', '('.repeat(5000) + 'a, b, c, d']) {
    const r = ing(['T:', l]);
    assert.ok(Array.isArray(r) && r.length >= 1, l.slice(0, 20));
  }
  assert.ok(Date.now() - t0 < 2000);
  // an opened and never closed bracket swallows the later commas: not three parts, so unchanged
  assert.deepEqual(ing(['T:', '(a, b, c, d']), ['(a, b, c, d']);
});

test('12 the text route splits after a label in the Ingredients section', () => {
  assert.deepEqual(txt(['- 1 cup rice', 'Garnish Ideas:', '- ' + LINE]), ['1 cup rice', ...SPLIT]);
  assert.deepEqual(txt(['Garnish Ideas:', LINE]), SPLIT);
});

test('13 the text route keeps the same exclusions', () => {
  assert.deepEqual(txt(['Toppings:', 'salt, pepper']), ['salt, pepper']);
  assert.deepEqual(txt(['sour cream, salsa, olives']), ['sour cream, salsa, olives']);
  assert.deepEqual(txt(['Toppings:', '2 tbsp oil', 'a, b, c']), ['2 tbsp oil', 'a, b, c']);
  assert.deepEqual(txt(['Toppings:', 'a (b, c), d']), ['a (b, c), d']);
});

test('14 the 200-ingredient cap applies to the split result', () => {
  const big = Array.from({ length: 250 }, (_, i) => letters(i)).join(', ');
  const r = ing(['T:', big]);
  assert.equal(r.length, 200);
  assert.equal(r[0], 'a');
  assert.equal(r[199], letters(199));
  const r2 = ing([...Array.from({ length: 10 }, (_, i) => 'item ' + letters(i)), 'T:', big]);
  assert.equal(r2.length, 200);
  assert.equal(r2[10], 'a');
  assert.equal(txt(['T:', big]).length, 200);
});

test('15 each split part gets the per-line cap (300 characters)', () => {
  const r = ing(['T:', 'x'.repeat(400) + ', b, c']);
  assert.deepEqual(r, ['x'.repeat(300), 'b', 'c']);
});

test('16 hostile and huge input stays bounded and never throws', () => {
  const t0 = Date.now();
  const many = 'a,'.repeat(200000);
  assert.ok(ing(['T:', many]).length <= 200);
  assert.ok(ing('T:\n' + many).length <= 200);
  assert.ok(txt(['T:', many]).length <= 200);
  assert.ok(ing(['T:', '('.repeat(100000) + ', a, b, c']).length <= 200);
  assert.ok(ing(['T:', ',,,,,,,,,,']).length <= 200);
  assert.ok(ing(Array.from({ length: 5000 }, (_, i) => (i % 2 ? 'a, b, c' : 'L:'))).length <= 200);
  assert.ok(Date.now() - t0 < 5000, 'finished in a sane time');
});

test('17 a label alone, and a label with a prototype-style name, still behave', () => {
  assert.deepEqual(ing(['Toppings:']), []);
  assert.deepEqual(ing(['__proto__:', 'constructor, toString, valueOf']), ['constructor', 'toString', 'valueOf']);
});

test('18 the invented corpus fixture is committed with the split golden', () => {
  const dir = new URL('./fixtures/site-corpus/', import.meta.url);
  const f = JSON.parse(readFileSync(new URL('synthetic-taco-bowl.json', dir), 'utf8'));
  const e = JSON.parse(readFileSync(new URL('synthetic-taco-bowl.expected.json', dir), 'utf8'));
  assert.ok(f.node.recipeIngredient.includes('Garnish Ideas:'));
  assert.deepEqual(importFromJsonLd(f.node), e);
  assert.equal(e.ingredients[1], 'sour cream');
});
