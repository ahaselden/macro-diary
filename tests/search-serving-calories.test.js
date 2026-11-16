// Spec: docs/specs/search-serving-calories.md. Test-designer file, written before the implementation. Golden values are hand-computed.
// Modules are imported as namespaces so each test fails on its own (TypeError: not a function) until the export exists.
// The UI part (21, 22) reads source text: WEAK, it proves wiring words exist, not that the screen works (see the headless checklist C1..C11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as food from '../js/domain/food.js';
import * as usda from '../js/services/usda.js';
import { esc } from '../js/core/format.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const rs = f => food.rowServingSummary(f);
const gen = (k, portions) => ({ name: 'X', brand: '', source: 'USDA', per100: { k, p: 0, c: 0, f: 0 }, servingG: 0, ...(portions ? { portions } : {}) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let nextId = 940000;                       // the cache is module-level and has no reset: every test uses fresh fdcIds
const mk = (n = 1) => Array.from({ length: n }, () => ({ name: 'F' + nextId, brand: '', source: 'USDA', fdcId: nextId++, servingG: 0, per100: { k: 100, p: 0, c: 0, f: 0 } }));
const PORTIONS = [{ label: 'medium', g: 118 }];
const RATE = 'rate limited – add your own USDA key in Settings';   // what services/http.js throws for HTTP 429

// ---------------------------------------------------------------- rowServingSummary
test('1. rowServingSummary returns servingSummary(food) unchanged when that is non-empty', () => {
  const b = { per100: { k: 400 }, servingG: 50, servingLabel: '1 bar' };
  assert.equal(rs(b), '200 kcal per 1 bar');
  assert.equal(rs(b), food.servingSummary(b));
  const withPortions = { ...b, portions: [{ label: 'medium', g: 118 }] };       // the serving wins over portions
  assert.equal(rs(withPortions), '200 kcal per 1 bar');
  const noLabel = { per100: { k: 100 }, servingG: 30 };
  assert.equal(rs(noLabel), '30 kcal per 30 g');
});

test('2. rowServingSummary: per-100 g only, or empty portions, gives an empty string', () => {
  assert.equal(rs({ per100: { k: 89 } }), '');
  assert.equal(rs({ per100: { k: 89 }, servingG: 0 }), '');
  assert.equal(rs(gen(89, [])), '');
});

test('3. rowServingSummary: count portion gives "<kcal> kcal per <label> (<g> g)" (89 * 118 / 100 = 105.02)', () => {
  assert.equal(rs(gen(89, [{ label: 'medium', g: 118 }])), '105 kcal per medium (118 g)');
  assert.equal(rs(gen(89, [{ label: 'NLEA serving', g: 126 }])), '112 kcal per NLEA serving (126 g)');   // 112.14
});

test('4. rowServingSummary uses the first count-type portion and skips cups, spoons, ounces, grams, ml', () => {
  const p = [{ label: 'cup, mashed', g: 225 }, { label: 'tbsp', g: 14 }, { label: 'oz', g: 28 }, { label: 'g', g: 1 }, { label: 'ml', g: 1 }, { label: 'medium', g: 118 }, { label: 'large', g: 136 }];
  assert.equal(rs(gen(89, p)), '105 kcal per medium (118 g)');
  assert.equal(rs(gen(89, p.slice(0, 5))), '', 'only non-count portions: nothing');
});

test('5. rowServingSummary rounds kcal and grams with Math.round', () => {
  assert.equal(rs(gen(50, [{ label: 'slice', g: 125 }])), '63 kcal per slice (125 g)');         // 62.5 -> 63
  assert.equal(rs(gen(100, [{ label: 'slice', g: 126.4 }])), '126 kcal per slice (126 g)');
  assert.equal(rs(gen(100, [{ label: 'slice', g: 126.5 }])), '127 kcal per slice (127 g)');
});

test('6. rowServingSummary skips portions whose grams are 0, negative, NaN, Infinity or not a number', () => {
  const bad = [0, -5, NaN, Infinity, '118', null, undefined].map(g => ({ label: 'large', g }));
  assert.equal(rs(gen(100, [...bad, { label: 'medium', g: 100 }])), '100 kcal per medium (100 g)');
  assert.equal(rs(gen(100, bad)), '');
});

test('7. rowServingSummary: bad per100 gives an empty string', () => {
  for (const per100 of [undefined, null, {}, { k: NaN }, { k: Infinity }, { k: 'abc' }, { k: undefined }, 'x'])
    assert.equal(rs({ name: 'X', per100, portions: PORTIONS }), '', JSON.stringify(per100));
});

test('8. rowServingSummary strips tags from the label and caps it at 60 characters', () => {
  assert.equal(rs(gen(100, [{ label: '<b>large</b>', g: 100 }])), '100 kcal per large (100 g)');
  const long = rs(gen(100, [{ label: 'a'.repeat(100), g: 100 }]));
  assert.equal(long, '100 kcal per ' + 'a'.repeat(60) + ' (100 g)');
  assert.doesNotMatch(rs(gen(100, [{ label: 'x <script>alert(1)</script> slice', g: 100 }])), /[<>]/);
});

test('9. rowServingSummary: an empty or tags-only label is not usable (the next portion is used, or nothing)', () => {
  assert.equal(rs(gen(100, [{ label: '', g: 100 }])), '');
  assert.equal(rs(gen(100, [{ label: '<br>', g: 100 }])), '');
  assert.equal(rs(gen(100, [{ label: '   ', g: 100 }, { label: 'slice', g: 40 }])), '40 kcal per slice (40 g)');
});

test('10. rowServingSummary never throws and always returns a string on junk input', () => {
  const boom = () => { throw new Error('boom'); };
  const trap = (o, key) => { Object.defineProperty(o, key, { get: boom, enumerable: true }); return o; };
  const junk = [null, undefined, [], 'x', 5, NaN, {}, { per100: { k: 1 }, portions: {} }, { per100: { k: 1 }, portions: 'medium' }, { per100: { k: 1 }, portions: 7 },
    { per100: { k: 1 }, portions: [null, 5, 'x', [], undefined, { label: 7, g: 1 }, { label: {}, g: 1 }] },
    trap({ portions: PORTIONS }, 'per100'), trap({ per100: { k: 1 } }, 'portions'),trap({ per100: { k: 1 }, portions: PORTIONS }, 'servingG'),
    { per100: trap({}, 'k'), portions: PORTIONS }, { per100: { k: 1 }, portions: [trap({ g: 1 }, 'label')] }, { per100: { k: 1 }, portions: [trap({ label: 'slice' }, 'g')] },
    { per100: { k: 1e308 }, portions: [{ label: 'slice', g: 1e308 }] }, { per100: { k: -1e308 }, portions: [{ label: 'slice', g: 1e308 }] },
    { per100: { k: 1 }, portions: [{ label: 'slice', g: Number.MAX_VALUE }] },
    JSON.parse('{"__proto__":{"portions":[{"label":"slice","g":1}]},"per100":{"k":1}}'), { constructor: 1, per100: { k: 1 }, portions: [{ label: 'constructor', g: 1 }] }];
  for (const j of junk) { let out; assert.doesNotThrow(() => { out = rs(j); }); assert.equal(typeof out, 'string'); assert.doesNotMatch(out, /NaN|Infinity/); }
  assert.equal(rs(JSON.parse('{"__proto__":{"portions":[{"label":"slice","g":1}]},"per100":{"k":1}}')), '', 'a polluted prototype is not data');
});

// ---------------------------------------------------------------- enrichWithPortions
const ok = async (f) => { f.portions = PORTIONS.map(p => ({ ...p })); };

test('11. enrichWithPortions only looks up USDA foods with an fdcId, no serving and no portions yet', async () => {
  const [a, b, c, d, e, f, g] = mk(7);
  b.source = 'Open Food Facts'; c.servingG = 50; d.portions = []; delete e.fdcId; f.source = 'My food'; g.fdcId = 0;
  const seen = [];
  const n = await usda.enrichWithPortions([a, b, c, d, e, f, g], { apiKey: 'TEST-KEY-NOT-REAL', load: async x => { seen.push(x); await ok(x); } });
  assert.deepEqual(seen, [a]);
  assert.equal(n, 1);
  for (const x of [b, c, e, f, g]) assert.ok(!('portions' in x), 'untouched');
  assert.deepEqual(d.portions, []);
});

test('12. enrichWithPortions looks up at most `limit` (default 5) candidates, first in list order; non-candidates do not use the limit', async () => {
  const list = mk(8); const other = { ...mk(1)[0], source: 'Open Food Facts' };
  const seen = [];
  const load = async x => { seen.push(x); await ok(x); };
  await usda.enrichWithPortions([other, ...list], { load });
  assert.deepEqual(seen, list.slice(0, 5));
  const list2 = mk(6); seen.length = 0;
  await usda.enrichWithPortions(list2, { load, limit: 2 });
  assert.deepEqual(seen, list2.slice(0, 2));
  seen.length = 0;
  await usda.enrichWithPortions(mk(3), { load, limit: 0 });
  assert.equal(seen.length, 0);
  seen.length = 0;
  await usda.enrichWithPortions(mk(1000), { load });
  assert.equal(seen.length, 5);
});

test('13. enrichWithPortions runs at most `concurrency` (default 2) lookups at once, and really in parallel', async () => {
  for (const [conc, want] of [[undefined, 2], [1, 1], [3, 3]]) {
    let inflight = 0, max = 0;
    const load = async x => { inflight++; max = Math.max(max, inflight); await sleep(15); inflight--; await ok(x); };
    await usda.enrichWithPortions(mk(5), { load, limit: 5, ...(conc ? { concurrency: conc } : {}) });
    assert.equal(max, want, 'concurrency ' + conc);
  }
});

test('14. enrichWithPortions: load(food, apiKey) on the same object, onUpdate once per food with portions, resolves to that count', async () => {
  const list = mk(3); const calls = [], updates = [];
  const n = await usda.enrichWithPortions(list, { apiKey: 'TEST-KEY-NOT-REAL', load: async (x, k) => { calls.push([x, k]); await ok(x); }, onUpdate: x => updates.push(x) });
  assert.equal(n, 3);
  assert.equal(calls.length, 3);
  for (const [x, k] of calls) { assert.ok(list.includes(x)); assert.equal(k, 'TEST-KEY-NOT-REAL'); }
  assert.deepEqual(list.map(x => x.portions), [PORTIONS, PORTIONS, PORTIONS]);
  assert.equal(updates.length, 3);
  assert.deepEqual([...updates].sort((a, b) => a.fdcId - b.fdcId), list);
  assert.equal(updates[0], list.find(x => x === updates[0]), 'the same object, not a copy');
});

test('15. enrichWithPortions: an empty answer leaves portions: [] and gives no onUpdate', async () => {
  const [a, b] = mk(2); const updates = [];
  const n = await usda.enrichWithPortions([a, b], { load: async x => { if (x === a) x.portions = []; /* b: sets nothing */ }, onUpdate: x => updates.push(x) });
  assert.deepEqual(a.portions, []);
  assert.deepEqual(b.portions, []);
  assert.equal(updates.length, 0);
  assert.equal(n, 0);
  let calls = 0;                                              // and they are not looked up again
  await usda.enrichWithPortions([a, b], { load: async () => { calls++; } });
  assert.equal(calls, 0);
});

test('16. enrichWithPortions: session cache by fdcId (a new object, a repeat search, a duplicate in one list) costs no extra request', async () => {
  const [a] = mk(1); let calls = 0;
  const load = async x => { calls++; await sleep(5); await ok(x); };
  await usda.enrichWithPortions([a], { load });
  assert.equal(calls, 1);
  const again = { ...a }; delete again.portions; const updates = [];
  const n = await usda.enrichWithPortions([again], { load: async () => { throw new Error('must not be requested again'); }, onUpdate: x => updates.push(x) });
  assert.deepEqual(again.portions, PORTIONS);
  assert.deepEqual(updates, [again]);
  assert.equal(n, 1);
  // same fdcId twice in one list, both would start at once
  const [x] = mk(1), y = { ...x }; calls = 0; const ups = [];
  await usda.enrichWithPortions([x, y], { load, concurrency: 2, onUpdate: f => ups.push(f) });
  assert.equal(calls, 1);
  assert.deepEqual(x.portions, PORTIONS); assert.deepEqual(y.portions, PORTIONS);
  assert.equal(ups.length, 2);
});

test('17. enrichWithPortions: a failed lookup leaves the row untouched, is not retried, and the others continue', async () => {
  for (const fail of [async () => { throw new Error('HTTP 500'); }, () => { throw new Error('sync boom'); }, async () => { throw 'a string'; }]) {
    const [a, b, c] = mk(3); const calls = new Map(), updates = [];
    const n = await usda.enrichWithPortions([a, b, c], { concurrency: 1, onUpdate: x => updates.push(x), load: async x => { calls.set(x, (calls.get(x) || 0) + 1); if (x === a) return fail(); await ok(x); } });
    assert.ok(!('portions' in a));
    assert.deepEqual([b.portions, c.portions], [PORTIONS, PORTIONS]);
    assert.equal(calls.get(a), 1);
    assert.deepEqual(updates, [b, c]);
    assert.equal(n, 2);
  }
});

test('18. enrichWithPortions: after a rate-limit failure no further lookups are started, and it still resolves', async () => {
  for (const conc of [1, 2]) {
    const list = mk(5); let calls = 0;
    const n = await usda.enrichWithPortions(list, { concurrency: conc, load: async x => { calls++; await sleep(5); if (calls === 1) throw new Error(RATE); await ok(x); } });
    assert.ok(calls <= conc, `concurrency ${conc}: only lookups already started may finish, got ${calls} calls`);
    assert.ok(typeof n === 'number');
    assert.ok(!('portions' in list[0]));
    assert.ok(!('portions' in list[4]), 'the last row was never requested');
  }
});

test('19. enrichWithPortions: cancelled stops new requests and onUpdate', async () => {
  let calls = 0;
  const n0 = await usda.enrichWithPortions(mk(3), { cancelled: () => true, load: async () => { calls++; } });
  assert.equal(calls, 0); assert.equal(n0, 0);
  // cancelled while the first lookup runs: no onUpdate for it, no second lookup
  let stop = false; const updates = []; calls = 0;
  await usda.enrichWithPortions(mk(5), { concurrency: 1, cancelled: () => stop, onUpdate: x => updates.push(x), load: async x => { calls++; await sleep(5); stop = true; await ok(x); } });
  assert.equal(calls, 1); assert.equal(updates.length, 0);
  // two in flight, cancelled after both started: neither calls onUpdate when it finishes
  stop = false; updates.length = 0; calls = 0;
  await usda.enrichWithPortions(mk(4), { concurrency: 2, cancelled: () => stop, onUpdate: x => updates.push(x), load: async x => { calls++; if (calls === 2) stop = true; await sleep(10); await ok(x); } });
  assert.equal(calls, 2); assert.equal(updates.length, 0);
});

test('20. enrichWithPortions never rejects on junk input or throwing callbacks', async () => {
  const boom = () => { throw new Error('boom'); };
  for (const foods of [null, undefined, 5, 'x', {}, [], [null, 5, 'x', [], undefined, { source: 'USDA' }]]) {
    const n = await usda.enrichWithPortions(foods, { load: ok });
    assert.equal(typeof n, 'number');
  }
  assert.equal(typeof await usda.enrichWithPortions(mk(2), { load: ok, onUpdate: boom }), 'number');
  assert.equal(typeof await usda.enrichWithPortions(mk(2), { load: ok, cancelled: boom }), 'number');
  assert.equal(typeof await usda.enrichWithPortions(mk(2), { load: boom }), 'number');
  assert.equal(typeof await usda.enrichWithPortions(mk(2), { load: async () => { throw null; } }), 'number');
  assert.equal(typeof await usda.enrichWithPortions(mk(1), { load: ok, onUpdate: 'nope', cancelled: 5 }), 'number');
});

// ---------------------------------------------------------------- UI (source text: weak)
test('21. UI wiring: add-food.js uses rowServingSummary and enrichWithPortions with a USDA guard and a cancel check; the amount picker does not refetch', () => {
  const src = read('js/ui/add-food.js');
  assert.match(src, /import\s*\{[^}]*\browServingSummary\b[^}]*\}\s*from\s*'\.\.\/domain\/food\.js'/);
  assert.match(src, /import\s*\{[^}]*\benrichWithPortions\b[^}]*\}\s*from\s*'\.\.\/services\/usda\.js'/);
  const res = src.slice(src.indexOf('function resHTML'), src.indexOf('let localList'));
  assert.ok(res.length > 50 && res.includes('rowServingSummary('), 'resHTML uses rowServingSummary');
  assert.doesNotMatch(res, /\bservingSummary\(/, 'resHTML no longer calls servingSummary directly');
  assert.match(res, /esc\(\s*rowServingSummary\(/, 'the summary is escaped');
  const body = src.split('\n').filter(l => !/^\s*import\b/.test(l)).join('\n');
  const at = body.indexOf('enrichWithPortions(');
  assert.ok(at > 0, 'enrichWithPortions is called (not just imported)');
  const around = body.slice(Math.max(0, at - 700), at + 700);
  assert.match(around, /useUSDA/, 'guarded by the USDA source switch');
  assert.match(around, /cancelled/, 'a cancel check is passed');
  assert.match(around, /onUpdate/, 'rows re-render from onUpdate');
  const ap = read('js/ui/amount-picker.js');
  assert.match(ap, /const canLoad = [^\n]*!food\.portions/);
  assert.match(ap, /if \(canLoad\) loadPortions\(/);
});

test('22. Security: a hostile portion label is plain text from the domain and inert after esc', () => {
  const evil = rs(gen(100, [{ label: '<img src=x onerror=alert(1)>', g: 100 }]));
  assert.doesNotMatch(evil, /<img/i);
  assert.doesNotMatch(esc(evil), /<|>/);
  const quote = rs(gen(100, [{ label: `a"onmouseover="x' & <script>`, g: 100 }]));
  assert.doesNotMatch(esc(quote), /[<>"']/);
  assert.equal(esc(rs(gen(100, [{ label: 'fish & chips', g: 100 }]))), '100 kcal per fish &amp; chips (100 g)');
});

test('23. Repeat search for the same food costs no new request (service level)', async () => {
  const list = mk(3); let calls = 0;
  const load = async x => { calls++; await ok(x); };
  await usda.enrichWithPortions(list, { load });
  assert.equal(calls, 3);
  const second = list.map(x => ({ ...x })); second.forEach(x => delete x.portions);     // a fresh search result: new objects, same fdcIds
  await usda.enrichWithPortions(second, { load });
  assert.equal(calls, 3);
  assert.ok(second.every(x => Array.isArray(x.portions) && x.portions.length === 1));
});
