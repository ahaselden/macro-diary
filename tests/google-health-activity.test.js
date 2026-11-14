// Spec: docs/specs/google-health-import.md (storage, sync, backup half). Test-designer file, written before the implementation.
// Numbering follows the spec's behaviour list (17-29). Expected values are hand-written from the spec. All data is made up.
// New modules are imported inside the tests and new named exports are read from namespaces, so each missing piece fails only its own test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as schema from '../js/core/schema.js';
import { defaults, migrate, sanitize, SCHEMA_VERSION } from '../js/core/schema.js';
import { createStore } from '../js/core/store.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { toRecords, applyRecords, isSyncKey, stableStringify } from '../js/domain/sync-records.js';
import { createSyncEngine } from '../js/services/sync/engine.js';
import { createMemoryAdapter } from '../js/services/sync/memory-adapter.js';
import { fixture, clone } from './helpers.js';

const A = () => import('../js/domain/activity.js');
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const sanitizeActivityDay = (...a) => schema.sanitizeActivityDay(...a);
const base = (over = {}) => ({ ...defaults(), ...over });
const W = (over = {}) => ({ id: 'e1', name: 'Walk', start: '2026-11-04T14:00:00Z', minutes: 45, kcal: 210, steps: 5200, distanceM: 3500, avgHr: 113, peakHr: 150, ...over });
const REC = (over = {}) => ({ updatedAt: 1000, source: 'google-health', steps: 9431, sleepMinutes: 465, sleepStart: '2026-11-04T05:00:00Z', sleepEnd: '2026-11-04T13:00:00Z', workouts: [W()], ...over });
const entry = (id, over = {}) => ({ id, meal: 'Lunch', name: 'Oats', brand: '', source: 'Custom', per100: { k: 400, p: 10, c: 60, f: 8 }, grams: 50, ...over });
const D1 = '2026-11-04', D2 = '2026-11-05', D3 = '2026-11-06';
const fakeStorage = text => { const m = { [STORAGE_KEY]: text }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, dump: () => m[STORAGE_KEY] }; };
const noPollution = () => { assert.equal(Object.keys(Object.prototype).length, 0); assert.equal(({}).polluted, undefined); assert.equal(({}).steps, undefined); };

// ---------------------------------------------------------------- 17, 18: applyActivityImport, activityForDay, activityLine
test('17. applyActivityImport: added, replaced as a whole, an identical import changes nothing (updatedAt NOT bumped), the diary is untouched', async () => {
  const { applyActivityImport } = await A();
  const s = base({ days: { [D1]: [entry('a')] }, tombstones: { gone: 7 }, settingsUpdatedAt: 5 });
  const guard = () => JSON.stringify([s.days, s.tombstones, s.settingsUpdatedAt, s.goals, s.recipes, s.plan, s.custom, s.schemaVersion]);
  const g0 = guard();
  const days = deepFreeze({ [D1]: { steps: 9431 }, [D2]: { steps: 100, workouts: [W()] } });
  assert.deepEqual(applyActivityImport(s, days, 5000), { added: 2, updated: 0, unchanged: 0 });
  assert.deepEqual(s.activity[D1], { updatedAt: 5000, source: 'google-health', steps: 9431 });
  assert.deepEqual(s.activity[D2], { updatedAt: 5000, source: 'google-health', steps: 100, workouts: [W()] });
  assert.equal(guard(), g0, 'diary, tombstones, settings stamp and everything else untouched');
  // the same export again, later: nothing changes, updatedAt stays
  assert.deepEqual(applyActivityImport(s, days, 9000), { added: 0, updated: 0, unchanged: 2 });
  assert.equal(s.activity[D1].updatedAt, 5000); assert.equal(s.activity[D2].updatedAt, 5000);
  // one day changes: only that day is stamped
  assert.deepEqual(applyActivityImport(s, { [D1]: { steps: 9432 }, [D2]: { steps: 100, workouts: [W()] } }, 9000), { added: 0, updated: 1, unchanged: 1 });
  assert.deepEqual(s.activity[D1], { updatedAt: 9000, source: 'google-health', steps: 9432 }); assert.equal(s.activity[D2].updatedAt, 5000);
  // replaced AS A WHOLE: a field the new export does not have is gone; days not in the import are left alone
  s.activity['2020-01-01'] = { updatedAt: 1, source: 'google-health', steps: 1 };
  assert.deepEqual(applyActivityImport(s, { [D2]: { sleepMinutes: 60, sleepStart: '2026-11-05T05:00:00Z', sleepEnd: '2026-11-05T06:00:00Z' } }, 9500), { added: 0, updated: 1, unchanged: 0 });
  assert.deepEqual(s.activity[D2], { updatedAt: 9500, source: 'google-health', sleepMinutes: 60, sleepStart: '2026-11-05T05:00:00Z', sleepEnd: '2026-11-05T06:00:00Z' });
  assert.deepEqual(s.activity['2020-01-01'], { updatedAt: 1, source: 'google-health', steps: 1 });
  assert.equal(guard(), g0);
});

