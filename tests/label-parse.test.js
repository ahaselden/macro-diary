import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLabel } from '../js/domain/label-parse.js';

const BAR = `Nutrition Facts
8 servings per container
Serving size 1 bar (50g)
Amount per serving
Calories 190
% Daily Value*
Total Fat 6g 8%
Saturated Fat 3.5g 18%
Cholesterol 10mg 3%
Sodium 200mg 9%
Total Carbohydrate 17g 6%
Dietary Fiber 2g 7%
Total Sugars 2g
Protein 20g
`;
test('a clean US label', () => {
  const r = parseLabel(BAR);
  assert.deepEqual([r.k, r.p, r.c, r.f, r.servingG, r.servingLabel], [190, 20, 17, 6, 50, '1 bar']);
  assert.deepEqual(r.missing, []); assert.deepEqual(r.warnings, []);
});
test('"Calories from Fat" is not mistaken for calories', () => {
  const r = parseLabel('Serving Size 1 cup (240g)\nCalories 150 Calories from Fat 60\nTotal Fat 7g\nTotal Carbohydrate 12g\nProtein 8g');
  assert.equal(r.k, 150); assert.equal(r.servingG, 240);
  const r2 = parseLabel('Calories from Fat 60\nCalories 150');
  assert.equal(r2.k, 150);
});
test('decimals, comma decimals and the kcal/energy style', () => {
  const r = parseLabel('Serving size 30 g\nEnergy 120 kcal\nFat 1,5g\nTotal Fat 1,5 g\nTotal Carbohydrate 22.5g\nProtein 3g');
  assert.equal(r.k, 120); assert.equal(r.f, 1.5); assert.equal(r.c, 22.5); assert.equal(r.p, 3); assert.equal(r.servingG, 30);
});
test('OCR look-alike letters inside numbers are repaired', () => {
  const r = parseLabel('Serving size 1 scoop (3Og)\nCalories 12O\nTotal Fat 1g\nTotal Carbohydrate 3g\nProtein 25g');
  assert.equal(r.servingG, 30);
  assert.equal(r.p, 25);
});
test('a misread "g" as 9 is caught by the plausibility checks, not silently accepted', () => {
  const r = parseLabel('Serving size 1 bar (50g)\nCalories 190\nTotal Fat 69\nTotal Carbohydrate 17g\nProtein 20g');
  assert.equal(r.f, null); assert.ok(r.missing.includes('fat'));
  const big = parseLabel('Serving size 1 bar (50g)\nCalories 190\nTotal Fat 6g\nTotal Carbohydrate 170g\nProtein 20g');
  assert.ok(big.warnings.some(w => /Carbs.*more than the serving weight/.test(w)));
});
test('calories that disagree with the macros produce a warning', () => {
  const r = parseLabel('Serving size 1 bar (50g)\nCalories 90\nTotal Fat 6g\nTotal Carbohydrate 17g\nProtein 20g');
  assert.ok(r.warnings.some(w => /don't match the macros/.test(w)));
});
test('partial and garbage input never throws and says what is missing', () => {
  const r = parseLabel('Protein 20g');
  assert.equal(r.p, 20); assert.deepEqual(r.missing, ['calories', 'fat', 'carbs', 'serving size (g)']);
  for (const junk of ['', null, undefined, 'lorem ipsum', '%%%%\n\n', 'Calories', 'Total Fat g', 'x'.repeat(100000)]) {
    const j = parseLabel(junk); assert.ok(Array.isArray(j.warnings));
  }
  assert.ok(parseLabel('hello').warnings[0].includes('No nutrition values'));
});
test('only the first serving column is read from a two-column "per serving / per 100 g" label', () => {
  const r = parseLabel('Serving size 1 bar (50g)\nCalories 190 380\nTotal Fat 6g 12g\nTotal Carbohydrate 17g 34g\nProtein 20g 40g');
  assert.deepEqual([r.k, r.f, r.c, r.p], [190, 6, 17, 20]);
});
test('measured OCR slip: "(50g)" read as "(509g)" is flagged, "(509)" is left empty', () => {
  const L = '\nCalories 190\nTotal Fat 6g\nTotal Carbohydrate 17g\nProtein 20g';
  const a = parseLabel('Serving size 1 bar (509g)' + L);
  assert.equal(a.servingG, 509); assert.ok(a.warnings.some(w => /read as 509 g/.test(w)));
  const b = parseLabel('Serving size 1 bar (509)' + L);
  assert.equal(b.servingG, null); assert.ok(b.missing.includes('serving size (g)'));
  assert.deepEqual(parseLabel('Serving size 1 cup (240g)\nCalories 150').warnings.filter(w => /read as/.test(w)), []);   // a normal weight is not flagged
});
test('macros heavier than the serving (sum) warn even when each one alone fits', () => {
  const r = parseLabel('Serving size 1 bar (30g)\nCalories 300\nTotal Fat 12g\nTotal Carbohydrate 20g\nProtein 20g');
  assert.ok(r.warnings.some(w => /Protein \+ carbs \+ fat/.test(w)));
});
test('EU/UK wording: "Fat", "Carbohydrate", "Protein" without "Total", and kJ/kcal energy', () => {
  const r = parseLabel('Typical values\nEnergy 1590kJ / 380kcal\nFat 12 g\nof which saturates 5 g\nCarbohydrate 34 g\nof which sugars 4 g\nProtein 40 g');
  assert.deepEqual([r.k, r.f, r.c, r.p], [380, 12, 34, 40]);        // saturates (5 g) is not mistaken for fat
});
test('"per 100 g" column first: values are taken as per 100 g and the serving becomes 100 g, with a warning', () => {
  const r = parseLabel('Nutrition per 100 g   per bar (50 g)\nEnergy 1590kJ / 380kcal   795kJ / 190kcal\nFat 12 g   6 g\nCarbohydrate 34 g   17 g\nProtein 40 g   20 g');
  assert.deepEqual([r.k, r.f, r.c, r.p, r.servingG, r.servingLabel], [380, 12, 34, 40, 100, '100 g']);
  assert.ok(r.warnings.some(w => /per 100 g/.test(w)));
});
test('"per serving" first is not treated as per 100 g', () => {
  const r = parseLabel('Per serving (50 g)   per 100 g\nCalories 190   380\nFat 6 g   12 g\nCarbohydrate 17 g   34 g\nProtein 20 g   40 g');
  assert.deepEqual([r.k, r.f, r.c, r.p], [190, 6, 17, 20]);
  assert.ok(!r.warnings.some(w => /per 100 g/.test(w)));
});
