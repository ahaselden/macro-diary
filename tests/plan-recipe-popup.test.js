// Tests for docs/specs/plan-recipe-popup.md. R1-R14: behavioural tests of the pure helper recipeSummary (js/domain/recipes.js), values hand computed.
// V1-V10: WEAK static checks that read source text of js/ui/plan-view.js, js/ui/recipe-view.js, css/components.css and sw.js. They prove that markup,
// imports and calls exist; they do NOT prove the popup opens, looks right, is accessible or escapes at runtime. See the manual checklist in the spec.
// All recipe text is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as recipes from '../js/domain/recipes.js';

const summary = (...a) => {
  assert.equal(typeof recipes.recipeSummary, 'function', 'js/domain/recipes.js must export recipeSummary');
  return recipes.recipeSummary(...a);
};
const KEYS = ['estimated', 'factor', 'ingredients', 'link', 'name', 'perServing', 'planned', 'servings', 'source', 'steps', 'tags', 'time', 'total'];
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const clone = o => JSON.parse(JSON.stringify(o));

const flour = () => ({ id: 'i1', raw: '2 cups flour', name: 'flour', qty: 2, unit: 'cup', prep: '', food: { name: 'Test flour', brand: '', source: 'custom', per100: { k: 100, p: 5, c: 20, f: 1 }, servingG: 0 }, grams: 400 });
const onion = () => ({ id: 'i2', raw: '1 onion, chopped', name: 'onion', qty: 1, unit: '', prep: 'chopped', food: null, grams: null });
const salt = () => ({ id: 'i3', raw: '1 tsp salt', name: 'salt', qty: 1, unit: 'tsp', prep: '', food: null, grams: null });
const stew = (over = {}) => ({ id: 'r1', name: 'Zorbble stew', description: '', source: 'https://example.test/stew', servings: 4, totalTime: 45, tags: ['soup', 'easy'],
  steps: ['Mix the flour.', 'Simmer.'], ingredients: [flour(), onion(), salt()], favorite: false, stated: null, updatedAt: 1, ...over });
const ST = { k: 300, p: 20, c: 30, f: 10, per: '1 bowl' };

// ---------- behavioural: recipeSummary ----------

test('R1 hand example: 4-serving recipe planned for 2 -> factor 0.5, scaled ingredient text, per serving 100/5/20/1, total 200/10/40/2', () => {
  // flour 400 g at 100 kcal, 5 p, 20 c, 1 f per 100 g = 400/20/80/4 over 4 servings = 100/5/20/1 per serving; x2 planned
  const s = summary(stew(), 2, {});
  assert.deepEqual(Object.keys(s).sort(), KEYS);
  assert.equal(s.name, 'Zorbble stew'); assert.equal(s.servings, 4); assert.equal(s.planned, 2); assert.equal(s.factor, 0.5);
  assert.deepEqual(s.perServing, { k: 100, p: 5, c: 20, f: 1 });
  assert.deepEqual(s.total, { k: 200, p: 10, c: 40, f: 2 });
  assert.equal(s.source, 'foods'); assert.equal(s.estimated, false);
  assert.deepEqual(s.ingredients, ['1 cup flour', '1/2 onion, chopped', '1/2 tsp salt']);   // 2 cups x 0.5 = 1 cup (singular); 1 onion x 0.5 = 1/2; tsp does not pluralise
  assert.deepEqual(s.steps, ['Mix the flour.', 'Simmer.']); assert.deepEqual(s.tags, ['soup', 'easy']);
  assert.equal(s.time, 45); assert.equal(s.link, 'https://example.test/stew');
});

test('R2 planned servings equal to the yield (or missing) -> factor 1, original amounts, total = per serving x yield (400/20/80/4)', () => {
  for (const planned of [4, undefined]) {
    const s = summary(stew(), planned, {});
    assert.equal(s.planned, 4); assert.equal(s.factor, 1);
    assert.deepEqual(s.ingredients, ['2 cups flour', '1 onion, chopped', '1 tsp salt']);
    assert.deepEqual(s.total, { k: 400, p: 20, c: 80, f: 4 });
  }
});

test('R3 more than the yield scales up: planned 6 of 4 -> factor 1.5, "3 cups flour", total 600/30/120/6; planned 1.5 -> total 150/7.5/30/1.5', () => {
  const s = summary(stew(), 6, {});
  assert.equal(s.factor, 1.5); assert.equal(s.ingredients[0], '3 cups flour'); assert.deepEqual(s.total, { k: 600, p: 30, c: 120, f: 6 });
  assert.deepEqual(summary(stew(), 1.5, {}).total, { k: 150, p: 7.5, c: 30, f: 1.5 });
});

