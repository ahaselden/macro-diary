import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, unmark } from './helpers.js';
import { csvCell, toCSV } from '../js/domain/reports.js';

const g = golden('csv');

test('csvCell matches golden', () => {
  for (const c of g.csvCell) assert.equal(csvCell(unmark(c.v)), c.out, JSON.stringify(c.v));
});

test('toCSV matches golden', () => {
  g.toCSV.forEach((c, i) => assert.equal(toCSV(c.rows), c.out, `case ${i}`));
});
