// Added after the PR #21 review (not written by the test designer): a title or intro line that merely STARTS with a nutrition word
// ("Fat-free Lemon Dip") must not be swallowed as a nutrition line in pasted text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFromText } from '../js/domain/recipe-import.js';

test('X1 a title or intro line that starts with a nutrition word is kept as text, not read as nutrition', () => {
  const r = importFromText('Fat-free Lemon Dip\nProtein-packed and quick\nFat free is the goal\nCalories: low\nIngredients\n- 1 cup yogurt\nMethod\n1. Stir.');
  assert.equal(r.name, 'Fat-free Lemon Dip');
  assert.ok(r.description.includes('Protein-packed and quick') && r.description.includes('Fat free is the goal'), r.description);
  assert.strictEqual(r.nutrition, null);
});

test('X2 real nutrition lines still work next to such a title', () => {
  const r = importFromText('Fat-free Lemon Dip\nCalories: 120\nProtein 6 g\nIngredients\n- 1 cup yogurt\nMethod\n1. Stir.');
  assert.equal(r.name, 'Fat-free Lemon Dip');
  assert.deepEqual(r.nutrition, { k: 120, p: 6, c: 0, f: 0, per: '' });
});
