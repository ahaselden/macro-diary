// Tests for docs/specs/recipe-import.md, domain part (js/domain/recipe-import.js). Written before the implementation exists.
// Golden values are hand written (fixtures in tests/fixtures/recipe-import/, expected outputs in .../expected/). Modules are
// imported dynamically so each test fails on its own. Titles carry the behaviour number (R1..R30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeRecipe } from '../js/core/schema.js';
import { newIngredient } from '../js/domain/recipes.js';

const mod = () => import('../js/domain/recipe-import.js');
const fx = name => readFileSync(new URL(`./fixtures/recipe-import/${name}`, import.meta.url), 'utf8');
const gold = name => JSON.parse(fx(`expected/${name}`));
const ld = json => `<script type="application/ld+json">${typeof json === 'string' ? json : JSON.stringify(json)}</script>`;
const page = (...blocks) => `<!doctype html><html><head>${blocks.join('\n')}</head><body></body></html>`;
const names = nodes => nodes.map(n => n.name);
const extract = async html => (await mod()).extractRecipeJsonLd(html);
const fromLd = async node => (await mod()).importFromJsonLd(node);
const fromText = async t => (await mod()).importFromText(t);
const fromJsonNode = async (extra) => fromLd({ '@type': 'Recipe', name: 'T', ...extra });
const KEYS = ['description', 'ingredients', 'name', 'servings', 'steps', 'tags', 'totalTime', 'warnings'];
const hasWarning = (r, re) => r.warnings.some(w => re.test(w));
const allStrings = r => [r.name, r.description, ...r.tags, ...r.steps, ...r.ingredients, ...r.warnings];
const RE_ING = /ingredient/i, RE_STEP = /step|instruction|method|direction/i, RE_SERV = /serving/i, RE_NUT = /nutrition/i;

// ---- extractRecipeJsonLd ---------------------------------------------------------------------------------------