test('R4 planned servings that are not a finite number > 0 fall back to the recipe yield (4); numbers only (not strings)', () => {
  for (const bad of [0, -1, NaN, Infinity, -Infinity, null, undefined, {}, [], true, 'abc', () => 1]) {
    const s = summary(stew(), bad, {});
    assert.equal(s.planned, 4, String(bad)); assert.equal(s.factor, 1, String(bad));
  }
});

test('R5 recipe yield that is not > 0 (0, negative, NaN, text, missing): factor 1; planned = given servings, else 1; per serving is the whole recipe', () => {
  for (const sv of [0, -2, NaN, 'x', undefined, null]) {
    const r = stew({ servings: sv }); if (sv === undefined) delete r.servings;
    const a = summary(r, 3, {});
    assert.equal(a.factor, 1, String(sv)); assert.equal(a.planned, 3);
    assert.deepEqual(a.perServing, { k: 400, p: 20, c: 80, f: 4 });   // recipeNutrition treats a bad yield as 1 serving
    assert.deepEqual(a.total, { k: 1200, p: 60, c: 240, f: 12 });
    assert.deepEqual(a.ingredients, ['2 cups flour', '1 onion, chopped', '1 tsp salt']);
    const b = summary(r, undefined, {});
    assert.equal(b.planned, 1); assert.equal(b.factor, 1);
  }
});

test('R6 stated nutrition (nothing linked): source stated, estimated true, per serving = the page numbers, total = per serving x planned', () => {
  const r = stew({ servings: 2, ingredients: [onion()], stated: { ...ST } });
  const s = summary(r, 3, {});
  assert.equal(s.source, 'stated'); assert.equal(s.estimated, true);
  assert.deepEqual(s.perServing, { k: 300, p: 20, c: 30, f: 10 });
  assert.deepEqual(s.total, { k: 900, p: 60, c: 90, f: 30 });
  assert.equal(s.factor, 1.5); assert.equal(s.ingredients[0], '1 1/2 onion, chopped');
});

test('R7 nothing linked and nothing stated: source none, estimated false, all numbers 0 (finite)', () => {
  const s = summary(stew({ ingredients: [onion()] }), 2, {});
  assert.equal(s.source, 'none'); assert.equal(s.estimated, false);
  assert.deepEqual(s.perServing, { k: 0, p: 0, c: 0, f: 0 }); assert.deepEqual(s.total, { k: 0, p: 0, c: 0, f: 0 });
});

test('R8 no steps, no tags, no time, no ingredients: empty arrays, time null, no throw', () => {
  const s = summary(stew({ steps: [], tags: [], totalTime: null, ingredients: [] }), 1, {});
  assert.deepEqual(s.steps, []); assert.deepEqual(s.tags, []); assert.deepEqual(s.ingredients, []); assert.equal(s.time, null);
  const bare = summary({ name: 'Bare' }, undefined, {});
  assert.deepEqual(bare.steps, []); assert.deepEqual(bare.tags, []); assert.deepEqual(bare.ingredients, []); assert.equal(bare.time, null); assert.equal(bare.link, ''); assert.equal(bare.name, 'Bare');
});

test('R9 steps keep only non-empty strings in order; tags keep only strings; ingredient lines that come out empty are dropped; junk entries ignored', () => {
  const s = summary(stew({ steps: ['One.', '', 5, null, {}, 'Two.'], tags: ['a', 7, null, 'b'], ingredients: ['junk', null, 5, [], {}, { name: '' }, flour()] }), 4, {});
  assert.deepEqual(s.steps, ['One.', 'Two.']);
  assert.deepEqual(s.tags, ['a', 'b']);
  assert.deepEqual(s.ingredients, ['2 cups flour']);
  for (const bad of ['text', 5, null, {}, true]) { const t = summary(stew({ steps: bad, tags: bad, ingredients: bad }), 1, {}); assert.deepEqual([t.steps, t.tags, t.ingredients], [[], [], []], String(bad)); }
});

test('R10 time is totalTime minutes for a finite number > 0, else null (null, NaN, Infinity, text)', () => {
  assert.equal(summary(stew({ totalTime: 45 }), 1, {}).time, 45);
  assert.equal(summary(stew({ totalTime: 7.5 }), 1, {}).time, 7.5);
  for (const bad of [null, undefined, NaN, Infinity, 'abc', {}, []]) assert.equal(summary(stew({ totalTime: bad }), 1, {}).time, null, String(bad));
});

