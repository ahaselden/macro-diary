// Tests for docs/specs/autofill-one-serving.md. Owner decision 2026-11-11 (changes D27): auto-fill proposes exactly ONE serving per recipe;
// the recipe is still chosen by how well one serving fits the slot's calorie target. O1-O12 are behavioural (domain, hand computed).
// G1-G4 are WEAK static source-text checks of js/ui/plan-view.js (dialog wording, manual-add default); they prove the text exists, not that it works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults } from '../js/core/schema.js';
import { addPlanItem, recipeItem, getDay } from '../js/domain/plan.js';

const mod = () => import('../js/domain/autoplan.js');
const propose = async (s, o) => (await mod()).proposePlan(s, o);
const rec = (id, kcal, over = {}) => ({ id, name: 'Quuxly ' + id, description: '', source: '', servings: 1, totalTime: null, tags: [], steps: [], favorite: false, updatedAt: 1,
  ingredients: [{ id: 'i1', raw: '100 g x', name: 'x', qty: 100, unit: 'g', prep: '', food: { name: 'X', brand: '', source: '', per100: { k: kcal, p: 0, c: 0, f: 0 }, servingG: 0 }, grams: 100 }], ...over });
const mk = (recs, goalK = 2000) => { const s = defaults(); s.goals.k = goalK; for (const r of recs) s.recipes[r.id] = r; return s; };
const D = ['2025-11-17', '2025-11-18', '2025-11-19', '2025-11-20', '2025-11-21', '2025-11-22', '2025-11-23'];
const pick = (p, d, slot) => p.days?.[d]?.[slot]?.[0];
const all = p => Object.values(p.days).flatMap(d => Object.values(d).flat());
const ALL4 = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const incomplete = kcal => rec('inc', kcal, { ingredients: [rec('x', kcal).ingredients[0], { id: 'i2', raw: '1 y', name: 'y', qty: 1, unit: '', prep: '', food: null, grams: null }] });
const src = readFileSync(new URL('../js/ui/plan-view.js', import.meta.url), 'utf8');

test('O1 every proposed item has servings exactly 1: many recipe sizes, goals, slot sets, with and without favourites', async () => {
  const recs = [rec('a', 80), rec('b', 250), rec('c', 600, { favorite: true }), rec('d', 1300), rec('e', 3000, { favorite: true })];
  for (const goalK of [300, 1200, 2000, 5000]) for (const slots of [['Lunch'], ['Lunch', 'Dinner'], ALL4]) for (const preferFavorites of [true, false]) {
    const p = all(await propose(mk(recs, goalK), { dates: D, slots, preferFavorites }));
    assert.ok(p.length > 0);
    for (const x of p) assert.strictEqual(x.servings, 1, `goal ${goalK} slots ${slots} fav ${preferFavorites}`);
  }
});

