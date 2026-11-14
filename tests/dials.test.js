// Spec: docs/specs/dials.md (backlog item 21). Test-designer file, written BEFORE the implementation. All data is made up.
// Golden values are hand-computed (the arithmetic is in the comments), never taken from the code under test.
// Tests 23-27 are WEAK source-text checks (words in files); the screens themselves are proved by the headless checklist C1-C15 in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults, migrate, sanitize, SCHEMA_VERSION } from '../js/core/schema.js';
import { createStore } from '../js/core/store.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { touchSettings } from '../js/domain/entries.js';
import { exportFiles, xData } from '../js/domain/reports.js';
import { clone } from './helpers.js';

const D = '2026-11-14';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const DIALS = () => import('../js/domain/dials.js');
const UI = () => import('../js/ui/dials.js');
const near = (a, b, e = 1e-9, msg) => assert.ok(typeof a === 'number' && Math.abs(a - b) <= e, `${msg || ''} ${a} is not within ${e} of ${b}`);
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const entry = (grams, per100 = { k: 100, p: 10, c: 20, f: 5 }, id = 'e1') => ({ id, meal: 'Lunch', name: 'Rice', brand: '', source: 'custom', per100, grams, updatedAt: 1 });
// 800 g of {100,10,20,5} per 100 g = 800 kcal, 80 g P, 160 g C, 40 g F
const mk = ({ entries = [entry(800)], goals = {}, activity = { [D]: { updatedAt: 1, source: 'google-health', steps: 6120, sleepMinutes: 473 } } } = {}) => {
  const s = defaults(); s.days = entries.length ? { [D]: entries } : {}; s.goals = { ...s.goals, ...goals }; s.activity = activity; return s;
};
const rings = m => [...m.nutrition.rings, m.steps, m.sleep];
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };
const BAD_WORDS = /NaN|Infinity|undefined|null|\[object|[<>]/;
const clean = (m, msg) => { for (const s of strings(m)) assert.doesNotMatch(s, BAD_WORDS, `${msg || ''} string "${s}"`); };
const fakeStorage = initial => { const m = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, m }; };

// ================================================================ domain: ring maths
test('1. ringFraction: ratio capped at a full circle', async () => {
  const { ringFraction } = await DIALS();
  assert.equal(ringFraction(50, 100), 0.5); assert.equal(ringFraction(0, 100), 0); assert.equal(ringFraction(100, 100), 1);
  assert.equal(ringFraction(150, 100), 1); assert.equal(ringFraction(250, 1000), 0.25);
  near(ringFraction(1, 3), 1 / 3, 1e-12);
});

test('2. ringFraction: bad goal or value gives exactly 0, never NaN or a division by zero', async () => {
  const { ringFraction } = await DIALS();
  for (const goal of [0, -5, NaN, Infinity, -Infinity, null, undefined, '100', {}, [], true]) assert.equal(ringFraction(50, goal), 0, 'goal ' + String(goal));
  for (const value of [-1, NaN, null, undefined, '50', {}, [], true, -Infinity]) assert.equal(ringFraction(value, 100), 0, 'value ' + String(value));
  const inf = ringFraction(Infinity, 100); assert.ok(Number.isFinite(inf) && inf >= 0 && inf <= 1);
  assert.equal(ringFraction(1e308, 1e-300) <= 1, true); assert.ok(Number.isFinite(ringFraction(1e308, 1e-300)));
});

test('3. isOver: strictly above a positive goal, nothing else', async () => {
  const { isOver } = await DIALS();
  assert.equal(isOver(101, 100), true); assert.equal(isOver(100, 100), false); assert.equal(isOver(99.9, 100), false); assert.equal(isOver(0, 100), false);
  for (const goal of [0, -1, NaN, Infinity, null, undefined, '100', {}]) assert.equal(isOver(500, goal), false, 'goal ' + String(goal));
  for (const value of [NaN, null, undefined, '500', {}, -Infinity]) assert.equal(isOver(value, 100), false, 'value ' + String(value));
});

test('4. ringArc: circumference, filled part, gap and dasharray (r = 10: circumference 20 PI = 62.83185307...)', async () => {
  const { ringArc } = await DIALS();
  const C = 2 * Math.PI * 10;
  const q = ringArc(0.25, 10);
  near(q.circumference, C); near(q.filled, C / 4); near(q.gap, 3 * C / 4);
  const [a, b] = q.dasharray.split(' ').map(Number); near(a, C / 4, 1e-6); near(b, 3 * C / 4, 1e-6);
  assert.equal(q.dasharray.trim().split(/\s+/).length, 2);
  const z = ringArc(0, 10); assert.equal(z.filled, 0); near(z.gap, C);
  const f = ringArc(1, 10); near(f.filled, C); assert.ok(f.gap >= 0 && f.gap < 1e-9, 'a full ring has no (or no negative) gap: ' + f.gap);
  for (const x of [1.5, 99, Infinity]) { const r = ringArc(x, 10); near(r.filled, C); assert.ok(r.gap >= 0); }
  for (const x of [-1, -Infinity, NaN, '0.5', null, undefined, {}]) { const r = ringArc(x, 10); assert.equal(r.filled, 0, 'fraction ' + String(x)); near(r.gap, C); }
  for (const r of [0, -3, NaN, Infinity, '10', null, undefined, {}]) {
    const o = ringArc(0.5, r);
    assert.deepEqual([o.circumference, o.filled, o.gap, o.dasharray], [0, 0, 0, '0 0'], 'radius ' + String(r));
  }
  assert.doesNotMatch(ringArc(NaN, NaN).dasharray + ringArc(Infinity, 1e308).dasharray, /NaN|Infinity|-/);
});

