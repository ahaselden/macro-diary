// Spec: docs/specs/goals-sync-rule.md. Test-designer file, written BEFORE the implementation. All data is made up.
// Rule (owner, 2026-11-14): a settings record (sync) or backup (restore) whose goals.steps / goals.sleepH / goals.waterCups is MISSING or UNUSABLE
// leaves THIS device's value alone; a usable value is taken when that record wins by timestamp. The old rule (steps/sleepH reset to 10000 / 8) is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults, migrate, sanitize } from '../js/core/schema.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { clone } from './helpers.js';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

// This device: custom goals that differ from every default, so "kept" and "reset" cannot be confused.
const MINE = { k: 2100, p: 140, c: 210, f: 70, steps: 7000, sleepH: 7.5, waterCups: 12 };
const local = (extra = {}) => ({ ...defaults(), settingsUpdatedAt: 50, goals: { ...MINE }, waterTap: 'whole', dials: ['calories', 'protein', 'steps'], ...extra });
const rec = (goals, stamp, extra = {}) => ({ key: 'settings', value: { goals, weightUnit: 'g', useUSDA: true, useOFF: true, syncApiKey: false, settingsUpdatedAt: stamp, ...extra }, updatedAt: stamp });
const OLD4 = { k: 1800, p: 100, c: 110, f: 50 };                 // what a device from before steps/sleep/water sends
const FOUR = g => ({ k: g.k, p: g.p, c: g.c, f: g.f });
const apply = (s, goals, stamp = 100, extra = {}) => applyRecords(clone(s), [rec(goals, stamp, extra)]).goals;

// ---------------------------------------------------------------- sync
test('1. sync: a newer record from an old device (no steps, sleepH, waterCups) takes the four older goals and keeps this device\'s three newer ones, waterTap and dials', () => {
  const out = applyRecords(clone(local()), [rec(OLD4, 100)]);
  assert.deepEqual(out.goals, { ...OLD4, steps: 7000, sleepH: 7.5, waterCups: 12 });
  assert.equal(out.settingsUpdatedAt, 100); assert.equal(out.waterTap, 'whole'); assert.deepEqual(out.dials, ['calories', 'protein', 'steps']);
  // a receiver on the defaults ends on the defaults, which is also "this device's value"
  assert.deepEqual(apply(defaults(), OLD4), { ...OLD4, steps: 10000, sleepH: 8, waterCups: 8 });
});

test('2. sync: each of the three fields is judged on its own (a record with one usable and two missing takes only the usable one)', () => {
  assert.deepEqual(apply(local(), { ...OLD4, steps: 12000 }), { ...OLD4, steps: 12000, sleepH: 7.5, waterCups: 12 });
  assert.deepEqual(apply(local(), { ...OLD4, sleepH: 6 }), { ...OLD4, steps: 7000, sleepH: 6, waterCups: 12 });
  assert.deepEqual(apply(local(), { ...OLD4, waterCups: 10 }), { ...OLD4, steps: 7000, sleepH: 7.5, waterCups: 10 });
  assert.deepEqual(apply(local(), { ...OLD4, steps: 'x', sleepH: 5, waterCups: 99 }), { ...OLD4, steps: 7000, sleepH: 5, waterCups: 12 });
});

test('3. sync: unusable values (text, negative, null, NaN as null, out of range, wrong type, markup) leave this device\'s value', () => {
  const badSteps = ['x', -5, null, '<img src=x>', 1e12, 1000001, '', true, false, {}, 'Infinity', '-1'];
  const badSleep = [99, -3, null, '<b>', 24.01, '', true, false, {}, 'x', '-0.5'];
  const badCups = [0, 41, -1, 8.5, '8', null, 'x', '<i>', true, {}, 1e9, -0];
  for (const v of badSteps) assert.equal(apply(local(), { ...OLD4, steps: v }).steps, 7000, 'steps ' + JSON.stringify(v));
  for (const v of badSleep) assert.equal(apply(local(), { ...OLD4, sleepH: v }).sleepH, 7.5, 'sleepH ' + JSON.stringify(v));
  for (const v of badCups) assert.equal(apply(local(), { ...OLD4, waterCups: v }).waterCups, 12, 'waterCups ' + JSON.stringify(v));
  const all = apply(local(), { k: 1800, p: 1, c: 1, f: 1, steps: 'x', sleepH: 99, waterCups: 0 });
  assert.deepEqual(all, { k: 1800, p: 1, c: 1, f: 1, steps: 7000, sleepH: 7.5, waterCups: 12 });
});

