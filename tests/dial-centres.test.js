// Spec: docs/specs/dial-centres.md (owner request 2026-11-14). Test-designer file, written BEFORE the implementation. All data is made up.
// Golden values are hand-computed (arithmetic in the comments), never taken from the code under test.
// Tests C15-C16 are WEAK source-text checks; the screens themselves are proved by the headless scenarios in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as DOMAIN from '../js/domain/dials.js';
import { defaults } from '../js/core/schema.js';
import { dialsHtml } from '../js/ui/dials.js';

// namespace import: a missing export fails only the tests that use it
const { dialModel, shortSteps, shortHours } = DOMAIN;
const D = '2026-11-14';
const ALL = ['k', 'p', 'c', 'f', 'steps', 'sleep'];
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const entry = (grams, per100 = { k: 100, p: 10, c: 20, f: 5 }, id = 'e1') => ({ id, meal: 'Lunch', name: 'Rice', brand: '', source: 'custom', per100, grams, updatedAt: 1 });
// 800 g of {100,10,20,5} per 100 g = 800 kcal, 80 g P, 160 g C, 40 g F
const mk = ({ entries = [entry(800)], goals = {}, dials = ALL, activity = { [D]: { updatedAt: 1, source: 'google-health', steps: 6120, sleepMinutes: 473 } } } = {}) => {
  const s = defaults(); s.days = entries.length ? { [D]: entries } : {}; s.goals = { ...s.goals, ...goals }; s.activity = activity; s.dials = dials; return s;
};
const act = (steps, sleepMinutes) => ({ [D]: { updatedAt: 1, source: 'google-health', steps, sleepMinutes } });
const BAD_WORDS = /NaN|Infinity|undefined|null|\[object|[<>]/;
const centreOf = (m, key) => m.rings[key].centre;
const tc = (m, key) => [centreOf(m, key).text, centreOf(m, key).caption];
const divWith = (html, attr) => {
  const i = html.search(new RegExp('<div\\b[^>]*' + attr)); if (i < 0) return null;
  const re = /<(\/?)div\b[^>]*>/g; re.lastIndex = i; let depth = 0, m;
  while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (depth === 0) return html.slice(i, re.lastIndex); }
  return html.slice(i);
};
// the <text> elements inside the ring svg of one dial: [{ cls: [...tokens], text }]
const svgTexts = (html, key) => {
  const dial = divWith(html, `data-dial="${key}"`); assert.ok(dial, 'dial ' + key); const a = dial.indexOf('<svg'), b = dial.indexOf('</svg>'); assert.ok(a > -1 && b > a, 'svg in dial ' + key);
  return [...dial.slice(a, b).matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map(m => ({ cls: (m[1].match(/\bclass="([^"]*)"/)?.[1] || '').split(/\s+/), text: m[2] }));
};
const numOf = (html, key) => svgTexts(html, key).find(t => t.cls.includes('dial-num'));
const capOf = (html, key) => svgTexts(html, key).find(t => t.cls.includes('dial-cap'));
const PART = /^(\d{1,3}|\d{1,2}(\.\d)?[kM]|\d{3}k|\d{2}M\+?)$/;

// ================================================================ pure formatters
test('C1. shortSteps: under 1000 plain; thousands as k with at most one decimal (half up, no trailing .0); 10k and up whole k; millions as M; always <= 4 characters', () => {
  // hand-computed: n/1000 rounded half up to one decimal below 10k
  const gold = [[0, '0'], [850, '850'], [999, '999'], [999.4, '999'], [999.5, '1k'], [1000, '1k'], [1049, '1k'], [1050, '1.1k'], [1250, '1.3k'], [1950, '2k'], [2300, '2.3k'], [2350, '2.4k'], [6120, '6.1k'],
    [9949, '9.9k'], [9950, '10k'], [10000, '10k'], [10499, '10k'], [10500, '11k'], [12400, '12k'], [12500, '13k'], [99000, '99k'], [250000, '250k'], [999499, '999k'], [999500, '1M'],
    [1000000, '1M'], [1500000, '1.5M'], [9949999, '9.9M'], [9950000, '10M'], [50000000, '50M'], [99499999, '99M'], [99500000, '99M+'], [1e12, '99M+'], [Number.MAX_VALUE, '99M+']];
  for (const [n, want] of gold) assert.equal(shortSteps(n), want, String(n));
});

test('C2. shortSteps: hostile input gives an empty string, never NaN/Infinity/undefined; every finite value stays within 4 characters and a clean pattern', () => {
  for (const bad of [undefined, null, NaN, Infinity, -Infinity, -1, -0.5, '2300', '', [], [2300], {}, true, () => 1, Symbol('x'), 10n]) assert.equal(shortSteps(bad), '', String(typeof bad === 'symbol' ? 'symbol' : bad));
  for (let n = 0; n < 2e8; n = n < 10 ? n + 0.7 : Math.floor(n * 1.37) + 1) { const s = shortSteps(n); assert.ok(s.length <= 4, `${n} -> ${s}`); assert.match(s, /^(\d{1,3}|\d{1,2}(\.\d)?[kM]|\d{3}k|\d{2}M\+?)$/, `${n} -> ${s}`); assert.doesNotMatch(s, /\.0|e\+|NaN|Infinity/, `${n} -> ${s}`); }
});

test('C3. shortHours: minutes to hours, one decimal below 10 h (half up), whole hours from 10 h, no trailing .0, capped as "99+"; hostile input gives ""', () => {
  // hand-computed: 473/60 = 7.883 -> 7.9; 435/60 = 7.25 (exact) -> 7.3; 450/60 = 7.5; 6/60 = 0.1; 630/60 = 10.5 -> 11; 5970/60 = 99.5 -> 99+
  const gold = [[473, '7.9'], [480, '8'], [450, '7.5'], [435, '7.3'], [540, '9'], [596, '9.9'], [600, '10'], [630, '11'], [720, '12'], [1440, '24'], [6, '0.1'], [0, '0'], [1, '0'], [5969, '99'], [5970, '99+'], [1e9, '99+'], [Number.MAX_VALUE, '99+']];
  for (const [m, want] of gold) assert.equal(shortHours(m), want, String(m));
  for (const bad of [undefined, null, NaN, Infinity, -Infinity, -1, -0.5, '473', '', [], [473], {}, true, () => 1]) assert.equal(shortHours(bad), '', String(bad));
  for (let m = 0; m < 1e7; m = m < 10 ? m + 0.7 : Math.floor(m * 1.31) + 1) { const s = shortHours(m); assert.ok(s.length <= 4, `${m} -> ${s}`); assert.match(s, /^(\d{1,2}(\.\d)?|99\+)$/, `${m} -> ${s}`); assert.doesNotMatch(s, /\.0$/, `${m} -> ${s}`); }
});

// ================================================================ model: every ring has a centre
test('C4. dialModel: all six rings carry centre {text, caption}; protein, carbs and fat show grams left, calories unchanged', () => {
  const m = dialModel(mk(), D);
  // P 150-80 = 70, C 200-160 = 40, F 65-40 = 25
  assert.deepEqual(tc(m, 'k'), ['1200', 'kcal left']); assert.deepEqual(tc(m, 'p'), ['70', 'g left']); assert.deepEqual(tc(m, 'c'), ['40', 'g left']); assert.deepEqual(tc(m, 'f'), ['25', 'g left']);
  assert.deepEqual(tc(m, 'steps'), ['6.1k/10k', 'steps']);   // 6120 -> 6.1k, goal 10000 -> 10k
  assert.deepEqual(tc(m, 'sleep'), ['7.9/8h', 'sleep']);     // 473 min = 7.88 h -> 7.9; goal 8 h -> 8
  for (const k of ALL) assert.deepEqual(Object.keys(centreOf(m, k)).sort(), ['caption', 'text'], k + ' centre has exactly text and caption');
  assert.deepEqual(m.nutrition.centre, { text: '1200', caption: 'kcal left' }, 'the calories centre stays where it was');
  assert.deepEqual(m.rings.k.centre, m.nutrition.centre); assert.deepEqual(m.rows.map(r => r.centre), [0, 1, 2, 3].map(i => m.nutrition.rings[i].centre));
  assert.deepEqual(m.steps.centre, m.rings.steps.centre); assert.deepEqual(m.sleep.centre, m.rings.sleep.centre);
});

test('C5. dialModel: over goal shows the amount over with "g over" (grams), exactly at goal is "0" and "g left", goal 0 shows grams eaten', () => {
  const over = dialModel(mk({ entries: [entry(2200)] }), D);   // 2200 g: 220 P, 440 C, 110 F, 2200 kcal
  assert.deepEqual([tc(over, 'k'), tc(over, 'p'), tc(over, 'c'), tc(over, 'f')], [['200', 'kcal over'], ['70', 'g over'], ['240', 'g over'], ['45', 'g over']]);   // 220-150, 440-200, 110-65
  const at = dialModel(mk({ entries: [entry(1500)] }), D);      // 150 P exactly (goal 150)
  assert.deepEqual(tc(at, 'p'), ['0', 'g left'], 'exactly at the goal is not over');
  const k0 = dialModel(mk({ goals: { k: 0, p: 0, c: 0, f: 0 } }), D);
  assert.deepEqual([tc(k0, 'k'), tc(k0, 'p'), tc(k0, 'c'), tc(k0, 'f')], [['800', 'kcal eaten'], ['80', 'g eaten'], ['160', 'g eaten'], ['40', 'g eaten']]);
  const empty = dialModel(mk({ entries: [] }), D);              // nothing eaten: the whole goal is left
  assert.deepEqual([tc(empty, 'k'), tc(empty, 'p'), tc(empty, 'c'), tc(empty, 'f')], [['2000', 'kcal left'], ['150', 'g left'], ['200', 'g left'], ['65', 'g left']]);
  const mixed = dialModel(mk({ entries: [entry(1000, { k: 100, p: 20, c: 5, f: 5 })] }), D);   // 200 P (over 150), 50 C, 50 F
  assert.deepEqual([tc(mixed, 'p'), tc(mixed, 'c'), tc(mixed, 'f')], [['50', 'g over'], ['150', 'g left'], ['15', 'g left']]);
  const frac = dialModel(mk({ entries: [entry(1000, { k: 100, p: 7.04, c: 20, f: 5 })] }), D);  // 70.4 P eaten -> 150 - 70.4 = 79.6 -> 80
  assert.deepEqual(tc(frac, 'p'), ['80', 'g left'], 'whole numbers, rounded');
});

test('C6. dialModel: steps and sleep centres: value/goal in short form, "--" with "no data", value only with no goal, over goal looks the same', () => {
  assert.deepEqual(tc(dialModel(mk({ activity: {} }), D), 'steps'), ['--', 'no data']); assert.deepEqual(tc(dialModel(mk({ activity: {} }), D), 'sleep'), ['--', 'no data']);
  assert.deepEqual(tc(dialModel(mk({ activity: act(0, 473) }), D), 'steps'), ['0/10k', 'steps'], 'a recorded 0 is a number, not no data');
  assert.deepEqual(tc(dialModel(mk({ activity: act(850, 473) }), D), 'steps'), ['850/10k', 'steps']);
  assert.deepEqual(tc(dialModel(mk({ activity: act(2300, 473) }), D), 'steps'), ['2.3k/10k', 'steps']);
  assert.deepEqual(tc(dialModel(mk({ activity: act(2350, 473) }), D), 'steps'), ['2.4k/10k', 'steps']);
  assert.deepEqual(tc(dialModel(mk({ activity: act(10000, 473) }), D), 'steps'), ['10k/10k', 'steps']);
  assert.deepEqual(tc(dialModel(mk({ activity: act(12400, 473) }), D), 'steps'), ['12k/10k', 'steps'], 'over goal: same style, no extra word');
  assert.equal(dialModel(mk({ activity: act(12400, 473) }), D).rings.steps.over, true);
  assert.deepEqual(tc(dialModel(mk({ goals: { steps: 7500 }, activity: act(6120, 473) }), D), 'steps'), ['6.1k/7.5k', 'steps']);
  assert.deepEqual(tc(dialModel(mk({ goals: { steps: 0 }, activity: act(6120, 473) }), D), 'steps'), ['6.1k', 'steps'], 'goal 0: value only');
  assert.deepEqual(tc(dialModel(mk({ goals: { steps: 0 }, activity: {} }), D), 'steps'), ['--', 'no data']);
  assert.deepEqual(tc(dialModel(mk({ activity: act(6120, 540) }), D), 'sleep'), ['9/8h', 'sleep'], 'over goal: same style, no extra word');
  assert.equal(dialModel(mk({ activity: act(6120, 540) }), D).rings.sleep.over, true);
  assert.deepEqual(tc(dialModel(mk({ goals: { sleepH: 7.5 }, activity: act(6120, 450) }), D), 'sleep'), ['7.5/7.5h', 'sleep']);
  assert.deepEqual(tc(dialModel(mk({ goals: { sleepH: 0 }, activity: act(6120, 473) }), D), 'sleep'), ['7.9h', 'sleep'], 'goal 0: value only, with the unit');
  assert.deepEqual(tc(dialModel(mk({ activity: act(null, null) }), D), 'steps'), ['--', 'no data']);
});

test('C7. dialModel: centre strings are fixed words and numbers, text <= 9 and caption <= 8 characters (calories caption <= 10), whatever the data; state never mutated; old fields unchanged', () => {
  const huge = { entries: [entry(1e12)], goals: { k: 1e15, p: 1e15, c: 1e15, f: 1e15, steps: 1e15, sleepH: 1e12 }, activity: act(1e12, 1e12) };
  const variants = [mk(), mk(huge), mk({ ...huge, goals: { k: 0, p: 0, c: 0, f: 0, steps: 0, sleepH: 0 } }), mk({ entries: [] }), mk({ activity: {} }), mk({ activity: act(Number.MAX_VALUE, Number.MAX_VALUE) }),
    mk({ activity: act(-5, -5) }), mk({ activity: act('9', '9') }), mk({ activity: act([1], {}) }), mk({ activity: act(NaN, Infinity) }), mk({ goals: { k: NaN, p: 'x', c: null, f: [], steps: -4, sleepH: {} } }),
    mk({ entries: [entry(1e12, { k: 1e12, p: 1e12, c: 1e12, f: 1e12 })] }), mk({ entries: [entry(NaN), entry(-5), entry('x')] }), mk({ entries: [entry(800, { k: 'a', p: null, c: [], f: {} })] })];
  for (const s of variants) {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(s))), m = dialModel(frozen, D);
    for (const k of ALL) {
      const c = centreOf(m, k); assert.ok(c && typeof c === 'object', k + ' has a centre');
      assert.equal(typeof c.text, 'string'); assert.equal(typeof c.caption, 'string'); assert.ok(c.text.length >= 1, k + ' text is never empty');
      assert.ok(c.text.length <= 9, `${k} text "${c.text}" longer than 9`); assert.ok(c.caption.length <= (k === 'k' ? 10 : 8), `${k} caption "${c.caption}" too long`);
      assert.doesNotMatch(c.text + ' ' + c.caption, BAD_WORDS, k); assert.doesNotMatch(c.text, /e\+|e-/, k + ' no exponent form');
    }
  }
  const m = dialModel(mk(), D);   // old fields are untouched
  assert.deepEqual(m.rings.p.text, '80 / 150 g'); assert.equal(m.steps.text, '6,120 / 10,000'); assert.equal(m.sleep.text, '7 h 53 min / 8 h'); assert.equal(m.sleep.label, 'Sleep: 7 h 53 min of 8 h'); assert.equal(m.nutrition.rings[0].label, 'Calories: 800 of 2000 kcal');
});

test('C8. dialModel: absurd amounts are capped so the centre fits: whole numbers above 99999 read "99999+" (calories included)', () => {
  const m = dialModel(mk({ entries: [entry(1e12)] }), D);   // 1e12 g of rice: 1e12 kcal, 1e11 g P ...
  for (const k of ['k', 'p', 'c', 'f']) assert.equal(centreOf(m, k).text, '99999+', k);
  assert.equal(centreOf(m, 'p').caption, 'g over');
  const big = dialModel(mk({ entries: [entry(800)], goals: { p: 1e12 } }), D); assert.deepEqual(tc(big, 'p'), ['99999+', 'g left']);   // 1e12 - 80
});

// ================================================================ markup
test('C9. dialsHtml: every selected dial draws its centre text and caption inside the ring svg; name, value text and aria-label stay', () => {
  const html = dialsHtml(dialModel(mk(), D));
  const want = { k: ['1200', 'kcal left'], p: ['70', 'g left'], c: ['40', 'g left'], f: ['25', 'g left'], steps: ['6.1k/10k', 'steps'], sleep: ['7.9/8h', 'sleep'] };
  for (const k of ALL) {
    const texts = svgTexts(html, k); assert.equal(texts.filter(t => t.cls.includes('dial-num')).length, 1, k + ' one dial-num'); assert.equal(texts.filter(t => t.cls.includes('dial-cap')).length, 1, k + ' one dial-cap');
    assert.equal(numOf(html, k).text, want[k][0], k + ' number'); assert.equal(capOf(html, k).text, want[k][1], k + ' caption');
  }
  const names = { k: 'Calories', p: 'Protein', c: 'Carbs', f: 'Fat', steps: 'Steps', sleep: 'Sleep' }, labels = { k: 'Calories: 800 of 2000 kcal', p: 'Protein: 80 of 150 g', c: 'Carbs: 160 of 200 g', f: 'Fat: 40 of 65 g', steps: 'Steps: 6,120 of 10,000', sleep: 'Sleep: 7 h 53 min of 8 h' };
  const texts = { k: '800 / 2000 kcal', p: '80 / 150 g', c: '160 / 200 g', f: '40 / 65 g', steps: '6,120 / 10,000', sleep: '7 h 53 min / 8 h' };
  for (const k of ALL) { const el = divWith(html, `data-dial="${k}"`); assert.ok(el.includes(names[k]), k + ' name'); assert.ok(el.includes(`aria-label="${labels[k]}"`), k + ' aria-label unchanged'); assert.ok(el.includes(texts[k]), k + ' value text under the ring'); }
  assert.equal(html.split('data-dial="').length - 1, 6);
});

test('C10. dialsHtml: unselected dials draw nothing; no-data, over-goal and goal-0 centres are drawn as modelled; the arc is still red when over', () => {
  const only = dialsHtml(dialModel(mk({ dials: ['p', 'steps'] }), D)); assert.equal(only.includes('data-dial="k"'), false); assert.equal(svgTexts(only, 'p').length >= 2, true); assert.equal(only.includes('1200'), false, 'no calories centre when calories is not selected');
  const none = dialsHtml(dialModel(mk({ activity: {} }), D)); assert.equal(numOf(none, 'steps').text, '--'); assert.equal(capOf(none, 'steps').text, 'no data'); assert.equal(numOf(none, 'sleep').text, '--'); assert.equal(capOf(none, 'sleep').text, 'no data');
  const over = dialsHtml(dialModel(mk({ entries: [entry(2200)], activity: act(12400, 540) }), D));
  assert.equal(numOf(over, 'p').text, '70'); assert.equal(capOf(over, 'p').text, 'g over'); assert.equal(numOf(over, 'steps').text, '12k/10k'); assert.equal(capOf(over, 'steps').text, 'steps'); assert.equal(numOf(over, 'sleep').text, '9/8h');
  for (const k of ['p', 'steps', 'sleep']) assert.ok(divWith(over, `data-dial="${k}"`).includes('stroke="var(--over)"'), k + ' arc stays red');
  const g0 = dialsHtml(dialModel(mk({ goals: { k: 0, p: 0, steps: 0, sleepH: 0 } }), D)); assert.equal(numOf(g0, 'p').text, '80'); assert.equal(capOf(g0, 'p').text, 'g eaten'); assert.equal(numOf(g0, 'steps').text, '6.1k'); assert.equal(numOf(g0, 'sleep').text, '7.9h');
});

test('C11. dialsHtml: long centre numbers (more than 4 characters) carry the small class "dial-num-s", short ones do not', () => {
  const html = dialsHtml(dialModel(mk({ activity: act(850, 473) }), D));
  const small = k => numOf(html, k).cls.includes('dial-num-s');
  assert.equal(numOf(html, 'k').text.length, 4); assert.equal(small('k'), false, '1200 keeps the calories size');
  assert.equal(small('p'), false, '70'); assert.equal(numOf(html, 'steps').text, '850/10k'); assert.equal(small('steps'), true, '850/10k is 7 characters'); assert.equal(small('sleep'), true, '7.9/8h is 5 characters');
  const none = dialsHtml(dialModel(mk({ activity: {} }), D)); assert.equal(numOf(none, 'steps').cls.includes('dial-num-s'), false, '"--" is short');
  const big = dialsHtml(dialModel(mk({ entries: [entry(1e12)] }), D)); assert.equal(numOf(big, 'p').cls.includes('dial-num-s'), true, '99999+ is 6 characters');
});

test('C12. dialsHtml: hostile centre strings are escaped, junk or missing centres do not throw and print no NaN/undefined/[object', () => {
  const evil = '<img src=x onerror=alert(1)>', q = '"><script>alert(2)</script>';
  const m = dialModel(mk(), D); for (const k of ALL) m.rings[k].centre = { text: evil, caption: q }; m.nutrition.centre = { text: evil, caption: q }; m.nutrition.rings.forEach(r => { r.centre = { text: evil, caption: q }; });
  const html = dialsHtml(m); assert.equal(html.includes('<img'), false); assert.equal(html.includes('<script'), false); assert.ok(html.includes('&lt;img'), 'visible as text'); assert.ok(html.includes('&quot;&gt;&lt;script') || html.includes('&lt;script'), 'quote and tag escaped');
  const spans = [...html.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]; assert.ok(spans.length >= 12, 'twelve centre texts, all still well-formed');
  for (const junk of [undefined, null, 5, 'x', [], [1], { text: ['a'], caption: {} }, { text: NaN, caption: Infinity }, { text: null, caption: undefined }, { text: { toString: () => '<b>' }, caption: [] }]) {
    const j = dialModel(mk(), D); for (const k of ALL) j.rings[k].centre = junk; j.nutrition.centre = junk; j.nutrition.rings.forEach(r => { r.centre = junk; });
    let out; assert.doesNotThrow(() => { out = dialsHtml(j); }, String(junk)); assert.doesNotMatch(out, /NaN|Infinity|undefined|\[object|<b>/, String(junk) + ' ' + JSON.stringify(junk));
    assert.equal(out.split('data-dial="').length - 1, 6, 'all six dials still drawn');
  }
  const bare = dialModel(mk(), D); for (const k of ALL) delete bare.rings[k].centre; bare.nutrition.rings.forEach(r => { delete r.centre; }); assert.doesNotThrow(() => dialsHtml(bare)); assert.doesNotMatch(dialsHtml(bare), /NaN|Infinity|undefined|\[object/);
});

test('C13. dialsHtml: the centre of a real model, rendered at the largest values, never exceeds 9 characters and never prints exponent form', () => {
  const huge = { entries: [entry(1e12)], goals: { k: 1e15, p: 1e15, c: 1e15, f: 1e15, steps: 1e15, sleepH: 1e12 }, activity: act(1e12, 1e12) };
  const html = dialsHtml(dialModel(mk(huge), D));
  for (const k of ALL) { const n = numOf(html, k), c = capOf(html, k); assert.ok(n.text.length >= 1 && n.text.length <= 9, `${k} "${n.text}"`); assert.ok(c.text.length <= (k === 'k' ? 10 : 8), `${k} "${c.text}"`); assert.doesNotMatch(n.text + c.text, /e\+|NaN|Infinity|undefined/); }
  assert.equal(numOf(html, 'steps').text, '99M+/99M+'); assert.equal(numOf(html, 'sleep').text, '99+/99+h');
});

// ================================================================ static checks
test('C14. CSS and source: the centre font sizes fit a ring of r=42 (stroke 9) in a 100 box: numbers up to 4 characters at <= 22 px, longer ones (up to 9) at 9-12 px, captions <= 10 px', () => {
  const css = read('css/components.css'), size = sel => { const m = css.match(new RegExp(sel.replace(/[.\-]/g, '\\$&') + '\\s*\\{[^}]*?font-size:\\s*(\\d+(?:\\.\\d+)?)px')); assert.ok(m, 'font-size for ' + sel); return Number(m[1]); };
  const big = size('.dial-num'), small = size('.dial-num-s'), cap = size('.dial-cap');
  // rough text width: 0.62 em per character (bold digits), inside the inner diameter of 2 * (42 - 4.5) = 75 minus a margin for the text height = 70
  assert.ok(4 * 0.62 * big <= 70, `4 chars at ${big}px`); assert.ok(9 * 0.62 * small <= 70, `9 chars at ${small}px`); assert.ok(small >= 9 && small <= 12, `small size ${small}px`); assert.ok(small < big);
  assert.ok(10 * 0.6 * cap <= 70, `10 char caption at ${cap}px`); assert.ok(cap >= 8, 'readable caption');
  const ui = read('js/ui/dials.js'); assert.ok(ui.includes('dial-num-s'), 'ui uses dial-num-s'); assert.ok(ui.includes('dial-cap') && ui.includes('dial-num'));
  assert.doesNotMatch(ui, /key === 'k' \?/, 'the centre is no longer calories-only');
});

test('C15. domain/dials.js exports the pure helpers and stays pure (no browser globals, allowed imports only)', () => {
  assert.equal(typeof shortSteps, 'function'); assert.equal(typeof shortHours, 'function');
  const src = read('js/domain/dials.js'); assert.match(src, /export (function|const) shortSteps/); assert.match(src, /export (function|const) shortHours/);
  assert.doesNotMatch(src, /\b(document|window|localStorage|fetch|navigator)\b/);
  for (const m of src.matchAll(/from '([^']+)'/g)) assert.match(m[1], /^\.\.\/core\/(constants|format|dates|schema)\.js$|^\.\/[a-z-]+\.js$/, 'import ' + m[1]);
});

test('C16. shipping: sw.js CACHE bumped above 64 (the value on this branch when written; never an exact number), decision D59 recorded, spec exists', () => {
  const sw = read('sw.js'), cache = Number(sw.match(/const CACHE = 'macro-diary-v(\d+)'/)[1]); assert.ok(cache > 64, 'CACHE must be bumped above 64, is ' + cache);
  const dec = read('docs/DECISIONS.md'), at = dec.search(/^## D59\./m); assert.ok(at > -1, '## D59. section'); const sec = dec.slice(at, at + 3000);
  assert.match(sec, /centre/i); assert.match(sec, /steps/i); assert.match(sec, /sleep/i); assert.match(sec, /shortSteps|shortHours/);
  assert.ok(read('docs/specs/dial-centres.md').includes('## Contract'));
});
