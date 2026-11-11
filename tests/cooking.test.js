// docs/specs/cooking-mode.md behaviours 1-13: pure helpers in js/domain/cooking.js. Expected values are hand-computed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mod = () => import('../js/domain/cooking.js');

const deepFreeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const recipe = () => ({
  id: 'r1', name: 'Pancakes', servings: 4, steps: ['Mix', 'Fry'], source: 'https://example.com/p',
  ingredients: [
    { name: 'flour', qty: 2, unit: 'cup', prep: 'sifted', raw: '2 cups flour, sifted' },
    { name: 'butter', qty: 3, unit: 'tbsp', prep: '', raw: '3 tbsp butter' },
    { name: 'salt', qty: null, unit: '', prep: '', raw: 'salt to taste' },
  ],
});

test('1 scaleFactor = wanted / recipe for valid pairs', async () => {
  const { scaleFactor } = await mod();
  assert.equal(scaleFactor(4, 8), 2); assert.equal(scaleFactor(4, 2), 0.5);
  assert.equal(scaleFactor(2, 3), 1.5); assert.equal(scaleFactor(4, 4), 1);
});

test('2 scaleFactor falls back to 1 for invalid input', async () => {
  const { scaleFactor } = await mod();
  for (const bad of [0, -1, NaN, Infinity, '4', null, undefined, {}, []]) {
    assert.equal(scaleFactor(bad, 4), 1, `recipe ${String(bad)}`);
    assert.equal(scaleFactor(4, bad), 1, `wanted ${String(bad)}`);
  }
});

test('3 clampServings clamps to [0.25, 100], non-finite/non-number -> 1', async () => {
  const { clampServings, MIN_SERVINGS, MAX_SERVINGS } = await mod();
  assert.equal(MIN_SERVINGS, 0.25); assert.equal(MAX_SERVINGS, 100);
  assert.equal(clampServings(3), 3); assert.equal(clampServings(0), 0.25); assert.equal(clampServings(-5), 0.25);
  assert.equal(clampServings(0.1), 0.25); assert.equal(clampServings(1000), 100); assert.equal(clampServings(0.25), 0.25);
  for (const bad of [NaN, Infinity, -Infinity, '4', null, undefined, {}, []]) assert.equal(clampServings(bad), 1, String(bad));
});

test('4 halve/double/step follow the clamp', async () => {
  const { halveServings, doubleServings, stepServings } = await mod();
  assert.equal(halveServings(4), 2); assert.equal(halveServings(1), 0.5); assert.equal(halveServings(0.25), 0.25);
  assert.equal(doubleServings(4), 8); assert.equal(doubleServings(80), 100); assert.equal(doubleServings(100), 100);
  assert.equal(stepServings(4, 1), 5); assert.equal(stepServings(1, -1), 0.25); assert.equal(stepServings(0.25, -1), 0.25);
  assert.equal(stepServings(4, NaN), 4);
});

test('5 cookingIngredients scales by hand-computed values and keeps unscalable lines', async () => {
  const { cookingIngredients } = await mod();
  assert.deepEqual(cookingIngredients(recipe(), 8), ['4 cups flour, sifted', '6 tbsp butter', 'salt to taste']);
  assert.deepEqual(cookingIngredients(recipe(), 2), ['1 cup flour, sifted', '1 1/2 tbsp butter', 'salt to taste']);
  assert.deepEqual(cookingIngredients(recipe(), 1), ['1/2 cup flour, sifted', '3/4 tbsp butter', 'salt to taste']);
  assert.deepEqual(cookingIngredients(recipe(), 4), ['2 cups flour, sifted', '3 tbsp butter', 'salt to taste']);
});

test('6 invalid wanted -> recipe yield (unscaled); out-of-range wanted equals the clamped result', async () => {
  const { cookingIngredients } = await mod();
  const base = ['2 cups flour, sifted', '3 tbsp butter', 'salt to taste'];
  for (const bad of [NaN, 0, -3, 'x', undefined, null, Infinity]) assert.deepEqual(cookingIngredients(recipe(), bad), base, String(bad));
  assert.deepEqual(cookingIngredients(recipe(), 1000), cookingIngredients(recipe(), 100));
  assert.deepEqual(cookingIngredients(recipe(), 0.1), cookingIngredients(recipe(), 0.25));
  assert.equal(cookingIngredients(recipe(), 100)[1], '75 tbsp butter');   // 3 x (100/4)
  const noYield = recipe(); delete noYield.servings;
  assert.deepEqual(cookingIngredients(noYield, 8), base);
});

