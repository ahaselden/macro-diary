// WEAK static checks for the plan-month UI (docs/specs/plan-month.md, PU1-PU9). They read source text only: they prove
// markup, imports and calls exist, NOT that the month view renders, that tapping works, or that ids are unique at runtime
// (except PU9, which evaluates the extracted newId definition with a frozen clock and Math.random). See the manual checklist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/ui/plan-view.js', import.meta.url), 'utf8');
const buttons = [...src.matchAll(/<button\b[^>]*>[^<]*<\/button>/g)].map(m => m[0]);
const around = (needle, len = 3000) => { const i = src.indexOf(needle); return i < 0 ? '' : src.slice(i, i + len); };

test('PU1 plan-view imports monthGrid, monthSummary, addMonths, monthStart, autofillDates from ../domain/plan.js', () => {
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/domain\/plan\.js['"]/);
  assert.ok(m, 'plan.js import');
  for (const n of ['monthGrid', 'monthSummary', 'addMonths', 'autofillDates']) assert.match(m[1], new RegExp(`\\b${n}\\b`), n);
});

test('PU2 Week and Month toggle are real <button>s with aria-pressed; no role="button" anywhere', () => {
  for (const label of ['Week', 'Month']) {
    const b = buttons.filter(x => new RegExp(`>\\s*${label}\\s*<`).test(x));
    assert.ok(b.some(x => /aria-pressed/.test(x)), `${label} toggle needs aria-pressed`);
  }
  assert.ok(!/role=["']button["']/.test(src));
});

test('PU3 prev/next month are <button>s with aria-labels mentioning month', () => {
  assert.ok(buttons.some(x => /aria-label="[^"]*prev[^"]*month/i.test(x)), 'previous month');
  assert.ok(buttons.some(x => /aria-label="[^"]*next[^"]*month/i.test(x)), 'next month');
});

test('PU4 month view uses monthGrid + monthSummary and renders each day as a <button> with an aria-label', () => {
  assert.match(src, /monthGrid\s*\(/); assert.match(src, /monthSummary\s*\(/);
  const seg = around('monthGrid(');
  assert.match(seg, /<button\b[^>]*aria-label=/, 'day cell button with aria-label near the monthGrid call');
  assert.match(seg, /kcal/i); assert.match(seg, /item/i);
});

test('PU5 everything interpolated into the month view goes through esc() (crude: esc( is used near the grid code)', () => {
  const seg = around('monthGrid(');
  assert.match(seg, /esc\s*\(/);
  assert.ok(!/aria-label="\$\{(?!esc)/.test(seg), 'aria-label must start with an esc()-ed value, not a raw interpolation');
});

test('PU6 tapping a day switches back to the week view (a handler sets the view to "week" and the week start)', () => {
  assert.match(src, /['"]week['"]/); assert.match(src, /['"]month['"]/);
  assert.match(src, /(view|mode|range)\w*\s*=\s*['"]week['"]/i, 'a view/mode variable is set to "week"');
  assert.match(src, /weekStart\s*\(/);
});

test('PU7 the Auto-fill dialog offers a Week/Month range choice, calls autofillDates and reports skipped past days', () => {
  assert.match(src, /autofillDates\s*\(/); assert.match(src, /skipped/i);
  const seg = around('autofillDates(', 4000);
  assert.match(seg, /proposePlan\s*\(|range/i);
  assert.ok(/type="radio"|aria-pressed/.test(around('Auto-fill', 6000)), 'range choice as radios or aria-pressed buttons');
});

test('PU8 Accept still goes through applyProposal and save(); proposePlan receives the dates from autofillDates', () => {
  assert.match(src, /applyProposal\s*\(/); assert.match(src, /\bsave\s*\(\s*\)/);
  assert.match(src, /autofillDates\s*\(/);
  assert.match(src, /proposePlan\s*\([^)]*\bdates\b[^)]*\)/);
});

test('PU9 newId does not rely only on Date.now()+Math.random(): ids stay unique when the clock and random are frozen', () => {
  const decl = src.match(/(?:^|\n)(?:const|let|var)\s+newId\s*=[^\n]*(?:\n(?![ \t]*(?:const|let|var|function|export|import)\b)[ \t]+[^\n]*)*/);
  assert.ok(decl, 'newId definition not found as `const newId = ...` (if refactored to a function declaration, update this test)');
  const counters = [...src.matchAll(/(?:^|\n)((?:let|var)\s+\w+\s*=\s*0\s*;?)/g)].map(m => m[1]);
  const body = counters.join('\n') + '\n' + decl[0] + '\nreturn newId;';
  const fakeDate = { now: () => 1700000000000 }, fakeMath = { random: () => 0.5 };
  const newId = new Function('Date', 'Math', body)(fakeDate, fakeMath);
  const ids = new Set(); for (let i = 0; i < 5000; i++) ids.add(newId());
  assert.equal(ids.size, 5000, 'ids collided with a frozen clock and constant random');
  assert.ok([...ids].every(x => typeof x === 'string' && x.length > 0));
});
