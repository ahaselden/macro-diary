// Spec: docs/specs/export-nutrition-facts.md. Expected values are hand-computed (see the spec), not taken from running the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { xData, rollup, exportFiles } from '../js/domain/reports.js';
import { SCHEMA_VERSION } from '../js/core/schema.js';
import { clone } from './helpers.js';

const LEGACY_ENTRIES = ['Date', 'Meal', 'Food', 'Brand', 'Amount (g)', 'Amount (oz)', 'Logged as', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Source'];
const NUT_COLS = ['Fiber (g)', 'Sugars (g)', 'Saturated fat (g)', 'Sodium (mg)', 'Cholesterol (mg)'];
const KEYS = ['fiber', 'sugars', 'satFat', 'sodium', 'cholesterol'];
const SUM_TAIL = [...NUT_COLS, 'Items logged', 'Fiber items', 'Sugars items', 'Saturated fat items', 'Sodium items', 'Cholesterol items'];
const LEGACY_SUMMARY = ['Date', 'Days logged', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Calorie goal'];

const per100 = { k: 100, p: 10, c: 20, f: 5 };
const ent = (id, grams, nut, extra = {}) => ({ id, meal: 'Lunch', name: 'Food ' + id, brand: '', source: 'OFF', per100: { ...per100 }, servingG: 0, servingLabel: '', grams, unitKey: 'g', amount: grams, disp: grams + ' g', ...(nut === undefined ? {} : { nut }), ...extra });
const A = () => ent('a', 200, { fiber: 2.5, sugars: 10, satFat: 1.2, sodium: 400, cholesterol: 30 });
const B = () => ent('b', 150, { fiber: 0, sodium: 100 });
const C = () => ent('c', 100);
const D = () => ent('d', 33, { sugars: 3 });
const mkState = days => ({ goals: { k: 2000, p: 150, c: 200, f: 65 }, weightUnit: 'g', days });

/** Minimal RFC-4180 parser (BOM stripped). Returns rows of cells. */
function parseCSV(text) {
  assert.equal(text.charCodeAt(0), 0xFEFF, 'BOM first');
  const s = text.slice(1), rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}
const run = (state, kind, date) => exportFiles(state, xData(state, kind, date), 'T');
const pick = (files, what) => files.find(f => f.name.includes(`-${what}-`));
const csv = (files, what) => parseCSV(pick(files, what).text);
const col = (rows, name) => { const i = rows[0].indexOf(name); assert.ok(i >= 0, 'column ' + name); return rows.slice(1).map(r => r[i]); };
const allText = files => files.map(f => f.text).join('\n');

test('1. entries CSV header is the 17 columns and legacy cells are unchanged', () => {
  const rows = csv(run(mkState({ '2025-11-20': [A()] }), 'day', '2025-11-20'), 'entries');
  assert.deepEqual(rows[0], [...LEGACY_ENTRIES, ...NUT_COLS]);
  assert.equal(rows[1].length, 17);
  // A: 200 g at 100 kcal/100 g = 200 kcal, P 20, C 40, F 10; oz = 200/28.349523125 = 7.05 -> 7.1
  assert.deepEqual(rows[1].slice(0, 12), ['2025-11-20', 'Lunch', 'Food a', '', '200', '7.1', '200 g', '200', '20', '40', '10', 'OFF']);
});

test('2. entry rows hold scaled values rounded to one decimal', () => {
  const rows = csv(run(mkState({ '2025-11-20': [A(), D()] }), 'day', '2025-11-20'), 'entries');
  assert.deepEqual(rows[1].slice(12), ['5', '20', '2.4', '800', '60']);
  assert.deepEqual(rows[2].slice(12), ['', '1', '', '', '']);   // 33 * 3 / 100 = 0.99 -> 1
});

test('3. not recorded is an empty cell, recorded 0 is 0', () => {
  const rows = csv(run(mkState({ '2025-11-20': [B(), C()] }), 'day', '2025-11-20'), 'entries');
  assert.deepEqual(rows[1].slice(12), ['0', '', '', '150', '']);
  assert.deepEqual(rows[2].slice(12), ['', '', '', '', '']);
});

test('4. columns are present even when nothing in range was recorded', () => {
  const state = mkState({ '2025-11-20': [C(), C()], '2025-12-02': [A()] });
  const files = run(state, 'month', '2025-11-20');
  const e = csv(files, 'entries');
  assert.deepEqual(e[0], [...LEGACY_ENTRIES, ...NUT_COLS]);
  e.slice(1).forEach(r => { assert.equal(r.length, 17); assert.deepEqual(r.slice(12), ['', '', '', '', '']); });
  const s = csv(files, 'summary');
  assert.deepEqual(s[0], [...LEGACY_SUMMARY, ...SUM_TAIL]);
  assert.equal(s[0].length, 18);
  assert.deepEqual(s[1].slice(7), ['', '', '', '', '', '2', '0', '0', '0', '0', '0']);
});

test('5. summary daily rows sum recorded values only and count coverage', () => {
  const state = mkState({ '2025-11-20': [A(), B(), C()], '2025-11-21': [C()] });
  const s = csv(run(state, 'week', '2025-11-20'), 'summary');
  assert.deepEqual(s[0], [...LEGACY_SUMMARY, ...SUM_TAIL]);
  assert.deepEqual(s[1].slice(0, 2), ['2025-11-20', '1']);
  assert.deepEqual(s[1].slice(7), ['5', '20', '2.4', '950', '60', '3', '2', '1', '1', '2', '1']);
  assert.deepEqual(s[2].slice(0, 2), ['2025-11-21', '1']);
  assert.deepEqual(s[2].slice(7), ['', '', '', '', '', '1', '0', '0', '0', '0', '0']);
});

test('6. summary yearly rows are per-month averages per logged day, counts are month sums', () => {
  const state = mkState({ '2025-11-20': [A(), B(), C()], '2025-11-21': [C()], '2025-12-05': [D()] });
  const s = csv(run(state, 'year', '2025-06-01'), 'summary');
  assert.equal(s[0][0], 'Month');
  assert.deepEqual(s[1].slice(0, 2), ['2025-11', '2']);
  assert.deepEqual(s[1].slice(7), ['2.5', '10', '1.2', '475', '30', '4', '2', '1', '1', '2', '1']);
  assert.deepEqual(s[2].slice(0, 2), ['2025-12', '1']);
  assert.deepEqual(s[2].slice(7), ['', '1', '', '', '', '1', '0', '1', '0', '0', '0']);
});

test('7. JSON entries with nutrients carry nutTotal (recorded keys only), nut as stored, nutTotal last', () => {
  const state = mkState({ '2025-11-20': [A(), B()] });
  const o = JSON.parse(pick(run(state, 'day', '2025-11-20'), 'data').text);
  const [a, b] = o.days['2025-11-20'];
  assert.deepEqual(a.nutTotal, { fiber: 5, sugars: 20, satFat: 2.4, sodium: 800, cholesterol: 60 });
  assert.deepEqual(b.nutTotal, { fiber: 0, sodium: 150 });
  assert.deepEqual(a.nut, { fiber: 2.5, sugars: 10, satFat: 1.2, sodium: 400, cholesterol: 30 });
  assert.deepEqual(b.nut, { fiber: 0, sodium: 100 });
  assert.equal(Object.keys(a).at(-1), 'nutTotal');
  assert.equal(Object.keys(b).at(-1), 'nutTotal');
  assert.deepEqual(Object.keys(a.nutTotal), KEYS);
});

test('8. JSON entries without recorded nutrients are untouched; top-level order stays', () => {
  const hostile = ent('h', 100, { fiber: 'x', sugars: NaN, sodium: -1 });
  const state = mkState({ '2025-11-20': [C(), ent('e', 100, {}), hostile, A()] });
  const text = pick(run(state, 'day', '2025-11-20'), 'data').text;
  const o = JSON.parse(text);
  assert.deepEqual(Object.keys(o), ['exported', 'from', 'to', 'goals', 'days']);
  const list = o.days['2025-11-20'];
  assert.deepEqual(list[0], JSON.parse(JSON.stringify(C())));
  assert.deepEqual(list[1], JSON.parse(JSON.stringify(ent('e', 100, {}))));
  assert.ok(!('nutTotal' in list[0]) && !('nutTotal' in list[1]) && !('nutTotal' in list[2]));
  assert.ok('nutTotal' in list[3]);
});

test('9. CSV injection protection still applies on the new layout', () => {
  const e = ent('x', 100, { fiber: 1 }, { name: '=HYPERLINK("x")', brand: '-1+1', disp: '@sum' });
  const rows = csv(run(mkState({ '2025-11-20': [e] }), 'day', '2025-11-20'), 'entries');
  assert.equal(rows[1][2], '\'=HYPERLINK("x")');
  assert.equal(rows[1][3], "'-1+1");
  assert.equal(rows[1][6], "'@sum");
  assert.equal(rows[1].length, 17);
  assert.deepEqual(rows[1].slice(12), ['1', '', '', '', '']);
});

test('10. hostile nut values are ignored, never throw, never produce NaN', () => {
  const inherit = ent('i', 100, Object.create({ fiber: 9, sodium: 9 }));
  const proto = ent('p', 100, JSON.parse('{"__proto__":{"fiber":5},"zzz":3}'));
  const wholes = [[1, 2], 5, 'fiber', true, null].map((n, i) => ent('w' + i, 100, n));
  const bad = ent('bad', 100, { fiber: '5', sugars: NaN, satFat: Infinity, sodium: -5, cholesterol: null, extra: 1 });
  const bad2 = ent('bad2', 100, { fiber: true, sugars: {}, satFat: [], sodium: () => 1, cholesterol: -Infinity });
  const good = ent('good', 100, { fiber: 1 });
  const state = mkState({ '2025-11-20': [inherit, proto, ...wholes, bad, bad2, good] });
  let files; assert.doesNotThrow(() => { files = run(state, 'day', '2025-11-20'); });
  const e = csv(files, 'entries');
  assert.equal(e.length, 1 + 1 + 1 + 5 + 2 + 1);
  e.slice(1, -1).forEach(r => assert.deepEqual(r.slice(12), ['', '', '', '', ''], r[2]));
  assert.deepEqual(e.at(-1).slice(12), ['1', '', '', '', '']);
  const s = csv(files, 'summary');
  assert.deepEqual(s[1].slice(7), ['1', '', '', '', '', '10', '1', '0', '0', '0', '0']);
  assert.doesNotMatch(allText(files), /NaN|Infinity|undefined|\[object/);
  const o = JSON.parse(pick(files, 'data').text);
  assert.equal(o.days['2025-11-20'].filter(x => 'nutTotal' in x).length, 1);
});

test('11. huge grams stay finite; an overflowing scaled value counts as not recorded', () => {
  const big = ent('big', 1e9, { fiber: 3 });
  const over = ent('over', 1e6, { fiber: 1e308 });
  const files = run(mkState({ '2025-11-20': [big, over] }), 'day', '2025-11-20');
  const e = csv(files, 'entries');
  assert.equal(e[1][12], '30000000');
  assert.equal(e[2][12], '');
  assert.doesNotMatch(allText(files), /Infinity|NaN/);
});

const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
test('12. pure: frozen state ok, no mutation, repeatable', () => {
  const state = mkState({ '2025-11-20': [A(), B(), C()] });
  const before = clone(state);
  deepFreeze(state);
  const x = xData(state, 'day', '2025-11-20');
  const f1 = exportFiles(state, x, 'T'), f2 = exportFiles(state, x, 'T');
  assert.deepEqual(f1, f2);
  assert.deepEqual(state, before);
  state.days['2025-11-20'].forEach(e => assert.ok(!('nutTotal' in e)));
});

test('13. empty range returns no files', () => {
  const state = mkState({ '2025-11-20': [A()] });
  assert.deepEqual(run(state, 'day', '2026-02-10'), []);
  assert.deepEqual(run(mkState({}), 'week', '2025-11-20'), []);
});

test('14. guards (pass before implementation): row shapes, schema, UI untouched', () => {
  const state = mkState({ '2025-11-20': [A()], '2025-12-01': [B()] });
  const x = xData(state, 'year', '2025-06-01');
  x.rows.forEach(r => assert.deepEqual(Object.keys(r), ['date', 'k', 'p', 'c', 'f', 'n']));
  rollup(x).forEach(r => assert.deepEqual(Object.keys(r).sort(), ['c', 'days', 'f', 'k', 'label', 'p']));
  assert.equal(SCHEMA_VERSION, 10);
  const ui = readFileSync(new URL('../js/ui/export-view.js', import.meta.url), 'utf8');
  assert.match(ui, /exportFiles/);
  assert.doesNotMatch(ui, /fiber|sodium|cholesterol|satFat|nutTotal/i);
});