test('R11 link: only a plain http(s) URL without credentials, at most 500 characters; everything else is the empty string', () => {
  const link = source => summary(stew({ source }), 1, {}).link;
  for (const ok of ['https://example.test/stew', 'http://example.test/a?b=1&c=2#x', 'https://example.test:8443/p']) assert.equal(link(ok), ok);
  const base = 'https://example.test/'; assert.equal(link(base + 'a'.repeat(479)), base + 'a'.repeat(479));   // exactly 500
  assert.equal(link(base + 'a'.repeat(480)), '');                                                            // 501
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd', 'ftp://example.test/x', 'blob:https://example.test/x',
    'https://user:pw@example.test/', 'https://user@example.test/', 'http://:pw@example.test/', '//example.test/x', 'example.test/stew', "Grandma's recipe book", 'https://', 'https:', '<script>alert(1)</script>',
    '', '   ', 'https://example.test/' + 'a'.repeat(5000), null, undefined, 5, {}, [], ['https://example.test/']]) assert.equal(link(bad), '', String(bad));
});

test('R12 hostile strings come back verbatim (the helper does not escape; the view must); a 100,000-character name is kept', () => {
  const evil = '<img src=x onerror=alert(1)> "q" \'a\' & <b>';
  const s = summary(stew({ name: evil, steps: [evil], tags: [evil], ingredients: [{ ...flour(), name: evil, raw: evil }] }), 4, {});
  assert.equal(s.name, evil); assert.deepEqual(s.steps, [evil]); assert.deepEqual(s.tags, [evil]); assert.ok(s.ingredients[0].includes(evil));
  assert.equal(summary(stew({ name: 'n'.repeat(1e5) }), 1, {}).name.length, 1e5);
  for (const bad of [null, undefined, 5, {}, [], true]) assert.equal(summary(stew({ name: bad }), 1, {}).name, '', String(bad));
});

test('R13 malformed recipes and arguments never throw and always give the full 13-key shape with finite numbers', () => {
  const bad = [null, undefined, {}, [], 'str', 5, NaN, true, () => 1, { ingredients: ['x'] }, { ingredients: [null] }, { steps: [1] }, { servings: NaN }, { servings: 1e308, ingredients: [flour()] }, { stated: 5 },
    { ingredients: [{ food: { per100: null }, grams: 5 }] }, { ingredients: [{ qty: NaN, unit: 5, name: {} }] }, { ingredients: [{ qty: 1e308, name: 'x' }] }];
  for (const r of bad) for (const planned of [undefined, 2, NaN, 1e300, -1]) for (const measures of [undefined, null, {}, 5]) {
    let s; assert.doesNotThrow(() => { s = summary(r, planned, measures); }, `${String(r && JSON.stringify(r))} ${planned}`);
    assert.deepEqual(Object.keys(s).sort(), KEYS);
    assert.ok(typeof s.name === 'string' && typeof s.link === 'string'); assert.ok(Array.isArray(s.ingredients) && Array.isArray(s.steps) && Array.isArray(s.tags));
    assert.ok(Number.isFinite(s.planned) && s.planned > 0); assert.ok(Number.isFinite(s.factor) && s.factor > 0);
    assert.ok(['foods', 'stated', 'none'].includes(s.source)); assert.equal(typeof s.estimated, 'boolean');
    for (const k of ['k', 'p', 'c', 'f']) assert.ok(Number.isFinite(s.perServing[k]), k);
  }
});

test('R14 never mutates (deep-frozen input works), returns fresh objects and arrays, own __proto__ keys do not leak or pollute', () => {
  const r = deepFreeze(stew()), before = clone(r);
  const a = summary(r, 2, {}), b = summary(r, 2, {});
  assert.deepEqual(clone(r), before);
  assert.notEqual(a, b); assert.notEqual(a.steps, r.steps); assert.notEqual(a.tags, r.tags); assert.notEqual(a.perServing, b.perServing); assert.notEqual(a.total, b.total);
  a.steps.push('x'); a.tags.push('x'); a.perServing.k = -1;
  assert.deepEqual(r.steps, before.steps); assert.deepEqual(r.tags, before.tags); assert.deepEqual(summary(r, 2, {}).perServing, { k: 100, p: 5, c: 20, f: 1 });
  const evil = JSON.parse('{"__proto__":{"name":"evil","steps":["x"],"polluted":1},"name":"Real","ingredients":[],"servings":2}');
  const s = summary(evil, 1, {});
  assert.equal(s.name, 'Real'); assert.deepEqual(s.steps, []); assert.equal(({}).polluted, undefined); assert.ok(!('polluted' in s));
  const evil2 = JSON.parse('{"__proto__":{"polluted":1}}'); summary(evil2, 1, {}); assert.equal(({}).polluted, undefined);
});