test('R1 extractRecipeJsonLd: a bare Recipe object in one ld+json script', async () => {
  const r = await extract(page(ld({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Soup' })));
  assert.ok(Array.isArray(r)); assert.equal(r.length, 1); assert.equal(r[0].name, 'Soup');
});

test('R2 extractRecipeJsonLd: arrays and @graph (also an @graph inside an array); only Recipe nodes come back', async () => {
  assert.deepEqual(names(await extract(page(ld([{ '@type': 'Organization', name: 'Org' }, { '@type': 'Recipe', name: 'A' }])))), ['A']);
  assert.deepEqual(names(await extract(page(ld({ '@graph': [{ '@type': 'WebPage', name: 'P' }, { '@type': 'Recipe', name: 'B' }, { '@type': 'Article', name: 'X' }] })))), ['B']);
  assert.deepEqual(names(await extract(page(ld([{ '@graph': [{ '@type': 'Recipe', name: 'C' }] }])))), ['C']);
  assert.deepEqual(names(await extract(page(ld({ '@graph': [{ '@type': 'Recipe', name: 'D1' }, { '@type': 'Recipe', name: 'D2' }] })))), ['D1', 'D2']);
});

test('R3 extractRecipeJsonLd: @type may be a string or an array containing Recipe; other types are not recipes', async () => {
  assert.deepEqual(names(await extract(page(ld({ '@type': 'Recipe', name: 'S' })))), ['S']);
  assert.deepEqual(names(await extract(page(ld({ '@type': ['Article', 'Recipe'], name: 'Arr' })))), ['Arr']);
  assert.deepEqual(await extract(page(ld({ '@type': ['NewsArticle'], name: 'N' }))), []);
  assert.deepEqual(await extract(page(ld({ '@type': 'HowTo', name: 'H' }))), []);
  assert.deepEqual(await extract(page(ld({ '@type': 'RecipeCollection', name: 'RC' }))), []);
  assert.deepEqual(await extract(page(ld({ name: 'no type' }))), []);
});

test('R4 extractRecipeJsonLd: script attribute order, quoting and case do not matter; look-alike attributes do not count', async () => {
  const body = '{"@type":"Recipe","name":"Z"}';
  const variants = [
    `<script type='application/ld+json'>${body}</script>`,
    `<SCRIPT TYPE="APPLICATION/LD+JSON">${body}</SCRIPT>`,
    `<script data-rh="true" id="x" type="application/ld+json" class=a>${body}</script>`,
    `<script type=application/ld+json>${body}</script>`,
    `<script\n   type="application/ld+json"\n>${body}</script >`,
  ];
  for (const v of variants) assert.deepEqual(names(await extract(v)), ['Z'], v);
  for (const v of [`<script type="application/json">${body}</script>`, `<script>var a=${body};</script>`, `<script type="text/javascript">${body}</script>`,
    `<script data-type="application/ld+json">${body}</script>`]) assert.deepEqual(await extract(v), [], v);
});

test('R5 extractRecipeJsonLd: HTML-comment and CDATA wrappers and surrounding whitespace are tolerated', async () => {
  const body = '{"@type":"Recipe","name":"W"}';
  for (const inner of [`<!-- ${body} -->`, `//<![CDATA[\n${body}\n//]]>`, `<![CDATA[ ${body} ]]>`, `/*<![CDATA[*/ ${body} /*]]>*/`, `\n\n   ${body}\n  `, `﻿${body}`])
    assert.deepEqual(names(await extract(`<script type="application/ld+json">${inner}</script>`)), ['W'], inner);
});

test('R6 extractRecipeJsonLd: several blocks are all read in document order; malformed JSON is skipped; non-ld scripts are ignored', async () => {
  const html = page(
    ld({ '@type': 'Article', name: 'Not a recipe' }),
    ld({ '@type': 'Recipe', name: 'One' }),
    '<script type="application/ld+json">{"@type":"Recipe", "name": </script>',
    '<script type="application/ld+json">{"@type":"Recipe","name":"Trailing",}</script>',
    ld({ '@type': 'Recipe', name: 'Two' }),
    '<script>var x = {"@type":"Recipe","name":"Nope"}</script>');
  assert.deepEqual(names(await extract(html)), ['One', 'Two']);
});

test('R7 extractRecipeJsonLd: never throws and returns [] for non-strings, empty and garbage input', async () => {
  const bad = [undefined, null, 42, true, {}, [], () => 1, Symbol('s'), { toString() { throw new Error('boom'); } }, '', '   ', 'x'.repeat(100000), '<script type="application/ld+json">', 'null', '<script type="application/ld+json">null</script>', '<script type="application/ld+json">"str"</script>', '<script type="application/ld+json">42</script>'];
  for (const b of bad) assert.deepEqual(await extract(b), []);
});

// ---- parseDuration / parseYield --------------------------------------------------------------------------------

test('R8 parseDuration: ISO-8601 durations to whole minutes (hand computed)', async () => {
  const { parseDuration } = await mod();
  const table = { PT1H30M: 90, PT45M: 45, P0DT2H: 120, PT90M: 90, PT1H: 60, PT0H15M: 15, P1D: 1440, P1DT1H: 1500, PT2H5M: 125, P0DT0H20M0S: 20, P30D: 43200 };
  for (const [iso, min] of Object.entries(table)) assert.equal(parseDuration(iso), min, iso);
});

test('R9 parseDuration: garbage, zero, numbers and absurd values are null (numbers are NOT minutes: the unit would be a guess)', async () => {
  const { parseDuration } = await mod();
  for (const g of ['', ' ', 'soon', '45', '1h30', 'PT', 'P', 'PT0M', 'P0D', 'PT-5M', 'PTM', 'PT1X', 'PT1H30M extra', 'P31D', 'PT99999999H', null, undefined, 45, 0, NaN, Infinity, {}, [], true])
    assert.equal(parseDuration(g), null, String(g));
});

test('R10 parseYield: servings from numbers, strings and arrays (ranges take the FIRST number)', async () => {
  const { parseYield } = await mod();
  const table = [[4, 4], [6, 6], [2.5, 2.5], ['4', 4], [' 4 ', 4], ['4 servings', 4], ['8 Servings', 8], ['Serves 6', 6], ['Serves: 6', 6], ['2-3 servings', 2], ['6 to 8 servings', 6], ['2–3', 2],
    [['4', '4 servings'], 4], [['4 servings'], 4], [[8], 8], [['', '6'], 6], ['12 cookies', 12], ['Makes 24', 24], ['1 loaf', 1], ['4 servings (about 2 cups each)', 4], ['Yield: 8 portions', 8], [1000, 1000], ['1000', 1000]];
  for (const [input, out] of table) assert.equal(parseYield(input), out, JSON.stringify(input));
});

test('R11 parseYield: never 0, negative, NaN or absurd; unparseable is null', async () => {
  const { parseYield } = await mod();
  for (const g of [0, -1, NaN, Infinity, -Infinity, '0', '0 servings', '', ' ', 'many', 'servings', 'a dozen', 'twelve', null, undefined, {}, [], [[]], [null], true, 1001, '1001', 1e9, '99999999'])
    assert.equal(parseYield(g), null, JSON.stringify(g));
});

// ---- importFromJsonLd -------------------------------------------------------------------------------------------

const golden = (r, g) => {
  assert.equal(r.name, g.name);
  if ('description' in g) assert.equal(r.description, g.description);
  assert.equal(r.servings, g.servings);
  assert.equal(r.totalTime, g.totalTime);
  if (g.tagsSorted) assert.deepEqual([...r.tags].sort(), [...g.tagsSorted].sort());
  assert.deepEqual(r.steps, g.steps);
  assert.deepEqual(r.ingredients, g.ingredients);
  assert.equal(r.warnings.length, g.warningCount, r.warnings.join(' | '));
  for (const p of g.warningPatterns || []) assert.ok(hasWarning(r, new RegExp(p, 'i')), p);
};

test('R12 importFromHtml golden: @graph with WebSite+WebPage+Article+Recipe (fixture graph-webpage-recipe.html); result has exactly the documented keys', async () => {
  const { importFromHtml } = await mod();
  const r = importFromHtml(fx('graph-webpage-recipe.html'));
  assert.deepEqual(Object.keys(r).sort(), KEYS);
  golden(r, gold('graph-webpage-recipe.json'));
  assert.ok(Array.isArray(r.tags) && Array.isArray(r.steps) && Array.isArray(r.ingredients) && Array.isArray(r.warnings));
});

test('R13 golden: array form with @type ["Recipe","NewsArticle"], "Serves 6", entities, string steps (fixture array-recipe.html)', async () => {
  golden((await mod()).importFromHtml(fx('array-recipe.html')), gold('array-recipe.json'));
});

test('R14 golden: HowToSection steps are flattened in order, section names are not steps (fixture howtosection-recipe.html)', async () => {
  golden((await mod()).importFromHtml(fx('howtosection-recipe.html')), gold('howtosection-recipe.json'));
});

test('R15 golden: instructions and ingredients as ONE string each, numbering stripped, entity &#176; decoded, no warnings (fixture string-instructions.html)', async () => {
  const r = (await mod()).importFromHtml(fx('string-instructions.html'));
  golden(r, gold('string-instructions.json'));
  assert.deepEqual(r.warnings, []);
});

test('R16 recipeInstructions shapes', async () => {
  const steps = async v => (await fromJsonNode({ recipeInstructions: v })).steps;
  assert.deepEqual(await steps('Mix.\nBake.'), ['Mix.', 'Bake.']);
  assert.deepEqual(await steps('Mix.\r\n\r\nBake.\n'), ['Mix.', 'Bake.']);
  assert.deepEqual(await steps('Just one long sentence.'), ['Just one long sentence.']);
  assert.deepEqual(await steps(['Mix.', 'Bake.']), ['Mix.', 'Bake.']);
  assert.deepEqual(await steps([{ '@type': 'HowToStep', text: 'Mix.' }, { '@type': 'HowToStep', text: 'Bake.' }]), ['Mix.', 'Bake.']);
  assert.deepEqual(await steps([{ '@type': 'HowToStep', name: 'Mix.' }]), ['Mix.']);
  assert.deepEqual(await steps([{ '@type': 'HowToStep', name: 'Short', text: 'The long text.' }]), ['The long text.']);
  assert.deepEqual(await steps(['A', { '@type': 'HowToStep', text: 'B' }, { '@type': 'HowToSection', name: 'Sec', itemListElement: ['C', { '@type': 'HowToStep', text: 'D' }] }]), ['A', 'B', 'C', 'D']);
  assert.deepEqual(await steps({ '@type': 'HowToSection', name: 'Only', itemListElement: [] }), []);
  assert.deepEqual(await steps(['', '   ', null, 5, {}, [], 'Mix.']), ['Mix.']);
  assert.deepEqual(await steps(undefined), []);
  assert.deepEqual(await steps(42), []);
});

test('R17 string instructions: HTML list/paragraph/br become separate steps; bullets and "1." / "2)" numbering are stripped but quantities are not', async () => {
  const steps = async v => (await fromJsonNode({ recipeInstructions: v })).steps;
  assert.deepEqual(await steps('<ol><li>Mix.</li><li>Bake.</li></ol>'), ['Mix.', 'Bake.']);
  assert.deepEqual(await steps('<p>Mix.</p><p>Bake.</p>'), ['Mix.', 'Bake.']);
  assert.deepEqual(await steps('Mix.<br>Bake.<br/>Cool.'), ['Mix.', 'Bake.', 'Cool.']);
  assert.deepEqual(await steps('1. Mix.\n2) Bake.\n- Cool.\n• Serve.\n* Eat.'), ['Mix.', 'Bake.', 'Cool.', 'Serve.', 'Eat.']);
  assert.deepEqual(await steps('Bake at 350. Cool.'), ['Bake at 350. Cool.']);
  assert.deepEqual(await steps('1.5 cups of water go in the pot.\n2 eggs go in next.'), ['1.5 cups of water go in the pot.', '2 eggs go in next.']);
});

test('R18 recipeIngredient: array, or one string split on newlines (not commas); trimmed; blanks and non-strings dropped; duplicates kept', async () => {
  const ings = async v => (await fromJsonNode({ recipeIngredient: v })).ingredients;
  assert.deepEqual(await ings(['2 eggs', ' 1 cup flour ']), ['2 eggs', '1 cup flour']);
  assert.deepEqual(await ings('1 cup flour\n2 eggs\r\n\r\nsalt, to taste'), ['1 cup flour', '2 eggs', 'salt, to taste']);
  assert.deepEqual(await ings('salt, pepper'), ['salt, pepper']);
  assert.deepEqual(await ings(['2   cups \n milk', '', '  ', null, 7, {}, '1 pinch salt', '1 pinch salt']), ['2 cups milk', '1 pinch salt', '1 pinch salt']);
  assert.deepEqual(await ings(undefined), []);
  assert.deepEqual(await ings({ a: 1 }), []);
});

test('R19 tags come from keywords (string "a, b" or array), recipeCategory and recipeCuisine; trimmed, de-duplicated case-insensitively, blanks and non-strings dropped', async () => {
  const tags = async x => (await fromJsonNode(x)).tags;
  assert.deepEqual((await tags({ keywords: 'a, b ,c,, ' })).sort(), ['a', 'b', 'c']);
  assert.deepEqual((await tags({ keywords: ['x', ' y ', '', 3, null] })).sort(), ['x', 'y']);
  assert.deepEqual((await tags({ recipeCategory: 'Dinner', recipeCuisine: ['Italian'] })).sort(), ['Dinner', 'Italian']);
  assert.deepEqual((await tags({ recipeCategory: ['Main', 'Dinner'], recipeCuisine: 'Thai', keywords: 'quick' })).sort(), ['Dinner', 'Main', 'Thai', 'quick']);
  const dup = await tags({ keywords: 'Dinner, dinner, DINNER', recipeCategory: 'Dinner' });
  assert.deepEqual(dup.map(t => t.toLowerCase()), ['dinner']);
  assert.deepEqual(await tags({}), []);
});

test('R20 text cleaning: tags stripped, entities decoded ONCE, whitespace (incl. nbsp) collapsed and trimmed, in name/description/tags/steps/ingredients', async () => {
  const r = await fromJsonNode({
    name: 'Tom &amp; Jerry&#39;s &quot;Best&quot; &frac12; &#x41;&#66;&nbsp;&nbsp;Soup',
    description: '<p>Alpha</p><p>Beta</p>', keywords: '<b>Bold</b> and <i>it</i>',
    recipeIngredient: ['  1 &frac12;\n cups   milk &amp; cream '], recipeInstructions: ['Use &lt; 5 minutes &amp;&amp; &apos;care&apos; &gt;&gt; ok'] });
  assert.equal(r.name, 'Tom & Jerry\'s "Best" ½ AB Soup');
  assert.equal(r.description, 'Alpha Beta');
  assert.deepEqual(r.tags, ['Bold and it']);
  assert.deepEqual(r.ingredients, ['1 ½ cups milk & cream']);
  assert.deepEqual(r.steps, ["Use < 5 minutes && 'care' >> ok"]);
  assert.equal((await fromJsonNode({ name: '&amp;lt;b&amp;gt;' })).name, '&lt;b&gt;');
  assert.equal((await fromJsonNode({ name: 'Fish &bogus; chips' })).name, 'Fish &bogus; chips');
  assert.equal((await fromJsonNode({ name: '  a \n\t b  ' })).name, 'a b');
  for (const odd of ['&#0;', '&#xD800;', '&#99999999999;', '&#x110000;', '&#;', '&#x;', '&']) {
    const n = (await fromJsonNode({ name: `a${odd}b` })).name;
    assert.equal(typeof n, 'string'); assert.ok(!n.includes('\u0000'), odd);
  }
});

test('R21 bounds equal sanitizeRecipe: name 200, description 2000, 20 tags x 40, 100 steps x 2000, 200 ingredients (each line <= 300)', async () => {
  const r = await fromJsonNode({ name: 'n'.repeat(500), description: 'd'.repeat(5000), keywords: Array.from({ length: 30 }, (_, i) => `tag${i}-` + 't'.repeat(100)),
    recipeInstructions: Array.from({ length: 150 }, (_, i) => `step ${i} ` + 's'.repeat(5000)), recipeIngredient: Array.from({ length: 300 }, (_, i) => `${i + 1} g ` + 'x'.repeat(1000)) });
  assert.ok(r.name.length > 0 && r.name.length <= 200);
  assert.ok(r.description.length > 0 && r.description.length <= 2000);
  assert.equal(r.tags.length, 20); assert.ok(r.tags.every(t => t.length <= 40));
  assert.equal(r.steps.length, 100); assert.ok(r.steps.every(s => s.length <= 2000));
  assert.equal(r.ingredients.length, 200); assert.ok(r.ingredients.every(s => s.length > 0 && s.length <= 300));
  assert.ok(r.steps[0].startsWith('step 0 ') && r.ingredients[0].startsWith('1 g '), 'the FIRST items are kept');
});

test('R22 servings and time: unknown servings default to 4 and warn; totalTime parsed from ISO or null', async () => {
  const a = await fromJsonNode({});
  assert.equal(a.servings, 4); assert.equal(a.totalTime, null);
  assert.ok(a.warnings.some(w => RE_SERV.test(w) && /4/.test(w)), 'the warning states the default of 4');
  const b = await fromJsonNode({ recipeYield: '6 servings', totalTime: 'PT1H30M' });
  assert.equal(b.servings, 6); assert.equal(b.totalTime, 90); assert.ok(!hasWarning(b, RE_SERV));
  assert.equal((await fromJsonNode({ recipeYield: 'lots', totalTime: 'later' })).totalTime, null);
});

test('R23 warnings: missing ingredients, missing steps, unknown servings, missing title, nutrition present-but-ignored; a complete recipe has none', async () => {
  const full = { recipeYield: 4, recipeIngredient: ['1 egg'], recipeInstructions: ['Cook.'] };
  assert.deepEqual((await fromJsonNode(full)).warnings, []);
  const noIng = await fromJsonNode({ ...full, recipeIngredient: [] });
  assert.ok(hasWarning(noIng, RE_ING)); assert.ok(!hasWarning(noIng, RE_STEP) && !hasWarning(noIng, RE_SERV) && !hasWarning(noIng, RE_NUT));
  const noSteps = await fromJsonNode({ ...full, recipeInstructions: undefined });
  assert.ok(hasWarning(noSteps, RE_STEP)); assert.ok(!hasWarning(noSteps, RE_ING));
  const noTitle = await fromLd({ '@type': 'Recipe', ...full });
  assert.equal(noTitle.name, ''); assert.ok(hasWarning(noTitle, /title|name/i));
  const nut = await fromJsonNode({ ...full, nutrition: { '@type': 'NutritionInformation', calories: '310 calories', proteinContent: '9 g' } });
  assert.ok(hasWarning(nut, RE_NUT), 'nutrition on the page is ignored and the user is told');
  assert.deepEqual(Object.keys(nut).sort(), KEYS, 'nutrition is NOT imported (no calories/macros field)');
  assert.ok(!JSON.stringify(nut).includes('310'), 'no nutrition value leaks into the result');
  const empty = await fromLd({ '@type': 'Recipe' });
  for (const re of [RE_ING, RE_STEP, RE_SERV, /title|name/i]) assert.ok(hasWarning(empty, re), String(re));
  assert.ok(empty.warnings.every(w => typeof w === 'string' && w.length > 0));
  assert.equal(new Set(empty.warnings).size, empty.warnings.length, 'no duplicate warnings');
});

test('R24 importFromJsonLd never throws on non-recipe input and always returns the full empty shape; inputs are not mutated', async () => {
  for (const bad of [null, undefined, 'str', 42, true, [], [{}], {}, () => 1]) {
    const r = await fromLd(bad);
    assert.deepEqual(Object.keys(r).sort(), KEYS);
    assert.equal(r.name, ''); assert.equal(r.description, ''); assert.equal(r.servings, 4); assert.equal(r.totalTime, null);
    assert.deepEqual([r.tags, r.steps, r.ingredients], [[], [], []]); assert.ok(r.warnings.length >= 1);
  }
  const wrongTypes = { '@type': 'Recipe', name: { a: 1 }, description: [1, 2], recipeIngredient: { x: 1 }, recipeInstructions: 5, keywords: 7, recipeYield: {}, totalTime: [], recipeCategory: {}, recipeCuisine: 3 };
  const r = await fromLd(wrongTypes);
  assert.equal(typeof r.name, 'string'); assert.equal(typeof r.description, 'string');
  assert.ok(Array.isArray(r.tags) && Array.isArray(r.steps) && Array.isArray(r.ingredients)); assert.equal(r.servings, 4);
  const frozen = structuredClone({ '@type': 'Recipe', name: 'Frozen', recipeIngredient: ['1 egg'], recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ text: 'x' }] }], keywords: 'a,b' });
  const snapshot = structuredClone(frozen);
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  const out = await fromLd(deepFreeze(frozen));
  assert.equal(out.name, 'Frozen'); assert.deepEqual(frozen, snapshot);
});