test('17b. an unchanged day is recognised whatever the key order of the stored record, and the stored records are copies', async () => {
  const { applyActivityImport } = await A();
  const s = base({ activity: { [D1]: { steps: 5, source: 'google-health', updatedAt: 42 } } });   // key order differs from what the importer writes
  assert.deepEqual(applyActivityImport(s, { [D1]: { steps: 5 } }, 9999), { added: 0, updated: 0, unchanged: 1 });
  assert.equal(s.activity[D1].updatedAt, 42);
  const input = { [D2]: { steps: 7, workouts: [W()] } };
  applyActivityImport(s, input, 100);
  input[D2].workouts[0].name = 'CHANGED'; input[D2].workouts.push(W({ id: 'zz' })); input[D2].steps = 1;
  assert.equal(s.activity[D2].workouts[0].name, 'Walk'); assert.equal(s.activity[D2].workouts.length, 1); assert.equal(s.activity[D2].steps, 7);
  s.activity[D2].workouts[0].name = 'EDITED'; assert.equal(W().name, 'Walk');
  const t = {}; applyActivityImport(t, { [D1]: { steps: 5 } }, 100);   // a state with no activity property at all
  assert.deepEqual(t.activity, { [D1]: { updatedAt: 100, source: 'google-health', steps: 5 } });
  const u = { activity: [] }; applyActivityImport(u, { [D1]: { steps: 5 } }, 100);
  assert.equal(Array.isArray(u.activity), false); assert.deepEqual(Object.keys(u.activity), [D1]);
});

test('17c. hostile days are skipped; a bad "now" or bad arguments apply nothing; nothing throws', async () => {
  const { applyActivityImport } = await A();
  const s = base(), before = JSON.stringify(s);
  const days = JSON.parse('{"__proto__":{"steps":5},"2026-02-30":{"steps":5},"x":{"steps":5},"2026-1-5":{"steps":5},"2026-11-04":null,"2026-11-05":5,"2026-11-06":[],"2026-11-07":{},"2026-11-08":{"steps":"x"},"2026-11-09":{"steps":1e9},"2026-11-10":{"workouts":"x"}}');
  assert.deepEqual(applyActivityImport(s, days, 100), { added: 0, updated: 0, unchanged: 0 });
  assert.deepEqual(s.activity, {}); noPollution();
  for (const now of [NaN, 0, -1, undefined, null, '5', Infinity, {}]) {
    const t = base(); assert.deepEqual(applyActivityImport(t, { [D1]: { steps: 5 } }, now), { added: 0, updated: 0, unchanged: 0 }, String(now)); assert.deepEqual(t.activity, {});
  }
  for (const d of [undefined, null, 'x', 5, [], () => 1]) assert.deepEqual(applyActivityImport(base(), d, 100), { added: 0, updated: 0, unchanged: 0 }, String(d));
  assert.equal(JSON.stringify(s), before, 'the hostile import left the state exactly as it was (activity stays {})');
});

test('18. activityForDay returns the stored record by own key, else null', async () => {
  const { activityForDay } = await A();
  const s = base({ activity: { [D1]: REC() } });
  assert.deepEqual(activityForDay(s, D1), REC()); assert.equal(activityForDay(s, D2), null);
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', undefined, null, 5, {}]) assert.equal(activityForDay(s, k), null, String(k));
  for (const st of [undefined, null, {}, { activity: null }, { activity: 'x' }, { activity: [] }, 5]) assert.equal(activityForDay(st, D1), null, JSON.stringify(st));
});

test('18b. activityLine: exact text, parts joined by " · ", parts omitted when absent, "" when nothing', async () => {
  const { activityLine } = await A();
  const e = { updatedAt: 1, source: 'google-health' };
  assert.equal(activityLine(REC()), 'Steps 9,431 · Sleep 7 h 45 min · 1 workout');
  assert.equal(activityLine({ ...e, steps: 5200, sleepMinutes: 465, workouts: [W(), W({ id: 'e2' })] }), 'Steps 5,200 · Sleep 7 h 45 min · 2 workouts');
  assert.equal(activityLine({ ...e, steps: 800 }), 'Steps 800');
  assert.equal(activityLine({ ...e, steps: 999 }), 'Steps 999'); assert.equal(activityLine({ ...e, steps: 1000 }), 'Steps 1,000'); assert.equal(activityLine({ ...e, steps: 200000 }), 'Steps 200,000');
  for (const [m, t] of [[420, 'Sleep 7 h'], [45, 'Sleep 45 min'], [60, 'Sleep 1 h'], [61, 'Sleep 1 h 1 min'], [400, 'Sleep 6 h 40 min'], [1440, 'Sleep 24 h']]) assert.equal(activityLine({ ...e, sleepMinutes: m }), t, String(m));
  assert.equal(activityLine({ ...e, workouts: [W()] }), '1 workout'); assert.equal(activityLine({ ...e, workouts: [W(), W({ id: 'b' }), W({ id: 'c' })] }), '3 workouts');
  assert.equal(activityLine({ ...e, steps: 5, workouts: [] }), 'Steps 5', 'an empty list adds nothing');
  for (const v of [null, undefined, {}, e, 'x', 5, [], true, { steps: 'x' }, { steps: NaN, sleepMinutes: '60', workouts: 'x' }, { steps: -5 }, { steps: Infinity }]) assert.equal(activityLine(v), '', JSON.stringify(v));
  assert.equal(activityLine({ ...e, steps: '5', sleepMinutes: 60 }), 'Sleep 1 h', 'a numeric string is not a number');
});

