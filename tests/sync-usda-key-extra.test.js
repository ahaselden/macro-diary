// Added by the implementer after the review of PR #39 (not from the test-designer): pins two deliberate behaviours of docs/DECISIONS.md D42.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates } from '../js/domain/merge.js';
import { toRecords } from '../js/domain/sync-records.js';
import { defaults } from '../js/core/store.js';

const dev = over => ({ ...defaults(), ...over });

test('X1 when the winning settings record has the switch off, apiKey stays device-local (the one deliberate non-commutative field)', () => {
  const a = dev({ syncApiKey: true, apiKey: '', settingsUpdatedAt: 1 });
  const b = dev({ syncApiKey: false, apiKey: 'A', settingsUpdatedAt: 2 });
  assert.equal(mergeStates(a, b).apiKey, '');          // a is local: keeps its own key
  assert.equal(mergeStates(b, a).apiKey, 'A');         // b is local: keeps its own key
  for (const m of [mergeStates(a, b), mergeStates(b, a)]) { assert.equal(m.syncApiKey, false); assert.equal(m.settingsUpdatedAt, 2); }
});

test('X2 a key with control characters or over 200 characters is cleaned before it is pushed, so every device holds the same key', () => {
  const s = dev({ syncApiKey: true, apiKey: ' ab\u0007c' + 'x'.repeat(300), settingsUpdatedAt: 5 });
  const v = toRecords(s).find(r => r.key === 'settings').value;
  assert.equal(v.apiKey, ('abc' + 'x'.repeat(300)).slice(0, 200));
});
