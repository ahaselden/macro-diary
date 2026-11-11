// Added after the PR #28 review (not written by the test designer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSuggestion } from '../js/domain/food-match.js';
import { suggestMatches } from '../js/services/food-suggest.js';

const per = { k: 100, p: 1, c: 1, f: 1 };
const food = (name, o = {}) => ({ name, brand: '', source: 'USDA', per100: per, servingG: 0, servingLabel: '', ...o });
const ing = (name, extra = {}) => ({ id: 'i_' + name, raw: name, name, qty: 1, unit: 'g', prep: '', food: null, grams: null, ...extra });

test('X1 a qualifier the ingredient says but the food lacks (ground, canned, dried...) makes the pick at most "check"', () => {
  const g = pickSuggestion(ing('ground beef'), [food('Beef, tenderloin, raw')]);
  assert.equal(g.confidence, 'check');
  const t = pickSuggestion(ing('ground turkey'), [food('Turkey, breast, meat only')]);
  assert.equal(t.confidence, 'check');
  assert.equal(pickSuggestion(ing('ground beef'), [food('Beef, ground, 80% lean')]).confidence, 'likely', 'the food says "ground" too');
  assert.equal(pickSuggestion(ing('dried basil'), [food('Basil, dried')]).confidence, 'likely');
  assert.equal(pickSuggestion(ing('onion'), [food('Onions, raw')]).confidence, 'likely', 'no qualifier: unchanged');
});

test('X2 only a real "429" stops the run as a rate limit, not a longer number', async () => {
  const two = [ing('onion'), ing('olive oil')];
  const calls = [];
  const search = async q => { calls.push(q); throw new Error('Request id 14290 failed'); };
  const res = await suggestMatches(two, { search, sleep: async () => {} });
  assert.equal(calls.length, 2, 'continued after an unrelated error containing 14290');
  assert.equal(res.stoppedEarly, false);
  const hit = await suggestMatches(two, { search: async () => { throw new Error('HTTP 429'); }, sleep: async () => {} });
  assert.equal(hit.reason, 'rate-limit');
});
