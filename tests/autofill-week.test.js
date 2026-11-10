// Tests for docs/specs/autofill-week.md (domain part). Written before the implementation exists.
// Golden values are hand computed (see the comments); modules are imported dynamically so each test fails on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults } from '../js/core/schema.js';
import { addPlanItem, recipeItem, getDay } from '../js/domain/plan.js';

const mod = () => import('../js/domain/autoplan.js');
const propose = async (s, o) => (await mod()).proposePlan(s, o);

// recipe whose ONE serving is exactly `kcal` kcal (100 g of a food with per100.k = kcal, 1 serving)
const rec = (id, kcal, over = {}) => ({ id, name: 'Zzyzx ' + id, description: '', source: '', servings: 1, totalTime: null, tags: [], steps: [], favorite: false, updatedAt: 1,
  ingredients: [{ id: 'i1', raw: '100 g x', name: 'x', qty: 100, unit: 'g', prep: '', food: { name: 'X', brand: '', source: '', per100: { k: kcal, p: 0, c: 0, f: 0 }, servingG: 0 }, grams: 100 }], ...over });
const mk = (recs, goalK = 2000) => { const s = defaults(); s.goals.k = goalK; for (const r of recs) s.recipes[r.id] = r; return s; };
const D = ['2025-11-17', '2025-11-18', '2025-11-19', '2025-11-20', '2025-11-21', '2025-11-22', '2025-11-23'];   // Mon..Sun
const pick = (p, d, slot) => p.days?.[d]?.[slot]?.[0];
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const hasRepeatNote = p => p.notes.some(n => /repeat/i.test(n));

test('A1 no dates or no recipes: empty proposal {days:{}, notes:[...]} with a note when nothing could be proposed', async () => {
  const s = mk([rec('a', 600)]);
  const none = await propose(s, {});
  assert.deepEqual(none.days, {}); assert.ok(Array.isArray(none.notes));
  assert.deepEqual((await propose(s)).days, {});
  assert.deepEqual((await propose(s, null)).days, {});
  const empty = await propose(mk([]), { dates: D });
  assert.deepEqual(empty.days, {}); assert.ok(empty.notes.length >= 1 && empty.notes.every(n => typeof n === 'string' && n.length > 0));
});

test('A2 one slot: target = whole day budget; servings = multiple of 0.5 whose kcal is closest (hand computed)', async () => {
  // target 600: 280 kcal -> 2 serv = 560 (diff 40; 2.5 = 700 diff 100); 400 kcal -> 1.5 serv = 600 exactly; 600 -> 1
  for (const [kcal, serv] of [[280, 2], [400, 1.5], [600, 1]]) {
    const p = await propose(mk([rec('a', kcal)], 600), { dates: [D[0]], slots: ['Lunch'] });
    const x = pick(p, D[0], 'Lunch');
    assert.equal(x.recipeId, 'a'); assert.equal(x.servings, serv, `${kcal} kcal`); assert.equal(x.complete, true); assert.equal(p.days[D[0]].Lunch.length, 1);
  }
});