// ---- importFromHtml ---------------------------------------------------------------------------------------------

test('R25 importFromHtml: first Recipe wins; null when there is none (microdata-only page, no scripts, empty, non-strings)', async () => {
  const { importFromHtml } = await mod();
  assert.equal(importFromHtml(fx('microdata-only.html')), null);
  assert.equal(importFromHtml('<html><body>no scripts</body></html>'), null);
  assert.equal(importFromHtml(page(ld({ '@type': 'Article', name: 'A' }))), null);
  for (const bad of ['', undefined, null, 42, {}, []]) assert.equal(importFromHtml(bad), null);
  const two = importFromHtml(page(ld({ '@type': 'Recipe', name: 'First' }), ld({ '@type': 'Recipe', name: 'Second' })));
  assert.equal(two.name, 'First');
});

// ---- importFromText ---------------------------------------------------------------------------------------------

test('R26 importFromText golden: title, Serves, Prep/Total time, Ingredients with - * bullets, Method with 1. and 2) numbering (fixture paste-recipe.txt)', async () => {
  const g = gold('paste-recipe.json');
  const r = await fromText(fx('paste-recipe.txt'));
  assert.deepEqual(Object.keys(r).sort(), KEYS);
  assert.equal(r.name, g.name); assert.equal(r.servings, g.servings); assert.equal(r.totalTime, g.totalTime);
  assert.deepEqual(r.steps, g.steps); assert.deepEqual(r.ingredients, g.ingredients);
  assert.deepEqual(r.warnings, []);
  assert.equal(typeof r.description, 'string'); assert.deepEqual(r.tags, []);
  assert.ok(!r.ingredients.some(l => /serves|prep time|total time/i.test(l)), 'meta lines are not ingredients');
  assert.ok(!r.steps.some(l => /serves|prep time|total time/i.test(l)));
  const crlf = await fromText(fx('paste-recipe.txt').replace(/\r?\n/g, '\r\n'));
  assert.deepEqual([crlf.name, crlf.ingredients, crlf.steps, crlf.servings, crlf.totalTime], [r.name, r.ingredients, r.steps, r.servings, r.totalTime]);
  const cr = await fromText(fx('paste-recipe.txt').replace(/\r?\n/g, '\r'));
  assert.deepEqual(cr.ingredients, r.ingredients);
});

