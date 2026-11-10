import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, unmark } from './helpers.js';
import { esc, rd, r1, r2, fmtW, amtLabel } from '../js/core/format.js';
import { fmt, parse, addDays } from '../js/core/dates.js';

const fm = golden('format'), dates = golden('dates');

test('fmtW matches original output for g and oz', () => {
  for (const unit of ['g', 'oz']) for (const c of fm[unit].fmtW) assert.equal(fmtW(c.g, unit), c.out, `${unit} ${c.g}`);
});
test('amtLabel matches original output for g and oz', () => {
  for (const unit of ['g', 'oz']) for (const c of fm[unit].amtLabel) assert.equal(amtLabel(c.e, unit), c.out, `${unit} ${c.e.name}`);
});
test('esc matches original output', () => { for (const c of fm.esc) assert.equal(esc(unmark(c.v)), c.out); });
test('rounding helpers match original output', () => {
  for (const c of fm.rounding) { assert.equal(rd(c.v), c.rd); assert.equal(r1(c.v), c.r1); assert.equal(r2(c.v), c.r2); }
});
test('esc neutralises HTML', () => assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;'));

test('date helpers match original output', () => {
  for (const c of dates.fmt) assert.equal(fmt(new Date(...c.a)), c.out);
  for (const c of dates.parse) assert.equal(fmt(parse(c.s)), c.out);
  for (const c of dates.addDays) assert.equal(addDays(c.s, c.n), c.out, `${c.s} ${c.n}`);
});