test('O2 goal 1e300 and a tiny positive goal still give 1 serving (no scaling with the budget)', async () => {
  for (const goalK of [1e300, 1e-300, 1, 0.5]) {
    const p = await propose(mk([rec('a', 500), rec('b', 20)], goalK), { dates: D, slots: ['Lunch'], noRepeatDays: 0 });
    assert.equal(all(p).length, D.length);
    for (const x of all(p)) assert.strictEqual(x.servings, 1, String(goalK));
  }
  // huge goal: the biggest 1-serving recipe is the closest to the (huge) target
  assert.equal(pick(await propose(mk([rec('a', 500), rec('b', 900)], 1e300), { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch').recipeId, 'b');
});

test('O3 goal already used up: lowest-kcal recipe at exactly 1 serving, a note and a why that say the goal is used up (hand computed)', async () => {
  const s = mk([rec('x', 800), rec('p', 400), rec('q', 200)], 500); addPlanItem(s, D[0], 'Dinner', recipeItem('i1', 'x', 1), 1);   // budget 500 - 800 < 0
  const p = await propose(s, { dates: [D[0]], slots: ['Lunch'] });
  const x = pick(p, D[0], 'Lunch');
  assert.equal(x.recipeId, 'q'); assert.strictEqual(x.servings, 1);
  assert.match(x.why, /goal/i); assert.match(x.why, /used/i); assert.match(x.why, /200 kcal/);
  assert.ok(!/smallest portion|0\.5/i.test(x.why));
  assert.ok(p.notes.some(n => /goal|budget/i.test(n)) && !p.notes.some(n => /smallest portion/i.test(n)));
  // exactly zero budget (500 planned of 500): also "used up"
  const z = mk([rec('x', 500), rec('q', 200)], 500); addPlanItem(z, D[0], 'Dinner', recipeItem('i1', 'x', 1), 1);
  const zp = pick(await propose(z, { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch'); assert.equal(zp.recipeId, 'q'); assert.strictEqual(zp.servings, 1);
});

test('O4 the recipe is chosen by the distance of ONE serving to the slot target (Lunch 600 / Dinner 700 of 1300; hand computed)', async () => {
  // Lunch target 600: r590 diff 10 beats r400 (200) and r750 (150). Dinner target 700: r590 blocked (same day); r750 diff 50 beats r400 diff 300.
  const p = await propose(mk([rec('r590', 590), rec('r400', 400), rec('r750', 750)], 1300), { dates: [D[0]], slots: ['Lunch', 'Dinner'] });
  assert.equal(pick(p, D[0], 'Lunch').recipeId, 'r590');
  assert.equal(pick(p, D[0], 'Dinner').recipeId, 'r750');
  // the old rule could scale 100 kcal x 6 = 600 and would prefer it; now 450 (diff 150) beats 100 (diff 500)
  assert.equal(pick(await propose(mk([rec('tiny', 100), rec('mid', 450)], 600), { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch').recipeId, 'mid');
});

test('O5 a stated-nutrition recipe is chosen by its stated kcal per serving (foods would say otherwise) and counts as complete', async () => {
  // a: stated 280/serving, its linked flour says 100/serving; c: 150/serving. Target 600: stated 280 -> diff 320 beats c (450); foods 100 -> diff 500 would lose.
  const flour = g => ({ id: 'i1', raw: g + ' g flour', name: 'flour', qty: g, unit: 'g', prep: '', food: { name: 'F', brand: '', source: 'custom', per100: { k: 100, p: 5, c: 20, f: 1 }, servingG: 0, servingLabel: '' }, grams: g });
  const onion = { id: 'i2', raw: '1 onion', name: 'onion', qty: 1, unit: '', prep: '', food: null, grams: null };
  const a = rec('a', 1, { servings: 4, ingredients: [flour(400), onion], stated: { k: 280, p: 1, c: 1, f: 1, per: '' } });
  const c = rec('c', 1, { servings: 4, ingredients: [flour(600)], stated: null });       // 600 kcal / 4 = 150
  const x = pick(await propose(mk([a, c], 600), { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch');
  assert.equal(x.recipeId, 'a'); assert.strictEqual(x.servings, 1); assert.equal(x.complete, true);
});

test('O6 favourites: a favourite within 10% of the target of the best fit wins; a far one does not; both at 1 serving', async () => {
  const o = { dates: [D[0]], slots: ['Lunch'] };   // goal 600 = target
  let x = pick(await propose(mk([rec('n', 600), rec('f', 640, { favorite: true })], 600), o), D[0], 'Lunch'); assert.equal(x.recipeId, 'f'); assert.strictEqual(x.servings, 1);   // 40 <= 60
  x = pick(await propose(mk([rec('n', 600), rec('f', 720, { favorite: true })], 600), o), D[0], 'Lunch'); assert.equal(x.recipeId, 'n'); assert.strictEqual(x.servings, 1);       // 120 > 60
  assert.match(pick(await propose(mk([rec('f', 600, { favorite: true })], 600), o), D[0], 'Lunch').why, /favourite/i);
});

test('O7 includeIncomplete: an incomplete recipe is proposed at 1 serving with complete:false and a note; without the flag it is not proposed', async () => {
  const s = mk([incomplete(900)], 600), o = { dates: [D[0]], slots: ['Lunch'] };
  assert.deepEqual((await propose(s, o)).days, {});
  const p = await propose(s, { ...o, includeIncomplete: true }), x = pick(p, D[0], 'Lunch');
  assert.equal(x.recipeId, 'inc'); assert.strictEqual(x.servings, 1); assert.equal(x.complete, false); assert.ok(p.notes.some(n => /incomplete/i.test(n)));
});

test('O8 why: "About N kcal for 1 serving, close to the T kcal target for this meal" (+ "; a favourite"); no talk of fitting servings or portions', async () => {
  // goal 1300, Lunch+Dinner: targets 600 / 700. Lunch picks r580, Dinner picks r690 (a favourite)
  const p = await propose(mk([rec('r580', 580), rec('r690', 690, { favorite: true })], 1300), { dates: [D[0]], slots: ['Lunch', 'Dinner'] });
  const l = pick(p, D[0], 'Lunch'), d = pick(p, D[0], 'Dinner');
  assert.equal(l.recipeId, 'r580'); assert.equal(d.recipeId, 'r690');
  assert.match(l.why, /About 580 kcal for 1 serving/); assert.match(l.why, /600 kcal target/); assert.ok(!/favourite/i.test(l.why));
  assert.match(d.why, /About 690 kcal for 1 serving/); assert.match(d.why, /700 kcal target/); assert.match(d.why, /favourite/i);
  for (const x of all(p)) { assert.ok(!/\bfit(s|ting)?\b/i.test(x.why), x.why); assert.ok(!/\bservings\b|portion/i.test(x.why), x.why); assert.ok(!/Quuxly|[<>]/.test(x.why)); }
  // the kcal in the text is for ONE serving of a multi-serving recipe: 400 g at 300 kcal/100 g over 4 servings = 300 per serving, not 1200
  const four = rec('f', 300, { servings: 4, ingredients: [{ ...rec('f', 300).ingredients[0], qty: 400, grams: 400, raw: '400 g x' }] });
  assert.match(pick(await propose(mk([four], 300), { dates: [D[0]], slots: ['Lunch'] }), D[0], 'Lunch').why, /About 300 kcal for 1 serving/);
});

test('O9 deterministic: same state + options + seed give the same proposal (default seed 1); seeds still vary ties; no repeat within 3 days; no Math.random', async () => {
  const s = mk(Array.from({ length: 8 }, (_, i) => rec('r' + i, 600)), 600), o = { dates: D, slots: ['Lunch'] };
  assert.deepEqual(await propose(s, { ...o, seed: 7 }), await propose(s, { ...o, seed: 7 }));
  assert.deepEqual(await propose(s, o), await propose(s, { ...o, seed: 1 }));
  const seen = new Set(); for (let seed = 1; seed <= 30; seed++) seen.add(JSON.stringify((await propose(s, { ...o, seed })).days));
  assert.ok(seen.size >= 2);
  const a = await propose(s, { ...o, seed: 3 });
  for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length && j - i < 3; j++) assert.notEqual(pick(a, D[i], 'Lunch').recipeId, pick(a, D[j], 'Lunch').recipeId);
  for (const x of all(a)) assert.strictEqual(x.servings, 1);
  assert.ok(!/Math\.random/.test(readFileSync(new URL('../js/domain/autoplan.js', import.meta.url), 'utf8')));
});

test('O10 repeat window counts already planned recipes; relaxing it (one recipe only) still gives 1 serving and the repeat note', async () => {
  const s = mk([rec('a', 600), rec('b', 590)], 600); addPlanItem(s, '2025-11-18', 'Dinner', recipeItem('i1', 'a', 5), 1);   // the planned amount (5) is irrelevant to the proposal
  const p = await propose(s, { dates: ['2025-11-17'], slots: ['Lunch'] });
  assert.equal(pick(p, '2025-11-17', 'Lunch').recipeId, 'b'); assert.strictEqual(pick(p, '2025-11-17', 'Lunch').servings, 1);
  const one = await propose(mk([rec('a', 600)], 600), { dates: D.slice(0, 3), slots: ['Lunch'] });
  for (const x of all(one)) assert.strictEqual(x.servings, 1);
  assert.ok(one.notes.some(n => /repeat/i.test(n)));
});

test('O11 hostile inputs never throw and never produce a servings value other than 1 (NaN/Infinity/negative recipe yields, hostile opts)', async () => {
  const hostile = [rec('h1', 500, { servings: 1e308 }), rec('h2', 500, { servings: 0 }), rec('h3', 500, { servings: -4 }), rec('h4', 500, { servings: 'x' }), rec('h5', 500, { servings: NaN }),
    rec('h6', 1e308), rec('h7', 1e-300), rec('h8', 500, { servings: Infinity }), rec('ok', 500)];
  for (const goalK of [NaN, Infinity, -5, 0, 1e300, 'abc', null]) for (const seed of [NaN, -3, 2 ** 53, '7', null]) {
    const p = await propose(mk(hostile, 2000), { dates: D, slots: ALL4, noRepeatDays: 0, goalK, seed });
    for (const x of all(p)) assert.strictEqual(x.servings, 1);
  }
  for (const o of [null, undefined, 'str', 5, [], { dates: 'nope' }, { dates: [D[0]], slots: 'Lunch' }]) await propose(mk(hostile), o);   // must not throw
  for (const s of [null, undefined, {}, { recipes: null, plan: null, goals: null }]) assert.deepEqual((await propose(s, { dates: D })).days, {});
});

test('O12 applyProposal is unchanged: it adds the proposed servings (1) through plan.js and never overwrites a filled slot', async () => {
  const { proposePlan, applyProposal } = await mod();
  const s = mk([rec('a', 600), rec('b', 590), rec('c', 580)], 1300);
  addPlanItem(s, D[0], 'Lunch', recipeItem('mine', 'c', 3), 1);
  const p = proposePlan(s, { dates: D.slice(0, 2) });
  let n = 0; const added = applyProposal(s, p, 9, () => 'id' + (++n));
  assert.equal(added, 3);   // D0 Lunch is taken
  assert.deepEqual(getDay(s, D[0]).slots.Lunch, [recipeItem('mine', 'c', 3)]);
  for (const [d, slot] of [[D[0], 'Dinner'], [D[1], 'Lunch'], [D[1], 'Dinner']]) assert.equal(getDay(s, d).slots[slot][0].servings, 1);
});

// ---- WEAK static checks of js/ui/plan-view.js -------------------------------------------------------------------

test('G1 (weak) the auto-fill dialog intro no longer promises to fit your calorie goal and says one serving', () => {
  const i = src.indexOf('Fills only empty meals');
  assert.ok(i >= 0, 'dialog intro text should still start with "Fills only empty meals"');
  const para = src.slice(i, src.indexOf('</p>', i));
  assert.ok(!/\bfit(s|ting)?\b[^.]*\b(calorie|kcal|goal)/i.test(para), para);
  assert.match(para, /one serving|1 serving/i);
  assert.match(para, /Accept/);   // the "nothing changes until Accept" promise stays
});

test('G2 (weak) the dialog preview row shows the proposed servings and the escaped why text, still', () => {
  assert.match(src, /esc\(\s*p\.why\s*\)/); assert.match(src, /p\.servings/);
});

test('G3 (weak) manual add: the recipe branch of the picker starts the servings box at 1 and no longer reads the recipe yield for the default', () => {
  const i = src.indexOf('if (res.dataset.rid)'), j = src.indexOf('} else {', i);
  assert.ok(i >= 0 && j > i, 'recipe branch not found');
  const branch = src.slice(i, j);
  const call = branch.match(/qtyStep\(\s*r\.name\s*,\s*'How many servings\?'\s*,\s*'Servings'\s*,\s*([^,]+?)\s*,/);
  assert.ok(call, 'qtyStep call for recipes not found in the expected form');
  assert.equal(call[1].trim(), '1', `default must be the literal 1, got ${call[1]}`);
  assert.ok(!/\br\.servings\b/.test(branch), 'recipe branch must not read r.servings');
});

test('G4 (weak) manual add: the food branch default is unchanged (serving size, else 100 g)', () => {
  assert.match(src, /qtyStep\(\s*f\.name\s*,[^\n]*'Grams'\s*,\s*Number\(f\.servingG\)\s*>\s*0\s*\?\s*Number\(f\.servingG\)\s*:\s*100\s*,/);
});