test('R27 importFromText headers: case, trailing colon, markdown #, synonyms, either order, ingredients-only; a leading header means no title', async () => {
  const body = ['1 cup flour', '2 eggs'];
  const ing = ['1 cup flour', '2 eggs'], st = ['Mix.', 'Bake.'];
  for (const [ih, sh] of [['INGREDIENTS', 'METHOD'], ['Ingredients:', 'Directions:'], ['## Ingredients', '## Steps'], ['ingredients', 'instructions'], ['Ingredients', 'Instructions']]) {
    const r = await fromText(`Pie\n\n${ih}\n${body.map(b => '- ' + b).join('\n')}\n\n${sh}\n1. Mix.\n2. Bake.\n`);
    assert.equal(r.name, 'Pie', ih); assert.deepEqual(r.ingredients, ing, ih); assert.deepEqual(r.steps, st, sh);
  }
  const swapped = await fromText('Pie\nMethod\n1. Bake.\nIngredients\n- 2 apples');
  assert.deepEqual(swapped.ingredients, ['2 apples']); assert.deepEqual(swapped.steps, ['Bake.']);
  const ingOnly = await fromText('Pie\nIngredients\n- 2 apples\n- 1 cup flour');
  assert.deepEqual(ingOnly.ingredients, ['2 apples', '1 cup flour']); assert.deepEqual(ingOnly.steps, []); assert.ok(hasWarning(ingOnly, RE_STEP)); assert.ok(!hasWarning(ingOnly, RE_ING));
  const headFirst = await fromText('Ingredients\n- 1 cup flour\nInstructions\n1. Mix.');
  assert.deepEqual(headFirst.ingredients, ['1 cup flour']); assert.deepEqual(headFirst.steps, ['Mix.']); assert.notEqual(headFirst.name.toLowerCase(), 'ingredients');
  assert.equal((await fromText('# Banana Bread\nIngredients\n- 1 banana')).name, 'Banana Bread');
});