test('A3 servings are clamped to [0.5, 4]', async () => {
  assert.equal(pick(await propose(mk([rec('a', 100)], 600), { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch').servings, 4);     // 400 kcal is the closest allowed
  assert.equal(pick(await propose(mk([rec('a', 2000)], 600), { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch').servings, 0.5);  // 1000 kcal is the closest allowed
});

test('A4 slots share the budget by weight (renormalised): Lunch+Dinner 1300 -> 600/700; Breakfast+Snacks 3500 -> 2500/1000; default slots are Lunch+Dinner', async () => {
  let p = await propose(mk([rec('r600', 600), rec('r700', 700)], 1300), { dates: [D[0]], slots: ['Lunch', 'Dinner'] });
  assert.equal(pick(p, D[0], 'Lunch').recipeId, 'r600'); assert.equal(pick(p, D[0], 'Dinner').recipeId, 'r700');
  assert.equal(pick(p, D[0], 'Lunch').servings, 1); assert.equal(pick(p, D[0], 'Dinner').servings, 1);
  p = await propose(mk([rec('big', 1250), rec('small', 500)], 3500), { dates: [D[0]], slots: ['Breakfast', 'Snacks'] });
  assert.equal(pick(p, D[0], 'Breakfast').recipeId, 'big'); assert.equal(pick(p, D[0], 'Breakfast').servings, 2);   // 1250 x 2 = 2500
  assert.equal(pick(p, D[0], 'Snacks').recipeId, 'small'); assert.equal(pick(p, D[0], 'Snacks').servings, 2);       // 500 x 2 = 1000
  p = await propose(mk([rec('a', 600), rec('b', 590), rec('c', 580)]), { dates: [D[0]] });
  assert.deepEqual(Object.keys(p.days[D[0]]).sort(), ['Dinner', 'Lunch']);
});

test('A5 kcal already planned that day (any slot, also not being filled) reduce the budget; default goal is state.goals.k', async () => {
  // goal 2000, Dinner already holds X = 1200 kcal -> Lunch budget 800 -> Y (800 kcal) 1 serving. (Without the budget: target 2000 -> 2.5 servings.)
  const s = mk([rec('x', 1200), rec('y', 800)]); addPlanItem(s, D[0], 'Dinner', recipeItem('i1', 'x', 1), 1);
  const x = pick(await propose(s, { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch');
  assert.equal(x.recipeId, 'y'); assert.equal(x.servings, 1);
  // goalK omitted -> state.goals.k (800): 400 kcal recipe -> 2 servings (with the schema default 2000 it would be 4)
  const p = await propose(mk([rec('a', 400)], 800), { dates: [D[0]], slots: ['Lunch'] });
  assert.equal(pick(p, D[0], 'Lunch').servings, 2);
  // opts.goalK overrides
  assert.equal(pick(await propose(mk([rec('a', 400)], 800), { dates: [D[0]], slots: ['Lunch'], goalK: 1200 }), D[0], 'Lunch').servings, 3);
});

test('A6 budget <= 0 (goal already exceeded): lowest-kcal recipe at 0.5 servings plus a note about the goal/budget', async () => {
  const s = mk([rec('x', 800), rec('p', 400), rec('q', 200)], 500); addPlanItem(s, D[0], 'Dinner', recipeItem('i1', 'x', 1), 1);   // 500 - 800 = -300
  const p = await propose(s, { dates: [D[0]], slots: ['Lunch'] });
  const x = pick(p, D[0], 'Lunch');
  assert.equal(x.recipeId, 'q'); assert.equal(x.servings, 0.5); assert.ok(x.why.length > 0);
  assert.ok(p.notes.some(n => /goal|budget/i.test(n)));
});

test('A7 only empty slots are filled; existing slots are left out of the proposal and their recipe counts for the repeat window', async () => {
  const s = mk([rec('a', 600), rec('b', 300)], 1300); addPlanItem(s, D[0], 'Lunch', recipeItem('i1', 'a', 1), 1);
  const before = structuredClone(s);
  const p = await propose(s, { dates: [D[0], D[1]] });
  assert.equal(p.days[D[0]]?.Lunch, undefined);                       // already planned: untouched
  assert.ok(pick(p, D[0], 'Dinner'));                                  // empty: filled
  assert.notEqual(pick(p, D[0], 'Dinner').recipeId, 'a');              // 'a' is already on that day
  assert.ok(pick(p, D[1], 'Lunch') && pick(p, D[1], 'Dinner'));
  assert.deepEqual(s, before);
  // fully planned day -> not in proposal at all
  addPlanItem(s, D[0], 'Dinner', recipeItem('i2', 'b', 1), 2);
  assert.equal((await propose(s, { dates: [D[0]] })).days[D[0]], undefined);
});

test('A8 no repeat within noRepeatDays (default 3: recipes must be >= 3 days apart); real day distance across a month end; input order irrelevant', async () => {
  const s = mk([rec('a', 600), rec('b', 590), rec('c', 580)], 600);
  const dates = ['2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02'];
  const p = await propose(s, { dates, slots: ['Lunch'] });
  assert.deepEqual(dates.map(d => pick(p, d, 'Lunch').recipeId), ['a', 'b', 'c', 'a']);   // best fit first; 'a' is free again after 3 days
  assert.equal(hasRepeatNote(p), false);
  assert.deepEqual(await propose(s, { dates: [...dates].reverse(), slots: ['Lunch'] }), p);   // chronological processing
  // noRepeatDays 2: a, b, a
  const p2 = await propose(s, { dates: dates.slice(0, 3), slots: ['Lunch'], noRepeatDays: 2 });
  assert.deepEqual(dates.slice(0, 3).map(d => pick(p2, d, 'Lunch').recipeId), ['a', 'b', 'a']);
});

test('A9 recipes already planned on neighbouring days and earlier in the same day count for the repeat window', async () => {
  const s = mk([rec('a', 600), rec('b', 590)], 600); addPlanItem(s, '2025-11-18', 'Dinner', recipeItem('i1', 'a', 1), 1);
  const p = await propose(s, { dates: ['2025-11-17', '2025-11-20', '2025-11-21'], slots: ['Lunch'] });
  assert.equal(pick(p, '2025-11-17', 'Lunch').recipeId, 'b');   // 'a' is 1 day away
  assert.equal(pick(p, '2025-11-20', 'Lunch').recipeId, 'b');   // 'a' 2 days away; 'b' 3 days away is allowed
  assert.equal(pick(p, '2025-11-21', 'Lunch').recipeId, 'a');   // 'a' 3 days away; 'b' 1 day away
  assert.equal(hasRepeatNote(p), false);
  // same day, other slot: budget 1200 - 600 = 600, 'a' would fit best but is already on this day
  const s2 = mk([rec('a', 600), rec('b', 500)], 1200); addPlanItem(s2, D[0], 'Dinner', recipeItem('i1', 'a', 1), 1);
  assert.equal(pick(await propose(s2, { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch').recipeId, 'b');
});

test('A10 repeat rule: noRepeatDays 0 disables it; relaxed only when nothing else is eligible, and then with a note', async () => {
  const s = mk([rec('a', 600), rec('b', 590)], 600);
  const off = await propose(s, { dates: D.slice(0, 3), slots: ['Lunch'], noRepeatDays: 0 });
  assert.deepEqual(D.slice(0, 3).map(d => pick(off, d, 'Lunch').recipeId), ['a', 'a', 'a']); assert.equal(hasRepeatNote(off), false);
  // two recipes, 3 days: a, b, then both are blocked -> relaxed to best fit 'a' + note
  const p = await propose(s, { dates: D.slice(0, 3), slots: ['Lunch'] });
  assert.deepEqual(D.slice(0, 3).map(d => pick(p, d, 'Lunch').recipeId), ['a', 'b', 'a']); assert.equal(hasRepeatNote(p), true);
  // one recipe only: still a full plan, one note
  const one = await propose(mk([rec('a', 600)], 600), { dates: D.slice(0, 3), slots: ['Lunch'] });
  assert.deepEqual(D.slice(0, 3).map(d => pick(one, d, 'Lunch').recipeId), ['a', 'a', 'a']); assert.equal(hasRepeatNote(one), true);
});

test('A11 preferFavorites: within 10% of the target (fit difference <= best + 0.1 x target) a favourite beats a better fit; closest favourite wins among favourites', async () => {
  const o = { dates: [D[0]], slots: ['Lunch'] };   // goal 600 = target
  assert.equal(pick(await propose(mk([rec('n', 600), rec('f', 640, { favorite: true })], 600), o), D[0], 'Lunch').recipeId, 'f');   // 40 <= 60
  assert.equal(pick(await propose(mk([rec('n', 600), rec('f1', 640, { favorite: true }), rec('f2', 610, { favorite: true })], 600), o), D[0], 'Lunch').recipeId, 'f2');
  assert.equal(pick(await propose(mk([rec('a', 600, { favorite: true }), rec('b', 590, { favorite: true })], 600), o), D[0], 'Lunch').recipeId, 'a');   // all favourites: plain best fit
});

test('A12 a clearly better non-favourite still wins (favourite 120 kcal off a 600 target is outside the 10% band)', async () => {
  const p = await propose(mk([rec('n', 600), rec('f', 720, { favorite: true })], 600), { dates: [D[0]], slots: ['Lunch'] });
  assert.equal(pick(p, D[0], 'Lunch').recipeId, 'n');
});

test('A13 preferFavorites:false ignores the flag (best fit wins)', async () => {
  const p = await propose(mk([rec('n', 600), rec('f', 640, { favorite: true })], 600), { dates: [D[0]], slots: ['Lunch'], preferFavorites: false });
  assert.equal(pick(p, D[0], 'Lunch').recipeId, 'n');
});

test('A14 recipes without usable nutrition are never picked (nothing linked, 0 kcal, NaN, Infinity), even with includeIncomplete', async () => {
  const noNut = rec('nonut', 600, { ingredients: [{ id: 'i1', raw: '1 x', name: 'x', qty: 1, unit: '', prep: '', food: null, grams: null }] });
  const bad = [noNut, rec('zero', 0), rec('nan', NaN), rec('inf', Infinity), rec('neg', -500)];
  for (const includeIncomplete of [false, true]) {
    const p = await propose(mk([...bad, rec('good', 500)], 500), { dates: D, slots: ['Lunch', 'Dinner'], noRepeatDays: 0, includeIncomplete });
    const ids = Object.values(p.days).flatMap(d => Object.values(d).flat()).map(x => x.recipeId);
    assert.ok(ids.length > 0); assert.ok(ids.every(i => i === 'good'), ids.join());
  }
});

test('A15 incomplete recipes only with includeIncomplete; then complete:false and a note; complete picks have complete:true', async () => {
  const inc = rec('inc', 600, { ingredients: [rec('x', 600).ingredients[0], { id: 'i2', raw: '1 y', name: 'y', qty: 1, unit: '', prep: '', food: null, grams: null }] });
  const s = mk([inc], 600), o = { dates: [D[0]], slots: ['Lunch'] };
  const off = await propose(s, o);
  assert.deepEqual(off.days, {}); assert.ok(off.notes.length >= 1);
  const on = await propose(s, { ...o, includeIncomplete: true });
  assert.equal(pick(on, D[0], 'Lunch').recipeId, 'inc'); assert.equal(pick(on, D[0], 'Lunch').complete, false);
  assert.ok(on.notes.some(n => /incomplete/i.test(n)));
  const mixed = await propose(mk([rec('ok', 500)], 500), { ...o, includeIncomplete: true });
  assert.equal(pick(mixed, D[0], 'Lunch').complete, true); assert.equal(mixed.notes.some(n => /incomplete/i.test(n)), false);
});

test('A16 no eligible recipes: empty proposal + note, no throw (empty, junk and prototype-key recipe maps)', async () => {
  for (const recipes of [{}, { r: null }, { r: 5 }, { r: { name: 'x' } }]) {
    const s = defaults(); s.recipes = recipes;
    const p = await propose(s, { dates: D });
    assert.deepEqual(p.days, {}); assert.ok(p.notes.length >= 1);
  }
  for (const s of [null, undefined, {}, { recipes: null, plan: null, goals: null }]) {
    const p = await propose(s, { dates: D }); assert.deepEqual(p.days, {}); assert.ok(Array.isArray(p.notes));
  }
});

test('A17 deterministic for the same state+opts+seed; default seed is 1; different seeds give at least two different proposals when many candidates tie', async () => {
  const s = mk(Array.from({ length: 8 }, (_, i) => rec('r' + i, 600)), 600);   // 8 identical fits
  const o = { dates: D, slots: ['Lunch'] };
  const a = await propose(s, { ...o, seed: 7 });
  assert.deepEqual(await propose(s, { ...o, seed: 7 }), a);
  assert.deepEqual(await propose(s, o), await propose(s, { ...o, seed: 1 }));
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) seen.add(JSON.stringify((await propose(s, { ...o, seed })).days));
  assert.ok(seen.size >= 2, 'seeds must produce variety');
  // variety never costs fit or the repeat rule: every pick is 1 serving, no recipe twice within 3 days
  for (const x of D.map(d => pick(a, d, 'Lunch'))) assert.equal(x.servings, 1);
  D.slice(0, 5).forEach((d, i) => assert.notEqual(pick(a, d, 'Lunch').recipeId, pick(a, D[i + 1], 'Lunch').recipeId));
  assert.ok(!/Math\.random/.test(readFileSync(new URL('../js/domain/autoplan.js', import.meta.url), 'utf8')), 'no Math.random');
});

test('A18 every pick has a non-empty plain-text why that mentions kcal and not the recipe name or markup', async () => {
  const s = mk([rec('a', 600, { name: 'Zzyzx <b>Stew</b>' }), rec('b', 590, { name: 'Other' })]);
  const p = await propose(s, { dates: D.slice(0, 3), slots: ['Lunch', 'Dinner'] });
  const all = Object.values(p.days).flatMap(d => Object.values(d).flat());
  assert.ok(all.length >= 3);
  for (const x of all) {
    assert.equal(typeof x.why, 'string'); assert.ok(x.why.trim().length > 0); assert.match(x.why, /kcal/i);
    assert.ok(!/Zzyzx|Stew|Other/.test(x.why)); assert.ok(!/[<>]/.test(x.why));
  }
});

test('A19 proposePlan never mutates state (deep-frozen input does not throw, no day records created)', async () => {
  const s = mk([rec('a', 600), rec('b', 300, { favorite: true })]); addPlanItem(s, D[0], 'Dinner', recipeItem('i1', 'a', 1), 5);
  const before = structuredClone(s); deepFreeze(s);
  await propose(s, { dates: D, slots: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] });
  assert.deepEqual(s, before);
});

test('A20 hostile opts never throw and fall back to defaults', async () => {
  const s = mk([rec('a', 600), rec('b', 590), rec('c', 580)]);
  const base = await propose(s, { dates: [D[0]] });
  for (const goalK of [NaN, Infinity, -Infinity, -5, 0, 'abc', null, {}, []]) assert.deepEqual(await propose(s, { dates: [D[0]], goalK }), base, String(goalK));
  for (const slots of ['Lunch', null, 5, {}, { length: 2 }]) assert.deepEqual(await propose(s, { dates: [D[0]], slots }), base);
  assert.deepEqual(Object.keys((await propose(s, { dates: [D[0]], slots: ['Brunch', '__proto__', 'Lunch', 'Lunch', 5] })).days[D[0]]), ['Lunch']);
  assert.deepEqual((await propose(s, { dates: [D[0]], slots: ['Brunch', 'constructor'] })).days, {});
  for (const seed of [NaN, Infinity, -3, 2 ** 53, 1.5, '7', null, {}]) { const p = await propose(s, { dates: D, seed }); assert.ok(pick(p, D[0], 'Lunch')); }
  for (const noRepeatDays of [NaN, -1, 'x', Infinity, null, 1e9]) { const p = await propose(s, { dates: D, noRepeatDays }); assert.equal(typeof p, 'object'); assert.ok(Array.isArray(p.notes)); }
  for (const o of [{ dates: 'nope' }, { dates: null }, { dates: {} }, { dates: 5 }, 'str', 5, [], () => 1]) assert.deepEqual((await propose(s, o)).days, {});
  const frozenProto = await propose(s, { dates: [D[0]], preferFavorites: 'x', includeIncomplete: 'yes', __proto__: { dates: D } });
  assert.ok(frozenProto.days[D[0]]); assert.equal(Object.keys((await propose(s, { __proto__: { dates: D } })).days).length, 0);   // inherited opts are ignored
});

test('A21 bad dates are ignored (not real calendar dates, wrong types); duplicates are proposed once', async () => {
  const s = mk([rec('a', 600), rec('b', 590)]);
  const p = await propose(s, { dates: ['nope', 5, null, undefined, {}, '2025-02-30', '2025-13-01', '2025-11-17 ', '17-11-2025', '', D[0], D[0], D[0]], slots: ['Lunch'] });
  assert.deepEqual(Object.keys(p.days), [D[0]]); assert.equal(p.days[D[0]].Lunch.length, 1);
});

test('A22 hostile recipe data never yields NaN/Infinity/out-of-range servings', async () => {
  const hostile = [rec('h1', 500, { servings: 1e308 }), rec('h2', 500, { servings: 0 }), rec('h3', 500, { servings: -4 }), rec('h4', 500, { servings: 'x' }), rec('h5', 500, { servings: NaN }),
    rec('h6', 1e308), rec('h7', 1e-300), rec('h8', 500, { servings: Infinity }), rec('ok', 500)];
  const p = await propose(mk(hostile, 1e300), { dates: D, slots: ['Lunch', 'Dinner'], noRepeatDays: 0 });
  const all = Object.values(p.days).flatMap(d => Object.values(d).flat());
  assert.ok(all.length > 0);
  for (const x of all) { assert.ok(Number.isFinite(x.servings), 'finite'); assert.ok(x.servings >= 0.5 && x.servings <= 4); assert.equal(x.servings * 2, Math.round(x.servings * 2)); }
  const huge = await propose(mk([rec('a', 500)], 1e300), { dates: D, slots: ['Lunch'] });
  for (const d of D) assert.equal(pick(huge, d, 'Lunch')?.servings, 4);   // budget capped by the 4-serving maximum
});

test('A23 31 days x 4 slots x 60 recipes finishes in well under 2 s and fills every slot', async () => {
  const s = mk(Array.from({ length: 60 }, (_, i) => rec('r' + i, 150 + i * 13, { favorite: i % 5 === 0 })), 2400);
  const dates = Array.from({ length: 31 }, (_, i) => `2025-12-${String(i + 1).padStart(2, '0')}`);
  const t = Date.now(); const p = await propose(s, { dates, slots: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] }); const ms = Date.now() - t;
  assert.ok(ms < 2000, ms + ' ms');
  assert.equal(Object.keys(p.days).length, 31);
  for (const d of dates) assert.deepEqual(Object.keys(p.days[d]).sort(), ['Breakfast', 'Dinner', 'Lunch', 'Snacks']);
});

test('A24 layering: autoplan.js imports only allowed modules and uses no DOM, storage, network or Math.random', async () => {
  const src = readFileSync(new URL('../js/domain/autoplan.js', import.meta.url), 'utf8');
  const specs = [...src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  for (const sp of specs) assert.match(sp, /^(?:\.\/[\w-]+\.js|\.\.\/core\/(?:constants|dates|format|schema)\.js)$/, sp);
  assert.ok(!/\b(document|localStorage|window|fetch)\b/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
});

// ---- applyProposal ----------------------------------------------------------------------------------------------

const idSeq = () => { let n = 0; return () => 'id' + (++n); };

test('A25 applyProposal adds plan items via plan.js: recipe items with ids from idGen, day updatedAt = now, returns the count', async () => {
  const { applyProposal } = await mod();
  const s = mk([rec('a', 600), rec('b', 590)]);
  const proposal = { days: { [D[0]]: { Lunch: [{ recipeId: 'a', servings: 1.5, why: 'w', complete: true }], Dinner: [{ recipeId: 'b', servings: 1, why: 'w', complete: true }] }, [D[1]]: { Lunch: [{ recipeId: 'b', servings: 2, why: 'w', complete: true }] } }, notes: [] };
  const copy = structuredClone(proposal);
  assert.equal(applyProposal(s, proposal, 777, idSeq()), 3);
  assert.deepEqual(s.plan[D[0]].slots.Lunch, [recipeItem('id1', 'a', 1.5)]);
  assert.deepEqual(s.plan[D[0]].slots.Dinner, [recipeItem('id2', 'b', 1)]);
  assert.deepEqual(s.plan[D[1]].slots.Lunch, [recipeItem('id3', 'b', 2)]);
  assert.equal(s.plan[D[0]].updatedAt, 777); assert.equal(s.plan[D[1]].updatedAt, 777);
  assert.deepEqual(proposal, copy);   // proposal untouched
});

test('A26 propose then apply round trip: the planned days now hold exactly the proposed picks; a second apply adds nothing', async () => {
  const { proposePlan, applyProposal } = await mod();
  const s = mk([rec('a', 600), rec('b', 590), rec('c', 580)], 1300);
  const p = proposePlan(s, { dates: D.slice(0, 3) });
  const n = applyProposal(s, p, 5, idSeq());
  assert.equal(n, 6);
  for (const d of D.slice(0, 3)) for (const slot of ['Lunch', 'Dinner']) {
    const items = getDay(s, d).slots[slot]; assert.equal(items.length, 1);
    assert.equal(items[0].recipeId, p.days[d][slot][0].recipeId); assert.equal(items[0].servings, p.days[d][slot][0].servings);
  }
  const snap = structuredClone(s);
  assert.equal(applyProposal(s, p, 99, idSeq()), 0);
  assert.deepEqual(s, snap);   // not even a timestamp changes
});

test('A27 applyProposal never overwrites: a slot that became non-empty after proposing is skipped (others still applied)', async () => {
  const { applyProposal } = await mod();
  const s = mk([rec('a', 600), rec('b', 590)]);
  const proposal = { days: { [D[0]]: { Lunch: [{ recipeId: 'a', servings: 1 }], Dinner: [{ recipeId: 'b', servings: 1 }] } }, notes: [] };
  addPlanItem(s, D[0], 'Lunch', recipeItem('mine', 'b', 3), 10);
  assert.equal(applyProposal(s, proposal, 50, idSeq()), 1);
  assert.deepEqual(s.plan[D[0]].slots.Lunch, [recipeItem('mine', 'b', 3)]);
  assert.equal(s.plan[D[0]].slots.Dinner.length, 1);
  // all skipped: no timestamp change, no new day records
  const s2 = mk([rec('a', 600)]); addPlanItem(s2, D[0], 'Lunch', recipeItem('mine', 'a', 1), 10);
  assert.equal(applyProposal(s2, { days: { [D[0]]: { Lunch: [{ recipeId: 'a', servings: 1 }] }, [D[1]]: { Lunch: [{ recipeId: 'zzz', servings: 1 }] } } }, 99, idSeq()), 0);
  assert.equal(s2.plan[D[0]].updatedAt, 10); assert.equal(s2.plan[D[1]], undefined);
});

test('A28 applyProposal ignores recipes that no longer exist (deleted, inherited keys), bad dates and bad slots', async () => {
  const { applyProposal } = await mod();
  const s = mk([rec('a', 600)]);
  const pk = recipeId => ({ recipeId, servings: 1 });
  const proposal = { days: {
    [D[0]]: { Lunch: [pk('gone')], Dinner: [pk('toString')], Snacks: [pk('constructor')], Breakfast: [pk('__proto__')], Brunch: [pk('a')], __proto__: { Lunch: [pk('a')] } },
    'nope': { Lunch: [pk('a')] }, '2025-02-30': { Lunch: [pk('a')] }, [D[1]]: { Lunch: [pk('a')] } }, notes: [] };
  assert.equal(applyProposal(s, proposal, 5, idSeq()), 1);
  assert.deepEqual(Object.keys(s.plan), [D[1]]);
});

test('A29 malformed proposals, states and arguments return 0 without throwing', async () => {
  const { applyProposal } = await mod();
  const bad = [null, undefined, 5, 'x', [], {}, { days: null }, { days: [] }, { days: 'x' }, { days: { [D[0]]: 5 } }, { days: { [D[0]]: { Lunch: 'x' } } }, { days: { [D[0]]: { Lunch: [null, 5, 'a', {}] } } },
    { days: { [D[0]]: { Lunch: [{ recipeId: 'a', servings: NaN }, { recipeId: 'a', servings: Infinity }, { recipeId: 'a', servings: 0 }, { recipeId: 'a', servings: -1 }, { recipeId: 'a', servings: '2' }, { recipeId: 'a' }, { recipeId: 7, servings: 1 }] } } }];
  for (const p of bad) { const s = mk([rec('a', 600)]); assert.equal(applyProposal(s, p, 1, idSeq()), 0, JSON.stringify(p)); assert.deepEqual(s.plan, {}); }
  const ok = { days: { [D[0]]: { Lunch: [{ recipeId: 'a', servings: 1 }] } } };
  for (const s of [null, undefined, {}, { recipes: null, plan: null }]) assert.equal(applyProposal(s, ok, 1, idSeq()), 0);
  for (const idGen of [undefined, null, 'x']) { const s = mk([rec('a', 600)]); assert.equal(applyProposal(s, ok, 1, idGen), 0); assert.deepEqual(s.plan, {}); }
});

test('A30 applying a proposal to a state whose plan has other days/slots keeps them intact', async () => {
  const { proposePlan, applyProposal } = await mod();
  const s = mk([rec('a', 600), rec('b', 590), rec('c', 580)]);
  addPlanItem(s, '2025-12-24', 'Snacks', recipeItem('keep', 'c', 1), 3);
  const keep = structuredClone(s.plan['2025-12-24']);
  applyProposal(s, proposePlan(s, { dates: D.slice(0, 2) }), 9, idSeq());
  assert.deepEqual(s.plan['2025-12-24'], keep);
});
