// Tests for docs/specs/copy-to-meal.md. Numbers B1.. match the spec's behaviour list.
// Domain tests (B1-B14) call copyEntries(state, fromDay, ids, toDay, toMeal, now, makeId) from js/domain/entries.js.
// B15-B16 are WEAK static checks on js/ui/diary.js: they read source text only and prove wiring/wording exists, NOT that the
// buttons, dialog or toast work. The numbered manual checklist (C1..) in the spec covers that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as entries from '../js/domain/entries.js';
import { addEntry, removeEntry } from '../js/domain/entries.js';
import { mergeStates } from '../js/domain/merge.js';
import { defaults } from '../js/core/store.js';

const copyEntries = (...a) => entries.copyEntries(...a);   // missing export -> TypeError "not a function" (fails the test)

const D1 = '2026-11-10', D2 = '2026-11-12';
const mk = (id, over = {}) => ({
  id, meal: 'Breakfast', name: 'Oats ' + id, brand: 'Acme', barcode: '5012345678900', source: 'OFF',
  per100: { k: 370, p: 13, c: 60, f: 7 }, grams: 40, amount: 1, unit: 'g', updatedAt: 5, ...over,
});
const counter = (prefix = 'n') => { let i = 0; return () => `${prefix}${++i}`; };
const fresh = () => {
  const s = { ...defaults(), days: {}, tombstones: {} };
  addEntry(s, D1, mk('a'), 5); addEntry(s, D1, mk('b', { meal: 'Lunch', name: 'Rice', grams: 150 }), 5);
  return s;
};

test('B1 copy to another meal on the same day: new id, meal set, updatedAt = now, logged values kept', () => {
  const s = fresh(), orig = structuredClone(s.days[D1][0]);
  const out = copyEntries(s, D1, ['a'], D1, 'Dinner', 1000, counter());
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.id, 'n1'); assert.equal(c.meal, 'Dinner'); assert.equal(c.updatedAt, 1000);
  for (const k of ['name', 'brand', 'barcode', 'source', 'grams', 'amount', 'unit', 'per100']) assert.deepEqual(c[k], orig[k], k);
  assert.deepEqual(Object.keys(c).sort(), Object.keys(orig).sort());
});

test('B2 the original is untouched (fields, meal, updatedAt, position)', () => {
  const s = fresh(), before = structuredClone(s.days[D1][0]);
  copyEntries(s, D1, ['a'], D2, 'Lunch', 9999, counter());
  assert.deepEqual(s.days[D1][0], before);
  assert.deepEqual(s.days[D1].map(e => e.id), ['a', 'b']);
});

test('B3 same day and same meal duplicates the entry (original first, copy appended)', () => {
  const s = fresh();
  const [c] = copyEntries(s, D1, ['a'], D1, 'Breakfast', 50, counter());
  assert.deepEqual(s.days[D1].map(e => e.id), ['a', 'b', c.id]);
  assert.equal(s.days[D1].filter(e => e.name === 'Oats a').length, 2);
  assert.notEqual(c.id, 'a');
});

test('B4 a different day creates that day\'s list; existing entries there are kept', () => {
  const s = fresh();
  assert.equal(s.days[D2], undefined);
  copyEntries(s, D1, ['a', 'b'], D2, 'Snacks', 70, counter());
  assert.deepEqual(s.days[D2].map(e => e.meal), ['Snacks', 'Snacks']);
  const [x] = copyEntries(s, D1, ['b'], D2, 'Dinner', 80, counter('m'));
  assert.deepEqual(s.days[D2].map(e => e.id), ['n1', 'n2', x.id]);
});

test('B5 several ids: every copy gets its own distinct id, in diary order, makeId called once per created entry', () => {
  const s = fresh(); let calls = 0;
  const out = copyEntries(s, D1, ['b', 'a'], D2, 'Lunch', 1, () => `id${++calls}`);
  assert.equal(calls, 2);
  assert.deepEqual(out.map(e => e.id), ['id1', 'id2']);
  assert.deepEqual(out.map(e => e.name), ['Oats a', 'Rice']);          // diary order (a before b), not request order
  assert.equal(new Set([...Object.values(s.days).flat().map(e => e.id)]).size, 4);
});