test('R28 importFromText lines: bullets (- * bullet en-dash, "1." "2)") stripped, quantities kept, blank/whitespace lines skipped, trimmed, entities decoded, tags stripped', async () => {
  const r = await fromText('Soup\nIngredients\n\n  - 1 cup salt &amp; pepper  \n   \n• 1/2 cup water\n– 2 eggs\n* 3 tbsp oil\n1. 4 carrots\n2) <b>5</b> onions\nMethod\n\n  1.  Boil <i>gently</i>.  \n\n2)   Serve.');
  assert.deepEqual(r.ingredients, ['1 cup salt & pepper', '1/2 cup water', '2 eggs', '3 tbsp oil', '4 carrots', '5 onions']);
  assert.deepEqual(r.steps, ['Boil gently.', 'Serve.']);
});

test('R29 importFromText meta: Serves/Servings/Yield and Total time in several spellings; no meta means 4 servings + warning', async () => {
  const sv = async line => (await fromText(`Cake\n${line}\nIngredients\n- 1 egg\nMethod\n1. Bake.`)).servings;
  for (const [line, n] of [['Serves 4', 4], ['serves 4', 4], ['SERVES 6', 6], ['Servings: 6', 6], ['Servings 3', 3], ['Yield: 12 cookies', 12], ['Serves 4-6', 4]]) assert.equal(await sv(line), n, line);
  const tm = async line => (await fromText(`Cake\n${line}\nIngredients\n- 1 egg\nMethod\n1. Bake.`)).totalTime;
  for (const [line, n] of [['Total time: 45 minutes', 45], ['Total Time: 1 hour 15 minutes', 75], ['Total time: 1 hr', 60], ['Total: 20 min', 20], ['Total time: 2 hours', 120], ['Total time: 45 mins', 45]]) assert.equal(await tm(line), n, line);
  const none = await fromText('Cake\nIngredients\n- 1 egg\nMethod\n1. Bake.');
  assert.equal(none.servings, 4); assert.equal(none.totalTime, null); assert.ok(none.warnings.some(w => RE_SERV.test(w) && /4/.test(w)));
  const r = await fromText('Cake\nServes 4\nTotal time: 45 minutes\nIngredients\n- 1 egg\nMethod\n1. Bake.');
  assert.deepEqual(r.ingredients, ['1 egg']); assert.deepEqual(r.steps, ['Bake.']);
});