// ---------------------------------------------------------------- 19, 20: schema
test('19. SCHEMA_VERSION is 10, defaults carry it and an empty activity, STORAGE_KEY is unchanged', () => {
  assert.equal(SCHEMA_VERSION, 10); assert.equal(defaults().schemaVersion, 10);
  assert.deepEqual(defaults().activity, {});
  const a = defaults(), b = defaults(); a.activity['2026-01-01'] = {}; assert.deepEqual(b.activity, {}, 'each call gives its own object');
  assert.equal(STORAGE_KEY, 'macrodiary.v1');
});

test('20. migrate from 9 (and older) keeps everything and adds only an empty activity; the original app fixtures survive; a store loads a v9 save intact', () => {
  const raw = fixture('state');                                   // a v1 save from the original app
  const m1 = migrate({ ...defaults(), ...clone(raw), schemaVersion: 1 });
  const noFoodId = o => JSON.parse(JSON.stringify(o, (k, v) => (k === 'foodId' ? undefined : v)));   // the v8 to v9 step (D53) stamps foodId on copies of saved foods; that is not this change
  assert.equal(m1.schemaVersion, 10); assert.deepEqual(noFoodId(m1.days), raw.days); assert.deepEqual(m1.goals, raw.goals); assert.deepEqual(m1.activity, {});
  const bk = fixture('backup');
  const m2 = migrate({ ...defaults(), ...clone(bk), schemaVersion: 1 });
  assert.deepEqual(m2.days, bk.days); assert.deepEqual(m2.activity, {});
  const v9 = { ...defaults(), schemaVersion: 9, days: { '2025-04-01': [entry('a', { updatedAt: 5, nut: { fiber: 2 } })] }, tombstones: { x: 3 }, settingsUpdatedAt: 8,
    recipes: { r1: { name: 'Chili', servings: 4, updatedAt: 9, ingredients: [] } }, plan: { '2025-04-02': { updatedAt: 4, slots: { Breakfast: [], Lunch: [], Dinner: [], Snacks: [] } } } };
  delete v9.activity;
  const want = clone(v9), m = migrate(clone(v9));
  for (const k of ['days', 'tombstones', 'settingsUpdatedAt', 'plan', 'custom', 'measures', 'goals', 'shopping']) assert.deepEqual(m[k], want[k], k);
  assert.equal(m.recipes.r1.name, 'Chili'); assert.equal(m.recipes.r1.updatedAt, 9);
  assert.equal(m.schemaVersion, 10); assert.deepEqual(m.activity, {});
  assert.deepEqual(migrate(clone(m)), m, 'idempotent');
  for (const v of [2, 5, 8]) assert.equal(migrate({ ...clone(v9), schemaVersion: v }).schemaVersion, 10, 'from ' + v);
});

test('20b. a store loads a stored v9 save as v10 with the diary intact; junk or valid activity in a save is handled; saving writes activity', () => {
  const v9 = { ...clone(defaults()), schemaVersion: 9, days: { '2025-04-01': [entry('a')] }, goals: { k: 1800, p: 100, c: 100, f: 50 } }; delete v9.activity;
  const st = fakeStorage(JSON.stringify(v9)), s = createStore(st);
  assert.equal(s.state.schemaVersion, 10); assert.deepEqual(s.state.days, v9.days); assert.deepEqual(s.state.goals, v9.goals); assert.deepEqual(s.state.activity, {});
  s.save(); const saved = JSON.parse(st.dump()); assert.equal(saved.schemaVersion, 10); assert.deepEqual(saved.activity, {}); assert.deepEqual(saved.days, v9.days);
  for (const junk of ['x', 5, [], null, true]) assert.deepEqual(createStore(fakeStorage(JSON.stringify({ ...v9, schemaVersion: 10, activity: junk }))).state.activity, {}, JSON.stringify(junk));
  const good = { [D1]: REC() };
  assert.deepEqual(createStore(fakeStorage(JSON.stringify({ ...clone(defaults()), activity: good }))).state.activity, good, 'a valid v10 save keeps its activity');
});