test('4. sync: usable values are taken when the record wins, including the edges of each range and numeric text for steps and sleepH', () => {
  const cases = [['steps', 0, 0], ['steps', 1000000, 1000000], ['steps', '12000', 12000], ['steps', 7500.6, 7501], ['steps', 1, 1],
    ['sleepH', 0, 0], ['sleepH', 24, 24], ['sleepH', 6.5, 6.5], ['sleepH', '9', 9],
    ['waterCups', 1, 1], ['waterCups', 40, 40], ['waterCups', 8, 8]];
  for (const [f, sent, want] of cases) assert.equal(apply(local(), { ...OLD4, [f]: sent })[f], want, f + ' ' + JSON.stringify(sent));
  assert.deepEqual(apply(local(), { k: 1, p: 2, c: 3, f: 4, steps: 5000, sleepH: 6, waterCups: 7 }), { k: 1, p: 2, c: 3, f: 4, steps: 5000, sleepH: 6, waterCups: 7 });
});

test('5. sync: an older or equal-stamp record does not change the goals, a newer stamp is still required (rule unchanged)', () => {
  const full = { ...OLD4, steps: 3000, sleepH: 5, waterCups: 3 };
  assert.deepEqual(apply(local(), full, 10), MINE);
  // equal stamp: tie converges the same in both orders
  const a = local({ settingsUpdatedAt: 100 }), b = { ...local({ settingsUpdatedAt: 100 }), goals: { ...full } };
  const ab = mergeStates(clone(a), clone(b)), ba = mergeStates(clone(b), clone(a));
  assert.deepEqual(ab.goals, ba.goals);
});

test('6. merge: when both sides carry all three fields both orders converge on the newer side', () => {
  const a = local({ settingsUpdatedAt: 100 }), b = { ...local({ settingsUpdatedAt: 200 }), goals: { k: 1500, p: 90, c: 100, f: 40, steps: 5000, sleepH: 6, waterCups: 9 } };
  for (const [x, y] of [[a, b], [b, a]]) assert.deepEqual(mergeStates(clone(x), clone(y)).goals, b.goals);
  const r = mergeStates(clone(a), clone(b)), r2 = mergeStates(clone(b), clone(a));
  assert.equal(r.settingsUpdatedAt, 200); assert.equal(r2.settingsUpdatedAt, 200);
});

test('7. merge: mergeStates with a newer remote whose goals lack the fields (an old device, no sanitising first) keeps the local three, both preferLocal modes', () => {
  const remote = { ...defaults(), settingsUpdatedAt: 500, goals: { ...OLD4 } };
  for (const opts of [{}, { preferLocal: true }]) {
    assert.deepEqual(mergeStates(clone(local()), clone(remote), opts).goals, { ...OLD4, steps: 7000, sleepH: 7.5, waterCups: 12 });
  }
  const noGoals = { ...defaults(), settingsUpdatedAt: 500 }; delete noGoals.goals;
  assert.doesNotThrow(() => mergeStates(clone(local()), noGoals));
  const g = mergeStates(clone(local()), noGoals).goals; assert.equal(g.steps, 7000); assert.equal(g.sleepH, 7.5); assert.equal(g.waterCups, 12);
});

test('8. sync: a hostile goals object (__proto__, extra keys) adds nothing and leaves this device\'s three values', () => {
  const v = JSON.parse('{"goals":{"k":1,"p":1,"c":1,"f":1,"__proto__":{"steps":5,"sleepH":1,"waterCups":2},"zzz":1,"constructor":{"steps":9}},"settingsUpdatedAt":100}');
  const out = applyRecords(clone(local()), [{ key: 'settings', value: v, updatedAt: 100 }]);
  assert.deepEqual(Object.keys(out.goals).sort(), ['c', 'f', 'k', 'p', 'sleepH', 'steps', 'waterCups']);
  assert.equal(out.goals.steps, 7000); assert.equal(out.goals.sleepH, 7.5); assert.equal(out.goals.waterCups, 12); assert.equal(({}).steps, undefined);
  for (const bad of [null, 'x', 5, [], { goals: 'x' }, { goals: [1] }, { goals: null }]) {
    let o; assert.doesNotThrow(() => { o = applyRecords(clone(local()), [rec(bad, 100)]); }, JSON.stringify(bad));
    assert.equal(o.goals.steps, 7000); assert.equal(o.goals.sleepH, 7.5); assert.equal(o.goals.waterCups, 12);
  }
});