test('R30 importFromText without headers or with junk returns what it can plus warnings and never throws', async () => {
  const r = await fromText('Toast with butter\n2 slices bread\nbutter');
  assert.equal(r.name, 'Toast with butter'); assert.ok(r.warnings.length >= 1);
  if (r.ingredients.length === 0) assert.ok(hasWarning(r, RE_ING));
  if (r.steps.length === 0) assert.ok(hasWarning(r, RE_STEP));
  for (const bad of ['', '   \n\n  ', undefined, null, 42, {}, [], true, '\u0000\u0001', 'Ingredients', 'Ingredients\nMethod']) {
    const x = await fromText(bad);
    assert.deepEqual(Object.keys(x).sort(), KEYS);
    assert.equal(typeof x.name, 'string'); assert.ok(Array.isArray(x.ingredients) && Array.isArray(x.steps) && x.warnings.length >= 1);
  }
  const long = await fromText('T'.repeat(500) + '\nIngredients\n' + Array.from({ length: 400 }, (_, i) => `${i} g ${'x'.repeat(900)}`).join('\n') + '\nMethod\n' + Array.from({ length: 300 }, (_, i) => `step ${i} ${'y'.repeat(4000)}`).join('\n'));
  assert.ok(long.name.length <= 200); assert.equal(long.ingredients.length, 200); assert.ok(long.ingredients.every(l => l.length <= 300));
  assert.equal(long.steps.length, 100); assert.ok(long.steps.every(l => l.length <= 2000));
});

// ---- toRecipe ---------------------------------------------------------------------------------------------------

