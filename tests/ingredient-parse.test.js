import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredient as p, normalizeUnit, formatQty } from '../js/domain/ingredient-parse.js';
import { UNIT_MAP, SYNONYMS } from '../js/domain/ingredient-tokens.js';

const cases = [
  // [text, qty, unit, name, prep]
  ['2 cups all-purpose flour, sifted', 2, 'cup', 'all-purpose flour', 'sifted'],
  ['1 cup sugar', 1, 'cup', 'sugar', ''],
  ['1/2 cup (120 ml) milk', 0.5, 'cup', 'milk', '120 ml'],
  ['1 1/2 cups milk', 1.5, 'cup', 'milk', ''],
  ['1.5 tsp vanilla extract', 1.5, 'tsp', 'vanilla extract', ''],
  ['2 tbsp. olive oil', 2, 'tbsp', 'olive oil', ''],
  ['2 Tbsp butter, softened', 2, 'tbsp', 'butter', 'softened'],
  ['3 tablespoons soy sauce', 3, 'tbsp', 'soy sauce', ''],
  ['1 lb. ground beef', 1, 'lb', 'ground beef', ''],
  ['2 pounds baby back ribs', 2, 'lb', 'baby back ribs', ''],
  ['8 oz cream cheese', 8, 'oz', 'cream cheese', ''],
  ['200g plain flour', 200, 'g', 'plain flour', ''],
  ['1.5kg potatoes', 1.5, 'kg', 'potatoes', ''],
  ['500 ml water', 500, 'ml', 'water', ''],
  ['2 fl oz milk', 2, 'fl oz', 'milk', ''],
  ['3 cloves garlic, minced', 3, 'clove', 'garlic', 'minced'],
  ['2 large eggs', 2, '', 'large eggs', ''],
  ['1 medium onion, diced', 1, '', 'medium onion', 'diced'],
  ['2 slices bacon', 2, 'slice', 'bacon', ''],
  ['1 stick butter', 1, 'stick', 'butter', ''],
  ['1 (14 oz) can tomatoes', 1, 'can', 'tomatoes', '14 oz'],
  ['1 15-ounce can goya black beans', 1, 'can', 'black beans', '15 ounce'],
  ['1 large can tomatoes', 1, 'can', 'tomatoes', 'large'],
  ['1 (10 ounce) package frozen chopped spinach, thawed, drained and squeezed dry', 1, 'package', 'frozen spinach', '10 ounce, thawed drained and squeezed dry, chopped'],
  ['juice of 1 lemon', 1, '', 'lemon juice', ''],
  ['Juice of 1/2 lime, divided', 0.5, '', 'lime juice', 'divided'],
  ['salt to taste', null, '', 'salt', 'to taste'],
  ['a pinch of salt', 1, 'pinch', 'salt', ''],
  ['pinch of cayenne', 1, 'pinch', 'cayenne', ''],
  ['a cup of milk', 1, 'cup', 'milk', ''],
  ['one large onion', 1, '', 'large onion', ''],
  ['Two cups rice', 2, 'cup', 'rice', ''],
  ['½ cup raisins', 0.5, 'cup', 'raisins', ''],
  ['1½ cups flour', 1.5, 'cup', 'flour', ''],
  ['¾ tsp salt', 0.75, 'tsp', 'salt', ''],
  ['⅓ cup honey', 1 / 3, 'cup', 'honey', ''],
  ['⅔ cup oats', 2 / 3, 'cup', 'oats', ''],
  ['⅛ tsp nutmeg', 0.125, 'tsp', 'nutmeg', ''],
  ['2-3 tbsp oil', 3, 'tbsp', 'oil', ''],
  ['2 to 3 cloves garlic', 3, 'clove', 'garlic', ''],
  ['1 1/2 to 2 cups stock', 2, 'cup', 'stock', ''],
  ['  3 eggs  ', 3, '', 'eggs', ''],
  ['Kraft light brown sugar', null, '', 'light brown sugar', ''],
  ['1 cup Heinz ketchup', 1, 'cup', 'ketchup', ''],
  ['2 tsp kosher salt', 2, 'tsp', 'salt', ''],
  ['chopped fresh parsley for garnish', null, '', 'parsley', 'for garnish, chopped'],
  ['2 cups hot sauce', 2, 'cup', 'hot sauce', ''],
  ['2 racks baby back ribs', 4, 'lb', 'baby back ribs', ''],
  ['1 whole chicken, 4 1/2 to 5 1/2 pounds, cut into parts', 1, '', 'whole chicken', '4 1/2 to 5 1/2 pounds cut into parts'],
  ['1 cup finely chopped onion', 1, 'cup', 'onion', 'finely chopped'],
  ['3 each carrots', 3, '', 'carrots', ''],
  ['1 can (15 oz) chickpeas, drained', 1, 'can', 'chickpeas', '15 oz, drained'],
];
for (const [text, qty, unit, name, prep] of cases) {
  test(`parse: ${text}`, () => {
    const r = p(text);
    assert.equal(r.raw, text);
    assert.equal(r.unit, unit);
    assert.equal(r.name, name);
    assert.equal(r.prep, prep);
    if (qty === null) assert.equal(r.qty, null); else assert.ok(Math.abs(r.qty - qty) < 1e-9, `qty ${r.qty} != ${qty}`);
  });
}