test('R15 a recipe with 20,000 ingredients and 20,000 steps summarises in well under 2 s', () => {
  const r = stew({ ingredients: Array.from({ length: 2e4 }, (_, i) => ({ id: 'i' + i, raw: '1 cup x' + i, name: 'x' + i, qty: 1, unit: 'cup', prep: '', food: null, grams: null })), steps: Array.from({ length: 2e4 }, (_, i) => 'Step ' + i) });
  const t = Date.now(); const s = summary(r, 8, {}); const ms = Date.now() - t;
  assert.ok(ms < 2000, ms + ' ms'); assert.equal(s.ingredients.length, 2e4); assert.equal(s.steps.length, 2e4);
});

// ---------- WEAK static checks ----------

const planSrc = readFileSync(new URL('../js/ui/plan-view.js', import.meta.url), 'utf8');
const swSrc = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const cssSrc = readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');
const VIEW = new URL('../js/ui/recipe-view.js', import.meta.url);
const viewSrc = () => { assert.ok(existsSync(VIEW), 'js/ui/recipe-view.js must exist'); return readFileSync(VIEW, 'utf8'); };
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripCalls = (s, name) => {   // remove name( ... ) with balanced parentheses (crude: ignores parens inside string literals)
  let out = '', i = 0;
  for (;;) {
    const j = s.indexOf(name + '(', i); if (j < 0) return out + s.slice(i);
    out += s.slice(i, j); let d = 0, k = j + name.length;
    for (; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')' && --d === 0) { k++; break; } }
    i = k;
  }
};
const itemHtmlSrc = () => { const i = planSrc.indexOf('function itemHtml'), j = planSrc.indexOf('function dayHtml', i); assert.ok(i >= 0 && j > i, 'itemHtml not found'); return planSrc.slice(i, j); };