test('9. sync: inputs are not modified (frozen state and record)', () => {
  const s = deepFreeze(local()), r = deepFreeze(rec(OLD4, 100));
  const out = applyRecords(s, [r]);
  assert.equal(out.goals.steps, 7000); assert.equal(s.goals.steps, 7000); assert.equal(r.value.goals.steps, undefined);
});

// ---------------------------------------------------------------- backup restore
const bk = (goals, stamp, extra = {}) => ({ ...clone(defaults()), goals, settingsUpdatedAt: stamp, ...extra });

test('10. backup: a newer backup without the three fields (current schema or legacy with no schemaVersion) takes k p c f and keeps this device\'s three', () => {
  const want = { ...OLD4, steps: 7000, sleepH: 7.5, waterCups: 12 };
  assert.deepEqual(mergeRestore(clone(local({ settingsUpdatedAt: 100 })), bk(OLD4, 500)).goals, want);
  const legacy = bk(OLD4, 500); delete legacy.schemaVersion; delete legacy.waterTap; delete legacy.dials;   // a real old backup has neither
  assert.deepEqual(mergeRestore(clone(local({ settingsUpdatedAt: 100 })), legacy).goals, want);
  const m = mergeRestore(clone(local({ settingsUpdatedAt: 100 })), legacy); assert.equal(m.waterTap, 'whole'); assert.deepEqual(m.dials, ['calories', 'protein', 'steps']);
});

test('11. backup: each field on its own; unusable values keep this device\'s; usable ones (edges, numeric text) are taken', () => {
  const L = () => clone(local({ settingsUpdatedAt: 100 }));
  assert.deepEqual(mergeRestore(L(), bk({ ...OLD4, steps: 12000 }, 500)).goals, { ...OLD4, steps: 12000, sleepH: 7.5, waterCups: 12 });
  assert.deepEqual(mergeRestore(L(), bk({ ...OLD4, sleepH: 6 }, 500)).goals, { ...OLD4, steps: 7000, sleepH: 6, waterCups: 12 });
  assert.deepEqual(mergeRestore(L(), bk({ ...OLD4, waterCups: 10 }, 500)).goals, { ...OLD4, steps: 7000, sleepH: 7.5, waterCups: 10 });
  for (const v of ['x', -5, null, 1e12, 1000001, '', true, '<img>']) assert.equal(mergeRestore(L(), bk({ ...OLD4, steps: v }, 500)).goals.steps, 7000, 'steps ' + JSON.stringify(v));
  for (const v of [99, -3, null, 24.01, '', true, '<b>']) assert.equal(mergeRestore(L(), bk({ ...OLD4, sleepH: v }, 500)).goals.sleepH, 7.5, 'sleepH ' + JSON.stringify(v));
  for (const v of [0, 41, 8.5, '8', null, 'x']) assert.equal(mergeRestore(L(), bk({ ...OLD4, waterCups: v }, 500)).goals.waterCups, 12, 'waterCups ' + JSON.stringify(v));
  const edges = mergeRestore(L(), bk({ ...OLD4, steps: '1000000', sleepH: 24, waterCups: 40 }, 500)).goals; assert.deepEqual([edges.steps, edges.sleepH, edges.waterCups], [1000000, 24, 40]);
  const zero = mergeRestore(L(), bk({ ...OLD4, steps: 0, sleepH: 0, waterCups: 1 }, 500)).goals; assert.deepEqual([zero.steps, zero.sleepH, zero.waterCups], [0, 0, 1]);
  const r = mergeRestore(L(), bk({ ...OLD4, steps: 7500.6 }, 500)).goals; assert.equal(r.steps, 7501);
});

test('12. backup: older, equal-stamp or untimestamped backups keep this device\'s goals whatever they carry (rule unchanged)', () => {
  const full = { k: 1500, p: 100, c: 100, f: 40, steps: 5000, sleepH: 7, waterCups: 5 };
  for (const stamp of [50, 100, 0]) assert.deepEqual(mergeRestore(clone(local({ settingsUpdatedAt: 100 })), bk(full, stamp)).goals, MINE, 'stamp ' + stamp);
  assert.deepEqual(mergeRestore(clone(local({ settingsUpdatedAt: 100 })), bk(full, 500)).goals, full);
});