// ---------------------------------------------------------------- 21, 22: sanitizeActivityDay
test('21. sanitizeActivityDay keeps a valid record exactly, as a fresh object', () => {
  const r = deepFreeze(REC()), out = sanitizeActivityDay(r);
  assert.deepEqual(out, REC()); assert.notEqual(out, r); assert.notEqual(out.workouts, r.workouts); assert.notEqual(out.workouts[0], r.workouts[0]);
  assert.deepEqual(sanitizeActivityDay({ source: 'google-health', steps: 5 }), { updatedAt: 0, source: 'google-health', steps: 5 });
  assert.deepEqual(sanitizeActivityDay({ updatedAt: 5, source: 'google-health', steps: 0 }), { updatedAt: 5, source: 'google-health', steps: 0 }, 'a stored 0 is kept');
  assert.deepEqual(sanitizeActivityDay({ updatedAt: 5, source: 'google-health', steps: 5.6 }).steps, 6, 'non-integers are rounded');
  assert.deepEqual(sanitizeActivityDay({ updatedAt: 8.64e15, source: 'google-health', steps: 1 }).updatedAt, 8.64e15);
  assert.deepEqual(sanitizeActivityDay({ updatedAt: 1, source: 'google-health', steps: 1, evil: 1, nested: { a: 1 } }), { updatedAt: 1, source: 'google-health', steps: 1 }, 'unknown keys dropped');
  assert.deepEqual(sanitizeActivityDay({ updatedAt: 1, source: 'a' + 'b'.repeat(39), steps: 1 }).source, 'a' + 'b'.repeat(39));
  assert.deepEqual(sanitizeActivityDay({ updatedAt: 1, source: 'other-app2', steps: 1 }).source, 'other-app2');
});

test('22. sanitizeActivityDay hostile input: records, scalars, ranges, times, workouts', () => {
  const ok = { updatedAt: 1, source: 'google-health' };
  for (const v of [null, undefined, 5, 'x', [], true, () => 1, NaN]) assert.equal(sanitizeActivityDay(v), null, String(v));
  for (const src of [undefined, 7, '', 'Google Health', 'x'.repeat(41), '__proto__', '1abc', 'a_b', null, {}, ['google-health']]) assert.equal(sanitizeActivityDay({ updatedAt: 1, source: src, steps: 5 }), null, 'source ' + String(src));
  for (const u of ['5', -1, NaN, 9e15, null, undefined, Infinity]) assert.equal(sanitizeActivityDay({ ...ok, updatedAt: u, steps: 5 }).updatedAt, 0, 'updatedAt ' + String(u));
  // steps: wrong type or range drops the key (the record survives when something else is valid)
  for (const v of ['5', -1, 200001, NaN, Infinity, null, true, [], {}]) { const o = sanitizeActivityDay({ ...ok, steps: v, sleepMinutes: 60 }); assert.equal('steps' in o, false, 'steps ' + String(v)); assert.equal(o.sleepMinutes, 60); }
  assert.equal(sanitizeActivityDay({ ...ok, steps: 200000 }).steps, 200000);
  for (const v of [0, 1441, -1, '60', NaN, null]) assert.equal('sleepMinutes' in sanitizeActivityDay({ ...ok, steps: 5, sleepMinutes: v }), false, 'sleepMinutes ' + String(v));
  assert.equal(sanitizeActivityDay({ ...ok, sleepMinutes: 1 }).sleepMinutes, 1); assert.equal(sanitizeActivityDay({ ...ok, sleepMinutes: 1440 }).sleepMinutes, 1440); assert.equal(sanitizeActivityDay({ ...ok, sleepMinutes: 59.6 }).sleepMinutes, 60);
  // sleep times: only together, only with sleepMinutes, exact form, end after start
  const t = (over) => sanitizeActivityDay({ ...ok, steps: 5, sleepMinutes: 60, sleepStart: '2026-11-04T05:00:00Z', sleepEnd: '2026-11-04T06:00:00Z', ...over });
  assert.equal(t({}).sleepEnd, '2026-11-04T06:00:00Z');
  for (const over of [{ sleepEnd: '2026-11-04T05:00:00Z' }, { sleepEnd: '2026-11-04T04:00:00Z' }, { sleepEnd: undefined }, { sleepStart: undefined }, { sleepStart: '2026-11-04 05:00:00' }, { sleepEnd: '2026-11-04T06:00:00.000Z' },
    { sleepStart: '2026-02-30T05:00:00Z' }, { sleepEnd: 5 }, { sleepStart: {} }, { sleepEnd: '2026-11-04T06:00:00+00:00' }]) {
    const o = t(over); assert.equal('sleepStart' in o, false, JSON.stringify(over)); assert.equal('sleepEnd' in o, false, JSON.stringify(over)); assert.equal(o.sleepMinutes, 60);
  }
  const noMinutes = sanitizeActivityDay({ ...ok, steps: 5, sleepStart: '2026-11-04T05:00:00Z', sleepEnd: '2026-11-04T06:00:00Z' });
  assert.deepEqual(noMinutes, { updatedAt: 1, source: 'google-health', steps: 5 }, 'times without minutes are dropped');
  // nothing valid left
  for (const v of [{ ...ok }, { ...ok, steps: -1 }, { ...ok, workouts: [] }, { ...ok, workouts: 'x' }, { ...ok, workouts: [null, 5, 'x', []] }, { ...ok, sleepStart: '2026-11-04T05:00:00Z', sleepEnd: '2026-11-04T06:00:00Z' }]) assert.equal(sanitizeActivityDay(v), null, JSON.stringify(v));
  noPollution();
});

