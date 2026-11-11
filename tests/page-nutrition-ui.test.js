// WEAK static checks for the page-nutrition UI (docs/specs/page-nutrition.md, behaviours U1..U6). They read source text only: they prove
// markup, wording and calls exist, NOT that the editor shows the numbers, that typing updates the draft, or that anything is escaped
// correctly at runtime. The manual checklist in the spec is what actually covers the UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('U1 recipe editor has the block "Nutrition per serving (from the page)" with four number inputs reKcal, reProt, reCarb, reFat', () => {
  const src = read('js/ui/recipe-editor.js');
  assert.ok(src.includes('Nutrition per serving (from the page)'));
  for (const id of ['reKcal', 'reProt', 'reCarb', 'reFat']) {
    const m = new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`).exec(src);
    assert.ok(m, `<input id="${id}">`);
    assert.match(m[0], /type="number"/, `${id} is a number input`);
    assert.ok(new RegExp(`<label[^>]*\\bfor="${id}"`).test(src), `${id} has a label`);
  }
});

test('U2 the editor reads and writes draft.stated; a blank kcal means null; the page serving text is escaped', () => {
  const src = strip(read('js/ui/recipe-editor.js'));
  assert.match(src, /\bd(?:raft)?\.stated\b/, 'reads draft.stated');
  assert.match(src, /\.stated\s*=\s*null/, 'blank kcal sets stated to null');
  assert.match(src, /\.stated\s*=\s*\{/, 'filled numbers set a stated object');
  assert.ok(/\bper\b/.test(src));
  assert.ok(/esc\([^)]*\bper\b[^)]*\)/.test(src), 'the `per` text goes through esc()');
  for (const id of ['reKcal', 'reProt', 'reCarb', 'reFat']) assert.ok(src.includes(id), `${id} is read by script`);
});

test('U3 the summary card says where the numbers come from, driven by recipeNutrition().source', () => {
  const src = read('js/ui/recipe-editor.js');
  assert.match(strip(src), /\.source\b/, 'uses the source field');
  assert.match(strip(src), /['"]stated['"]/);
  assert.ok(src.includes('from linked foods'));
  assert.ok(src.includes('from the page (estimate)'));
  assert.ok(src.includes('link all ingredients to use your own foods'));
});

test('U4 recipes list card shows a "from page" badge when the source is stated, and still shows "incomplete" for foods', () => {
  const src = read('js/ui/recipes-view.js');
  assert.ok(src.includes('from page'));
  assert.match(strip(src), /\.source\s*===?\s*['"]stated['"]|['"]stated['"]\s*===?\s*[\w.]*source/);
  assert.ok(src.includes('incomplete'));
  assert.ok(/badge/.test(src));
});

test('U5 the plan view "link foods" toast depends on source === "none", not on linked === 0', () => {
  const src = strip(read('js/ui/plan-view.js'));
  assert.ok(!/\.linked\s*===?\s*0/.test(src), 'no linked === 0 test left');
  assert.match(src, /\.source\s*===?\s*['"]none['"]/);
  assert.ok(src.includes('Link foods'));
});

test('U6 service worker: CACHE was bumped past macro-diary-v29 (tests/sw.test.js already enforces the precache list)', () => {
  const sw = read('sw.js');
  const m = /const CACHE = 'macro-diary-v(\d+)'/.exec(sw);
  assert.ok(m, 'CACHE has the usual form');
  assert.ok(Number(m[1]) > 29, `CACHE is v${m[1]} but must be greater than 29`);
});