test('13. backup: hostile goals (__proto__, junk, no goals) add nothing, never throw, keep this device\'s three', () => {
  const hostile = bk({}, 500); hostile.goals = JSON.parse('{"k":1,"p":1,"c":1,"f":1,"__proto__":{"steps":5},"zzz":1}');
  const m = mergeRestore(clone(local({ settingsUpdatedAt: 100 })), hostile);
  assert.deepEqual(Object.keys(m.goals).sort(), ['c', 'f', 'k', 'p', 'sleepH', 'steps', 'waterCups']);
  assert.deepEqual([m.goals.steps, m.goals.sleepH, m.goals.waterCups], [7000, 7.5, 12]);
  for (const g of [null, 'x', 5, [], undefined]) {
    const b = bk(OLD4, 500); b.goals = g; let o;
    assert.doesNotThrow(() => { o = mergeRestore(clone(local({ settingsUpdatedAt: 100 })), b); }, JSON.stringify(g));
    assert.deepEqual([o.goals.steps, o.goals.sleepH, o.goals.waterCups], [7000, 7.5, 12], 'goals ' + JSON.stringify(g));
  }
  const frozenIn = deepFreeze(local({ settingsUpdatedAt: 100 })), frozenBk = deepFreeze(bk(OLD4, 500));
  assert.equal(mergeRestore(frozenIn, frozenBk).goals.steps, 7000);
});

// ---------------------------------------------------------------- unchanged behaviour
test('14. unchanged: sanitize / migrate of a state loaded from disk still gives defaults for missing or unusable fields; toRecords carries the goals as they are', () => {
  assert.deepEqual(sanitize({ goals: { k: 1800, p: 100, c: 110, f: 50 } }).goals, { ...OLD4, steps: 10000, sleepH: 8, waterCups: 8 });
  assert.deepEqual(sanitize({ goals: { k: 1, p: 1, c: 1, f: 1, steps: 'x', sleepH: 99, waterCups: 0 } }).goals, { k: 1, p: 1, c: 1, f: 1, steps: 10000, sleepH: 8, waterCups: 8 });
  assert.equal(sanitize({ goals: { steps: '12000.4', sleepH: '6.5', waterCups: 9 } }).goals.steps, 12000);
  assert.deepEqual(migrate({ schemaVersion: 1, goals: { k: 1800, p: 100, c: 110, f: 50 } }).goals, { ...OLD4, steps: 10000, sleepH: 8, waterCups: 8 });
  const settings = toRecords(local()).find(r => r.key === 'settings');
  assert.deepEqual(settings.value.goals, MINE); assert.equal(settings.value.waterTap, 'whole'); assert.equal(settings.updatedAt, 50);
  // the four older goals keep their old behaviour: a bad value in a winning record falls back to the default
  const g4 = apply(local(), { k: -1, p: 'x', c: null });
  assert.deepEqual([g4.k, g4.p, g4.c], [2000, 150, 200]);
});

// ---------------------------------------------------------------- decision and shipping
test('15. docs and shipping: DECISIONS has D59 stating the one rule; KNOWN-ISSUES 69 no longer says the goals fall back; CACHE bumped above 64 (never an exact number)', () => {
  const dec = read('docs/DECISIONS.md');
  const m = dec.match(/^## D59\.[^\n]*\n([\s\S]*?)(?=^## D\d+\.|(?![\s\S]))/m);
  assert.ok(m, 'docs/DECISIONS.md needs a "## D59." section');
  const body = m[0];
  assert.match(body, /missing|older device|old device/i); assert.match(body, /unusable|invalid|not usable/i);
  for (const w of ['steps', 'sleepH', 'waterCups', 'waterTap', 'dials']) assert.ok(body.includes(w), 'D59 should name ' + w);
  assert.match(body, /differ/i, 'D59 states the accepted divergence');
  assert.ok(dec.indexOf('## D58.') < dec.indexOf('## D59.'), 'D59 comes after D58');
  const ki = read('docs/KNOWN-ISSUES.md').split('\n').find(l => /^\|\s*69\s*\|/.test(l)) || '';
  assert.ok(!/fall back to 10,000 and 8/.test(ki), 'KNOWN-ISSUES 69 still describes the old reset');
  const sw = read('sw.js'); const cache = Number(sw.match(/const CACHE = 'macro-diary-v(\d+)'/)[1]);
  assert.ok(cache > 64, 'CACHE must be bumped above 64 (the value when this spec was written), is ' + cache);
});