test('R31 toRecipe: builds an app recipe with newRecipe/newIngredient semantics, favorite false, updatedAt now, no linked food, passes sanitizeRecipe unchanged', async () => {
  const { importFromHtml, toRecipe } = await mod();
  const src = 'https://example.com/lemon-pancakes/?utm=1';
  const res = importFromHtml(fx('graph-webpage-recipe.html'));
  const before = structuredClone(res);
  const rec = toRecipe(res, 'r_abc', 1700000000000, src);
  assert.deepEqual(res, before, 'toRecipe does not mutate its input');
  assert.equal(rec.id, 'r_abc'); assert.equal(rec.updatedAt, 1700000000000); assert.equal(rec.favorite, false);
  assert.equal(rec.name, 'Lemon Pancakes'); assert.equal(rec.description, res.description); assert.equal(rec.source, src);
  assert.equal(rec.servings, 4); assert.equal(rec.totalTime, 25); assert.deepEqual(rec.tags, res.tags); assert.deepEqual(rec.steps, res.steps);
  assert.deepEqual(Object.keys(rec).sort(), ['description', 'favorite', 'id', 'ingredients', 'name', 'servings', 'source', 'steps', 'tags', 'totalTime', 'updatedAt']);
  assert.equal(rec.ingredients.length, 8);
  const ids = rec.ingredients.map(i => i.id);
  assert.ok(ids.every(i => typeof i === 'string' && i.length > 0 && i.length <= 80)); assert.equal(new Set(ids).size, 8);
  rec.ingredients.forEach((i, n) => {
    const { id, ...parsed } = newIngredient(res.ingredients[n], 'x');
    const { id: _i, ...mine } = i;
    assert.deepEqual(mine, parsed, `ingredient ${n} is exactly what the existing parser makes of the line`);
    assert.equal(i.food, null); assert.equal(i.grams, null);
  });
  const flour = rec.ingredients[0], butter = rec.ingredients[6];
  assert.deepEqual([flour.qty, flour.unit, flour.name], [1.5, 'cup', 'all-purpose flour']);
  assert.deepEqual([butter.qty, butter.unit, butter.name, butter.prep], [3, 'tbsp', 'butter', 'melted']);
  assert.deepEqual(sanitizeRecipe(rec, rec.id), rec);
});

test('R32 toRecipe source: only a valid http(s) URL without credentials and <= 500 chars is kept; everything else becomes ""', async () => {
  const { toRecipe } = await mod();
  const res = { name: 'X', description: '', servings: 2, totalTime: null, tags: [], steps: [], ingredients: [], warnings: [] };
  const src = u => toRecipe(res, 'r1', 1, u).source;
  for (const ok of ['https://example.com/recipes/pancakes', 'http://example.com/a?x=1&y=2', 'https://sub.example.co.uk/a/b/c.html']) assert.equal(src(ok), ok);
  const long = 'https://example.com/' + 'a'.repeat(480);
  assert.equal(src(long), long);
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'ftp://example.com/x', 'vbscript:x', 'https://user:pw@example.com/', 'https://user@example.com/',
    'not a url', '', '//example.com/x', '/relative/path', 'https://example.com/' + 'a'.repeat(500), null, undefined, 42, {}, []]) assert.equal(src(bad), '', String(bad));
  assert.equal(toRecipe(res, 'r1', 1).source, '');
});

test('R33 toRecipe hostile or empty results: never throws, empty name falls back to "Imported recipe", servings sane, still passes sanitizeRecipe', async () => {
  const { toRecipe } = await mod();
  for (const bad of [null, undefined, 'x', 42, [], {}, { name: '' }, { name: 5, servings: 'many', totalTime: 'x', tags: 'a', steps: 7, ingredients: {} }]) {
    const r = toRecipe(bad, 'r9', 5, '');
    assert.equal(r.id, 'r9'); assert.ok(r.name.length > 0, 'a name is always present');
    assert.ok(Number.isFinite(r.servings) && r.servings > 0);
    assert.ok(Array.isArray(r.tags) && Array.isArray(r.steps) && Array.isArray(r.ingredients));
    assert.deepEqual(sanitizeRecipe(r, r.id), r);
  }
  assert.equal(toRecipe({}, 'r9', 5, '').name, 'Imported recipe');
  const r = toRecipe({ name: 'Big', ingredients: Array.from({ length: 500 }, (_, i) => `${i} eggs`) }, 'r9', 5, '');
  assert.equal(r.ingredients.length, 200);
  const objs = toRecipe({ name: 'O', ingredients: ['1 egg', 7, null, { raw: 'x' }, '2 cups milk'] }, 'r9', 5, '');
  assert.deepEqual(objs.ingredients.map(i => i.raw), ['1 egg', '2 cups milk']);
});

// ---- security, bounds, purity ---------------------------------------------------------------------------------

test('R34 hostile page (fixture hostile.html): markup removed, prototype keys ignored, plain scripts ignored, absurd yield defaults to 4', async () => {
  const { importFromHtml, toRecipe } = await mod();
  const r = importFromHtml(fx('hostile.html'));
  assert.ok(r, 'the ld+json Recipe is found');
  assert.equal(r.name, 'Pwn Pie', 'not the decoy from the plain <script>');
  for (const s of allStrings(r)) assert.ok(!/<\s*[a-z!\/]/i.test(s), `markup left in: ${s}`);
  const all = allStrings(r).join('\n');
  for (const bad of ['onerror', 'onmouseover']) assert.ok(!all.includes(bad), bad);
  assert.deepEqual(r.ingredients, ['1 cup sugar', '2 eggs']);
  assert.deepEqual(r.steps, ['Click to mix', 'Bake']);
  assert.ok(r.description.endsWith('Tasty'));
  assert.equal(r.servings, 4); assert.ok(hasWarning(r, RE_SERV));
  assert.equal({}.polluted, undefined); assert.equal({}.polluted2, undefined); assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(Object.keys(r).sort(), KEYS);
  const rec = toRecipe(r, 'r1', 1, 'javascript:alert(1)');
  assert.equal(rec.source, ''); assert.deepEqual(sanitizeRecipe(rec, rec.id), rec);
});