test('5. ringRadii: outermost first, each one (stroke + gap) smaller, nothing overlaps, impossible input gives []', async () => {
  const { ringRadii } = await DIALS();
  // 120/2 - 8/2 = 56, then -11 each: 45, 34, 23 (innermost inner edge 23 - 4 = 19 > 0)
  assert.deepEqual(ringRadii(120, 8, 3, 4), [56, 45, 34, 23]);
  assert.deepEqual(ringRadii(100, 10, 2, 2), [45, 33]);
  assert.deepEqual(ringRadii(100, 10, 0, 2), [45, 35]);
  assert.deepEqual(ringRadii(18, 8, 0, 1), [5]);
  const r = ringRadii(128, 9, 3, 4); assert.equal(r.length, 4);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1] - r[i] >= 9, 'rings overlap'); assert.ok(r[3] - 4.5 > 0);
  assert.deepEqual(ringRadii(20, 8, 3, 4), []);          // does not fit: 6, -5
  assert.deepEqual(ringRadii(16, 8, 0, 1), []);          // 4 - 4 = 0 is not above 0
  for (const bad of [[NaN, 8, 3, 4], [Infinity, 8, 3, 4], ['120', 8, 3, 4], [120, 0, 3, 4], [120, -1, 3, 4], [120, NaN, 3, 4], [120, 8, -1, 4], [120, 8, NaN, 4], [120, 8, 3, 0], [120, 8, 3, 9], [120, 8, 3, 2.5], [120, 8, 3, NaN], [120, 8, 3, '4'], [-120, 8, 3, 4], []]) {
    assert.deepEqual(ringRadii(...bad), [], JSON.stringify(bad));
  }
});

test('6. formatSleep and formatSteps', async () => {
  const { formatSleep, formatSteps } = await DIALS();
  const cases = [[473, '7 h 53 min'], [480, '8 h'], [45, '45 min'], [0, '0 min'], [1440, '24 h'], [59.6, '1 h'], [450, '7 h 30 min'], [61, '1 h 1 min'], [400, '6 h 40 min']];
  for (const [m, t] of cases) assert.equal(formatSleep(m), t, String(m));
  for (const bad of [NaN, -1, -0.6, '480', null, undefined, Infinity, {}, [], true]) assert.equal(formatSleep(bad), '', String(bad));
  const steps = [[9431, '9,431'], [0, '0'], [1234567, '1,234,567'], [9430.6, '9,431'], [999, '999'], [1000, '1,000'], [200000, '200,000']];
  for (const [n, t] of steps) assert.equal(formatSteps(n), t, String(n));
  for (const bad of [NaN, -1, '9431', null, undefined, Infinity, {}, [], true]) assert.equal(formatSteps(bad), '', String(bad));
});

// ================================================================ domain: the model
test('7. dialModel nutrition: order, names, keys, colours, fractions and texts (800 kcal, 80 P, 160 C, 40 F of 2000/150/200/65)', async () => {
  const { dialModel } = await DIALS();
  const m = dialModel(mk(), D);
  assert.deepEqual(m.nutrition.rings.map(r => r.key), ['k', 'p', 'c', 'f']);
  assert.deepEqual(m.nutrition.rings.map(r => r.name), ['Calories', 'Protein', 'Carbs', 'Fat']);
  assert.deepEqual(m.nutrition.rings.map(r => r.color), ['var(--kcal)', 'var(--p)', 'var(--c)', 'var(--f)']);
  assert.deepEqual(m.nutrition.rings.map(r => r.text), ['800 / 2000 kcal', '80 / 150 g', '160 / 200 g', '40 / 65 g']);
  assert.deepEqual(m.nutrition.rings.map(r => r.label), ['Calories: 800 of 2000 kcal', 'Protein: 80 of 150 g', 'Carbs: 160 of 200 g', 'Fat: 40 of 65 g']);
  const want = [0.4, 80 / 150, 0.8, 40 / 65];
  m.nutrition.rings.forEach((r, i) => { near(r.fraction, want[i], 1e-12, r.key); assert.equal(r.over, false, r.key); assert.equal(r.hasData, true, r.key); });
  assert.deepEqual(m.nutrition.rings.map(r => r.goal), [2000, 150, 200, 65]);
  assert.deepEqual(m.nutrition.centre, { text: '1200', caption: 'kcal left' });
  assert.match(m.nutrition.label, /800/); assert.match(m.nutrition.label, /2000/);
  clean(m);
});