test('7 hostile recipes: safe, verbatim strings, no mutation, own properties only', async () => {
  const { cookingIngredients, cookingSteps } = await mod();
  for (const bad of [null, undefined, 5, 'x', [], () => 1]) {
    assert.deepEqual(cookingIngredients(bad, 2), []); assert.deepEqual(cookingSteps(bad), []);
  }
  assert.deepEqual(cookingIngredients({ ingredients: 'nope', steps: {} }, 2), []);
  assert.deepEqual(cookingSteps({ steps: 'nope' }), []);
  assert.deepEqual(cookingIngredients({ servings: 2, ingredients: [null, 5, 'x', [], { raw: 'a pinch of salt' }] }, 2), ['a pinch of salt']);
  const evil = '<img src=x onerror=alert(1)> & "q"';
  assert.deepEqual(cookingIngredients({ servings: 2, ingredients: [{ raw: evil, qty: null }] }, 4), [evil]);
  assert.deepEqual(cookingSteps({ steps: ['</li><script>alert(1)</script>'] }), ['</li><script>alert(1)</script>']);
  assert.deepEqual(cookingIngredients(Object.create({ ingredients: [{ raw: 'inherited' }], servings: 2 }), 2), []);
  assert.deepEqual(cookingSteps(Object.create({ steps: ['inherited'] })), []);
  const proto = JSON.parse('{"__proto__":{"ingredients":[{"raw":"pp"}],"steps":["pp"]},"servings":2}');
  assert.deepEqual(cookingIngredients(proto, 2), []); assert.deepEqual(cookingSteps(proto), []);
  assert.doesNotThrow(() => cookingIngredients({ servings: 1e308, ingredients: [{ name: 'x', qty: 1e308, unit: 'cup' }] }, 100));
  assert.ok(cookingIngredients({ servings: 1e308, ingredients: [{ name: 'x', qty: 1e308, unit: 'cup' }] }, 100).every(s => typeof s === 'string'));
  const frozen = deepFreeze(recipe());
  assert.doesNotThrow(() => { cookingIngredients(frozen, 8); cookingSteps(frozen); });
  assert.deepEqual(frozen, recipe());
});

test('8 cookingSteps keeps non-blank string steps in order, verbatim', async () => {
  const { cookingSteps } = await mod();
  assert.deepEqual(cookingSteps({ steps: ['Mix', '  ', '', 5, null, ' Bake  ', {}] }), ['Mix', ' Bake  ']);
  assert.deepEqual(cookingSteps({ steps: [] }), []);
  assert.deepEqual(cookingSteps(recipe()), ['Mix', 'Fry']);
});

test('9 toggleTick adds, removes, sorts, sanitises, does not mutate, ignores invalid', async () => {
  const { toggleTick } = await mod();
  assert.deepEqual(toggleTick([], 2, 5), [2]);
  assert.deepEqual(toggleTick([2], 2, 5), []);
  assert.deepEqual(toggleTick([3, 1], 2, 5), [1, 2, 3]);
  const frozen = Object.freeze([3, 1]);
  const out = toggleTick(frozen, 0, 5);
  assert.deepEqual(out, [0, 1, 3]); assert.deepEqual([...frozen], [3, 1]); assert.notEqual(out, frozen);
  assert.deepEqual(toggleTick([7, 'a', 1, 1, -2, 1.5, null], 0, 3), [0, 1]);
  for (const bad of [-1, 5, 1.5, NaN, '1', null, undefined, Infinity]) assert.deepEqual(toggleTick([1], bad, 5), [1], String(bad));
  for (const bad of [0, -1, NaN, 2.5, '3', undefined]) assert.deepEqual(toggleTick([1], 1, bad), [], String(bad));
  for (const bad of [null, undefined, 'abc', {}, 5]) assert.deepEqual(toggleTick(bad, 1, 3), [1]);
});