test('22b. sanitizeActivityDay workouts: cap of 20, ids, starts, names, numbers, repeated ids, unknown keys', () => {
  const ok = { updatedAt: 1, source: 'google-health' }, wk = list => sanitizeActivityDay({ ...ok, workouts: list });
  const many = Array.from({ length: 25 }, (_, i) => W({ id: 'w' + i }));
  assert.deepEqual(wk(many).workouts.map(w => w.id), many.slice(0, 20).map(w => w.id), 'the first 20, in the order given');
  assert.equal(wk(Array.from({ length: 100000 }, (_, i) => W({ id: 'w' + i }))).workouts.length, 20);
  const bad = [W({ id: '' }), W({ id: 7 }), W({ id: 'x'.repeat(81) }), W({ start: undefined }), W({ start: '2026-11-04 14:00:00' }), W({ start: '2026-02-30T14:00:00Z' }), null, 5, 'x', [], W()];
  assert.deepEqual(wk(bad).workouts, [W()], 'only the valid one survives');
  assert.equal(wk([W({ id: 'x'.repeat(80) })]).workouts[0].id.length, 80);
  assert.deepEqual(wk([W({ id: 'a', name: 'First' }), W({ id: 'a', name: 'Second' })]).workouts.map(w => w.name), ['First'], 'a repeated id keeps the first');
  const name = n => wk([W({ name: n })]).workouts[0].name;
  assert.equal(name('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>'); assert.equal(name('=HYPERLINK("a","b")'), '=HYPERLINK("a","b")');
  assert.equal(name('Wal\u0007k\u0000\u009f'), 'Walk'); assert.equal(name('x'.repeat(100)), 'x'.repeat(60)); assert.equal(name('   '), 'Workout'); assert.equal(name(5), 'Workout'); assert.equal(name(undefined), 'Workout'); assert.equal(name({}), 'Workout');
  const one = over => wk([W(over)]).workouts[0];
  for (const v of ['x', -1, 1441, NaN, null]) assert.equal(one({ minutes: v }).minutes, 0, 'minutes ' + String(v));
  assert.equal(one({ minutes: 1440 }).minutes, 1440);
  for (const [k, bads, goods] of [['kcal', [-1, 20001, 'x', NaN, null], [0, 20000]], ['steps', [-1, 200001, '5', NaN], [0, 200000]], ['distanceM', [-1, 1000001, '5', Infinity], [0, 1000000]],
    ['avgHr', [19, 301, '90', NaN], [20, 300]], ['peakHr', [19, 301, '90', NaN], [20, 300]]]) {
    for (const v of bads) assert.equal(k in one({ [k]: v }), false, `${k} ${String(v)} must be dropped`);
    for (const v of goods) assert.equal(one({ [k]: v })[k], v, `${k} ${v} must be kept`);
  }
  assert.equal('kcal' in one({ kcal: undefined }), false);
  const evil = JSON.parse('{"id":"e9","name":"n","start":"2026-11-04T14:00:00Z","minutes":5,"__proto__":{"polluted":1},"extra":"x","constructor":"y"}');
  const w9 = wk([evil]).workouts[0]; assert.deepEqual(w9, { id: 'e9', name: 'n', start: '2026-11-04T14:00:00Z', minutes: 5 }); noPollution();
  const poisoned = sanitizeActivityDay(JSON.parse('{"__proto__":{"polluted":1},"source":"google-health","steps":5}'));
  assert.deepEqual(poisoned, { updatedAt: 0, source: 'google-health', steps: 5 }); assert.equal(Object.hasOwn(poisoned, '__proto__'), false); noPollution();
});

test('23. sanitize rebuilds d.activity: real date keys and valid records only; the diary and everything else are left alone', () => {
  const act = JSON.parse(JSON.stringify({ [D1]: REC(), '2026-02-30': REC(), x: REC(), '2026-1-5': REC(), [D2]: { source: 7, steps: 1 }, [D3]: 'junk', '2026-11-07': { updatedAt: 1, source: 'google-health' }, '2026-11-08': null }));
  Object.defineProperty(act, '__proto__', { value: REC(), enumerable: true, configurable: true, writable: true });
  const d = base({ activity: act, days: { [D1]: [entry('a')] } });
  const days = clone(d.days);
  sanitize(d);
  assert.deepEqual(Object.keys(d.activity), [D1]); assert.deepEqual(d.activity[D1], REC()); assert.deepEqual(d.days, days);
  for (const junk of ['x', 5, [], null, true, undefined]) assert.deepEqual(sanitize({ activity: junk }).activity, {}, String(junk));
  assert.deepEqual(sanitize({}).activity, {});
  assert.deepEqual(sanitize({ days: { [D1]: [entry('a')] }, activity: {} }).days, { [D1]: [entry('a')] });
  noPollution();
});

// ---------------------------------------------------------------- 24-29: sync, merge, backup
test('24. isSyncKey knows activity:YYYY-MM-DD and nothing close to it; toRecords writes one record per day after the plan records', () => {
  for (const k of ['activity:2026-11-05', 'activity:1999-01-01']) assert.equal(isSyncKey(k), true, k);
  for (const k of ['activity:', 'activity', 'activity:2026-1-5', 'activity:2026-11-05x', 'xactivity:2026-11-05', 'Activity:2026-11-05', 'activity:2026-11-05\n', 'activity:2026-11-05/x', 'activity: 2026-11-05', 'sleep:2026-11-05']) assert.equal(isSyncKey(k), false, JSON.stringify(k));
  for (const k of ['settings', 'custom', 'measures', 'tombstones', 'shopping', 'day:2026-11-05', 'plan:2026-11-05', 'recipe:abc']) assert.equal(isSyncKey(k), true, k + ' still known');
  const s = base({ activity: { [D2]: REC({ updatedAt: 2000 }), [D1]: REC({ updatedAt: 1000 }) }, plan: { [D1]: { updatedAt: 3, slots: { Breakfast: [], Lunch: [], Dinner: [], Snacks: [] } } }, recipes: { r1: { id: 'r1', name: 'x', updatedAt: 4 } } });
  const recs = toRecords(s), keys = recs.map(r => r.key);
  assert.deepEqual(keys.filter(k => k.startsWith('activity:')), ['activity:' + D1, 'activity:' + D2], 'sorted by date');
  assert.ok(keys.indexOf('activity:' + D1) > keys.lastIndexOf('plan:' + D1), 'after the plan records');
  const r1 = recs.find(r => r.key === 'activity:' + D1);
  assert.deepEqual(r1.value, { activity: REC({ updatedAt: 1000 }) }); assert.equal(r1.updatedAt, 1000); assert.equal(recs.find(r => r.key === 'activity:' + D2).updatedAt, 2000);
  assert.equal(recs[0].key, 'settings');
  assert.equal(toRecords(base()).some(r => r.key.startsWith('activity')), false, 'no activity, no records');
  assert.doesNotThrow(() => toRecords(base({ activity: { [D1]: null, [D2]: 'x', [D3]: REC() } })));
  assert.doesNotThrow(() => toRecords({ ...base(), activity: undefined }));
  assert.doesNotThrow(() => toRecords({ ...base(), activity: 'x' }));
});

test('25. applyRecords: a valid activity record arrives; hostile and unknown records are ignored; partly hostile ones arrive cleaned', () => {
  const rec = (day, activity) => ({ key: 'activity:' + day, value: { activity }, updatedAt: 1 });
  const s0 = deepFreeze(base({ days: { [D1]: [entry('a')] } }));
  const got = applyRecords(s0, clone([rec(D1, REC())]));
  assert.deepEqual(got.activity[D1], REC()); assert.deepEqual(got.days, s0.days);
  const hostile = [{ key: 'activity:' + D1, value: null }, { key: 'activity:' + D1, value: {} }, { key: 'activity:' + D1, value: { activity: null } }, rec(D1, 'x'), rec(D1, []), rec(D1, { source: 7, steps: 5 }),
    rec(D1, { source: 'google-health' }), rec('2026-02-30', REC()), rec(D1, { source: 'google-health', steps: 1e9 }), { key: 'activity:' + D1, value: 'x' }, { key: 'activity:' + D1 },
    { key: 'sleep:' + D1, value: { activity: REC() } }, { key: 'activity', value: { activity: REC() } }, { key: 'activity:2026-11-04/x', value: { activity: REC() } }, { key: 'future:thing', value: { x: 1 } },
    null, 5, 'x', [], undefined, { value: { activity: REC() } }, { key: 5, value: { activity: REC() } }];
  let r; assert.doesNotThrow(() => { r = applyRecords(s0, hostile); });
  assert.deepEqual(r.activity, {}); assert.deepEqual(r.days, s0.days); noPollution();
  assert.doesNotThrow(() => applyRecords(s0, undefined)); assert.doesNotThrow(() => applyRecords(s0, 'x'));
  const part = applyRecords(s0, [rec(D1, { updatedAt: 5, source: 'google-health', steps: 100, workouts: [W(), W({ id: '' }), W({ id: 'b', kcal: 99999 }), null], sleepMinutes: '60', evil: 1 })]);
  assert.deepEqual(part.activity[D1], { updatedAt: 5, source: 'google-health', steps: 100, workouts: [W(), { id: 'b', name: 'Walk', start: '2026-11-04T14:00:00Z', minutes: 45, steps: 5200, distanceM: 3500, avgHr: 113, peakHr: 150 }] });
  const jsonKey = JSON.parse('{"key":"activity:2026-11-04","value":{"activity":{"__proto__":{"polluted":1},"source":"google-health","steps":5,"updatedAt":3}}}');
  assert.deepEqual(applyRecords(s0, [jsonKey]).activity[D1], { updatedAt: 3, source: 'google-health', steps: 5 }); noPollution();
  // the wire stamp does not matter: the record's own updatedAt decides
  const local = base({ activity: { [D1]: REC({ updatedAt: 5000, steps: 1 }) } });
  assert.equal(applyRecords(local, [{ key: 'activity:' + D1, value: { activity: REC({ updatedAt: 9999, steps: 2 }) }, updatedAt: 1 }]).activity[D1].steps, 2);
  assert.equal(applyRecords(local, [{ key: 'activity:' + D1, value: { activity: REC({ updatedAt: 10, steps: 2 }) }, updatedAt: 99999999 }]).activity[D1].steps, 1);
  // a state with no activity property (an old object) works as {}
  const old = { ...defaults() }; delete old.activity;
  assert.deepEqual(applyRecords(old, clone([rec(D1, REC())])).activity[D1], REC());
});

test('26. mergeStates: last writer wins per day by updatedAt, ties are order independent, preferLocal, missing stamp is 0, tombstones do not apply', () => {
  const L = base({ activity: { [D1]: REC({ updatedAt: 100, steps: 1 }), [D2]: REC({ updatedAt: 300, steps: 2 }) } });
  const R = base({ activity: { [D1]: REC({ updatedAt: 200, steps: 11 }), [D2]: REC({ updatedAt: 200, steps: 22 }), [D3]: REC({ updatedAt: 50, steps: 33 }) } });
  for (const [x, y] of [[L, R], [R, L]]) {
    const m = mergeStates(x, y).activity;
    assert.equal(m[D1].steps, 11); assert.equal(m[D2].steps, 2); assert.equal(m[D3].steps, 33); assert.deepEqual(Object.keys(m).sort(), [D1, D2, D3]);
  }
  const t1 = base({ activity: { [D1]: REC({ updatedAt: 100, steps: 5 }) } }), t2 = base({ activity: { [D1]: REC({ updatedAt: 100, steps: 9 }) } });
  assert.equal(mergeStates(t1, t2).activity[D1].steps, 9, 'tie: the larger JSON text wins'); assert.equal(mergeStates(t2, t1).activity[D1].steps, 9, '... in either order');
  assert.equal(mergeStates(t1, t2, { preferLocal: true }).activity[D1].steps, 5); assert.equal(mergeStates(t2, t1, { preferLocal: true }).activity[D1].steps, 9);
  const noStamp = base({ activity: { [D1]: (() => { const r = REC({ steps: 7 }); delete r.updatedAt; return r; })() } }), one = base({ activity: { [D1]: REC({ updatedAt: 1, steps: 8 }) } });
  assert.equal(mergeStates(noStamp, one).activity[D1].steps, 8); assert.equal(mergeStates(one, noStamp).activity[D1].steps, 8);
  const tomb = base({ activity: { [D1]: REC() }, tombstones: { [D1]: 9e12, ['activity:' + D1]: 9e12 } });
  assert.deepEqual(Object.keys(mergeStates(tomb, base()).activity), [D1]); assert.deepEqual(Object.keys(mergeStates(base(), tomb).activity), [D1]);
  const noProp = { ...defaults() }; delete noProp.activity;
  assert.deepEqual(mergeStates(noProp, noProp).activity, {}, 'the result always has an activity object'); assert.deepEqual(mergeStates(noProp, L).activity, L.activity); assert.deepEqual(mergeStates(L, noProp).activity, L.activity);
  assert.doesNotThrow(() => mergeStates(base({ activity: { [D1]: null, [D2]: 'x', [D3]: [] } }), L));
  assert.deepEqual(Object.keys(mergeStates(base({ activity: { [D1]: null, [D2]: 'x', [D3]: [] } }), L).activity).sort(), [D1, D2], 'junk entries are not carried over');
});

test('27. merge laws for activity: commutative, associative, idempotent over random states (with many ties)', () => {
  let seed = 20261113; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
  const state = () => base({ activity: Object.fromEntries(days.filter(() => rnd() < 0.6).map(d => [d, REC({ updatedAt: pick([0, 1, 2, 3]), steps: pick([1, 2, 3]), ...(rnd() < 0.5 ? { workouts: [W({ id: pick(['a', 'b']) })] } : { workouts: undefined, sleepMinutes: undefined, sleepStart: undefined, sleepEnd: undefined }) })])) });
  const strip = o => JSON.parse(JSON.stringify(o));
  const act = s => stableStringify(strip(s.activity));
  for (let i = 0; i < 300; i++) {
    const a = state(), b = state(), c = state();
    assert.equal(act(mergeStates(a, b)), act(mergeStates(b, a)), 'commutative ' + i);
    assert.equal(act(mergeStates(mergeStates(a, b), c)), act(mergeStates(a, mergeStates(b, c))), 'associative ' + i);
    assert.equal(act(mergeStates(a, a)), act(a), 'idempotent ' + i);
    assert.equal(act(mergeStates(mergeStates(a, b), b)), act(mergeStates(a, b)), 'repeating a merge changes nothing ' + i);
  }
});

test('28. activity does not disturb the diary, plan or recipes in a merge; two devices converge through the sync engine; an identical re-import pushes nothing', async () => {
  const { applyActivityImport } = await A();
  const local = base({ days: { [D1]: [entry('a', { updatedAt: 5 })] }, recipes: { r1: { id: 'r1', name: 'Chili', updatedAt: 3 } }, tombstones: { z: 1 }, activity: { [D1]: REC() } });
  const remoteActivityOnly = base({ activity: { [D2]: REC({ updatedAt: 9 }) } });
  const m = mergeStates(local, remoteActivityOnly);
  for (const k of ['days', 'recipes', 'plan', 'custom', 'measures', 'tombstones', 'shopping']) assert.deepEqual(m[k], mergeStates(local, base())[k], k);
  assert.deepEqual(Object.keys(m.activity).sort(), [D1, D2]);
  const diaryOnly = base({ days: { [D3]: [entry('c', { updatedAt: 1 })] } });
  assert.deepEqual(mergeStates(local, diaryOnly).activity, local.activity, 'a remote without activity never removes it');
  assert.deepEqual(mergeStates(diaryOnly, local).activity, local.activity);

  let clock = 1000; const tick = () => ++clock, srv = createMemoryAdapter();
  const dev = () => { const d = { state: defaults(), saved: null }; d.engine = createSyncEngine({ adapter: srv, getState: () => d.state, applyState: s => { d.state = s; }, meta: { load: () => (d.saved ? clone(d.saved) : null), save: o => { d.saved = clone(o); } }, now: tick }); return d; };
  const a = dev(), b = dev();
  const calls = []; const orig = srv.push.bind(srv); srv.push = async r => { calls.push(r); return orig(r); };
  applyActivityImport(a.state, { [D1]: { steps: 100 }, [D2]: { steps: 200, workouts: [W()] } }, tick());
  assert.equal((await a.engine.sync()).ok, true); assert.equal((await b.engine.sync()).ok, true);
  assert.deepEqual(b.state.activity, a.state.activity);
  assert.ok(calls.flat().some(r => r.key === 'activity:' + D1) && calls.flat().some(r => r.key === 'activity:' + D2), 'the activity days travelled as records');
  // the same export imported on the other device (a later clock): nothing changes, so nothing is pushed
  calls.length = 0;
  assert.deepEqual(applyActivityImport(b.state, { [D1]: { steps: 100 }, [D2]: { steps: 200, workouts: [W()] } }, tick()), { added: 0, updated: 0, unchanged: 2 });
  await b.engine.sync(); await a.engine.sync();
  assert.equal(calls.flat().length, 0, 'an identical re-import must not push anything');
  // a newer export on b changes one day; a gets it
  applyActivityImport(b.state, { [D1]: { steps: 150 } }, tick());
  await b.engine.sync(); await a.engine.sync();
  assert.equal(a.state.activity[D1].steps, 150); assert.equal(a.state.activity[D2].steps, 200); assert.deepEqual(a.state.activity, b.state.activity);
  // different days imported on both devices converge
  applyActivityImport(a.state, { [D3]: { steps: 3 } }, tick()); applyActivityImport(b.state, { '2026-11-07': { steps: 7 } }, tick());
  await a.engine.sync(); await b.engine.sync(); await a.engine.sync();
  assert.deepEqual(a.state.activity, b.state.activity); assert.deepEqual(Object.keys(a.state.activity).sort(), [D1, D2, D3, '2026-11-07']);
});

test('29. mergeRestore with activity: per day last writer wins, this device wins ties, a v9 backup still restores, a hostile backup is cleaned and the diary kept', () => {
  const state = base({ days: { [D1]: [entry('a')] }, activity: { [D1]: REC({ updatedAt: 100, steps: 1 }), [D3]: REC({ updatedAt: 50, steps: 5 }) } });
  const backup = clone(base({ days: { [D2]: [entry('b')] }, activity: { [D1]: REC({ updatedAt: 200, steps: 11 }), [D2]: REC({ updatedAt: 50, steps: 22 }), [D3]: REC({ updatedAt: 50, steps: 99 }) } }));
  const r = mergeRestore(clone(state), backup);
  assert.equal(r.activity[D1].steps, 11, 'newer backup day wins'); assert.equal(r.activity[D2].steps, 22, 'new day arrives'); assert.equal(r.activity[D3].steps, 5, 'a tie goes to this device');
  assert.deepEqual(Object.keys(r.days).sort(), [D1, D2]);
  const v9 = clone({ ...defaults(), schemaVersion: 9, days: { [D2]: [entry('b')] } }); delete v9.activity;
  const r9 = mergeRestore(clone(state), v9);
  assert.deepEqual(r9.activity, state.activity); assert.deepEqual(Object.keys(r9.days).sort(), [D1, D2]);
  const evil = JSON.parse(JSON.stringify({ ...defaults(), days: { [D3]: [entry('c')] }, activity: { '2026-02-30': REC(), x: REC(), [D2]: { source: 7, steps: 1 }, [D3]: REC({ steps: 1e9, workouts: [W({ id: '' }), W({ id: 'ok', kcal: -4 })], updatedAt: 70 }) } }));
  const re = mergeRestore(clone(state), evil);
  assert.deepEqual(Object.keys(re.activity).sort(), [D1, D3]);
  assert.equal(re.activity[D3].updatedAt, 70); assert.equal('steps' in re.activity[D3], false, 'the absurd steps value is dropped'); assert.deepEqual(re.activity[D3].workouts.map(w => w.id), ['ok']); assert.equal('kcal' in re.activity[D3].workouts[0], false);
  assert.deepEqual(re.days[D3].map(e => e.id), ['c'], 'the diary entry of the hostile backup is kept');
  const round = JSON.parse(JSON.stringify(state)); assert.deepEqual(round.activity, state.activity);
  const back = mergeRestore(base(), JSON.parse(JSON.stringify(state))); assert.deepEqual(back.activity, state.activity);
  noPollution();
});
