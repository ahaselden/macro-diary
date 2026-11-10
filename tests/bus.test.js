import { test } from 'node:test';
import assert from 'node:assert/strict';
import { on, emit } from '../js/core/bus.js';

test('emit calls every subscriber with the detail', () => {
  const got = []; on('t1', d => got.push(['a', d])); on('t1', d => got.push(['b', d]));
  emit('t1', 5);
  assert.deepEqual(got, [['a', 5], ['b', 5]]);
});
test('emit with no subscribers is a no-op', () => assert.doesNotThrow(() => emit('nobody', 1)));
test('unsubscribe stops delivery', () => {
  let n = 0; const off = on('t2', () => n++);
  emit('t2'); off(); emit('t2');
  assert.equal(n, 1);
});
