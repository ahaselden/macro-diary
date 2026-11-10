import { test } from 'node:test';
import assert from 'node:assert/strict';
import { golden, clone } from './helpers.js';
import { mapOFF } from '../js/services/off.js';
import { mapUSDA, mapPortions, loadPortions } from '../js/services/usda.js';

const g = golden('mappers');

test('mapOFF replays golden', () => {
  g.mapOFF.forEach(({ input, out }, i) => assert.deepEqual(mapOFF(clone(input)), out, `mapOFF #${i}`));
});
test('mapUSDA replays golden', () => {
  g.mapUSDA.forEach(({ input, out }, i) => assert.deepEqual(mapUSDA(clone(input)), out, `mapUSDA #${i}`));
});
test('mapPortions replays golden', () => {
  g.portions.forEach(({ input, out }, i) => assert.deepEqual(mapPortions(clone(input)), out, `portions #${i}`));
});
test('loadPortions sets food.portions via mocked fetch', async () => {
  const orig = globalThis.fetch;
  try {
    for (const [i, { input, out }] of g.portions.entries()) {
      let url;
      globalThis.fetch = async u => { url = u; return { ok: true, status: 200, json: async () => clone(input) }; };
      const food = { fdcId: 1 };
      const ret = await loadPortions(food, 'k');
      assert.equal(ret, undefined);
      assert.deepEqual(food.portions, out, `loadPortions #${i}`);
      assert.equal(url, 'https://api.nal.usda.gov/fdc/v1/food/1?api_key=k');
    }
  } finally { globalThis.fetch = orig; }
});
