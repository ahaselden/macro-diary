import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, fixture } from './helpers.js';
import { dayText } from '../js/domain/summary.js';

const g = golden('daytext');

test('dayText matches golden', () => {
  const st = fixture('state');
  g.forEach((c, i) => {
    const out = dayText(st, c.day, c.weightUnit).replace(/^My day – .*\n/, 'My day – <date>\n');
    assert.equal(out, c.out, `case ${i}`);
  });
});
