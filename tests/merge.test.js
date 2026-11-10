import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates, pruneTombstones } from '../js/domain/merge.js';
import { addEntry, updateEntry, removeEntry, touchSettings } from '../js/domain/entries.js';
import { defaults } from '../js/core/store.js';
import { fixture, clone } from './helpers.js';

const per100 = { k: 100, p: 1, c: 1, f: 1 };
const entry = (id, over = {}) => ({ id, meal: 'Lunch', name: id, brand: '', source: 'x', per100, grams: 100, ...over });
const base = (over = {}) => ({ ...defaults(), ...over });
const ids = (s, day) => (s.days[day] || []).map(e => e.id);

// ---------- targeted behaviour ----------
test('entries only on one side are all kept', () => {
  const a = base({ days: { d1: [entry('a')] } }), b = base({ days: { d1: [entry('b')], d2: [entry('c')] } });
  const m = mergeStates(a, b);
  assert.deepEqual(ids(m, 'd1'), ['a', 'b']); assert.deepEqual(ids(m, 'd2'), ['c']);
});

test('the newer edit of the same entry wins, in either direction', () => {
  const a = base({ days: { d: [entry('x', { grams: 100, updatedAt: 10 })] } });
  const b = base({ days: { d: [entry('x', { grams: 250, updatedAt: 20 })] } });
  assert.equal(mergeStates(a, b).days.d[0].grams, 250);
  assert.equal(mergeStates(b, a).days.d[0].grams, 250);
});

test('a tombstone beats an older edit but an edit made after the deletion wins', () => {
  const del = base({ tombstones: { x: 50 } });
  assert.deepEqual(mergeStates(base({ days: { d: [entry('x', { updatedAt: 40 })] } }), del).days, {});
  assert.deepEqual(mergeStates(del, base({ days: { d: [entry('x', { updatedAt: 40 })] } })).days, {});
  assert.deepEqual(ids(mergeStates(base({ days: { d: [entry('x', { updatedAt: 60 })] } }), del), 'd'), ['x']);
});

test('deleting an entry on one device removes it on the other after merge', () => {
  const phone = base(), pc = base();
  addEntry(phone, 'd', entry('m1'), 100);
  const synced = mergeStates(pc, phone);                  // pc receives it
  removeEntry(synced, 'd', 'm1', 200);                    // pc deletes it
  const back = mergeStates(phone, synced);                // phone receives the deletion
  assert.deepEqual(back.days, {});
  assert.equal(back.tombstones.m1, 200);
});

test('settings: the newest settings record wins as a whole; theme/apiKey/recent stay local', () => {
  const a = base({ goals: { k: 1800, p: 1, c: 1, f: 1 }, weightUnit: 'oz', settingsUpdatedAt: 100, theme: 'nord', apiKey: 'A', recent: [{ name: 'r', brand: '', source: 's', per100 }] });
  const b = base({ goals: { k: 2500, p: 2, c: 2, f: 2 }, weightUnit: 'g', settingsUpdatedAt: 200, theme: 'paper', apiKey: 'B', recent: [] });
  const m = mergeStates(a, b);
  assert.equal(m.goals.k, 2500); assert.equal(m.weightUnit, 'g'); assert.equal(m.settingsUpdatedAt, 200);
  assert.equal(m.theme, 'nord'); assert.equal(m.apiKey, 'A'); assert.equal(m.recent.length, 1);
});

test('custom foods and measures merge by key/label with newest winning', () => {
  const f = (name, k, u) => ({ name, brand: '', source: 'Custom', per100: { ...per100, k }, updatedAt: u });
  const a = base({ custom: [f('Chili', 100, 5)], measures: { 'A||Custom': [{ label: 'cup', g: 100, updatedAt: 1 }] } });
  const b = base({ custom: [f('Chili', 200, 9), f('Soup', 50, 1)], measures: { 'A||Custom': [{ label: 'cup', g: 120, updatedAt: 2 }, { label: 'bowl', g: 300 }] } });
  const m = mergeStates(a, b);
  assert.equal(m.custom.find(x => x.name === 'Chili').per100.k, 200);
  assert.equal(m.custom.length, 2);
  assert.deepEqual(m.measures['A||Custom'].map(x => [x.label, x.g]), [['bowl', 300], ['cup', 120]]);
});

test('junk entries are skipped, empty days vanish', () => {
  const a = base({ days: { d: [null, { name: 'no id' }, entry('ok')], e: [] } });
  const m = mergeStates(a, base());
  assert.deepEqual(ids(m, 'd'), ['ok']); assert.equal('e' in m.days, false);
});

