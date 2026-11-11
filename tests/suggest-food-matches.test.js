// docs/specs/suggest-food-matches.md. Numbers 1..26 are behavioural tests of js/domain/food-match.js and js/services/food-suggest.js
// (hand-computed values, see the spec's scoring table). U1..U12 are WEAK static checks that read source text of js/ui/recipe-editor.js,
// css/components.css, sw.js and the two new modules: they prove strings, imports and CSS rules exist, NOT that the button works, that
// nothing is linked without a tap, or that text is escaped at runtime. That is covered only by the manual checklist in the spec.
// Modules are imported dynamically inside each test so each test fails on its own while the modules do not exist yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dom = async () => import('../js/domain/food-match.js');
const svc = async () => import('../js/services/food-suggest.js');
const fn = async (name) => { const m = await dom(); assert.equal(typeof m[name], 'function', `js/domain/food-match.js must export ${name}`); return m[name]; };
const suggestMatches = async () => { const m = await svc(); assert.equal(typeof m.suggestMatches, 'function', 'js/services/food-suggest.js must export suggestMatches'); return m.suggestMatches; };

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} expected ${b}, got ${a}`);
const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const ing = (name, extra = {}) => ({ id: 'i_' + name, raw: name, name, qty: 1, unit: '', prep: '', food: null, grams: null, ...extra });
const per = { k: 40, p: 1, c: 9, f: 0.1 };
const food = (name, o = {}) => ({ name, brand: '', source: 'USDA', per100: per, servingG: 100, servingLabel: '', ...o });

const onionsRaw = food('Onions, raw', { fdcId: 1001, servingG: 110, servingLabel: '1 medium' });
const onionPowder = food('Onion powder');
const onionRings = food('Onion rings, breaded, frozen');
const oliveOil = food('Oil, olive, salad or cooking');
const broilers = food('Chicken, broilers or fryers, breast, meat only, raw');
const nuggets = food('Chicken breast nuggets', { brand: 'Acme Foods' });

// ---------- searchQuery ----------

test('1 searchQuery: hand-computed table (fillers, parentheses, tags, case, whitespace, caps, unusable input)', async () => {
  const q = await fn('searchQuery');
  const table = [
    ['Yellow Onion', 'yellow onion'], ['ONION', 'onion'], ['  Fresh   Basil  Leaves ', 'basil leaves'], ['red\t\nonion', 'red onion'],
    ['large eggs', 'eggs'], ['boneless skinless chicken breasts', 'chicken breasts'], ['extra lean ground turkey', 'lean ground turkey'],
    ['extra virgin olive oil', 'virgin olive oil'], ['chopped fresh parsley', 'parsley'], ['minced garlic', 'garlic'],
    ['freshly ground black pepper', 'black pepper'], ['fresh-ground black pepper', 'black pepper'],
    ['tomatoes (diced)', 'tomatoes'], ['onion (about 1 cup)', 'onion'], ['<b>onion</b>', 'onion'],
    ['large', ''], ['', ''], ['   ', ''], ['(optional)', ''],
  ];
  for (const [name, want] of table) assert.equal(q({ name }), want, JSON.stringify(name));
  for (const bad of [null, undefined, 'onion', 5, [], {}, true, { name: 5 }, { name: null }, { name: {} }, { name: ['onion'] }]) assert.equal(q(bad), '', JSON.stringify(bad));
  assert.equal(q(Object.create({ name: 'onion' })), '', 'inherited name is not read');
  assert.equal(q(JSON.parse('{"__proto__":{"name":"onion"}}')), '', 'JSON-parsed own __proto__ key is not a name');
  const html = q({ name: '<img src=x onerror=alert(1)>' });
  assert.ok(!/[<>]/.test(html) && html.length <= 80, `hostile tag text: ${html}`);
  assert.ok(!/[<>]/.test(q({ name: 'onion <script' })), 'stray < removed');
  const huge = q({ name: 'x'.repeat(100000) });
  assert.ok(huge.length > 0 && huge.length <= 80, `huge name length ${huge.length}`);
  const words = q({ name: 'word '.repeat(50000) });
  assert.ok(words.length <= 80 && words === words.trim(), 'capped and trimmed');
  assert.equal(typeof q({ name: '__proto__' }), 'string');
});

test('2 searchQuery: ground is kept unless another word remains; only LEADING fillers are removed', async () => {
  const q = await fn('searchQuery');
  assert.equal(q({ name: 'ground' }), 'ground');
  assert.equal(q({ name: 'fresh ground' }), 'ground');
  assert.equal(q({ name: 'ground cinnamon' }), 'cinnamon');
  assert.equal(q({ name: 'garlic minced' }), 'garlic minced');
  assert.equal(q({ name: 'onion chopped' }), 'onion chopped');
  assert.equal(q({ name: 'sweet large onion' }), 'sweet large onion');
});

// ---------- scoreMatch ----------

test('3 scoreMatch: hand-computed scores from the spec table', async () => {
  const s = await fn('scoreMatch');
  const cases = [
    [ing('onion'), onionsRaw, 0.88], [ing('onion'), food('Onion'), 1.0], [ing('onion'), onionPowder, 0.38], [ing('onion'), onionRings, 0.14],
    [ing('olive oil'), oliveOil, 0.84], [ing('chicken breasts'), broilers, 0.78], [ing('chicken breasts'), nuggets, 0.58],
  ];
  for (const [i, f, want] of cases) near(s(i, f).score, want, `${i.name} vs ${f.name}`);
});

test('4 scoreMatch: plural folding (tomatoes/tomato, berries/berry, olives/olive, eggs/egg, onions/onion); score in [0,1]; reasons are strings', async () => {
  const s = await fn('scoreMatch');
  for (const [a, b] of [['tomatoes', 'Tomato'], ['berries', 'Berry'], ['olives', 'Olive'], ['eggs', 'Egg'], ['onions', 'Onion'], ['onion', 'Onions']]) near(s(ing(a), food(b)).score, 1.0, `${a} vs ${b}`);
  for (const i of [ing('onion'), ing('chicken breasts'), ing('x'.repeat(500))]) for (const f of [onionsRaw, onionPowder, onionRings, oliveOil, broilers, nuggets]) {
    const r = s(i, f);
    assert.ok(Number.isFinite(r.score) && r.score >= 0 && r.score <= 1, `range ${i.name.slice(0, 10)} vs ${f.name}: ${r.score}`);
    assert.ok(Array.isArray(r.reasons) && r.reasons.every(x => typeof x === 'string'));
  }
});

test('5 scoreMatch: generic beats branded and OFF; a brand word in the ingredient lifts the penalty; no overlap scores 0', async () => {
  const s = await fn('scoreMatch');
  near(s(ing('onion'), food('Onions, raw', { brand: 'Acme' })).score, 0.58, 'branded');
  near(s(ing('chicken breasts'), food('Chicken breast nuggets', { source: 'OFF' })).score, 0.58, 'OFF without brand');
  assert.ok(s(ing('onion'), onionsRaw).score > s(ing('onion'), food('Onions, raw', { brand: 'Acme' })).score);
  near(s(ing('acme chicken breast'), food('Chicken breast', { brand: 'Acme' })).score, 0.90, 'brand word in the ingredient');
  assert.ok(s(ing('acme chicken breast'), food('Chicken breast', { brand: 'Acme' })).score > s(ing('chicken breast'), food('Chicken breast', { brand: 'Acme' })).score, 'brand word helps');
  assert.equal(s(ing('onion'), food('Chocolate cake')).score, 0);
  assert.equal(s(ing('onion'), food('')).score, 0);
  assert.equal(s(ing(''), onionsRaw).score, 0);
});

test('6 scoreMatch: deterministic, fresh outputs, never throws or mutates on hostile input', async () => {
  const s = await fn('scoreMatch');
  const a = s(ing('onion'), onionsRaw), b = s(ing('onion'), onionsRaw);
  assert.deepEqual(a, b);
  assert.notEqual(a.reasons, b.reasons);
  const bad = [null, undefined, 5, 'x', [], {}, { name: 5 }, { name: { toString() { throw new Error('boom'); } } }, ing('<img src=x onerror=alert(1)>'), ing('__proto__'), ing('x'.repeat(100000))];
  for (const i of bad) for (const f of [...bad, onionsRaw, { name: 'Onion', brand: 5, source: {}, per100: null }]) {
    const r = s(i, f);
    assert.ok(r && Number.isFinite(r.score) && r.score >= 0 && r.score <= 1 && Array.isArray(r.reasons));
  }
  const fi = deepFreeze(structuredClone(ing('onion'))), ff = deepFreeze(structuredClone(onionsRaw));
  near(s(fi, ff).score, 0.88);
  assert.equal(s(Object.create({ name: 'onion' }), onionsRaw).score, 0, 'inherited name is not read');
});

// ---------- pickSuggestion ----------

test('7 pickSuggestion: a lone strong candidate is likely; a strong candidate beating the runner-up by >= 0.15 is likely', async () => {
  const p = await fn('pickSuggestion');
  const one = p(ing('onion'), [onionsRaw]);
  assert.equal(one.confidence, 'likely');
  assert.equal(one.food.name, 'Onions, raw');
  near(one.score, 0.88);
  const two = p(ing('onion'), [onionPowder, onionsRaw]);   // 0.38 then 0.88: margin 0.50
  assert.equal(two.confidence, 'likely');
  assert.equal(two.food.name, 'Onions, raw');
  const oil = p(ing('olive oil'), [oliveOil]);
  assert.equal(oil.confidence, 'likely');
  near(oil.score, 0.84);
});

test('8 pickSuggestion: ties and near-duplicates give the EARLIER candidate and only check', async () => {
  const p = await fn('pickSuggestion');
  const a = food('Onions, raw', { fdcId: 1 }), b = food('Onions, raw', { fdcId: 2 });
  const r = p(ing('onion'), [a, b]);
  assert.equal(r.confidence, 'check');
  assert.equal(r.food.fdcId, 1);
  near(r.score, 0.88);
  assert.equal(p(ing('onion'), [b, a]).food.fdcId, 2);
});

test('9 pickSuggestion: 0.45..0.75 is check; below 0.45, empty or non-array candidates give null', async () => {
  const p = await fn('pickSuggestion');
  const r = p(ing('chicken breasts'), [nuggets]);
  assert.equal(r.confidence, 'check');
  near(r.score, 0.58);
  assert.equal(p(ing('onion'), [onionPowder]), null, '0.38');
  assert.equal(p(ing('onion'), [onionRings, onionPowder]), null);
  assert.equal(p(ing('onion'), []), null);
  for (const bad of [null, undefined, 'x', 5, {}]) assert.equal(p(ing('onion'), bad), null);
});

test('10 pickSuggestion: candidates without a usable per100.k are skipped, never chosen and never the runner-up; k 0 is usable', async () => {
  const p = await fn('pickSuggestion');
  const perfectNoNutrition = [food('Onion', { per100: null }), food('Onion', { per100: {} }), food('Onion', { per100: { k: NaN } }), food('Onion', { per100: { k: -5 } }), { name: 'Onion' }, null, 'x'];
  for (const bad of perfectNoNutrition) {
    const r = p(ing('onion'), [bad, onionsRaw]);
    assert.equal(r.food.name, 'Onions, raw');
    assert.equal(r.confidence, 'likely', 'the skipped candidate is not the runner-up');
    assert.equal(p(ing('onion'), [onionsRaw, bad]).confidence, 'likely');
  }
  assert.equal(p(ing('onion'), perfectNoNutrition), null);
  const z = p(ing('sweetener'), [food('Sweetener', { per100: { k: 0, p: 0, c: 0, f: 0 } })]);
  assert.equal(z.confidence, 'likely');
  near(z.score, 1.0);
});

test('11 pickSuggestion: generic chicken (0.78) over branded nuggets (0.58) is likely (margin 0.20); nuggets alone are only check', async () => {
  const p = await fn('pickSuggestion');
  const r = p(ing('chicken breasts'), [nuggets, broilers]);
  assert.equal(r.food.name, broilers.name);
  assert.equal(r.confidence, 'likely');
  near(r.score, 0.78);
  assert.equal(p(ing('chicken breasts'), [nuggets]).confidence, 'check');
});

test('12 pickSuggestion: never throws on hostile input and does not mutate frozen input', async () => {
  const p = await fn('pickSuggestion');
  for (const i of [null, undefined, 5, [], {}, ing('<img src=x onerror=alert(1)>'), ing('__proto__'), ing('x'.repeat(100000))])
    for (const c of [null, undefined, [null, undefined, 5, 'x', [], {}], [onionsRaw], [food('x'.repeat(100000))]]) {
      const r = p(i, c);
      assert.ok(r === null || (typeof r === 'object' && ['likely', 'check'].includes(r.confidence)));
    }
  const i = deepFreeze(ing('onion')), c = deepFreeze([structuredClone(onionPowder), structuredClone(onionsRaw)]);
  assert.equal(p(i, c).confidence, 'likely');
});

// ---------- shouldSuggest / suggestionFood ----------

test('13 shouldSuggest: unlinked + usable name true; linked, empty, filler-only, ignorable lines and non-objects false', async () => {
  const sh = await fn('shouldSuggest');
  assert.equal(sh(ing('onion')), true);
  assert.equal(sh({ name: 'olive oil' }), true);
  assert.equal(sh({ name: 'onion', food: undefined }), true);
  assert.equal(sh(ing('onion', { food: { name: 'X', per100: { k: 1, p: 0, c: 0, f: 0 } } })), false, 'already linked');
  for (const name of ['', '   ', 'large', '<b></b>']) assert.equal(sh(ing(name)), false, JSON.stringify(name));
  for (const name of ['salt', 'kosher salt', 'water', 'black pepper', 'ice']) assert.equal(sh(ing(name)), false, name);
  assert.equal(sh(ing('chili flakes', { prep: 'to taste' })), false);
  assert.equal(sh(ing('chili flakes', { raw: 'chili flakes, optional' })), false);
  assert.equal(sh(ing('cayenne', { unit: 'pinch' })), false);
  assert.equal(sh(ing('nutmeg', { unit: 'dash' })), false);
  for (const bad of [null, undefined, 'onion', 5, [], true]) assert.equal(sh(bad), false, String(bad));
  assert.equal(sh(Object.create({ name: 'onion' })), false, 'inherited name');
  assert.equal(sh(JSON.parse('{"name":"x","__proto__":{"food":{"name":"evil"}}}')), true, 'own __proto__ key does not link it');
});

test('14 suggestionFood: whitelist copy, fresh objects, caps, null for invalid input, no pollution', async () => {
  const sf = await fn('suggestionFood');
  const input = { name: 'Onions, raw', brand: '', source: 'USDA', per100: { k: 40, p: 1.1, c: 9.3, f: 0.1, x: 5 }, servingG: 110, servingLabel: '1 medium', fdcId: 1001,
    portions: [{ label: '1 cup, chopped', g: 160, extra: 1 }], barcode: '12345678', id: 'zzz', secret: 'y' };
  const out = sf(input);
  assert.deepEqual(out, { name: 'Onions, raw', brand: '', source: 'USDA', per100: { k: 40, p: 1.1, c: 9.3, f: 0.1 }, servingG: 110, servingLabel: '1 medium', fdcId: 1001,
    portions: [{ label: '1 cup, chopped', g: 160 }] });
  assert.notEqual(out, input); assert.notEqual(out.per100, input.per100); assert.notEqual(out.portions, input.portions); assert.notEqual(out.portions[0], input.portions[0]);
  out.per100.k = 999; out.portions[0].g = 1;
  assert.equal(input.per100.k, 40); assert.equal(input.portions[0].g, 160);
  assert.deepEqual(sf({ name: 'A', per100: { k: 1, p: 2, c: 3, f: 4 } }), { name: 'A', brand: '', source: '', per100: { k: 1, p: 2, c: 3, f: 4 }, servingG: 0, servingLabel: '' }, 'no fdcId/portions keys when absent');
  const long = sf({ name: 'n'.repeat(500), brand: 'b'.repeat(500), source: 's'.repeat(500), servingLabel: 'l'.repeat(500), per100: { k: 1 } });
  assert.equal(long.name.length, 200); assert.equal(long.brand.length, 200); assert.equal(long.source.length, 40); assert.equal(long.servingLabel.length, 100);
  assert.deepEqual(sf({ name: 'A', per100: { k: NaN, p: -5, c: 'x', f: undefined } }).per100, { k: 0, p: 0, c: 0, f: 0 });
  assert.equal(sf({ name: 'A', per100: { k: 1 }, fdcId: 'abc' }).fdcId, 'abc');
  assert.ok(!('fdcId' in sf({ name: 'A', per100: { k: 1 }, fdcId: {} })));
  const many = Array.from({ length: 40 }, (_, n) => ({ label: 'p' + n, g: n + 1 }));
  const pp = sf({ name: 'A', per100: { k: 1 }, portions: [null, 5, { label: 5, g: 3 }, { label: 'zero', g: 0 }, ...many] }).portions;
  assert.equal(pp.length, 30);
  assert.ok(pp.every(x => Object.keys(x).sort().join() === 'g,label' && x.g > 0));
  for (const bad of [null, undefined, 'x', 5, [], {}, { name: '' }, { name: 'A' }, { name: 'A', per100: null }, { name: 5, per100: {} }, Object.create({ name: 'A', per100: { k: 1 } })]) assert.equal(sf(bad), null, JSON.stringify(bad));
  const evil = sf(JSON.parse('{"name":"A","per100":{"k":1},"__proto__":{"polluted":1}}'));
  assert.deepEqual(Object.keys(evil).sort(), ['brand', 'name', 'per100', 'servingG', 'servingLabel', 'source']);
  assert.equal(({}).polluted, undefined);
  assert.equal(sf(deepFreeze(structuredClone(input))).name, 'Onions, raw');
});

// ---------- service ----------

const instant = () => Promise.resolve();
/** harness: records every call in order and tracks overlap */
function harness({ db = {}, portions, sleepLog } = {}) {
  const log = [], h = { log, inflight: 0, max: 0, searches: [], sleeps: [], portionCalls: [] };
  const enter = async (tag) => { h.inflight++; h.max = Math.max(h.max, h.inflight); log.push(tag); await new Promise(r => setImmediate(r)); h.inflight--; };
  h.search = async q => {
    h.searches.push(q); await enter('s:' + q);
    const r = typeof db === 'function' ? db(q) : db[q];
    if (r instanceof Error) throw r;
    return r === undefined ? { results: [], errors: [] } : r;
  };
  h.loadPortions = async f => {
    h.portionCalls.push(f); await enter('p:' + f.name);
    if (portions instanceof Error) throw portions;
    f.portions = [{ label: '1 medium', g: 110 }];
  };
  h.sleep = ms => { h.sleeps.push(ms); log.push('sleep'); return instant(); };
  return h;
}
const ok = (...foods) => ({ results: foods, errors: [] });
const run = async (ings, h, extra = {}) => (await suggestMatches())(ings, { search: h.search, loadPortions: h.loadPortions, sleep: h.sleep, ...extra });

test('15 service: strictly sequential, in order, each search gets searchQuery(ingredient); no overlap', async () => {
  const h = harness({ db: { onion: ok(onionsRaw), 'olive oil': ok(oliveOil), 'chicken breasts': ok(broilers) } });
  const ings = [ing('onion', { unit: 'cup' }), ing('olive oil', { unit: 'cup' }), ing('Boneless Skinless Chicken Breasts', { unit: 'cup' })];
  await run(ings, h);
  assert.deepEqual(h.searches, ['onion', 'olive oil', 'chicken breasts']);
  assert.equal(h.max, 1, 'two requests were in flight at once');
  assert.deepEqual(h.log, ['s:onion', 'p:Onions, raw', 'sleep', 's:olive oil', 'p:Oil, olive, salad or cooking', 'sleep', 's:chicken breasts', 'p:' + broilers.name]);
});

test('16 service: only shouldSuggest ingredients are looked up; the rest (linked, ignorable, null, filler-only) are counted in skipped', async () => {
  const h = harness({ db: { onion: ok(onionsRaw) } });
  const linked = ing('rice', { food: food('Rice') });
  const res = await run([ing('onion'), ing('salt'), linked, null, ing('large'), 5, ing('water')], h);
  assert.deepEqual(h.searches, ['onion']);
  assert.equal(res.skipped, 6);
});

test('17 service: a pick becomes suggestions[id] = {food, confidence, score} with a suggestionFood copy; no pick, no key', async () => {
  const h = harness({ db: { onion: ok(onionPowder, onionsRaw), 'olive oil': ok(food('Chocolate cake')), 'chicken breasts': ok(nuggets) } });
  const res = await run([ing('onion', { unit: 'g' }), ing('olive oil', { unit: 'g' }), ing('chicken breasts', { unit: 'g' })], h);
  assert.deepEqual(Object.keys(res.suggestions).sort(), ['i_chicken breasts', 'i_onion']);
  const a = res.suggestions.i_onion;
  assert.deepEqual(Object.keys(a).sort(), ['confidence', 'food', 'score']);
  assert.equal(a.confidence, 'likely'); near(a.score, 0.88);
  assert.deepEqual(a.food, { name: 'Onions, raw', brand: '', source: 'USDA', per100: per, servingG: 110, servingLabel: '1 medium', fdcId: 1001 });
  assert.notEqual(a.food, onionsRaw);
  assert.equal(res.suggestions['i_chicken breasts'].confidence, 'check');
});

test('18 service: loadPortions only for non-weight units and real picks; portions land on the suggested food; a failure keeps the suggestion', async () => {
  for (const unit of ['g', 'kg', 'oz', 'lb']) {
    const h = harness({ db: { onion: ok(onionsRaw) } });
    const res = await run([ing('onion', { unit })], h);
    assert.equal(h.portionCalls.length, 0, `unit ${unit}`);
    assert.equal(res.suggestions.i_onion.confidence, 'likely');
  }
  for (const unit of ['cup', 'tbsp', '', 'clove', 'can']) {
    const h = harness({ db: { onion: ok(onionsRaw) } });
    const res = await run([ing('onion', { unit })], h);
    assert.equal(h.portionCalls.length, 1, `unit "${unit}"`);
    assert.equal(h.portionCalls[0].name, 'Onions, raw');
    assert.deepEqual(res.suggestions.i_onion.food.portions, [{ label: '1 medium', g: 110 }]);
  }
  const none = harness({ db: { onion: ok(food('Chocolate cake')) } });
  await run([ing('onion', { unit: 'cup' })], none);
  assert.equal(none.portionCalls.length, 0, 'no pick, no portions request');
  const failing = harness({ db: { onion: ok(onionsRaw) }, portions: new Error('portions down') });
  const r1 = await run([ing('onion', { unit: 'cup' })], failing);
  assert.equal(r1.suggestions.i_onion.confidence, 'likely');
  assert.equal(r1.stoppedEarly, false);
  const h2 = harness({ db: { onion: ok(onionsRaw) } });
  const r2 = await (await suggestMatches())([ing('onion', { unit: 'cup' })], { search: h2.search, loadPortions: () => { throw new Error('sync boom'); }, sleep: h2.sleep });
  assert.equal(r2.suggestions.i_onion.confidence, 'likely');
});

test('19 service: sleep(delayMs) between looked-up ingredients, not after the last; default 250; custom honoured; skipped items add none', async () => {
  const three = [ing('onion', { unit: 'g' }), ing('olive oil', { unit: 'g' }), ing('chicken breasts', { unit: 'g' })];
  let h = harness({}); await run(three, h);
  assert.deepEqual(h.sleeps, [250, 250]);
  h = harness({}); await run(three, h, { delayMs: 10 });
  assert.deepEqual(h.sleeps, [10, 10]);
  h = harness({}); await run([three[0]], h);
  assert.deepEqual(h.sleeps, []);
  h = harness({}); await run([three[0], ing('salt'), three[1]], h);
  assert.deepEqual(h.sleeps, [250]);
});

test('20 service: onProgress({done,total,current}) after each looked-up ingredient; total = how many will be looked up', async () => {
  const h = harness({ db: { onion: ok(onionsRaw) } });
  const calls = [];
  await run([ing('onion', { unit: 'g' }), ing('salt'), ing('olive oil', { unit: 'g' })], h, { onProgress: p => calls.push({ ...p }) });
  assert.deepEqual(calls, [{ done: 1, total: 2, current: 'i_onion' }, { done: 2, total: 2, current: 'i_olive oil' }]);
});

test('21 service: cancellation stops further lookups, keeps earlier suggestions, reason "cancelled"', async () => {
  const three = [ing('onion', { unit: 'g' }), ing('olive oil', { unit: 'g' }), ing('chicken breasts', { unit: 'g' })];
  let cancelled = false;
  const h = harness({ db: q => { if (q === 'olive oil') cancelled = true; return q === 'onion' ? ok(onionsRaw) : ok(); } });
  const res = await run(three, h, { isCancelled: () => cancelled });
  assert.deepEqual(h.searches, ['onion', 'olive oil'], 'third ingredient never searched');
  assert.equal(res.stoppedEarly, true);
  assert.equal(res.reason, 'cancelled');
  assert.equal(res.suggestions.i_onion.confidence, 'likely');
  const h0 = harness({});
  const r0 = await run(three, h0, { isCancelled: () => true });
  assert.equal(h0.searches.length, 0);
  assert.equal(r0.stoppedEarly, true);
  assert.equal(r0.reason, 'cancelled');
  assert.deepEqual(r0.suggestions, {});
});

test('22 service: a rate limit (rejection or errors without results) stops the run, keeps earlier suggestions, reports it', async () => {
  const four = [ing('onion', { unit: 'g' }), ing('olive oil', { unit: 'g' }), ing('chicken breasts', { unit: 'g' }), ing('rice', { unit: 'g' })];
  const variants = [new Error('429 Too Many Requests'), new Error('USDA: rate limit exceeded'), new Error('Too many requests'), { results: [], errors: ['USDA: HTTP 429'] }];
  for (const v of variants) {
    const h = harness({ db: q => (q === 'olive oil' ? v : q === 'onion' ? ok(onionsRaw) : ok()) });
    const res = await run(four, h);
    assert.deepEqual(h.searches, ['onion', 'olive oil'], String(v.message || v.errors));
    assert.equal(res.stoppedEarly, true);
    assert.equal(res.reason, 'rate-limit');
    assert.equal(res.suggestions.i_onion.confidence, 'likely');
    assert.ok(res.errors.length >= 1 && res.errors.every(e => typeof e === 'string' && e.length <= 200));
  }
});

test('23 service: any other failure (rejection, sync throw, errors without results) adds one short deduplicated message and continues', async () => {
  const three = [ing('onion', { unit: 'g' }), ing('olive oil', { unit: 'g' }), ing('chicken breasts', { unit: 'g' })];
  let h = harness({ db: q => (q === 'olive oil' ? new Error('network down') : q === 'onion' ? ok(onionsRaw) : ok(broilers)) });
  let res = await run(three, h);
  assert.equal(h.searches.length, 3, 'continued after the failure');
  assert.equal(res.errors.length, 1);
  assert.ok(res.errors[0].length > 0 && res.errors[0].length <= 200);
  assert.equal(res.stoppedEarly, false);
  assert.equal(res.reason, '');
  assert.ok(res.suggestions.i_onion && res.suggestions['i_chicken breasts']);
  h = harness({ db: () => new Error('network down') }); res = await run(three, h);
  assert.equal(h.searches.length, 3); assert.equal(res.errors.length, 1, 'same message deduplicated');
  h = harness({ db: () => ({ results: [], errors: ['USDA: HTTP 500'] }) }); res = await run(three, h);
  assert.equal(h.searches.length, 3); assert.equal(res.errors.length, 1); assert.equal(res.stoppedEarly, false);
  h = harness({ db: () => new Error('x'.repeat(5000)) }); res = await run(three, h);
  assert.ok(res.errors.length >= 1 && res.errors.every(e => typeof e === 'string' && e.length <= 200), 'long message truncated');
  for (const rejection of [undefined, null, 'boom', 42]) {
    const r = await (await suggestMatches())(three, { search: () => Promise.reject(rejection), sleep: instant });
    assert.ok(r.errors.length >= 1 && r.errors.every(e => typeof e === 'string' && e.length <= 200), String(rejection));
  }
  const sync = await (await suggestMatches())(three, { search: () => { throw new Error('sync boom'); }, sleep: instant });
  assert.ok(sync.errors.length >= 1 && sync.stoppedEarly === false);
});

test('24 service: more than 60 eligible ingredients: only the first 60 are looked up and the text says so', async () => {
  const h = harness({ db: () => ok(onionsRaw) });
  const many = Array.from({ length: 100 }, (_, n) => ing('onion', { id: 'i' + n, unit: 'g' }));
  const res = await run(many, h);
  assert.equal(h.searches.length, 60);
  assert.equal(Object.keys(res.suggestions).length, 60);
  assert.ok(/only the first 60/i.test(`${res.reason} ${res.errors.join(' ')}`), `reason: ${res.reason} errors: ${res.errors}`);
  const few = await run(many.slice(0, 3), harness({ db: () => ok(onionsRaw) }));
  assert.equal(few.reason, '');
  assert.deepEqual(few.errors, []);
  assert.equal(few.stoppedEarly, false);
});

test('25 service: never mutates ingredient objects; result has exactly the documented keys', async () => {
  const ings = deepFreeze([ing('onion', { unit: 'cup' }), ing('salt'), ing('olive oil', { unit: 'g' })]);
  const before = JSON.stringify(ings);
  const h = harness({ db: { onion: ok(onionsRaw), 'olive oil': ok(oliveOil) } });
  const res = await run(ings, h);
  assert.equal(JSON.stringify(ings), before);
  assert.deepEqual(Object.keys(res).sort(), ['errors', 'reason', 'skipped', 'stoppedEarly', 'suggestions']);
  assert.equal(res.skipped, 1); assert.equal(res.stoppedEarly, false); assert.equal(res.reason, ''); assert.deepEqual(res.errors, []);
  assert.equal(res.suggestions.i_onion.confidence, 'likely');
});

test('26 service: hostile input never throws (non-arrays, null items, missing options, __proto__ ids, tag names, huge names, bad results)', async () => {
  const sm = await suggestMatches();
  const h = harness({});
  for (const bad of [null, undefined, 'abc', {}, 5, true]) {
    const r = await sm(bad, { search: h.search, loadPortions: h.loadPortions, sleep: h.sleep });
    assert.deepEqual(r, { suggestions: {}, skipped: 0, errors: [], stoppedEarly: false, reason: '' }, String(bad));
  }
  assert.equal(h.searches.length, 0);
  const noOpts = await sm([ing('onion')]);
  assert.ok(noOpts && typeof noOpts.suggestions === 'object');
  assert.deepEqual(noOpts.suggestions, {});
  await sm([ing('onion')], {});
  await sm([null, undefined, 5, 'x', [], {}], { search: h.search, sleep: instant });
  // ids and names
  const hp = harness({ db: { onion: ok(onionsRaw) } });
  const res = await run([{ ...ing('onion', { unit: 'g' }), id: '__proto__' }, ing('<img src=x onerror=alert(1)>'), ing('x'.repeat(100000), { unit: 'g' })], hp);
  assert.ok(Object.hasOwn(res.suggestions, '__proto__'), 'an ingredient id of __proto__ is stored as a plain key');
  assert.equal(({}).confidence, undefined, 'Object.prototype not polluted');
  assert.ok(hp.searches.every(q => q.length <= 80 && !/[<>]/.test(q)), `queries: ${hp.searches.map(q => q.length)}`);
  assert.ok(!hp.searches.some(q => q === ''), 'no empty query is sent');
  // odd search results
  for (const r of [undefined, null, {}, { results: undefined, errors: undefined }, { results: [null, 5, 'x', {}, { name: 'Onion' }, { name: 'Onion', per100: null }], errors: [] }]) {
    const out = await sm([ing('onion', { unit: 'cup' })], { search: async () => r, loadPortions: async () => {}, sleep: instant });
    assert.deepEqual(out.suggestions, {}, JSON.stringify(r));
    assert.equal(out.stoppedEarly, false);
  }
});

// ---------- WEAK static checks ----------

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const editor = () => strip(read('js/ui/recipe-editor.js'));
const cssRules = () => [...strip(read('css/components.css')).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2].replace(/\s*([:;])\s*/g, '$1').replace(/\s+/g, ' ').trim() }));

test('U1 the editor has a type="button" #reSuggest button labelled "Suggest matches"', () => {
  const src = editor();
  const tag = /<button\b[^>]*\bid="reSuggest"[^>]*>/.exec(src);
  assert.ok(tag, '<button id="reSuggest"> in the editor markup');
  assert.match(tag[0], /\btype="button"/);
  assert.ok(src.slice(tag.index, tag.index + 300).includes('Suggest matches'), 'button text');
});

test('U2 the button is conditional on shouldSuggest and on a database being enabled (useUSDA / useOFF)', () => {
  const src = editor();
  assert.ok(src.indexOf('id="reSuggest"') > 0);
  assert.match(src, /shouldSuggest\s*\(/);
  assert.match(src, /state\.useUSDA/);
  assert.match(src, /state\.useOFF/);
  const before = src.slice(Math.max(0, src.indexOf('id="reSuggest"') - 700), src.indexOf('id="reSuggest"'));
  assert.ok(/shouldSuggest|canSuggest|suggestOk/i.test(before) || /\?|&&/.test(before), 'a condition precedes the button in the template');
});

test('U3 the editor imports suggestMatches (services), shouldSuggest + suggestionFood (domain), and wires searchAll and loadPortions', () => {
  const src = editor();
  assert.match(src, /import\s*\{[^}]*\bsuggestMatches\b[^}]*\}\s*from\s*'\.\.\/services\/food-suggest\.js'/);
  assert.match(src, /import\s*\{[^}]*\bshouldSuggest\b[^}]*\}\s*from\s*'\.\.\/domain\/food-match\.js'/);
  assert.match(src, /import\s*\{[^}]*\bsuggestionFood\b[^}]*\}\s*from\s*'\.\.\/domain\/food-match\.js'/);
  assert.match(src, /suggestMatches\s*\(/);
  assert.match(src, /searchAll\s*\(\s*\w+\s*,\s*\{[^}]*useUSDA[^}]*useOFF[^}]*apiKey/);
  assert.match(src, /loadPortions/);
  assert.match(src, /state\.apiKey/);
});

test('U4 progress text "Looking up", aria-live polite, a Cancel button for the run, and an isCancelled callback', () => {
  const src = editor();
  assert.match(src, /Looking up/);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /isCancelled/);
  assert.match(src, /id="reSugCancel"|data-sug-cancel|>Cancel<[\s\S]{0,200}isCancelled|isCancelled[\s\S]{0,400}Cancel/, 'a Cancel control tied to the run');
});

test('U5 the suggestion in the info line: "Suggested:" with esc() text, confidence, data-accept / data-dismiss buttons (class sug-btn), sug-check for check', () => {
  const src = editor();
  const i = src.indexOf('Suggested:');
  assert.ok(i > 0, 'Suggested: text');
  assert.match(src.slice(i, i + 400), /esc\s*\(/, 'suggested food name goes through esc()');
  for (const s of ['data-accept', 'data-dismiss', 'sug-btn', 'sug-check', 'class="sug']) assert.ok(src.includes(s), s);
  assert.match(src, /type="button"[^>]*data-accept|data-accept[^>]*type="button"/);
});

test('U6 accept reuses resolveGrams and suggestionFood like the picker; #reAcceptAll exists and filters on \'likely\'', () => {
  const src = editor();
  assert.ok((src.match(/resolveGrams\s*\(/g) || []).length >= 2, 'resolveGrams used by the picker and by accept');
  assert.ok((src.match(/suggestionFood\s*\(/g) || []).length >= 1, 'suggestionFood( called');
  assert.match(src, /id="reAcceptAll"/);
  assert.match(src, /===\s*'likely'/, 'accept-all filters on confidence === likely');
});

test('U7 the rate-limit outcome tells the user to add their own USDA key in Settings', () => {
  const src = editor();
  assert.match(src, /rate-limit/);
  assert.match(src, /own USDA key/i);
  assert.match(src, /Settings/);
});

test('U8 suggestions live in a module variable that is reset when the editor opens', () => {
  const src = editor();
  assert.match(src, /^(?:let|const)\s+\w*[Ss]ugg\w*\s*=/m, 'module-level suggestions variable');
  const open = /export function openRecipeEditor[\s\S]*?\n}\n/.exec(src);
  assert.ok(open && /[Ss]ugg/.test(open[0]), 'openRecipeEditor resets the suggestions');
});

test('U9 layering and purity: domain/food-match.js and services/food-suggest.js import only allowed layers and use no DOM / network / storage / clock / random', () => {
  const dm = strip(read('js/domain/food-match.js')), sv = strip(read('js/services/food-suggest.js'));
  const imports = s => [...s.matchAll(/(?:^|\n)\s*import[^;]*?from\s*'([^']+)'/g)].map(m => m[1]);
  for (const p of imports(dm)) assert.ok(/^\.\/[\w-]+\.js$/.test(p) || /^\.\.\/core\/(constants|format|dates|schema)\.js$/.test(p), `domain import ${p}`);
  for (const p of imports(sv)) assert.ok(/^\.\/[\w-]+\.js$/.test(p) || /^\.\.\/(domain|core)\/[\w-]+\.js$/.test(p), `service import ${p}`);
  assert.ok(imports(sv).includes('../domain/food-match.js'), 'service uses the domain module');
  assert.ok(!/\b(?:document|window|localStorage|fetch|XMLHttpRequest)\b/.test(dm + sv), 'no DOM, storage or network');
  assert.ok(!/Date\.now|new Date|Math\.random|setTimeout|performance\./.test(dm), 'domain: no clock or random');
});

test('U10 the suggestion buttons are built outside ingInfo and styled by class, so the compact-ingredients tests keep passing unchanged', () => {
  const src = editor();
  const m = /(?:function\s+ingInfo|const\s+ingInfo\s*=)[\s\S]*?(?=\n(?:function|const|let|\/\*\*|export)\s)/.exec(src);
  assert.ok(m, 'ingInfo exists');
  assert.ok(!/<button/.test(m[0]), 'no <button literal inside ingInfo (use a helper)');
  assert.ok(src.includes('data-accept') && src.includes('data-dismiss'));
  for (const r of cssRules()) assert.ok(!/\.ing-info\s+button/.test(r.sel), `selector ${r.sel} would break compact-ingredients U8`);
});

test('U11 CSS: .sug-btn is at least 32px tall, .sug-check has its own rule, .ing-info keeps 13px and overflow-wrap:anywhere', () => {
  const rules = cssRules();
  const btn = rules.find(r => r.sel.split(',').some(s => /\.sug-btn$/.test(s.trim())));
  assert.ok(btn, '.sug-btn rule');
  assert.match(btn.body, /min-height:32px/);
  assert.ok(rules.some(r => r.sel.split(',').some(s => /\.sug-check\b/.test(s))), '.sug-check rule');
  const info = rules.find(r => r.sel === '.ing-info');
  assert.ok(info && /font-size:13px/.test(info.body) && /overflow-wrap:anywhere/.test(info.body));
});

test('U12 sw.js: SHELL lists both new files and CACHE is greater than v35 (v35 is on main)', () => {
  const sw = read('sw.js');
  const shell = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
  assert.ok(shell.includes("'js/domain/food-match.js'"), 'food-match.js in SHELL');
  assert.ok(shell.includes("'js/services/food-suggest.js'"), 'food-suggest.js in SHELL');
  const m = /const CACHE = 'macro-diary-v(\d+)'/.exec(sw);
  assert.ok(m && Number(m[1]) > 35, `CACHE is v${m && m[1]}, must be greater than 35`);
});