test('B6 copies share no references with originals (mutating the copy leaves the original alone)', () => {
  const s = fresh();
  const [c] = copyEntries(s, D1, ['a'], D1, 'Lunch', 1, counter());
  const o = s.days[D1][0];
  assert.notEqual(c, o); assert.notEqual(c.per100, o.per100);
  c.per100.k = 1; c.name = 'changed';
  assert.equal(o.per100.k, 370); assert.equal(o.name, 'Oats a');
});

test('B7 tombstones: none created for new ids, existing ones undisturbed, state without tombstones stays without', () => {
  const s = fresh(); s.tombstones = { gone: 77 };
  copyEntries(s, D1, ['a'], D2, 'Lunch', 100, counter());
  assert.deepEqual(s.tombstones, { gone: 77 });
  const bare = fresh(); delete bare.tombstones;
  copyEntries(bare, D1, ['a'], D2, 'Lunch', 100, counter());
  assert.equal('tombstones' in bare, false);
});

test('B8 goes through addEntry: a tombstone for the freshly made id is cleared (re-adding undoes a deletion)', () => {
  const s = fresh(); s.tombstones = { n1: 10, keep: 20 };
  copyEntries(s, D1, ['a'], D2, 'Lunch', 100, counter());
  assert.deepEqual(s.tombstones, { keep: 20 });
});

test('B9 ids not present in fromDay are skipped; returns only the created entries, possibly none', () => {
  const s = fresh(); addEntry(s, D2, mk('z'), 5);
  const out = copyEntries(s, D1, ['nope', 'z', 'a', 'a'], D2, 'Lunch', 1, counter());   // z lives on D2, 'a' repeated
  assert.deepEqual(out.map(e => e.name), ['Oats a']);                                      // repeated id copied once
  assert.deepEqual(copyEntries(s, D1, ['nope'], D2, 'Lunch', 1, counter()), []);
  assert.deepEqual(copyEntries(s, '2020-01-01', ['a'], D2, 'Lunch', 1, counter()), []);
  assert.deepEqual(copyEntries(s, D1, [], D2, 'Lunch', 1, counter()), []);
  assert.equal(s.days['2020-01-01'], undefined);
});

test('B10 invalid toMeal copies nothing (state unchanged, makeId never called)', () => {
  for (const bad of ['Brunch', 'breakfast', '', undefined, null, 3, {}, ['Lunch'], '__proto__', 'constructor']) {
    const s = fresh(), before = structuredClone(s);
    const out = copyEntries(s, D1, ['a'], D2, bad, 1, () => { throw new Error('makeId must not be called'); });
    assert.deepEqual(out, [], String(bad));
    assert.deepEqual(s, before, String(bad));
  }
});