test('10 setCurrentStep selects, clears on re-tap, ignores invalid, result always valid', async () => {
  const { setCurrentStep } = await mod();
  assert.equal(setCurrentStep(null, 2, 5), 2);
  assert.equal(setCurrentStep(2, 2, 5), null);
  assert.equal(setCurrentStep(2, 4, 5), 4);
  assert.equal(setCurrentStep(null, 0, 5), 0);
  assert.equal(setCurrentStep(2, 0, 5), 0);
  for (const bad of [5, 6, -1, 1.5, NaN, '3', null, undefined, Infinity]) assert.equal(setCurrentStep(2, bad, 5), 2, String(bad));
  assert.equal(setCurrentStep(null, NaN, 5), null);
  assert.equal(setCurrentStep(7, 'x', 5), null); assert.equal(setCurrentStep(undefined, 1, 3), 1);
  assert.equal(setCurrentStep(null, 0, 0), null); assert.equal(setCurrentStep(1, 1, NaN), null); assert.equal(setCurrentStep(1, 0, -2), null);
});

test('11 safeSourceLink: plain http/https only', async () => {
  const { safeSourceLink } = await mod();
  for (const ok of ['https://example.com/recipe', 'http://example.com', 'HTTPS://Example.com/a?b=1#c', 'https://example.com/a b'.replace(' ', '%20')]) assert.equal(safeSourceLink(ok), ok);
  const bad = ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://example.com/x', 'file:///etc/passwd',
    'https://user:pw@example.com/', 'https://user@example.com/', ' https://example.com', 'https://example.com ', '\nhttps://example.com', 'https://', 'example.com',
    '', 'not a url', '//example.com', 'https://example.com/' + 'a'.repeat(600), 'vbscript:x', 'blob:https://example.com/uuid'];
  for (const b of bad) assert.equal(safeSourceLink(b), '', JSON.stringify(b).slice(0, 60));
  for (const b of [null, undefined, 5, {}, [], ['https://example.com'], true, { toString: () => 'https://example.com' }]) assert.equal(safeSourceLink(b), '');
});

test('12 display scaling never mutates the state', async () => {
  const m = await mod();
  const state = { recipes: { r1: recipe() }, plan: {}, log: {} };
  const snap = JSON.parse(JSON.stringify(state));
  deepFreeze(state);
  const r = state.recipes.r1;
  assert.doesNotThrow(() => {
    m.cookingIngredients(r, m.doubleServings(r.servings)); m.cookingIngredients(r, m.halveServings(r.servings));
    m.cookingSteps(r); m.safeSourceLink(r.source); m.scaleFactor(r.servings, 7);
  });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), snap);
  assert.equal(state.recipes.r1.servings, 4);
});

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
test('13 layer rules: domain/cooking.js and services/wakelock.js', () => {
  const dom = strip(readFileSync(new URL('../js/domain/cooking.js', import.meta.url), 'utf8'));
  const specs = [...dom.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const allowed = [/^\.\/[a-z-]+\.js$/, /^\.\.\/core\/(constants|format|dates|schema)\.js$/];
  assert.deepEqual(specs.filter(s => !allowed.some(a => a.test(s))), []);
  assert.ok(specs.every(s => !/ui\/|services\/|store|dom\.js|bus/.test(s)));
  for (const g of ['document', 'window', 'localStorage', 'navigator', 'fetch', 'sessionStorage', 'indexedDB'])
    assert.ok(!new RegExp(`\\b${g}\\b`).test(dom), `domain uses ${g}`);
  const svc = strip(readFileSync(new URL('../js/services/wakelock.js', import.meta.url), 'utf8'));
  assert.ok(!/from\s*['"][^'"]*\/ui\//.test(svc), 'service must not import ui');
  for (const g of ['document', 'navigator', 'window', 'globalThis', 'localStorage'])
    assert.ok(!new RegExp(`\\b${g}\\b`).test(svc), `service uses global ${g}`);
});