test('8. dialModel over and exactly-at-goal', async () => {
  const { dialModel } = await DIALS();
  // 2100 g of 100 kcal/100 g = 2100 kcal; protein 210 > 150, carbs 420 > 200, fat 105 > 65
  const over = dialModel(mk({ entries: [entry(2100)] }), D);
  assert.equal(over.nutrition.rings[0].over, true); assert.equal(over.nutrition.rings[0].fraction, 1);
  assert.deepEqual(over.nutrition.centre, { text: '100', caption: 'kcal over' });
  assert.equal(over.nutrition.rings[0].label, 'Calories: 2100 of 2000 kcal, over goal');
  assert.deepEqual(over.nutrition.rings.map(r => r.over), [true, true, true, true]);
  const at = dialModel(mk({ entries: [entry(2000)] }), D);       // 2000 kcal exactly
  assert.equal(at.nutrition.rings[0].over, false); assert.equal(at.nutrition.rings[0].fraction, 1);
  assert.deepEqual(at.nutrition.centre, { text: '0', caption: 'kcal left' });
  // only protein over: 20 g P/100 g * 800 g = 160 g > 150; calories 800, carbs 160, fat 40
  const one = dialModel(mk({ entries: [entry(800, { k: 100, p: 20, c: 20, f: 5 })] }), D);
  assert.deepEqual(one.nutrition.rings.map(r => r.over), [false, true, false, false]);
  assert.equal(one.nutrition.rings[1].label, 'Protein: 160 of 150 g, over goal');
});

test('9. dialModel: a day with nothing logged is a real zero, not "no data"', async () => {
  const { dialModel } = await DIALS();
  const m = dialModel(mk({ entries: [] }), D);
  for (const r of m.nutrition.rings) { assert.equal(r.fraction, 0); assert.equal(r.hasData, true); assert.equal(r.over, false); }
  assert.deepEqual(m.nutrition.centre, { text: '2000', caption: 'kcal left' });
  assert.equal(m.nutrition.rings[0].text, '0 / 2000 kcal');
});

test('10. dialModel steps and sleep from the viewed day\'s activity', async () => {
  const { dialModel } = await DIALS();
  const m = dialModel(mk(), D);
  assert.equal(m.steps.key, 'steps'); assert.equal(m.steps.name, 'Steps'); assert.equal(m.steps.color, 'var(--ring-steps)');
  assert.equal(m.steps.value, 6120); assert.equal(m.steps.goal, 10000); near(m.steps.fraction, 0.612, 1e-12);
  assert.equal(m.steps.text, '6,120 / 10,000'); assert.equal(m.steps.label, 'Steps: 6,120 of 10,000'); assert.equal(m.steps.hasData, true); assert.equal(m.steps.over, false);
  assert.equal(m.sleep.key, 'sleep'); assert.equal(m.sleep.name, 'Sleep'); assert.equal(m.sleep.color, 'var(--ring-sleep)');
  assert.equal(m.sleep.value, 473); assert.equal(m.sleep.goal, 480); near(m.sleep.fraction, 473 / 480, 1e-12);
  assert.equal(m.sleep.text, '7 h 53 min / 8 h'); assert.equal(m.sleep.label, 'Sleep: 7 h 53 min of 8 h'); assert.equal(m.sleep.over, false);
  const h = dialModel(mk({ goals: { sleepH: 7.5 }, activity: { [D]: { updatedAt: 1, source: 'google-health', sleepMinutes: 400 } } }), D);   // 7.5 h = 450 min
  assert.equal(h.sleep.goal, 450); near(h.sleep.fraction, 400 / 450, 1e-12); assert.equal(h.sleep.text, '6 h 40 min / 7 h 30 min');
  const other = dialModel(mk({ activity: { [D]: { updatedAt: 1, source: 'google-health', steps: 1 }, '2026-11-13': { updatedAt: 1, source: 'google-health', steps: 9999 } } }), D);
  assert.equal(other.steps.value, 1, 'only the viewed day counts');
  clean(m);
});

test('11. dialModel over goal for steps and sleep; exactly at goal is not over', async () => {
  const { dialModel } = await DIALS();
  const act = o => ({ [D]: { updatedAt: 1, source: 'google-health', ...o } });
  const m = dialModel(mk({ activity: act({ steps: 12000, sleepMinutes: 540 }) }), D);
  assert.equal(m.steps.over, true); assert.equal(m.steps.fraction, 1); assert.equal(m.steps.text, '12,000 / 10,000'); assert.equal(m.steps.label, 'Steps: 12,000 of 10,000, over goal');
  assert.equal(m.sleep.over, true); assert.equal(m.sleep.fraction, 1); assert.equal(m.sleep.text, '9 h / 8 h'); assert.equal(m.sleep.label, 'Sleep: 9 h of 8 h, over goal');
  const at = dialModel(mk({ activity: act({ steps: 10000, sleepMinutes: 480 }) }), D);
  assert.deepEqual([at.steps.over, at.steps.fraction, at.sleep.over, at.sleep.fraction], [false, 1, false, 1]);
  const big = dialModel(mk({ activity: act({ steps: 200000 }) }), D);
  assert.equal(big.steps.fraction, 1); assert.equal(big.steps.text, '200,000 / 10,000');
});

