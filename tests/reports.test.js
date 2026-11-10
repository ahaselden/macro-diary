import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, fixture, clone } from './helpers.js';
import { rangeOf, xData, rollup, exportFiles } from '../js/domain/reports.js';

const g = golden('reports');

test('rangeOf matches golden', () => {
  for (const c of g.rangeOf) assert.deepEqual(rangeOf(c.kind, c.a), c.out, `${c.kind} ${c.a}`);
});

g.cases.forEach((c, i) => {
  test(`report case ${i}: ${c.kind} ${c.a} (${c.weightUnit})`, () => {
    const state = clone(fixture('state'));
    state.weightUnit = c.weightUnit; // must not affect output
    const x = xData(state, c.kind, c.a);
    assert.deepEqual(x, c.x);
    assert.deepEqual(rollup(x), c.rollup);
    const files = exportFiles(state, x, 'IGNORED');
    assert.deepEqual(files.map(f => [f.name, f.type]), c.files.map(f => [f.name, f.type]));
    files.forEach((f, j) => {
      let text = f.text;
      if (f.type === 'application/json') {
        const o = JSON.parse(text);
        assert.equal(Object.keys(o)[0], 'exported');
        assert.equal(o.exported, 'IGNORED');
        delete o.exported;
        text = JSON.stringify(o);
      }
      assert.equal(text, c.files[j].text, f.name);
    });
  });
});