test('empty and whitespace', () => {
  assert.deepEqual(p(''), { raw: '', name: '', qty: null, unit: '', prep: '' });
  assert.equal(p('   ').name, '');
  assert.equal(p('   ').qty, null);
});

test('never throws on junk', () => {
  const junk = [null, undefined, 5, {}, [], '???', '1/0 cup x', '0/0', '(', ')))(((', '1 (', '﻿2 cups tea', '-', ',', '1 to', '1 -', '.', '1.2.3 cups', 'a', 'an',
    'x'.repeat(5000), '\u0000\u0001', '🍕 2 slices', '9999999999999999999999 cups', '1/', '/2', 'cup', 'to taste', 'juice of', 'zest of ', 'of', '1 cup of'];
  for (const j of junk) {
    const r = p(j);
    assert.equal(typeof r.name, 'string'); assert.equal(typeof r.unit, 'string'); assert.equal(typeof r.prep, 'string');
    assert.ok(r.qty === null || Number.isFinite(r.qty), String(j));
  }
  const bits = ['1', '1/2', '½', 'cup', 'to', '-', '(', ')', ',', 'of', 'juice', 'a', 'oz', '.', 'salt'];
  for (let i = 0; i < 300; i++) {
    const s = Array.from({ length: 1 + (i % 12) }, (_, k) => bits[(i * 7 + k * 13 + k * k) % 15]).join(i % 2 ? ' ' : '');
    assert.doesNotThrow(() => p(s), s);
  }
});

test('zero denominators do not produce Infinity/NaN', () => {
  const r = p('1/0 cup flour');
  assert.ok(r.qty === null || Number.isFinite(r.qty));
});

test('BOM and unicode spaces are tolerated', () => {
  assert.equal(p('﻿2 cups rice').qty, 2);
  assert.equal(p('﻿2 cups rice').unit, 'cup');
});

test('normalizeUnit', () => {
  assert.equal(normalizeUnit('Tablespoons'), 'tbsp');
  assert.equal(normalizeUnit('tbsp.'), 'tbsp');
  assert.equal(normalizeUnit('c.'), 'cup');
  assert.equal(normalizeUnit('LBS'), 'lb');
  assert.equal(normalizeUnit('fl. oz.'), 'fl oz');
  assert.equal(normalizeUnit('cloves'), 'clove');
  assert.equal(normalizeUnit('each'), '');
  assert.equal(normalizeUnit('banana'), '');
  assert.equal(normalizeUnit(null), '');
  assert.equal(normalizeUnit('constructor'), '');
});

test('vocabulary canonical tokens are lowercase', () => {
  for (const v of Object.values(UNIT_MAP)) assert.equal(v, v.toLowerCase());
  assert.equal(SYNONYMS['kosher salt'], 'salt');
});

test('formatQty', () => {
  const t = [[1.5, '1 1/2'], [0.3333, '1/3'], [0.75, '3/4'], [2, '2'], [0.5, '1/2'], [2.6667, '2 2/3'], [0.125, '1/8'], [0.1, '0.1'], [2.9999, '3'],
    [0, '0'], [12.5, '12 1/2'], [0.6667, '2/3'], [null, ''], [NaN, ''], [-1, ''], [undefined, '']];
  for (const [q, s] of t) assert.equal(formatQty(q), s, String(q));
});