test('12. dialModel: no data is "no data", never a silent 0; a recorded 0 is data', async () => {
  const { dialModel } = await DIALS();
  const rec = o => ({ updatedAt: 1, source: 'google-health', ...o });
  const noSteps = [{}, { '2026-11-13': rec({ steps: 5, sleepMinutes: 5 }) }, { [D]: rec({ sleepMinutes: 473 }) }, { [D]: rec({ workouts: [{ id: 'w', name: 'Run', start: '2026-11-14T07:00:00Z', minutes: 30 }] }) }];
  const noSleep = [{}, { '2026-11-13': rec({ steps: 5, sleepMinutes: 5 }) }, { [D]: rec({ steps: 100 }) }, noSteps[3]];
  const gone = (r, name) => {
    assert.equal(r.hasData, false); assert.equal(r.value, null); assert.equal(r.text, 'no data'); assert.equal(r.label, name + ': no data'); assert.equal(r.fraction, 0); assert.equal(r.over, false);
  };
  noSteps.forEach((a, i) => gone(dialModel(mk({ activity: a }), D).steps, 'Steps'));
  noSleep.forEach(a => gone(dialModel(mk({ activity: a }), D).sleep, 'Sleep'));
  const z = dialModel(mk({ activity: { [D]: rec({ steps: 0, sleepMinutes: 473 }) } }), D);
  assert.equal(z.steps.hasData, true); assert.equal(z.steps.value, 0); assert.equal(z.steps.text, '0 / 10,000'); assert.equal(z.steps.fraction, 0); assert.equal(z.steps.over, false);
  assert.equal(z.sleep.text, '7 h 53 min / 8 h');
  const noAct = mk(); delete noAct.activity; gone(dialModel(noAct, D).steps, 'Steps'); gone(dialModel(noAct, D).sleep, 'Sleep');
  for (const junk of ['x', 5, [], null, true]) { const s = mk(); s.activity = junk; gone(dialModel(s, D).steps, 'Steps'); }
});

test('13. dialModel: a missing or zero goal never divides by zero; the text keeps the number', async () => {
  const { dialModel } = await DIALS();
  const old = mk(); old.goals = { k: 2000, p: 150, c: 200, f: 65 };   // a state from before the new goals
  const variants = [old, mk({ goals: { steps: 0, sleepH: 0 } }), mk({ goals: { steps: NaN, sleepH: NaN } }), mk({ goals: { steps: -5, sleepH: -1 } }), mk({ goals: { steps: 'x', sleepH: '8' } }),
    mk({ goals: { steps: Infinity, sleepH: Infinity } }), mk({ goals: { steps: null, sleepH: undefined } })];
  for (const s of variants) {
    const m = dialModel(s, D);
    assert.equal(m.steps.goal, 0); assert.equal(m.steps.fraction, 0); assert.equal(m.steps.over, false); assert.equal(m.steps.text, '6,120'); assert.equal(m.steps.label, 'Steps: 6,120, no goal set');
    assert.equal(m.sleep.goal, 0); assert.equal(m.sleep.fraction, 0); assert.equal(m.sleep.over, false); assert.equal(m.sleep.text, '7 h 53 min'); assert.equal(m.sleep.label, 'Sleep: 7 h 53 min, no goal set');
    clean(m);
  }
  const k0 = dialModel(mk({ goals: { k: 0, p: 0, c: 0, f: 0 } }), D);
  assert.deepEqual(k0.nutrition.rings.map(r => [r.goal, r.fraction, r.over]), [[0, 0, false], [0, 0, false], [0, 0, false], [0, 0, false]]);
  assert.deepEqual(k0.nutrition.rings.map(r => r.text), ['800 kcal', '80 g', '160 g', '40 g']);
  assert.equal(k0.nutrition.rings[0].label, 'Calories: 800 kcal, no goal set');
  clean(k0);
});

test('14. dialModel survives hostile state: no throw, no mutation, only fixed words and numbers in the strings', async () => {
  const { dialModel } = await DIALS();
  for (const s of [null, undefined, {}, 5, 'x', [], { days: null, goals: null, activity: null }, { days: [], goals: [], activity: [] }]) {
    const m = dialModel(s, D);
    assert.equal(m.nutrition.rings.length, 4); assert.equal(m.steps.hasData, false); assert.equal(m.sleep.hasData, false); clean(m, JSON.stringify(s));
  }
  const bad = (a) => mk({ activity: { [D]: { updatedAt: 1, source: 'google-health', ...a } } });
  for (const a of [{ steps: NaN }, { steps: '5000' }, { steps: -1 }, { steps: Infinity }, { steps: null }, { steps: {} }, { steps: [5] }, { sleepMinutes: 0 }, { sleepMinutes: -5 }, { sleepMinutes: 'x' }, { sleepMinutes: NaN }, { sleepMinutes: Infinity }]) {
    const m = dialModel(bad(a), D); clean(m, JSON.stringify(a));
    const k = Object.keys(a)[0] === 'steps' ? m.steps : m.sleep; assert.equal(k.hasData, false, JSON.stringify(a)); assert.equal(k.text, 'no data');
  }
  for (const day of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', undefined, null, 5, {}, '<img>']) {
    const s = mk(); const m = dialModel(s, day); clean(m, String(day)); assert.equal(m.steps.hasData, false, String(day));
  }
  const evil = mk({ goals: { k: '<img src=x onerror=1>', p: {}, c: [], f: null, steps: '<b>', sleepH: true } });
  clean(dialModel(evil, D));
  const frozen = deepFreeze(mk()); const before = JSON.stringify(frozen);
  clean(dialModel(frozen, D)); assert.equal(JSON.stringify(frozen), before);
  assert.deepEqual(dialModel(mk(), D), dialModel(mk(), D), 'same answer every time');
});

