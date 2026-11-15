// Spec: docs/specs/dials-simplify.md (follow-up to backlog item 21). Test-designer file, written BEFORE the implementation. All data is made up.
// Golden values are hand-computed (the arithmetic is in the comments), never taken from the code under test.
// Tests S18-S22 are WEAK source-text checks (words in files); the screens themselves are proved by the headless scenarios H1-H14 in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SCHEMA from '../js/core/schema.js';
import * as DOMAIN from '../js/domain/dials.js';
import { createStore } from '../js/core/store.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { mergeStates } from '../js/domain/merge.js';
import { mergeRestore } from '../js/domain/backup.js';
import { touchSettings } from '../js/domain/entries.js';
import { dialsHtml } from '../js/ui/dials.js';
import { clone } from './helpers.js';

// namespace imports: a missing export fails only the tests that use it (not the whole file)
const { defaults, migrate, sanitize, SCHEMA_VERSION, DIAL_KEYS, DEFAULT_DIALS, sanitizeDials } = SCHEMA;
const { dialModel, normalizeDials, toggleDial } = DOMAIN;
const D = '2026-11-14';
const ALL = ['k', 'p', 'c', 'f', 'steps', 'sleep'];
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const near = (a, b, e = 1e-9, msg) => assert.ok(typeof a === 'number' && Math.abs(a - b) <= e, `${msg || ''} ${a} is not within ${e} of ${b}`);
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const entry = (grams, per100 = { k: 100, p: 10, c: 20, f: 5 }, id = 'e1') => ({ id, meal: 'Lunch', name: 'Rice', brand: '', source: 'custom', per100, grams, updatedAt: 1 });
// 800 g of {100,10,20,5} per 100 g = 800 kcal, 80 g P, 160 g C, 40 g F
const mk = ({ entries = [entry(800)], goals = {}, dials, activity = { [D]: { updatedAt: 1, source: 'google-health', steps: 6120, sleepMinutes: 473 } } } = {}) => {
  const s = defaults(); s.days = entries.length ? { [D]: entries } : {}; s.goals = { ...s.goals, ...goals }; s.activity = activity; if (dials !== undefined) s.dials = dials; return s;
};
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };
const BAD_WORDS = /NaN|Infinity|undefined|null|\[object|[<>]/;
const clean = (m, msg) => { for (const s of strings(m)) assert.doesNotMatch(s, BAD_WORDS, `${msg || ''} string "${s}"`); };
const fakeStorage = initial => { const m = new Map(initial === undefined ? [] : [[STORAGE_KEY, initial]]); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, v); }, m }; };
// the element that starts at the first <div ...ATTR...> in html, up to its matching </div> (div nesting counted); null when absent
const divWith = (html, attr) => {
  const i = html.search(new RegExp('<div\\b[^>]*' + attr)); if (i < 0) return null;
  const re = /<(\/?)div\b[^>]*>/g; re.lastIndex = i; let depth = 0, m;
  while ((m = re.exec(html))) { depth += m[1] ? -1 : 1; if (depth === 0) return html.slice(i, re.lastIndex); }
  return html.slice(i);
};
const count = (s, n) => s.split(n).length - 1;
const tagOf = (src, id) => { const m = src.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>')); assert.ok(m, 'missing #' + id); return m[0]; };
const withDials = (dials, opts) => dialModel(mk({ ...opts, dials }), D);

// ================================================================ saved shape
test('S1. SCHEMA_VERSION 12; defaults carry dials ["k"] (a fresh array each time); DIAL_KEYS fixed; STORAGE_KEY unchanged', () => {
  assert.equal(SCHEMA_VERSION, 12); assert.equal(defaults().schemaVersion, 12);
  assert.deepEqual(DIAL_KEYS, ALL); assert.deepEqual(DEFAULT_DIALS, ['k']);
  assert.deepEqual(defaults().dials, ['k']); assert.notStrictEqual(defaults().dials, defaults().dials);
  defaults().dials.push('p'); assert.deepEqual(defaults().dials, ['k'], 'mutating one default must not change the next');
  assert.equal(STORAGE_KEY, 'macrodiary.v1'); assert.match(read('js/core/schema.js'), /export const SCHEMA_VERSION = 12;/);
  assert.deepEqual(defaults().goals, { k: 2000, p: 150, c: 200, f: 65, steps: 10000, sleepH: 8 }, 'goals are untouched by this feature');
});

test('S2. sanitizeDials: known keys, unique, in the fixed order k p c f steps sleep; unknown and duplicates dropped; [] is valid; not an array gives the default', () => {
  const ok = [[['k'], ['k']], [['k', 'steps'], ['k', 'steps']], [['sleep', 'k', 'p'], ['k', 'p', 'sleep']], [['k', 'k', 'p', 'p', 'k'], ['k', 'p']], [['x', 'k'], ['k']], [[], []], [['x', 'y'], []], [['K'], []],
    [[5, null, {}, ['k'], 'k', true], ['k']], [['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'k'], ['k']], [['steps', 'sleep', 'f', 'c', 'p', 'k'], ALL], [['<img src=x>', 'p'], ['p']]];
  for (const [input, want] of ok) assert.deepEqual(sanitizeDials(input), want, JSON.stringify(input));
  for (const junk of [undefined, null, 'k', 'k,p', 5, 0, true, false, {}, { 0: 'k', length: 1 }, NaN, () => ['k']]) assert.deepEqual(sanitizeDials(junk), ['k'], String(junk));
  const a = sanitizeDials(['p']); a.push('c'); assert.deepEqual(sanitizeDials(['p']), ['p'], 'a fresh array each call');
  const out = sanitizeDials(undefined); out.push('f'); assert.deepEqual(sanitizeDials(undefined), ['k'], 'the default is never shared');
  const frozen = Object.freeze(['steps', 'k']); assert.deepEqual(sanitizeDials(frozen), ['k', 'steps']); assert.deepEqual([...frozen], ['steps', 'k'], 'input not mutated');
  assert.deepEqual(sanitizeDials(new Array(100000).fill('k')), ['k'], 'a huge array of duplicates is fine');
  assert.deepEqual(sanitizeDials(Array.from({ length: 50000 }, (_, i) => 'x' + i).concat(['sleep'])), ['sleep']);
});

test('S3. sanitize() applies it to d.dials: kept, [] kept (not reset), junk gives the default, other fields untouched', () => {
  assert.deepEqual(sanitize({ dials: ['f', 'p'] }).dials, ['p', 'f']); assert.deepEqual(sanitize({ dials: [] }).dials, []);
  for (const junk of [undefined, null, 'k', 5, {}, true]) assert.deepEqual(sanitize({ dials: junk }).dials, ['k'], String(junk));
  assert.deepEqual(sanitize({}).dials, ['k']); assert.deepEqual(sanitize({ dials: ['x', 'sleep', 'sleep'] }).dials, ['sleep']);
  const g = sanitize({ dials: ['p'], goals: { k: 1800, p: 120, c: 150, f: 50, steps: 7000, sleepH: 7.5 }, theme: 'dark' });
  assert.deepEqual(g.goals, { k: 1800, p: 120, c: 150, f: 50, steps: 7000, sleepH: 7.5 }); assert.equal(g.theme, 'dark');
  const twice = sanitize(sanitize({ dials: ['steps', 'k', 'k'] })); assert.deepEqual(twice.dials, ['k', 'steps'], 'idempotent');
});

const oldSave = v => { const s = { ...clone(defaults()), schemaVersion: v, goals: { k: 1800, p: 120, c: 0, f: 55.5, steps: 5000, sleepH: 7 }, theme: 'dark', weightUnit: 'oz', settingsUpdatedAt: 77, tombstones: { x: 5 },
  days: { '2026-11-13': [entry(300)] }, activity: { '2026-11-13': { updatedAt: 1, source: 'google-health', steps: 5000, sleepMinutes: 400 } } }; delete s.dials; return s; };
const kept = s => JSON.stringify([s.days, s.tombstones, s.settingsUpdatedAt, s.theme, s.weightUnit, s.activity, s.goals]);

test('S4. migration from every older version (1, 2, 5, 8, 9, 10, 11) keeps every value and sets dials ["k"]; version 12 data keeps its choice, including []; store load/save/reload agree', () => {
  for (const v of [1, 2, 5, 8, 9, 10, 11]) {
    const src = oldSave(v), m = migrate(clone(src));
    assert.equal(m.schemaVersion, 12, 'from ' + v); assert.deepEqual(m.dials, ['k'], 'from ' + v); assert.equal(kept(m), kept(src), 'from ' + v);
  }
  for (const dials of [['p', 'steps'], [], ['k', 'p', 'c', 'f', 'steps', 'sleep']]) assert.deepEqual(migrate({ ...oldSave(12), schemaVersion: 12, dials: clone(dials) }).dials, dials, 'v12 keeps ' + JSON.stringify(dials));
  const st = fakeStorage(JSON.stringify(oldSave(11))), s = createStore(st);
  assert.equal(s.state.schemaVersion, 12); assert.deepEqual(s.state.dials, ['k']); assert.equal(kept(s.state), kept(oldSave(11)));
  s.state.dials = toggleDial(s.state.dials, 'sleep'); assert.equal(s.save(), true);
  const saved = JSON.parse(st.m.get(STORAGE_KEY)); assert.equal(saved.schemaVersion, 12); assert.deepEqual(saved.dials, ['k', 'sleep']);
  assert.deepEqual(createStore(fakeStorage(JSON.stringify(saved))).state.dials, ['k', 'sleep']);
  s.state.dials = []; s.save(); assert.deepEqual(createStore(fakeStorage(st.m.get(STORAGE_KEY))).state.dials, [], 'an empty choice survives a reload (is not reset to the default)');
  const rep = createStore(fakeStorage()); rep.replace({ goals: { k: 1800, p: 120, c: 150, f: 50 } }); assert.deepEqual(rep.state.dials, ['k']);
  assert.deepEqual(createStore(fakeStorage()).state.dials, ['k'], 'a brand new store');
  assert.match(read('js/core/schema.js'), /v < 12/, 'a migrate step for version 12');
});

// ================================================================ domain helpers
test('S5. normalizeDials and toggleDial: pure, fixed order, [] allowed, bad keys change nothing', () => {
  for (const input of [['k'], ['sleep', 'p'], [], ['x'], ['k', 'k'], undefined, null, 'k', {}, ALL, ['__proto__', 'f']]) assert.deepEqual(normalizeDials(input), sanitizeDials(input), JSON.stringify(input));
  const t = (list, key, on) => toggleDial(list, key, on);
  assert.deepEqual(t(['k'], 'p'), ['k', 'p']); assert.deepEqual(t(['k', 'p'], 'k'), ['p']); assert.deepEqual(t(['k'], 'k'), []); assert.deepEqual(t([], 'sleep'), ['sleep']);
  assert.deepEqual(t(['sleep'], 'k', true), ['k', 'sleep'], 'inserted in the fixed order, not appended'); assert.deepEqual(t(['k'], 'k', true), ['k']); assert.deepEqual(t(['k'], 'p', false), ['k']); assert.deepEqual(t(['k', 'p'], 'p', false), ['k']);
  assert.deepEqual(t(['k'], 'p', 'yes'), ['k', 'p'], 'on is used only when it is exactly true or false, anything else flips'); assert.deepEqual(t(['k'], 'p', 1), ['k', 'p']);
  for (const bad of ['bogus', '__proto__', 'constructor', '', 'K', 5, null, undefined, {}, ['k'], '<img>']) assert.deepEqual(t(['k', 'steps'], bad), ['k', 'steps'], 'key ' + JSON.stringify(bad));
  assert.deepEqual(t(undefined, 'p'), ['k', 'p'], 'a missing list starts from the default'); assert.deepEqual(t('junk', 'f'), ['k', 'f']);
  const frozen = Object.freeze(['k']); const out = t(frozen, 'p'); assert.deepEqual([...frozen], ['k']); assert.notStrictEqual(out, frozen);
  let cur = []; for (const k of [...ALL].reverse()) cur = t(cur, k); assert.deepEqual(cur, ALL, 'turning all on in any order gives the fixed order');
  for (const k of ALL) cur = t(cur, k); assert.deepEqual(cur, [], 'and all off gives []');
});

test('S6. dialModel is selection aware: selected (fixed order, [] allowed, default when missing), one ring for each of the six keys, rows for the four macros; the old fields are unchanged', () => {
  const m = withDials(['k']);
  assert.deepEqual(m.selected, ['k']); assert.deepEqual(Object.keys(m.rings), ALL);
  for (const k of ALL) assert.equal(m.rings[k].key, k);
  assert.deepEqual(m.rows.map(r => r.key), ['k', 'p', 'c', 'f']); assert.deepEqual(m.rows, m.nutrition.rings);
  assert.deepEqual(m.rings.k, m.nutrition.rings[0]); assert.deepEqual(m.rings.p, m.nutrition.rings[1]); assert.deepEqual(m.rings.c, m.nutrition.rings[2]); assert.deepEqual(m.rings.f, m.nutrition.rings[3]);
  assert.deepEqual(m.rings.steps, m.steps); assert.deepEqual(m.rings.sleep, m.sleep);
  assert.deepEqual(m.rows.map(r => r.text), ['800 / 2000 kcal', '80 / 150 g', '160 / 200 g', '40 / 65 g']);
  assert.equal(m.rings.steps.text, '6,120 / 10,000'); assert.equal(m.rings.sleep.text, '7 h 53 min / 8 h'); assert.deepEqual(m.nutrition.centre, { text: '1200', caption: 'kcal left' });
  assert.deepEqual(withDials(['sleep', 'p', 'k']).selected, ['k', 'p', 'sleep']); assert.deepEqual(withDials(ALL).selected, ALL); assert.deepEqual(withDials([]).selected, []);
  assert.deepEqual(Object.keys(withDials([]).rings), ALL, 'rings exist whatever is selected');
  for (const junk of [undefined, null, 'k', 5, {}, ['x', {}, 5]]) { const s = mk(); if (junk === undefined) delete s.dials; else s.dials = junk; const want = Array.isArray(junk) ? [] : ['k']; assert.deepEqual(dialModel(s, D).selected, want, JSON.stringify(junk)); }
  for (const s of [null, undefined, {}, 5, 'x', []]) assert.deepEqual(dialModel(s, D).selected, ['k'], 'state ' + JSON.stringify(s));
  const s = mk({ dials: ['k', 'p'] }), out = dialModel(s, D); out.selected.push('c'); assert.deepEqual(s.dials, ['k', 'p'], 'the model does not hand out the state array');
  const frozen = deepFreeze(mk({ dials: ['steps', 'k'] })), before = JSON.stringify(frozen); assert.deepEqual(dialModel(frozen, D).selected, ['k', 'steps']); assert.equal(JSON.stringify(frozen), before);
  clean(m); clean(withDials(['<img src=x onerror=1>', 'k', 'k']));
  const over = withDials(['p'], { entries: [entry(800, { k: 100, p: 20, c: 20, f: 5 })] }); assert.equal(over.rings.p.over, true); assert.equal(over.rings.p.label, 'Protein: 160 of 150 g, over goal');
  const none = withDials(['steps'], { activity: {} }); assert.equal(none.rings.steps.hasData, false); assert.equal(none.rings.steps.text, 'no data');
});

test('S7. choosing dials goes through touchSettings so sync timestamps it: the settings record carries dials and the new stamp', () => {
  const s = defaults(); s.dials = toggleDial(s.dials, 'steps'); touchSettings(s, 170);
  const rec = toRecords(s).find(r => r.key === 'settings');
  assert.deepEqual(rec.value.dials, ['k', 'steps']); assert.equal(rec.updatedAt, 170); assert.equal(rec.value.settingsUpdatedAt, 170);
  assert.deepEqual(rec.value.goals, defaults().goals, 'goals still travel in the same record');
  assert.doesNotThrow(() => toRecords({ ...defaults(), dials: undefined })); assert.doesNotThrow(() => toRecords({ ...defaults(), dials: 'x' }));
  const legacy = toRecords({ ...defaults(), dials: undefined }).find(r => r.key === 'settings').value; assert.ok(legacy.dials === undefined || Array.isArray(legacy.dials));
});

// ================================================================ sync and backup
const settingsRec = (goals, stamp, extra = {}) => ({ key: 'settings', value: { goals, weightUnit: 'g', useUSDA: true, useOFF: true, syncApiKey: false, settingsUpdatedAt: stamp, ...extra }, updatedAt: stamp });
const GOALS = { k: 1800, p: 100, c: 100, f: 50, steps: 10000, sleepH: 8 };

test('S8. sync: dials round trip through toRecords/applyRecords and two devices converge on the newer settings record in both orders (also on a tie)', () => {
  const s = defaults(); s.dials = ['p', 'sleep']; touchSettings(s, 170);
  assert.deepEqual(applyRecords(defaults(), clone(toRecords(s))).dials, ['p', 'sleep']);
  const emptyS = defaults(); emptyS.dials = []; touchSettings(emptyS, 171);
  assert.deepEqual(applyRecords({ ...defaults(), dials: ['k', 'f'] }, clone(toRecords(emptyS))).dials, [], 'an empty choice is a real choice and is applied');
  const a = { ...defaults(), settingsUpdatedAt: 100, dials: ['k'] }, b = { ...defaults(), settingsUpdatedAt: 200, dials: ['p', 'c'] };
  for (const [x, y] of [[a, b], [b, a]]) { const m = mergeStates(clone(x), clone(y)); assert.deepEqual(m.dials, ['p', 'c']); assert.equal(m.settingsUpdatedAt, 200); }
  assert.deepEqual(applyRecords(clone(a), [settingsRec(GOALS, 200, { dials: ['p', 'c'] })]).dials, ['p', 'c']);
  assert.deepEqual(applyRecords(clone(b), [settingsRec(GOALS, 100, { dials: ['k'] })]).dials, ['p', 'c'], 'an older record does not win');
  const t1 = { ...defaults(), settingsUpdatedAt: 300, dials: ['k', 'f'] }, t2 = { ...defaults(), settingsUpdatedAt: 300, dials: ['steps'] };
  assert.deepEqual(mergeStates(clone(t1), clone(t2)).dials, mergeStates(clone(t2), clone(t1)).dials, 'equal stamps: the same winner whichever side is local');
});

test('S9. sync: an old-device settings record (no dials) never resets this device\'s choice; a present but unusable dials value is ignored; usable ones are cleaned', () => {
  const local = { ...defaults(), settingsUpdatedAt: 50, dials: ['p', 'steps'] };
  const out = applyRecords(clone(local), [settingsRec({ k: 1800, p: 100, c: 100, f: 50 }, 100)]);
  assert.deepEqual(out.dials, ['p', 'steps'], 'old record without dials leaves the choice alone'); assert.equal(out.goals.k, 1800, 'and its goals are still applied'); assert.equal(out.settingsUpdatedAt, 100);
  const empty = applyRecords({ ...local, dials: [] }, [settingsRec(GOALS, 100)]); assert.deepEqual(empty.dials, [], 'an empty local choice is also left alone');
  for (const bad of ['x', 'k', null, 5, {}, true, { 0: 'k', length: 1 }]) assert.deepEqual(applyRecords(clone(local), [settingsRec(GOALS, 100, { dials: bad })]).dials, ['p', 'steps'], 'dials ' + JSON.stringify(bad));
  assert.deepEqual(applyRecords(clone(local), [settingsRec(GOALS, 100, { dials: ['steps', 'steps', 'zzz', 5, 'k', '__proto__'] })]).dials, ['k', 'steps']);
  assert.deepEqual(applyRecords(clone(local), [settingsRec(GOALS, 100, { dials: ['<img>', '"onerror="x'] })]).dials, []);
  const proto = applyRecords(clone(local), [{ key: 'settings', value: JSON.parse('{"goals":{"k":1,"p":1,"c":1,"f":1},"dials":["k"],"__proto__":{"dials":["f"],"polluted":1},"settingsUpdatedAt":100}'), updatedAt: 100 }]);
  assert.deepEqual(proto.dials, ['k']); assert.equal(({}).polluted, undefined); assert.equal(({}).dials, undefined);
  for (const bad of [null, 'x', 5, [], { goals: 'x' }]) assert.doesNotThrow(() => applyRecords(clone(local), [settingsRec(bad, 100)]));
});

test('S10. backup: a newer backup brings its dials, an older or untimestamped one keeps ours, a backup WITHOUT dials (before this feature) keeps ours even when newer; the saved JSON (what Backup exports) carries dials', () => {
  const local = { ...defaults(), settingsUpdatedAt: 100, dials: ['k', 'steps'] };
  const bk = (dials, stamp) => ({ ...clone(defaults()), goals: { ...defaults().goals, k: 1500 }, dials, settingsUpdatedAt: stamp });
  const newer = mergeRestore(clone(local), bk(['p', 'c'], 500)); assert.deepEqual(newer.dials, ['p', 'c']); assert.equal(newer.goals.k, 1500, 'the backup really won the settings');
  assert.deepEqual(mergeRestore(clone(local), bk(['sleep', 'p', 'sleep'], 500)).dials, ['p', 'sleep'], 'cleaned and ordered');
  assert.deepEqual(mergeRestore(clone(local), bk([], 500)).dials, [], 'an empty choice is restored as empty');
  for (const stamp of [50, 0]) assert.deepEqual(mergeRestore(clone(local), bk(['p', 'c'], stamp)).dials, ['k', 'steps'], 'stamp ' + stamp);
  const legacy = bk(undefined, 500); delete legacy.dials; legacy.schemaVersion = 11;
  const r = mergeRestore(clone(local), legacy); assert.equal(r.goals.k, 1500, 'the old backup won the settings'); assert.deepEqual(r.dials, ['k', 'steps'], 'but it does not reset the dial choice');
  const noVersion = clone(legacy); delete noVersion.schemaVersion; assert.deepEqual(mergeRestore(clone(local), noVersion).dials, ['k', 'steps']);
  for (const junk of ['x', null, 5, {}, true]) assert.deepEqual(mergeRestore(clone(local), bk(junk, 500)).dials, ['k', 'steps'], 'junk ' + JSON.stringify(junk));
  const st = fakeStorage(), s = createStore(st); s.state.dials = ['c', 'sleep']; s.save(); assert.deepEqual(JSON.parse(JSON.stringify(JSON.parse(st.m.get(STORAGE_KEY)))).dials, ['c', 'sleep']);
  assert.match(read('js/ui/settings-view.js'), /JSON\.stringify\(state\)/, 'Backup export is the whole state, so dials travel with it');
});

// ================================================================ ui strings
test('S11. dialsHtml default (calories only): one dial, four rows with "value / goal unit" text, pencil button, no edit panel; the clickable area opens the details', () => {
  const m = withDials(['k']), html = dialsHtml(m);
  assert.equal(typeof html, 'string'); assert.equal(count(html, 'data-dial="'), 1); assert.ok(divWith(html, 'data-dial="k"'), 'a calories dial');
  const dial = divWith(html, 'data-dial="k"');
  assert.match(dial, /<svg\b[^>]*\bviewBox="/); assert.ok(dial.includes('aria-label="Calories: 800 of 2000 kcal"')); assert.ok(dial.includes('1200')); assert.ok(dial.includes('kcal left'));
  assert.ok((dial.match(/<circle/g) || []).length <= 2, 'a single ring: a track and an arc');
  for (const [key, text, name] of [['k', '800 / 2000 kcal', 'Calories'], ['p', '80 / 150 g', 'Protein'], ['c', '160 / 200 g', 'Carbs'], ['f', '40 / 65 g', 'Fat']]) {
    const row = divWith(html, `data-row="${key}"`); assert.ok(row, 'row ' + key); assert.ok(row.includes(name), name); assert.ok(row.includes(text), text); assert.ok(/class="[^"]*\bbar\b/.test(row), 'bar in row ' + key);
  }
  assert.equal(count(html, 'data-row="'), 4); assert.equal(html.includes('id="dialsPanel"'), false, 'no edit panel unless editing');
  const open = divWith(html, 'id="dialsOpen"'); assert.ok(open, '#dialsOpen'); assert.match(open.slice(0, open.indexOf('>') + 1), /role="button"/); assert.match(open.slice(0, open.indexOf('>') + 1), /tabindex="0"/);
  assert.match(open.slice(0, open.indexOf('>') + 1), /aria-label="[^"]*Nutrition details[^"]*"/); assert.ok(open.includes('data-dial="k"') && open.includes('data-row="f"'), 'dial and rows are inside the clickable area');
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});

test('S12. dialsHtml: all six dials in the fixed order whatever the order of model.selected; each has a ring with label, name and value text', () => {
  const m = withDials(ALL); m.selected = ['sleep', 'f', 'steps', 'k', 'c', 'p'];   // hostile order: the UI must still draw k p c f steps sleep
  const html = dialsHtml(m), at = k => html.indexOf(`data-dial="${k}"`);
  assert.equal(count(html, 'data-dial="'), 6); for (let i = 1; i < ALL.length; i++) assert.ok(at(ALL[i - 1]) > -1 && at(ALL[i - 1]) < at(ALL[i]), `${ALL[i - 1]} before ${ALL[i]}`);
  const want = { k: ['Calories', 'Calories: 800 of 2000 kcal', '800 / 2000 kcal', 0.4, 'var(--kcal)'], p: ['Protein', 'Protein: 80 of 150 g', '80 / 150 g', 80 / 150, 'var(--p)'], c: ['Carbs', 'Carbs: 160 of 200 g', '160 / 200 g', 0.8, 'var(--c)'],
    f: ['Fat', 'Fat: 40 of 65 g', '40 / 65 g', 40 / 65, 'var(--f)'], steps: ['Steps', 'Steps: 6,120 of 10,000', '6,120 / 10,000', 0.612, 'var(--ring-steps)'], sleep: ['Sleep', 'Sleep: 7 h 53 min of 8 h', '7 h 53 min / 8 h', 473 / 480, 'var(--ring-sleep)'] };
  for (const k of ALL) {
    const [name, label, text, frac, colour] = want[k], el = divWith(html, `data-dial="${k}"`);
    assert.ok(el.includes(name), k + ' name'); assert.ok(el.includes(`aria-label="${label}"`), k + ' label'); assert.ok(el.includes(text), k + ' text'); assert.ok(el.includes(colour), k + ' colour');
    const r = Number(el.match(/<circle[^>]*class="ring-arc"[^>]*\br="([0-9.]+)"/)?.[1] ?? el.match(/<circle[^>]*\br="([0-9.]+)"[^>]*class="ring-arc"/)?.[1]);
    const dash = Number(el.match(/stroke-dasharray="([0-9.]+) /)?.[1]); assert.ok(r > 0 && Number.isFinite(dash), k + ' has an arc with a radius and a dash length');
    near(dash / (2 * Math.PI * r), frac, 0.005, k + ' fill');
  }
  assert.equal(html.includes('var(--over)'), false, 'nothing is over');
  assert.match(divWith(html, 'data-dial="k"'), /transform="rotate\(-90 /, 'starts at 12 o\'clock');
});

test('S13. dialsHtml with nothing selected: no dial area at all, the four rows and the pencil are still there; unselected dials are not drawn', () => {
  const none = dialsHtml(withDials([]));
  assert.equal(count(none, 'data-dial="'), 0); assert.doesNotMatch(none, /class="[^"]*\bdial-area\b/); assert.equal(count(none, 'data-row="'), 4); assert.ok(none.includes('id="dialsEdit"')); assert.ok(none.includes('id="dialsOpen"'));
  const some = dialsHtml(withDials(['p', 'steps']));
  assert.equal(count(some, 'data-dial="'), 2); assert.ok(some.includes('data-dial="p"') && some.includes('data-dial="steps"')); for (const k of ['k', 'c', 'f', 'sleep']) assert.equal(some.includes(`data-dial="${k}"`), false, k);
  assert.match(dialsHtml(withDials(['k'])), /class="[^"]*\bdial-area\b/, 'the area exists when something is selected');
  const nodata = dialsHtml(withDials(['steps', 'sleep'], { activity: {} }));
  assert.ok(nodata.includes('no data') && nodata.includes('aria-label="Steps: no data"') && nodata.includes('aria-label="Sleep: no data"')); assert.doesNotMatch(nodata, /NaN|Infinity/);
});

test('S14. dialsHtml rows: the bar fills in proportion in the macro colour; over goal gets the over class AND the words "over goal"; goal 0 gives an empty bar and no NaN', () => {
  const html = dialsHtml(withDials(['k'])), width = k => Number(divWith(html, `data-row="${k}"`).match(/width:\s*([0-9.]+)%/)?.[1]);
  // 800/2000 = 40 %, 80/150 = 53.33 %, 160/200 = 80 %, 40/65 = 61.54 %
  near(width('k'), 40, 0.5); near(width('p'), 53.333, 0.5); near(width('c'), 80, 0.5); near(width('f'), 61.538, 0.5);
  for (const [k, v] of [['k', 'kcal'], ['p', 'p'], ['c', 'c'], ['f', 'f']]) {
    const row = divWith(html, `data-row="${k}"`); assert.ok(row.includes(`background:var(--${v})`), k + ' uses its macro colour'); assert.doesNotMatch(row, /class="[^"]*\bbar\b[^"]*\bover\b/, k + ' not over'); assert.equal(row.includes('over goal'), false, k + ' not over');
  }
  // 2200 g: 2200 kcal, 220 P, 440 C, 110 F: all over; the bar is full and the text still keeps the real number
  const over = dialsHtml(withDials(['k'], { entries: [entry(2200)] }));
  for (const k of ['k', 'p', 'c', 'f']) {
    const row = divWith(over, `data-row="${k}"`); assert.match(row, /class="[^"]*\bbar\b[^"]*\bover\b[^"]*"/, k + ' over class'); assert.ok(row.includes('over goal'), k + ' says over goal in words');
    near(Number(row.match(/width:\s*([0-9.]+)%/)[1]), 100, 0.01); assert.equal(/background:var\(--(kcal|p|c|f)\)/.test(row), false, k + ': an over bar is not drawn in the macro colour');
  }
  assert.ok(divWith(over, 'data-row="k"').includes('2200 / 2000 kcal'));
  const one = dialsHtml(withDials(['k'], { entries: [entry(800, { k: 100, p: 20, c: 20, f: 5 })] }));   // only protein: 160 g > 150 g
  assert.ok(divWith(one, 'data-row="p"').includes('over goal')); for (const k of ['k', 'c', 'f']) assert.equal(divWith(one, `data-row="${k}"`).includes('over goal'), false, k);
  const exact = dialsHtml(withDials(['k'], { entries: [entry(2000)] })); assert.equal(divWith(exact, 'data-row="k"').includes('over goal'), false, 'exactly at the goal is not over');
  const zero = dialsHtml(withDials(['k'], { goals: { k: 0, p: 0, c: 0, f: 0 } }));
  const wide = divWith(zero, 'data-row="p"'); assert.equal(Number(wide.match(/width:\s*([0-9.]+)%/)?.[1] ?? 0), 0); assert.ok(wide.includes('80 g')); assert.doesNotMatch(zero, /NaN|Infinity|undefined/);
  assert.equal(count(dialsHtml(withDials([], { entries: [] })), 'over goal'), 0, 'an empty day is never over');
});

test('S15. dialsHtml edit mode: the pencil is a real labelled button OUTSIDE the clickable area; the panel has six labelled checkboxes reflecting the choice, and a Done button', () => {
  const calm = dialsHtml(withDials(['p', 'sleep']), false), editing = dialsHtml(withDials(['p', 'sleep']), true);
  for (const html of [calm, editing]) {
    const pencil = tagOf(html, 'dialsEdit'); assert.match(pencil, /^<button\b/); assert.match(pencil, /type="button"/); assert.match(pencil, /aria-label="Choose dials"/);
    const open = divWith(html, 'id="dialsOpen"'); assert.equal(open.includes('id="dialsEdit"'), false, 'the pencil is not inside the details button'); assert.equal(open.includes('dialsPanel'), false, 'nor is the panel');
    assert.equal(count(html, 'id="dialsEdit"'), 1);
  }
  assert.match(tagOf(calm, 'dialsEdit'), /aria-expanded="false"/); assert.match(tagOf(editing, 'dialsEdit'), /aria-expanded="true"/);
  assert.equal(calm.includes('id="dialsPanel"') || calm.includes('dialPick-') || calm.includes('id="dialsDone"'), false, 'no panel, checkboxes or Done when not editing');
  const panel = divWith(editing, 'id="dialsPanel"'); assert.ok(panel, '#dialsPanel');
  const names = { k: 'Calories', p: 'Protein', c: 'Carbs', f: 'Fat', steps: 'Steps', sleep: 'Sleep' };
  for (const k of ALL) {
    const input = tagOf(panel, 'dialPick-' + k); assert.match(input, /^<input\b/); assert.match(input, /type="checkbox"/);
    assert.equal(/\bchecked\b/.test(input), k === 'p' || k === 'sleep', 'checked state of ' + k);
    assert.match(panel, new RegExp(`<label[^>]*\\bfor="dialPick-${k}"[^>]*>\\s*${names[k]}\\s*</label>`), 'a real label for ' + k);
  }
  assert.equal(count(panel, 'type="checkbox"'), 6);
  const done = panel.match(/<button[^>]*id="dialsDone"[^>]*>\s*Done\s*<\/button>/); assert.ok(done, 'Done button'); assert.match(done[0], /type="button"/);
  const allOff = divWith(dialsHtml(withDials([]), true), 'id="dialsPanel"'); assert.equal(/\bchecked\b/.test(allOff), false, 'nothing ticked when nothing is selected');
});

const hostileModel = () => {
  const bad = '<img src=x onerror=alert(1)>', q = '"onmouseover="x', m = JSON.parse(JSON.stringify(withDials(ALL)));
  const all = [...m.rows, ...Object.values(m.rings), ...m.nutrition.rings, m.steps, m.sleep];
  for (const r of all) { r.key = r.key; r.name = bad; r.text = q + bad; r.label = q + bad; r.color = 'red" onload="x'; }
  m.nutrition.label = bad + q; m.nutrition.centre = { text: bad, caption: q };
  return m;
};

test('S16. dialsHtml is injection safe and never prints NaN: hostile strings, hostile numbers, hostile selection, hostile model', () => {
  for (const editing of [false, true]) {
    const html = dialsHtml(hostileModel(), editing);
    assert.doesNotMatch(html, /<img/i); assert.doesNotMatch(html, /<script/i); assert.doesNotMatch(html, /onmouseover="/); assert.doesNotMatch(html, /onload="/); assert.doesNotMatch(html, /onerror=alert\(1\)>/);
    assert.ok(html.includes('&lt;img'), 'the hostile text is shown escaped, not dropped silently');
  }
  const n = JSON.parse(JSON.stringify(withDials(ALL))), hostile = [NaN, Infinity, -Infinity, -1, 5, 'x', null, undefined, {}];
  const rs = [...n.rows, ...Object.values(n.rings), ...n.nutrition.rings, n.steps, n.sleep];
  rs.forEach((r, i) => { r.fraction = hostile[i % hostile.length]; r.value = hostile[(i + 3) % hostile.length]; r.goal = hostile[(i + 5) % hostile.length]; r.over = hostile[i % hostile.length]; });
  assert.doesNotMatch(dialsHtml(n, true), /NaN|Infinity|undefined/);
  const sel = withDials(ALL); sel.selected = ['__proto__', 'k', 'k', '<img src=x>', 5, null, {}, 'constructor', 'p'];
  const sh = dialsHtml(sel); assert.equal(count(sh, 'data-dial="k"'), 1); assert.equal(count(sh, 'data-dial="'), 2, 'only known keys, each once'); assert.doesNotMatch(sh, /<img/i);
  for (const x of [null, undefined, {}, 'x', 5, [], { nutrition: null }, { selected: ['k'] }, { selected: 'k', rows: 'x', rings: [] }, { rows: [null, 5, 'x'], rings: { k: null } }]) {
    for (const editing of [false, true, 'yes', undefined]) assert.equal(typeof dialsHtml(x, editing), 'string', 'does not throw on ' + JSON.stringify(x));
  }
  const noRows = dialsHtml({ selected: [], rows: [], rings: {} }); assert.ok(noRows.includes('id="dialsEdit"'), 'the pencil survives an empty model so the choice can always be changed');
});

// ================================================================ wiring (WEAK static checks)
test('S17. index.html: ONE card #dials (a plain card, not a button), no #summary, #activityLine still hidden and in place; the Settings goals fields are still there', () => {
  const html = read('index.html');
  assert.equal(count(html, 'id="dials"'), 1); assert.equal(count(html, 'id="summary"'), 0, '#summary must be gone'); assert.doesNotMatch(html, /id="summary"/);
  const dials = tagOf(html, 'dials'); assert.match(dials, /class="[^"]*\bcard\b/); assert.doesNotMatch(dials, /role="button"/, 'the card itself is not a button (it holds a real button)'); assert.doesNotMatch(dials, /tabindex/);
  const iv = html.indexOf('id="v-diary"'), id = html.indexOf('id="dials"'), ia = html.indexOf('id="activityLine"'), im = html.indexOf('id="meals"');
  assert.ok(iv > -1 && iv < id && id < ia && ia < im, 'order: #dials, #activityLine, #meals inside #v-diary');
  const line = tagOf(html, 'activityLine'); assert.match(line, /\bhidden\b/); assert.match(line, /class="[^"]*\bmuted\b/);
  for (const i of ['gK', 'gP', 'gC', 'gF', 'gSteps', 'gSleep']) assert.equal(count(html, `id="${i}"`), 1, '#' + i);
  assert.equal(count(html, 'id="dialsEdit"'), 0, 'the pencil is drawn by script, not hard-coded');
});

test('S18. diary.js and dials.js wiring: #summary is no longer rendered, the dials open the details, choosing dials uses toggleDial + touchSettings + save', () => {
  const diary = read('js/ui/diary.js'), dials = read('js/ui/dials.js'), both = diary + '\n' + dials;
  assert.doesNotMatch(diary, /#summary|id="summary"|\bsummary'\)/, 'diary.js no longer touches #summary'); assert.match(diary, /renderDials\(\)/); assert.match(diary, /#activityLine/); assert.match(diary, /From Google Health: /);
  for (const w of ['dialsOpen', 'dialsEdit', 'dialsDone', 'openDetails', 'Enter']) assert.ok(both.includes(w), w + ' appears in diary.js or dials.js');
  assert.match(dials, /import\s*\{[^}]*\btoggleDial\b[^}]*\}\s*from\s*'\.\.\/domain\/dials\.js'/); assert.match(dials, /import\s*\{[^}]*\btouchSettings\b[^}]*\}\s*from\s*'\.\.\/domain\/entries\.js'/);
  assert.match(dials, /touchSettings\(/); assert.match(dials, /\bsave\(/); assert.match(dials, /export function dialsHtml\b/); assert.match(dials, /export function renderDials\b/);
  assert.ok(!/\bstate\.settingsUpdatedAt\s*=/.test(dials), 'the stamp is set through touchSettings, never by hand');
});

test('S19. security (static): ui/dials.js writes HTML only from dialsHtml(), uses esc, no dangerous sinks; domain/dials.js stays pure with allowed imports', () => {
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const ui = strip(read('js/ui/dials.js'));
  assert.match(ui, /\besc\b/); assert.doesNotMatch(ui, /from\s+'\.\.\/services\//); assert.doesNotMatch(ui, /insertAdjacentHTML|document\.write|\beval\b|new Function|outerHTML\s*=/);
  for (const m of ui.matchAll(/\.innerHTML\s*=\s*([^;\n]+)/g)) assert.match(m[1], /dialsHtml\(/, 'innerHTML is assigned only from dialsHtml(): ' + m[1]);
  const dom = strip(read('js/domain/dials.js'));
  for (const m of dom.matchAll(/from\s+'([^']+)'/g)) assert.match(m[1], /^(\.\/[a-z0-9-]+\.js|\.\.\/core\/(constants|format|dates|schema)\.js)$/, 'domain/dials.js may not import ' + m[1]);
  assert.doesNotMatch(dom, /\b(document|window|localStorage|sessionStorage|fetch|navigator|globalThis)\b/, 'domain/dials.js must stay pure');
  for (const f of ['normalizeDials', 'toggleDial']) assert.match(dom, new RegExp('export (function|const) ' + f + '\\b'));
  const sch = strip(read('js/core/schema.js')); for (const f of ['DIAL_KEYS', 'DEFAULT_DIALS', 'sanitizeDials']) assert.match(sch, new RegExp('export (function|const) ' + f + '\\b'));
});

test('S20. shipping: both dials files still in SHELL, CACHE bumped above 62 (the value on this branch when written; never an exact number), decision D57 and architecture notes', () => {
  const sw = read('sw.js');
  const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL'))).matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const f of ['js/domain/dials.js', 'js/ui/dials.js', 'js/core/schema.js', 'index.html']) assert.ok(shell.includes(f), f + ' must be in SHELL');
  const cache = Number(sw.match(/const CACHE = 'macro-diary-v(\d+)'/)[1]); assert.ok(cache > 62, 'CACHE must be bumped above 62, is ' + cache);
  const dec = read('docs/DECISIONS.md'), at = dec.search(/^## D57\./m); assert.ok(at > -1, 'DECISIONS.md needs ## D57.');
  const sec = dec.slice(at, (dec.indexOf('\n## D', at + 5) + 1 || dec.length)); assert.match(sec, /dial/i); assert.match(sec, /\b12\b/); assert.match(sec, /default/i); assert.match(sec, /sync/i);
  assert.match(read('docs/ARCHITECTURE.md'), /dials\.js/);
});