test('V1 (weak) itemHtml: a recipe item name is a real <button type="button" class="pl-nm link" data-open> with aria-label "Open recipe ..." through esc(); food names stay plain text', () => {
  const h = itemHtmlSrc();
  const tag = h.match(/<button\b[^>]*\bclass="pl-nm link"[^>]*>/);
  assert.ok(tag, 'button.pl-nm.link not found in itemHtml');
  assert.match(tag[0], /\btype="button"/); assert.match(tag[0], /\bdata-open\b/);
  assert.match(tag[0], /aria-label="Open recipe[^"]*\$\{esc\(/);
  assert.match(h, /<button\b[^>]*class="pl-nm link"[^>]*>\s*\$\{esc\(name\)\}\s*<\/button>/);
  assert.match(h, /<div class="pl-nm">/, 'the food item keeps a plain name');
  assert.match(h, /isR\s*\?/); assert.ok(!/role=["']button["']/.test(planSrc));
});

test('V2 (weak) plan-view imports openRecipeView from ./recipe-view.js and its click handler opens it for the clicked item\'s recipe and planned servings', () => {
  assert.match(planSrc, /import\s*\{[^}]*\bopenRecipeView\b[^}]*\}\s*from\s*['"]\.\/recipe-view\.js['"]/);
  const i = planSrc.indexOf("closest('[data-open]')"); assert.ok(i >= 0, "onClick must use t.closest('[data-open]')");
  const seg = planSrc.slice(i, i + 900);
  assert.match(seg, /openRecipeView\s*\(/); assert.match(seg, /recipeId/); assert.match(seg, /servings/);
});

test('V3 (weak) a deleted recipe shows the toast "That recipe was deleted" (in the plan click handler or in openRecipeView)', () => {
  const i = planSrc.indexOf("closest('[data-open]')"); assert.ok(i >= 0);
  const inPlan = /That recipe was deleted/.test(planSrc.slice(i, i + 900));
  const inView = existsSync(VIEW) && /That recipe was deleted/.test(readFileSync(VIEW, 'utf8'));
  assert.ok(inPlan || inView, 'neither the open handler nor recipe-view.js shows the deleted-recipe toast');
});

test('V4 (weak) css/components.css styles button.pl-nm.link as a link (underline or accent colour, no button chrome)', () => {
  const m = cssSrc.match(/[^{}]*\.pl-nm\.link[^{}]*\{[^}]*\}/) || cssSrc.match(/[^{}]*button\.pl-nm[^{}]*\{[^}]*\}/);
  assert.ok(m, 'no CSS rule for .pl-nm.link');
  assert.match(m[0], /text-decoration\s*:\s*underline|color\s*:/); assert.match(m[0], /background\s*:\s*(none|transparent)/);
});

test('V5 (weak) js/ui/recipe-view.js exists, exports openRecipeView, imports only core/domain and ./recipe-editor.js, and uses recipeSummary + the shared dialog helpers', () => {
  const s = viewSrc();
  assert.match(s, /export\s+(?:async\s+)?function\s+openRecipeView\s*\(\s*recipeId\s*,\s*servings\s*\)|export\s+const\s+openRecipeView\b/);
  const specs = [...s.matchAll(/import[^'"]*?from\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(specs.length > 0);
  for (const sp of specs) assert.match(sp, /^(?:\.\.\/core\/[\w-]+\.js|\.\.\/domain\/[\w-]+\.js|\.\/recipe-editor\.js)$/, sp);
  assert.ok(specs.includes('./recipe-editor.js')); assert.match(s, /\brecipeSummary\b/);
  assert.match(s, /\bdialog\s*\(/); assert.match(s, /\bhead\s*\(/); assert.match(s, /showModal\s*\(/);
  assert.ok(!/\b(fetch|localStorage|XMLHttpRequest)\b/.test(noComments(s)));
});

test('V6 (weak) every string from the recipe goes through esc() in the view: no summary string is interpolated raw', () => {
  const s = noComments(viewSrc());
  assert.ok((s.match(/\besc\(/g) || []).length >= 5, 'expected esc( around name, ingredients, steps, tags and link');
  const rest = stripCalls(stripCalls(s, 'esc'), 'rd');
  assert.ok(!/\$\{[^}]*\.(name|link|source|description)\b/.test(rest), 'a recipe string is interpolated without esc(');
  assert.ok(!/\$\{\s*(t|s|x|i|step|tag|ing|line|text|label|link|name)\s*\}/.test(rest), 'a bare variable is interpolated without esc(');
});

test('V7 (weak) the source is a link only when summary.link is non-empty: <a> has href from link, target="_blank", rel="noopener noreferrer"; no other href', () => {
  const s = noComments(viewSrc());
  const anchors = [...s.matchAll(/<a\b[^>]*>/g)].map(m => m[0]);
  assert.ok(anchors.length >= 1, 'no <a> in the view');
  for (const a of anchors) { assert.match(a, /target="_blank"/); assert.match(a, /rel="noopener noreferrer"/); assert.match(a, /href="\$\{esc\([^)]*\blink\b[^)]*\)\}"/); }
  for (const m of s.matchAll(/href\s*=\s*["'`]([^"'`]*)/g)) assert.match(m[1], /link/, `href not built from link: ${m[1]}`);
  const i = s.indexOf('<a '); assert.match(s.slice(Math.max(0, i - 200), i), /\.link\s*\?|\.link\s*&&|if\s*\(\s*[\w.]*\.link\s*\)/, 'the anchor must be guarded by a non-empty link');
  assert.ok(!/javascript:/i.test(s));
});

test('V8 (weak) the view has real <button> Edit and Close buttons; Edit closes the view and then opens the editor for that recipe; no role="button"', () => {
  const s = noComments(viewSrc());
  for (const w of ['Edit', 'Close']) assert.match(s, new RegExp(`<button\\b[^>]*>\\s*${w}\\s*</button>`), w);
  assert.ok(!/role=["']button["']/.test(s));
  const ed = s.indexOf('openRecipeEditor('); assert.ok(ed >= 0, 'openRecipeEditor is never called');
  assert.match(s.slice(0, ed), /dialog\(\)\.close\(\)|\.close\(\)/, 'the view must be closed before the editor opens');
  assert.ok(/openRecipeEditor\(\s*[\w.\[\]]*(r|recipe)\b/.test(s));
});

test('V9 (weak) the view shows the planned servings and kcal line, the source label wording, and numbered steps (<ol>)', () => {
  const s = noComments(viewSrc());
  assert.match(s, /serving/i); assert.match(s, /kcal/i); assert.match(s, /planned/i);
  assert.match(s, /from linked foods/); assert.match(s, /from the page \(estimate\)/);
  assert.match(s, /<ol\b/);
});

test('V10 (weak) sw.js precaches js/ui/recipe-view.js and CACHE is bumped past macro-diary-v31 (the value on main when this test was written)', () => {
  const shell = swSrc.slice(swSrc.indexOf('const SHELL'), swSrc.indexOf('];', swSrc.indexOf('const SHELL')));
  assert.ok(shell.includes("'js/ui/recipe-view.js'"), 'add js/ui/recipe-view.js to SHELL');
  const n = Number((swSrc.match(/const CACHE = 'macro-diary-v(\d+)'/) || [])[1]);
  assert.ok(n > 31, `CACHE must be greater than v31, got v${n}`);
});