// ================================================================ ui: dialsHtml
test('15. dialsHtml: svg with viewBox, a label and visible text for each ring, red only when over, "no data" text', async () => {
  const { dialModel } = await DIALS(); const { dialsHtml } = await UI();
  const model = dialModel(mk(), D), html = dialsHtml(model);
  assert.equal(typeof html, 'string');
  assert.match(html, /<svg\b[^>]*\bviewBox="/);
  for (const r of rings(model)) { assert.ok(html.includes(`aria-label="${r.label}"`), 'aria-label ' + r.label); assert.ok(html.includes(r.text), 'text ' + r.text); }
  for (const t of ['800 / 2000 kcal', '80 / 150 g', '160 / 200 g', '40 / 65 g', '6,120 / 10,000', '7 h 53 min / 8 h', 'kcal left']) assert.ok(html.includes(t), t);
  assert.ok(html.includes('1200'));
  for (const v of ['var(--kcal)', 'var(--p)', 'var(--c)', 'var(--f)', 'var(--ring-steps)', 'var(--ring-sleep)']) assert.ok(html.includes(v), v);
  assert.equal(html.includes('var(--over)'), false, 'nothing is over');
  assert.ok(html.includes('stroke-dasharray'));
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  const over = dialsHtml(dialModel(mk({ activity: { [D]: { updatedAt: 1, source: 'google-health', steps: 12000, sleepMinutes: 473 } } }), D));
  assert.ok(over.includes('var(--over)'), 'an over-goal ring is drawn in --over');
  assert.ok(over.includes('Steps: 12,000 of 10,000, over goal'));
  const none = dialsHtml(dialModel(mk({ activity: {} }), D));
  assert.ok(none.includes('no data')); assert.ok(none.includes('aria-label="Steps: no data"')); assert.ok(none.includes('aria-label="Sleep: no data"')); assert.doesNotMatch(none, /NaN|Infinity/);
});

test('16. dialsHtml escapes everything and never prints NaN', async () => {
  const { dialModel } = await DIALS(); const { dialsHtml } = await UI();
  const bad = '<img src=x onerror=alert(1)>', q = '"onmouseover="x';
  const m = JSON.parse(JSON.stringify(dialModel(mk(), D)));
  for (const r of rings(m)) { r.key = bad; r.name = bad; r.text = q + bad; r.label = q + bad; r.color = 'red" onload="x'; }
  m.nutrition.label = bad + q; m.nutrition.centre = { text: bad, caption: q };
  const html = dialsHtml(m);
  assert.doesNotMatch(html, /<img/i); assert.doesNotMatch(html, /<script/i); assert.doesNotMatch(html, /onmouseover="/); assert.doesNotMatch(html, /onload="/); assert.doesNotMatch(html, /onerror=alert\(1\)>/);
  const n = JSON.parse(JSON.stringify(dialModel(mk(), D)));
  const hostile = [NaN, Infinity, -Infinity, -1, 5, 'x', null, undefined, {}];
  rings(n).forEach((r, i) => { r.fraction = hostile[i % hostile.length]; r.value = hostile[(i + 3) % hostile.length]; r.goal = hostile[(i + 5) % hostile.length]; r.over = hostile[i % hostile.length]; });
  assert.doesNotMatch(dialsHtml(n), /NaN|Infinity|undefined/);
  for (const x of [null, undefined, {}, 'x', 5, [], { nutrition: null }]) assert.equal(typeof dialsHtml(x), 'string', 'does not throw on ' + JSON.stringify(x));
});

// ================================================================ saved shape
test('17. SCHEMA_VERSION 11, defaults carry the new goals, STORAGE_KEY unchanged', () => {
  assert.equal(SCHEMA_VERSION, 11); assert.equal(defaults().schemaVersion, 11);
  assert.deepEqual(defaults().goals, { k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8 });
  assert.equal(STORAGE_KEY, 'macrodiary.v1'); assert.match(read('js/core/schema.js'), /export const SCHEMA_VERSION = 11;/);
});

const oldSave = v => ({ ...clone(defaults()), schemaVersion: v, goals: { k: 1800, p: 120, c: 0, f: 55.5 }, theme: 'dark', weightUnit: 'oz', settingsUpdatedAt: 77, tombstones: { x: 5 },
  days: { '2026-11-13': [entry(300)] }, activity: { '2026-11-13': { updatedAt: 1, source: 'google-health', steps: 5000, sleepMinutes: 400 } } });
const kept = s => JSON.stringify([s.days, s.tombstones, s.settingsUpdatedAt, s.theme, s.weightUnit, s.activity, s.goals.k, s.goals.p, s.goals.c, s.goals.f]);

test('18. migration from any older version keeps every value and adds steps 10000 / sleepH 8; store load, save and reload agree', () => {
  for (const v of [1, 2, 5, 8, 9, 10]) {
    const src = oldSave(v), m = migrate(clone(src));
    assert.equal(m.schemaVersion, 11, 'from ' + v); assert.equal(kept(m), kept(src), 'from ' + v);
    assert.deepEqual(m.goals, { k: 1800, p: 120, c: 0, f: 55.5, steps: 10000, sleepH: 8 }, 'from ' + v);
  }
  const st = fakeStorage(JSON.stringify(oldSave(10))), s = createStore(st);
  assert.equal(s.state.schemaVersion, 11); assert.deepEqual(s.state.goals, { k: 1800, p: 120, c: 0, f: 55.5, steps: 10000, sleepH: 8 });
  s.state.goals.steps = 7000; s.state.goals.sleepH = 7.5; assert.equal(s.save(), true);
  const saved = JSON.parse(st.m.get(STORAGE_KEY)); assert.equal(saved.schemaVersion, 11); assert.equal(saved.goals.steps, 7000); assert.equal(saved.goals.sleepH, 7.5);
  const again = createStore(fakeStorage(JSON.stringify(saved)));
  assert.deepEqual(again.state.goals, { k: 1800, p: 120, c: 0, f: 55.5, steps: 7000, sleepH: 7.5 }); assert.equal(kept(again.state), kept(oldSave(10)));
  const rep = createStore(fakeStorage()); rep.replace({ goals: { k: 1800, p: 120, c: 150, f: 50 } });
  assert.deepEqual(rep.state.goals, { k: 1800, p: 120, c: 150, f: 50, steps: 10000, sleepH: 8 });
});

test('19. sanitising the new goals: valid kept, numeric text converted, anything else falls back to the default', () => {
  const g = o => sanitize({ goals: o }).goals;
  const steps = [[7500, 7500], [0, 0], ['9000', 9000], [7500.6, 7501], [7500.4, 7500], [1e6, 1e6], [1e6 + 1, 10000], [1e12, 10000], [-1, 10000], [NaN, 10000], [Infinity, 10000], [-Infinity, 10000],
    [null, 10000], ['', 10000], [true, 10000], [false, 10000], [{}, 10000], ['abc', 10000], [undefined, 10000], ['<img>', 10000]];
  for (const [v, want] of steps) assert.equal(g({ k: 1, p: 2, c: 3, f: 4, steps: v }).steps, want, 'steps ' + String(v));
  const sleep = [[7.5, 7.5], [0, 0], [24, 24], ['7.5', 7.5], [8, 8], [24.5, 8], [25, 8], [1e9, 8], [-0.1, 8], [NaN, 8], [Infinity, 8], [null, 8], ['', 8], [true, 8], [false, 8], [{}, 8], ['abc', 8], [undefined, 8]];
  for (const [v, want] of sleep) assert.equal(g({ k: 1, p: 2, c: 3, f: 4, sleepH: v }).sleepH, want, 'sleepH ' + String(v));
  assert.deepEqual(g({ k: 1800, p: 120, c: 0, f: 55.5 }), { k: 1800, p: 120, c: 0, f: 55.5, steps: 10000, sleepH: 8 });
  assert.deepEqual(g({ k: 1800, p: 120, c: 0, f: 55.5, steps: 5000, sleepH: 6 }), { k: 1800, p: 120, c: 0, f: 55.5, steps: 5000, sleepH: 6 });
  assert.deepEqual(g({ k: -1, p: 'x', steps: 5000 }), { k: 2000, p: 150, c: 200, f: 65, steps: 5000, sleepH: 8 }, 'bad calorie goals do not disturb the new ones');
  for (const junk of [null, undefined, 'x', 5, [], true]) assert.deepEqual(sanitize({ goals: junk }).goals, defaults().goals, String(junk));
  const evil = g(JSON.parse('{"k":1,"p":2,"c":3,"f":4,"steps":6000,"sleepH":7,"zzz":9,"__proto__":{"steps":1,"polluted":true}}'));
  assert.deepEqual(Object.keys(evil).sort(), ['c', 'f', 'k', 'p', 'sleepH', 'steps']); assert.equal(evil.steps, 6000); assert.equal(({}).polluted, undefined); assert.equal(Object.getPrototypeOf(evil), Object.prototype);
  assert.equal(JSON.stringify(g({ k: '<img>', steps: '<b>', sleepH: '<i>' })).includes('<'), false);
});

// ================================================================ sync, backup, export
const settingsRec = (goals, stamp, extra = {}) => ({ key: 'settings', value: { goals, weightUnit: 'g', useUSDA: true, useOFF: true, syncApiKey: false, settingsUpdatedAt: stamp, ...extra }, updatedAt: stamp });

test('20. sync: the settings record carries steps and sleepH; round trip and convergence in both orders', () => {
  const s = defaults(); s.goals = { k: 1800, p: 120, c: 150, f: 50, steps: 7000, sleepH: 7.5 }; touchSettings(s, 170);
  const rec = toRecords(s).find(r => r.key === 'settings');
  assert.equal(rec.value.goals.steps, 7000); assert.equal(rec.value.goals.sleepH, 7.5); assert.equal(rec.updatedAt, 170);
  assert.deepEqual(applyRecords(defaults(), clone(toRecords(s))).goals, s.goals);
  const a = { ...defaults(), settingsUpdatedAt: 100, goals: { ...defaults().goals, steps: 5000, sleepH: 6 } };
  const b = { ...defaults(), settingsUpdatedAt: 200, goals: { ...defaults().goals, steps: 6000, sleepH: 7 } };
  for (const [x, y] of [[a, b], [b, a]]) { const m = mergeStates(clone(x), clone(y)); assert.equal(m.goals.steps, 6000); assert.equal(m.goals.sleepH, 7); assert.equal(m.settingsUpdatedAt, 200); }
  const viaRecords = applyRecords(clone(a), [settingsRec(b.goals, 200)]); assert.deepEqual(viaRecords.goals, b.goals);
  const older = applyRecords(clone(b), [settingsRec(a.goals, 100)]); assert.deepEqual(older.goals, b.goals, 'an older record does not win');
});

test('21. sync: an old-device settings record still applies and gets the defaults; hostile records give valid numbers', () => {
  const oldGoals = { k: 1800, p: 100, c: 100, f: 50 };
  const local = { ...defaults(), settingsUpdatedAt: 50 };
  const out = applyRecords(clone(local), [settingsRec(oldGoals, 100)]);
  assert.deepEqual(out.goals, { k: 1800, p: 100, c: 100, f: 50, steps: 10000, sleepH: 8 }); assert.equal(out.settingsUpdatedAt, 100);
  const custom = { ...defaults(), settingsUpdatedAt: 50, goals: { ...defaults().goals, steps: 7000, sleepH: 7.5 } };
  const o2 = applyRecords(clone(custom), [settingsRec(oldGoals, 100)]);   // spec open question 1: defaults or the receiver's own value are both accepted here
  assert.equal(o2.goals.k, 1800); assert.ok(Number.isFinite(o2.goals.steps) && o2.goals.steps >= 0); assert.ok(Number.isFinite(o2.goals.sleepH) && o2.goals.sleepH >= 0 && o2.goals.sleepH <= 24);
  for (const g of [{ k: 1800, p: 1, c: 1, f: 1, steps: 'x', sleepH: 99 }, { k: 1800, p: 1, c: 1, f: 1, steps: -5, sleepH: null }, { k: 1800, p: 1, c: 1, f: 1, steps: '<img>', sleepH: '<b>' }, { k: 1800, p: 1, c: 1, f: 1, steps: 1e12, sleepH: -3 }]) {
    const r = applyRecords(clone(local), [settingsRec(g, 100)]);
    assert.equal(r.goals.steps, 10000, JSON.stringify(g)); assert.equal(r.goals.sleepH, 8, JSON.stringify(g)); assert.equal(r.goals.k, 1800);
  }
  const pr = applyRecords(clone(local), [{ key: 'settings', value: JSON.parse('{"goals":{"k":1,"p":1,"c":1,"f":1,"__proto__":{"steps":5},"zzz":1},"settingsUpdatedAt":100}'), updatedAt: 100 }]);
  assert.deepEqual(Object.keys(pr.goals).sort(), ['c', 'f', 'k', 'p', 'sleepH', 'steps']); assert.equal(({}).steps, undefined);
  for (const bad of [null, 'x', 5, [], { goals: 'x' }]) assert.doesNotThrow(() => applyRecords(clone(local), [settingsRec(bad, 100)]));
});

test('22. backup and export: restore brings the goals of a newer backup, keeps ours against an older one, defaults for old backups; the export JSON carries them', () => {
  const local = { ...defaults(), settingsUpdatedAt: 100, goals: { k: 1800, p: 120, c: 150, f: 50, steps: 7000, sleepH: 7.5 } };
  const bk = (goals, stamp) => ({ ...clone(defaults()), goals, settingsUpdatedAt: stamp });
  const newer = mergeRestore(clone(local), bk({ k: 1500, p: 100, c: 100, f: 40, steps: 5000, sleepH: 7 }, 500));
  assert.deepEqual(newer.goals, { k: 1500, p: 100, c: 100, f: 40, steps: 5000, sleepH: 7 });
  for (const stamp of [50, 0]) assert.deepEqual(mergeRestore(clone(local), bk({ k: 1500, p: 100, c: 100, f: 40, steps: 5000, sleepH: 7 }, stamp)).goals, local.goals, 'stamp ' + stamp);
  const legacy = { ...clone(defaults()), goals: { k: 1500, p: 100, c: 100, f: 40 }, settingsUpdatedAt: 500 }; delete legacy.schemaVersion;
  assert.deepEqual(mergeRestore(clone(local), legacy).goals, { k: 1500, p: 100, c: 100, f: 40, steps: 10000, sleepH: 8 });
  const s = mk({ goals: { steps: 7000, sleepH: 7.5 } });
  const files = exportFiles(s, xData(s, 'day', D), '2026-11-14T10:00:00Z'), json = files.find(f => /\.json$/.test(f.name));
  assert.ok(json, 'a data file is exported'); const goals = JSON.parse(json.text).goals;
  assert.equal(goals.steps, 7000); assert.equal(goals.sleepH, 7.5); assert.equal(goals.k, 2000);
});

// ================================================================ wiring (WEAK static checks)
const count = (s, n) => s.split(n).length - 1;
const tagOf = (src, id) => { const m = src.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>')); assert.ok(m, 'missing #' + id); return m[0]; };

test('23. index.html: #dials before an unchanged #summary inside the Diary; #gSteps and #gSleep in the goals card', () => {
  const html = read('index.html');
  assert.equal(count(html, 'id="dials"'), 1); assert.equal(count(html, 'id="gSteps"'), 1); assert.equal(count(html, 'id="gSleep"'), 1);
  const dials = tagOf(html, 'dials'); assert.match(dials, /role="button"/); assert.match(dials, /tabindex="0"/);
  const iv = html.indexOf('id="v-diary"'), id = html.indexOf('id="dials"'), is = html.indexOf('id="summary"');
  assert.ok(iv > -1 && iv < id && id < is, '#dials must sit inside #v-diary and above #summary');
  assert.ok(html.includes('<div class="card" id="summary" role="button" tabindex="0"></div>'), '#summary must stay unchanged');
  for (const [i, mode] of [['gSteps', 'numeric'], ['gSleep', 'decimal']]) {
    const t = tagOf(html, i); assert.match(t, /^<input\b/); assert.match(t, /type="number"/); assert.match(t, /inputmode="/); assert.match(t, /min="0"/);
    assert.match(html, new RegExp('<label[^>]*for="' + i + '"'), 'label for ' + i);
    assert.ok(html.indexOf('id="' + i + '"') > html.indexOf('id="gF"'), i + ' comes after #gF');
    assert.ok(html.indexOf('id="' + i + '"') < html.indexOf('<div class="card">', html.indexOf('id="gF"')), i + ' is in the same card as #gF');
  }
  assert.match(tagOf(html, 'gSleep'), /max="24"/);
});

test('24. settings-view.js: loads, listens to and saves both goals; refuses more than 24 sleep hours', () => {
  const src = read('js/ui/settings-view.js');
  assert.ok(count(src, '#gSteps') >= 2 && count(src, '#gSleep') >= 2, 'both ids are read and written');
  const arr = src.match(/\[\s*'#gK'[^\]]*\]/); assert.ok(arr, 'the change-listener list'); assert.ok(arr[0].includes('#gSteps') && arr[0].includes('#gSleep'), 'both inputs are in the listener list');
  assert.match(src, /\bsteps\s*:/); assert.match(src, /\bsleepH\s*:/); assert.match(src, /\b24\b/, 'the 24 h limit is applied');
  assert.match(src, /touchSettings/);
});

test('25. diary.js: imports dials, renders it, and #dials opens the same details dialog (click and Enter/Space)', () => {
  const src = read('js/ui/diary.js');
  assert.match(src, /from '\.\/dials\.js'/); assert.match(src, /renderDials\(\)/);
  assert.match(src, /\$\('#dials'\)[\s\S]{0,400}openDetails/); assert.match(src, /\$\('#dials'\)[\s\S]{0,600}Enter/);
  assert.match(src, /\$\('#summary'\)|sm\.onclick = openDetails/, '#summary keeps its handler');
});

const luminance = hex => {
  const h = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex;
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('26. themes.css: --ring-steps and --ring-sleep in :root and every theme, readable on the card and distinct from the other colours', () => {
  const css = read('css/themes.css');
  const hexOf = (body, name) => { const m = body.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\\b')); return m ? m[1].toLowerCase() : null; };
  const blocks = [[':root', css.match(/:root\{([^}]*)\}/)[1]], ...[...css.matchAll(/\[data-theme=([a-z]+)\]\{([^}]*--card:[^}]*)\}/g)].map(m => [m[1], m[2]])];
  assert.ok(blocks.length >= 14, 'found :root and the 13 themes, found ' + blocks.length);
  for (const [name, body] of blocks) {
    const steps = hexOf(body, 'ring-steps'), sleep = hexOf(body, 'ring-sleep'), card = hexOf(body, 'card');
    assert.ok(steps && sleep, name + ' defines both ring colours as hex'); assert.ok(card, name + ' has a card colour');
    assert.ok(contrast(steps, card) >= 3, `${name}: steps ${steps} on ${card} is ${contrast(steps, card).toFixed(2)}:1`);
    assert.ok(contrast(sleep, card) >= 3, `${name}: sleep ${sleep} on ${card} is ${contrast(sleep, card).toFixed(2)}:1`);
    const others = ['p', 'c', 'f', 'accent'].map(n => hexOf(body, n)).filter(Boolean).concat(['#dc2626', '#f87171']);
    assert.notEqual(steps, sleep, name); assert.ok(!others.includes(steps), name + ': steps colour must differ from p/c/f/accent/over'); assert.ok(!others.includes(sleep), name + ': sleep colour must differ from p/c/f/accent/over');
  }
});

test('27. shipping: SHELL lists both new files, CACHE above 60, layering, decision and architecture notes', () => {
  const sw = read('sw.js');
  const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of ['js/domain/dials.js', 'js/ui/dials.js']) assert.ok(shell.includes(f), f + ' must be in SHELL');
  const cache = Number(sw.match(/const CACHE = 'macro-diary-v(\d+)'/)[1]); assert.ok(cache > 60, 'CACHE must be bumped above the value on main (60), is ' + cache);
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const dom = strip(read('js/domain/dials.js'));
  for (const m of dom.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^(\.\/[a-z0-9-]+\.js|\.\.\/core\/(constants|format|dates|schema)\.js)$/, 'domain/dials.js may not import ' + m[1]);
  assert.doesNotMatch(dom, /\b(document|window|localStorage|sessionStorage|fetch|navigator|globalThis)\b/, 'domain/dials.js must stay pure');
  const ui = strip(read('js/ui/dials.js'));
  assert.doesNotMatch(ui, /from\s+'\.\.\/services\//); assert.match(ui, /\besc\b/);
  const dec = read('docs/DECISIONS.md'), at = dec.search(/^## D56\./m); assert.ok(at > -1, 'DECISIONS.md needs ## D56.');
  const sec = dec.slice(at, (dec.indexOf('\n## D', at + 5) + 1 || dec.length)); assert.match(sec, /dial/i); assert.match(sec, /11/); assert.match(sec, /goal/i);
  assert.match(read('docs/ARCHITECTURE.md'), /dials\.js/);
});