test('B11 invalid toDay copies nothing (only YYYY-MM-DD accepted)', () => {
  for (const bad of ['', 'today', '2026-1-5', '26-11-12', '2026/11/12', '2026-11-12x', '2026-11-12\n', ' 2026-11-12',
    '__proto__', 'constructor', 'toString', undefined, null, 20261112, {}, ['2026-11-12'], '<b>2026-11-12</b>']) {
    const s = fresh(), before = structuredClone(s);
    const out = copyEntries(s, D1, ['a'], bad, 'Lunch', 1, () => { throw new Error('makeId must not be called'); });
    assert.deepEqual(out, [], String(bad));
    assert.deepEqual(s, before, String(bad));
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('B12 hostile fromDay / ids: prototype keys, non-arrays, NaN, junk entries never throw and copy nothing', () => {
  const s = fresh(), before = structuredClone(s);
  const never = () => { throw new Error('makeId must not be called'); };
  for (const day of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', undefined, null, 5, {}])
    assert.deepEqual(copyEntries(s, day, ['a'], D2, 'Lunch', 1, never), [], String(day));
  for (const ids of [undefined, null, 'a', 5, NaN, {}, { length: 1, 0: 'a' }, new Set(['a']), true])
    assert.deepEqual(copyEntries(s, D1, ids, D2, 'Lunch', 1, never), [], String(ids));
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', NaN, null, undefined, 0, {}, ['a']])
    assert.deepEqual(copyEntries(s, D1, [id], D2, 'Lunch', 1, never), [], String(id));
  assert.deepEqual(s, before);
  // junk already stored in the day (null, no id, no nutrition, bad grams) is not copied and does not throw
  const j = fresh(); j.days[D1].push(null, { name: 'x' }, { id: 'nopm', grams: 10 }, { id: 'bad', per100: { k: 1 }, grams: 0 }, 'str');
  const out = copyEntries(j, D1, ['a', 'nopm', 'bad', 'undefined'], D2, 'Lunch', 1, counter());
  assert.deepEqual(out.map(e => e.name), ['Oats a']);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal({}.id, undefined);
});

test('B13 inherited/prototype days: a state whose days object is polluted or null-prototype copies only own days', () => {
  const s = fresh(); Object.setPrototypeOf(s.days, { [D2]: [mk('ghost')] });
  assert.deepEqual(copyEntries(s, D2, ['ghost'], D1, 'Lunch', 1, counter()), []);
  const t = fresh(); t.days = Object.assign(Object.create(null), t.days);
  assert.equal(copyEntries(t, D1, ['a'], D2, 'Lunch', 1, counter()).length, 1);
});

test('B14 hostile data and size: HTML stays plain data, huge lists work, huge id arrays of unknown ids are quick', () => {
  const s = { ...defaults(), days: {}, tombstones: {} };
  addEntry(s, D1, mk('h', { name: '<img src=x onerror=alert(1)>', brand: '"><script>1</script>' }), 5);
  const [c] = copyEntries(s, D1, ['h'], D2, 'Snacks', 1, counter());
  assert.equal(c.name, '<img src=x onerror=alert(1)>'); assert.equal(c.brand, '"><script>1</script>');
  const big = { ...defaults(), days: {}, tombstones: {} };
  const ids = [];
  for (let i = 0; i < 2000; i++) { ids.push('e' + i); addEntry(big, D1, mk('e' + i), 5); }
  const out = copyEntries(big, D1, ids, D2, 'Lunch', 9, counter());
  assert.equal(out.length, 2000); assert.equal(big.days[D2].length, 2000);
  assert.equal(new Set(big.days[D2].map(e => e.id)).size, 2000);
  const t0 = Date.now();
  assert.deepEqual(copyEntries(big, D1, Array.from({ length: 200000 }, (_, i) => 'x' + i), D2, 'Lunch', 9, counter('q')), []);
  assert.ok(Date.now() - t0 < 3000, 'huge unknown-id array must not be quadratic');
});

test('B15 sync: a state with a copy merged into an empty state keeps both the original and the copy; deleting the original later keeps the copy', () => {
  const s = fresh();
  const [c] = copyEntries(s, D1, ['a'], D2, 'Dinner', 1000, counter('copy'));
  for (const m of [mergeStates(defaults(), s), mergeStates(s, defaults())]) {
    assert.deepEqual(m.days[D1].map(e => e.id), ['a', 'b']);
    assert.deepEqual(m.days[D2].map(e => e.id), ['copy1']);
    assert.equal(m.days[D2][0].meal, 'Dinner'); assert.equal(m.days[D2][0].updatedAt, 1000);
  }
  removeEntry(s, D1, 'a', 2000);
  const m2 = mergeStates(defaults(), s);
  assert.deepEqual(m2.days[D2].map(e => e.id), [c.id]);
  assert.deepEqual(m2.days[D1].map(e => e.id), ['b']);
});

const ui = readFileSync(new URL('../js/ui/diary.js', import.meta.url), 'utf8');

test('B16 (weak, source text only) diary.js imports copyEntries and MEALS, calls copyEntries with Date.now(), and has the agreed control ids', () => {
  assert.match(ui, /import\s*\{[^}]*\bcopyEntries\b[^}]*\}\s*from\s*['"]\.\.\/domain\/entries\.js['"]/);
  assert.match(ui, /copyEntries\s*\(\s*state\s*,[^)]*Date\.now\(\)/);
  assert.match(ui, /data-copy=/); assert.match(ui, /data-copy-meal=/);
  for (const id of ['copyMeal', 'copyDate', 'copyGo']) assert.match(ui, new RegExp(`id="${id}"`), id);
  assert.match(ui, /Copy meal/);
  assert.match(ui, /Copied/);
  assert.ok(/MEALS\.map/.test(ui.slice(ui.indexOf('copyMeal') - 400, ui.indexOf('copyMeal') + 400)), 'meal options built from MEALS');
});

test('B17 (weak, source text only) the diary does not hand-roll entry creation: no direct push into state.days in diary.js', () => {
  assert.ok(!/state\.days\[[^\]]*\]\s*(\|\|=|=)[^=]/.test(ui) && !/\.days\[[^\]]*\]\.push\(/.test(ui));
});