test('R35 prototype safety: inherited or __proto__ properties are never read as recipe fields', async () => {
  const proto = JSON.parse('{"@type":"Recipe","__proto__":{"name":"Evil","recipeIngredient":["1 evil"]},"constructor":{"prototype":{"polluted3":1}}}');
  const r = await fromLd(proto);
  assert.equal(r.name, ''); assert.deepEqual(r.ingredients, []); assert.equal({}.polluted3, undefined);
  const inherited = await fromLd(Object.create({ name: 'Inherited', recipeIngredient: ['1 inherited'] }));
  assert.equal(inherited.name, ''); assert.deepEqual(inherited.ingredients, []);
  const viaHtml = (await mod()).importFromHtml(page(ld('{"@graph":[{"@type":"Recipe","__proto__":{"name":"Evil"}}]}')));
  assert.ok(viaHtml); assert.equal(viaHtml.name, '');
  const t = await fromText('__proto__\nIngredients\n- constructor\nMethod\n1. toString');
  assert.equal(t.name, '__proto__'); assert.deepEqual(t.ingredients, ['constructor']); assert.deepEqual(t.steps, ['toString']);
});

test('R36 pasted text with markup stays inert: tags removed (the UI escapes anything left)', async () => {
  const r = await fromText('<script>alert(1)</script>Pie\nIngredients\n<img src=x onerror=alert(1)>1 cup x\nMethod\n<a href="javascript:alert(1)">go</a> now');
  for (const s of allStrings(r)) assert.ok(!/<\s*[a-z!\/]/i.test(s), s);
  assert.ok(!allStrings(r).join('\n').includes('onerror'));
  assert.deepEqual(r.ingredients, ['1 cup x']); assert.deepEqual(r.steps, ['go now']);
});

test('R37 resource bounds: huge, deeply nested, cyclic and unterminated input finishes quickly without throwing', async () => {
  const m = await mod();
  const t0 = Date.now();
  assert.deepEqual(m.extractRecipeJsonLd('<script'.repeat(300000)), []);
  assert.deepEqual(m.extractRecipeJsonLd('<script type="application/ld+json">'.repeat(100000)), []);
  assert.deepEqual(m.extractRecipeJsonLd('<script type="application/ld+json">' + 'x'.repeat(5e6)), []);
  assert.deepEqual(m.extractRecipeJsonLd(ld('['.repeat(60000) + ']'.repeat(60000))), []);
  m.extractRecipeJsonLd(ld('{"a":'.repeat(5000) + '{"@type":"Recipe","name":"deep"}' + '}'.repeat(5000)));   // may or may not find it; must not throw or hang
  const big = { '@type': 'Recipe', name: 'Big', recipeIngredient: Array.from({ length: 1e6 }, () => '1 egg'), recipeInstructions: Array.from({ length: 1e6 }, () => 'Stir.') };
  const rb = m.importFromJsonLd(big);
  assert.equal(rb.ingredients.length, 200); assert.equal(rb.steps.length, 100);
  let deep = { '@type': 'HowToStep', text: 'bottom' };
  for (let i = 0; i < 100000; i++) deep = { '@type': 'HowToSection', itemListElement: [deep] };
  const rd = m.importFromJsonLd({ '@type': 'Recipe', name: 'Nested', recipeInstructions: [deep] });
  assert.equal(rd.name, 'Nested');
  const cyc = { '@type': 'HowToSection', itemListElement: [] }; cyc.itemListElement.push(cyc, { '@type': 'HowToStep', text: 'ok' });
  const rc = m.importFromJsonLd({ '@type': 'Recipe', name: 'Cyc', recipeInstructions: cyc });
  assert.ok(rc.steps.length <= 100);
  const cycNode = { '@type': 'Recipe', name: 'Self' }; cycNode.recipeInstructions = [cycNode]; cycNode.keywords = [cycNode];
  assert.equal(m.importFromJsonLd(cycNode).name, 'Self');
  const huge = m.importFromText('a\n'.repeat(2e6));
  assert.ok(huge.ingredients.length <= 200 && huge.steps.length <= 100);
  assert.ok(Date.now() - t0 < 20000, `took ${Date.now() - t0} ms`);
});

test('R38 purity: domain/recipe-import.js has no DOM, network, storage, clock or randomness, and only imports downward', () => {
  const src = readFileSync(new URL('../js/domain/recipe-import.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const banned of [/\bdocument\b/, /\bDOMParser\b/, /\bwindow\b/, /\bfetch\s*\(/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bDate\.now\b/, /\bnew Date\b/, /\bMath\.random\b/, /\bcrypto\b/, /\bprocess\b/, /\beval\s*\(/, /\bnew Function\b/, /\binnerHTML\b/])
    assert.ok(!banned.test(code), String(banned));
  const specs = [...src.matchAll(/(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  for (const s of specs) assert.ok(/^\.\/[\w-]+\.js$/.test(s) || /^\.\.\/core\/(constants|format|dates|schema)\.js$/.test(s), `illegal import ${s}`);
});