test('merge does not mutate its inputs', () => {
  const a = base({ days: { d: [entry('a', { updatedAt: 1 })] } }), b = base({ days: { d: [entry('a', { updatedAt: 2, grams: 5 })] } });
  const [ca, cb] = [clone(a), clone(b)]; mergeStates(a, b);
  assert.deepEqual(a, ca); assert.deepEqual(b, cb);
});

test('preferLocal keeps this device on a timestamp tie (legacy backups) but newer still wins', () => {
  const a = base({ days: { d: [entry('x', { grams: 1 })] } }), b = base({ days: { d: [entry('x', { grams: 2 })] } });
  assert.equal(mergeStates(a, b, { preferLocal: true }).days.d[0].grams, 1);
  const c = base({ days: { d: [entry('x', { grams: 3, updatedAt: 9 })] } });
  assert.equal(mergeStates(a, c, { preferLocal: true }).days.d[0].grams, 3);
});

test('pruneTombstones drops only old ones', () => {
  assert.deepEqual(pruneTombstones(base({ tombstones: { old: 10, fresh: 100 } }), 50).tombstones, { fresh: 100 });
});

test('merging a legacy fixture with itself changes nothing important (all entries kept, none duplicated)', () => {
  const s = { ...defaults(), ...clone(fixture('state')) };
  const m = mergeStates(s, clone(s));
  const count = x => Object.values(x.days).flat().length;
  assert.equal(count(m), count(s));
  assert.deepEqual(Object.keys(m.days).sort(), Object.keys(s.days).sort());
});

// ---------- entries helpers ----------
test('addEntry/updateEntry/removeEntry stamp times and leave tombstones', () => {
  const s = base(); const e = addEntry(s, 'd', entry('a'), 10);
  assert.equal(e.updatedAt, 10);
  assert.equal(updateEntry(s, 'd', 'a', { grams: 7 }, 20).updatedAt, 20);
  assert.equal(s.days.d[0].grams, 7);
  assert.equal(updateEntry(s, 'd', 'nope', {}, 1), null);
  assert.equal(removeEntry(s, 'd', 'a', 30), true);
  assert.deepEqual(s.days, {}); assert.equal(s.tombstones.a, 30);
  assert.equal(removeEntry(s, 'd', 'a', 40), false);
  addEntry(s, 'd', entry('a'), 50);                         // re-adding clears the tombstone
  assert.equal('a' in s.tombstones, false);
  touchSettings(s, 99); assert.equal(s.settingsUpdatedAt, 99);
});

// ---------- algebraic properties over random states ----------
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
function randomState() {
  const days = {}, tombstones = {};
  for (const d of ['2025-01-01', '2025-01-02', '2025-01-03']) {
    const list = [];
    for (let i = 0; i < Math.floor(rnd() * 4); i++) list.push(entry(pick(['a', 'b', 'c', 'd', 'e', 'f']) + d.slice(-1), { grams: Math.floor(rnd() * 500), updatedAt: Math.floor(rnd() * 5) * 10 }));
    // unique ids per day
    days[d] = [...new Map(list.map(e => [e.id, e])).values()];
  }
  for (const id of ['a1', 'b2', 'c3', 'd1']) if (rnd() < 0.3) tombstones[id] = Math.floor(rnd() * 5) * 10;
  const custom = rnd() < 0.5 ? [{ name: pick(['X', 'Y']), brand: '', source: 'Custom', per100, updatedAt: Math.floor(rnd() * 3) }] : [];
  return base({ days, tombstones, custom, goals: { k: Math.floor(rnd() * 3000), p: 1, c: 1, f: 1 }, settingsUpdatedAt: Math.floor(rnd() * 3) * 10,
    measures: rnd() < 0.5 ? { 'K||s': [{ label: pick(['cup', 'bowl']), g: 1 + Math.floor(rnd() * 3), updatedAt: Math.floor(rnd() * 3) }] } : {} });
}
const norm = s => { const { theme, apiKey, recent, ...rest } = s; return rest; };   // local-only fields excluded

test('merge is commutative, associative and idempotent over 300 random state triples', () => {
  for (let i = 0; i < 300; i++) {
    const a = randomState(), b = randomState(), c = randomState();
    const ab = mergeStates(a, b);
    assert.deepEqual(norm(ab), norm(mergeStates(b, a)), `commutative #${i}`);
    assert.deepEqual(norm(mergeStates(ab, c)), norm(mergeStates(a, mergeStates(b, c))), `associative #${i}`);
    assert.deepEqual(norm(mergeStates(ab, ab)), norm(ab), `idempotent #${i}`);
    assert.deepEqual(norm(mergeStates(ab, a)), norm(ab), `absorbs inputs #${i}`);
  }
});
