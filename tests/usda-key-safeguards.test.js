// USDA key safeguards (docs/specs/usda-key-safeguards.md). Test-designer file: written before the implementation.
// Expected values are hand-written from the spec, not computed by the code under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as schema from '../js/core/schema.js';
import { defaults } from '../js/core/schema.js';
import { mergeStates } from '../js/domain/merge.js';
import { toRecords, applyRecords } from '../js/domain/sync-records.js';
import { clone } from './helpers.js';

const A = 'abcdefghijklmnopqrstuvwxyz0123456789f3a9';   // 40 chars, ends f3a9
const B = 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210-_wxyz';  // 43 chars
const st = (over = {}) => ({ ...defaults(), ...over });
const settingsOf = s => toRecords(s).find(r => r.key === 'settings');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const rec = (value, updatedAt = 500) => ({ key: 'settings', value, updatedAt });
const remoteVal = (over = {}) => ({ goals: { k: 2000, p: 150, c: 200, f: 65 }, weightUnit: 'g', useUSDA: true, useOFF: true, settingsUpdatedAt: 500, ...over });

// ---------- predicates ----------
test('S1 isPlaceholderKey: empty, whitespace, DEMO_KEY in any case, non-strings', () => {
  for (const v of ['', '   ', 'DEMO_KEY', 'demo_key', ' Demo_Key ', undefined, null, 7, {}, []]) assert.equal(schema.isPlaceholderKey(v), true, String(v));
  for (const v of [A, 'abc', 'DEMO-KEY', 'DEMO_KEY2']) assert.equal(schema.isPlaceholderKey(v), false, v);
});

test('S2 isLegitKey: 20-200 chars of letters, digits, - and _ after trim; everything hostile is false', () => {
  for (const v of [A, B, 'a'.repeat(20), 'a'.repeat(200), 'abc-def_ghi-jkl_mno-pqr', '  ' + A + '  ']) assert.equal(schema.isLegitKey(v), true, v);
  const bad = ['a'.repeat(19), 'a'.repeat(201), 'DEMO_KEY', '', '   ', undefined, null, 7, {}, [A], true,
    A.slice(0, 10) + ' ' + A.slice(10), A + '.', A + '<', 'x'.repeat(20) + '\u0000' + 'y'.repeat(20), 'x'.repeat(20) + '\u0007' + 'y'.repeat(20),
    'x'.repeat(20) + '\n' + 'y'.repeat(20), 'A'.repeat(1e6), 'é'.repeat(30), '__proto__', '<img src=x onerror=1>'.repeat(3)];
  for (const v of bad) assert.equal(schema.isLegitKey(v), false, typeof v === 'string' ? JSON.stringify(v.slice(0, 40)) : String(v));
});

// ---------- merge ----------
const PLACEHOLDERS = [['empty', ''], ['demo', 'DEMO_KEY'], ['absent', undefined]];
const dev = (key, on, ts, extra = {}) => { const s = st({ syncApiKey: on, settingsUpdatedAt: ts, ...extra }); if (key === undefined) delete s.apiKey; else s.apiKey = key; return s; };

test('S3 local legit key survives a newer remote record that carries an empty/demo/absent key', () => {
  for (const [name, ph] of PLACEHOLDERS) {
    const local = dev(A, true, 100, { goals: { k: 1500, p: 1, c: 1, f: 1 } });
    const remote = dev(ph, true, 200, { goals: { k: 1234, p: 2, c: 2, f: 2 } });
    for (const m of [mergeStates(local, remote), mergeStates(remote, local)]) {
      assert.equal(m.apiKey, A, name);
      assert.equal(m.settingsUpdatedAt, 200); assert.equal(m.syncApiKey, true); assert.equal(m.goals.k, 1234, 'other settings still follow the winner');
    }
    // also when local is the newer one
    assert.equal(mergeStates(dev(A, true, 300), remote).apiKey, A, name);
    assert.equal(mergeStates(dev(A, false, 300), remote).apiKey, A, name);
  }
});

test('S4 local empty/demo/absent key takes a legit remote key whichever record is newer; flag still follows last-writer-wins', () => {
  for (const [name, ph] of PLACEHOLDERS) {
    for (const localOn of [true, false]) {
      const remoteNewer = mergeStates(dev(ph, localOn, 100), dev(A, true, 200));
      assert.equal(remoteNewer.apiKey, A, name + ' remote newer'); assert.equal(remoteNewer.syncApiKey, true);
      const localNewer = mergeStates(dev(ph, localOn, 300), dev(A, true, 200));
      assert.equal(localNewer.apiKey, A, name + ' local newer'); assert.equal(localNewer.syncApiKey, localOn, 'flag is the winner\'s (local), not forced on by the key');
      assert.equal(localNewer.settingsUpdatedAt, 300);
    }
  }
});

test('S5 a legit remote key whose switch is OFF is never adopted', () => {
  for (const [name, ph] of PLACEHOLDERS) {
    const m = mergeStates(dev(ph, true, 100), dev(A, false, 200));
    assert.notEqual(m.apiKey, A, name); assert.ok(!m.apiKey || m.apiKey === 'DEMO_KEY', name);
  }
});

test('S6 two different legit keys, both switches on: last writer wins, same in both orders, ties converge', () => {
  const older = dev(A, true, 100), newer = dev(B, true, 200);
  assert.equal(mergeStates(older, newer).apiKey, B); assert.equal(mergeStates(newer, older).apiKey, B);
  const t1 = dev(A, true, 100), t2 = dev(B, true, 100);
  assert.equal(mergeStates(t1, t2).apiKey, mergeStates(t2, t1).apiKey);
  assert.ok([A, B].includes(mergeStates(t1, t2).apiKey));
});

test('S7 matrix: {empty, DEMO_KEY, A, B, absent} x {on, off} on both sides x {older, newer, equal}', () => {
  const keys = ['', 'DEMO_KEY', A, B, undefined], LEGIT = [A, B];
  let n = 0;
  for (const kl of keys) for (const kr of keys) for (const onl of [true, false]) for (const onr of [true, false]) for (const [tl, tr] of [[100, 200], [200, 100], [100, 100]]) {
    const L = dev(kl, onl, tl), R = dev(kr, onr, tr), label = `${kl}|${onl}|${tl} vs ${kr}|${onr}|${tr}`;
    for (const [x, y] of [[L, R], [R, L]]) {
      const m = mergeStates(x, y);
      const offeredRemote = y.syncApiKey === true ? y.apiKey : undefined;
      assert.ok(m.apiKey === x.apiKey || m.apiKey === offeredRemote, 'result must be local key or an offered remote key: ' + label);
      const offered = [x.apiKey, offeredRemote];
      const legit = offered.filter(k => LEGIT.includes(k)), ph = offered.filter(k => !LEGIT.includes(k));
      if (legit.length) assert.ok(LEGIT.includes(m.apiKey), 'a legit offered key must not be lost: ' + label);
      if (legit.length === 1 && ph.length === 1) assert.equal(m.apiKey, legit[0], 'single legit key wins: ' + label);
    }
    if (onl && onr) assert.equal(mergeStates(L, R).apiKey, mergeStates(R, L).apiKey, 'both switches on must commute: ' + label);
    n++;
  }
  assert.equal(n, 5 * 5 * 4 * 3);
});

test('S7b documented non-commutative case: legit key on a switch-off device vs placeholder on a switch-on device, each keeps its own', () => {
  const off = dev(A, false, 100), on = dev('', true, 200);
  assert.equal(mergeStates(off, on).apiKey, A);   // off device is local: keeps its key, nothing offered by the other side
  assert.equal(mergeStates(on, off).apiKey, '');  // on device is local: remote switch off, so its key is not offered
});

// ---------- toRecords ----------
test('S11 toRecords omits a placeholder key even with the switch on; real and short keys travel; switch off never', () => {
  for (const k of ['', '   ', 'DEMO_KEY', 'demo_key']) {
    const v = settingsOf(st({ apiKey: k, syncApiKey: true, settingsUpdatedAt: 9 })).value;
    assert.equal('apiKey' in v, false, JSON.stringify(k)); assert.equal(v.syncApiKey, true);
  }
  assert.equal(settingsOf(st({ apiKey: A, syncApiKey: true })).value.apiKey, A);
  assert.equal(settingsOf(st({ apiKey: 'abc', syncApiKey: true })).value.apiKey, 'abc');
  assert.equal('apiKey' in settingsOf(st({ apiKey: A, syncApiKey: false })).value, false);
  assert.ok(!JSON.stringify(toRecords(st({ apiKey: A, syncApiKey: false }))).includes(A));
});

// ---------- end to end ----------
test('S12 through records: an empty device gets the key; a keyed device is not wiped by an empty/demo device', () => {
  const keyed = st({ apiKey: A, syncApiKey: true, settingsUpdatedAt: 200 });
  const empty = st({ apiKey: '', syncApiKey: true, settingsUpdatedAt: 300 });
  const a = applyRecords(empty, clone(toRecords(keyed)));          // (a) empty device is the newer one
  assert.equal(a.apiKey, A); assert.equal(a.syncApiKey, true);
  for (const ph of ['', 'DEMO_KEY']) {
    const phDev = st({ apiKey: ph, syncApiKey: true, settingsUpdatedAt: 300 });
    const recs = clone(toRecords(phDev));
    assert.equal('apiKey' in recs.find(r => r.key === 'settings').value, false);   // (c)
    const b = applyRecords(keyed, recs);                            // (b) newer record from a placeholder device
    assert.equal(b.apiKey, A); assert.equal(b.settingsUpdatedAt, 300);
    assert.equal(settingsOf(b).value.apiKey, A);
  }
});

test('S13 hostile remote values never replace a legit local key and never throw', () => {
  const junk = [7, NaN, null, true, {}, [], [A], 'x'.repeat(5), '<img src=x onerror=1>', 'x'.repeat(20) + '\u0000' + 'y'.repeat(20), '', 'DEMO_KEY', '__proto__'];
  for (const j of junk) {
    const local = st({ apiKey: A, syncApiKey: true, settingsUpdatedAt: 1 });
    let r;
    assert.doesNotThrow(() => { r = applyRecords(local, [rec(remoteVal({ syncApiKey: true, apiKey: j, settingsUpdatedAt: 500 }))]); });
    if (typeof j !== 'string' || j === '' || j === 'DEMO_KEY') assert.equal(r.apiKey, A, 'placeholder/non-string must not replace: ' + String(j));
    assert.equal(typeof r.apiKey, 'string');
  }
  const proto = JSON.parse('{"__proto__":{"polluted":1},"syncApiKey":true,"apiKey":"' + A + '","goals":{},"weightUnit":"g","useUSDA":true,"useOFF":true,"settingsUpdatedAt":500}');
  const r = applyRecords(st({ settingsUpdatedAt: 1 }), [{ key: 'settings', value: proto, updatedAt: 500 }]);
  assert.equal(({}).polluted, undefined); assert.equal(r.apiKey, A);
});

// ---------- apiKeySummary (new pure module) ----------
const summary = async k => (await import('../js/domain/api-key.js')).apiKeySummary(k);

test('S8 summary: not set', async () => {
  for (const k of ['', '   ', undefined, null, 7, {}]) assert.equal(await summary(k), 'USDA key: not set', String(k));
});

test('S9 summary: demo key in any case', async () => {
  for (const k of ['DEMO_KEY', 'demo_key', ' Demo_Key ']) assert.equal(await summary(k), 'USDA key: using the shared demo key', k);
});

test('S10 summary: last 4 characters at most, nothing for short keys, hostile input', async () => {
  assert.equal(await summary(A), 'USDA key: set (ends …f3a9)');
  assert.equal(await summary('  ' + A + '  '), 'USDA key: set (ends …f3a9)');
  assert.equal(await summary('abcdefghijkl'), 'USDA key: set (ends …ijkl)');         // exactly 12 characters
  assert.equal(await summary('abcdefghijk'), 'USDA key: set');                           // 11 characters: nothing shown
  assert.equal(await summary('abc123'), 'USDA key: set');
  const line = await summary(A);
  assert.ok(!line.includes('hijkl') && !line.includes(A.slice(0, 30)), 'only the last 4 characters may appear');
  assert.equal(await summary('x'.repeat(20) + '\u0000\u0007ab'), 'USDA key: set (ends …xxab)');   // control chars removed first
  const huge = await summary('Q'.repeat(1e6));
  assert.ok(huge.length < 60); assert.equal(huge, 'USDA key: set (ends …QQQQ)');
  assert.equal(await summary('<img src=x onerror=window.__x=1>'), 'USDA key: set (ends …x=1>)');   // returned raw; the UI uses textContent
});

// ---------- UI source (WEAK: proves structure and wiring exist; the browser checklist C1-C15 proves behaviour) ----------
test('S14 UI source: collapsed structure in index.html, Edit/Save/Cancel wiring in settings-view.js, shipped in sw.js', () => {
  const html = read('../index.html'), view = read('../js/ui/settings-view.js'), sw = read('../sw.js');
  const tag = id => { const m = html.match(new RegExp('<[^>]*id="' + id + '"[^>]*>')); assert.ok(m, 'missing #' + id); return m[0]; };
  const edit = tag('keyEdit');
  assert.match(edit, /^<button/); assert.match(edit, /type="button"/); assert.match(edit, /aria-expanded="false"/); assert.match(edit, /aria-controls="keyEditor"/);
  assert.match(html, /id="keyEdit"[^>]*>\s*Edit\s*</);
  assert.match(tag('keyEditor'), /\bhidden\b/);
  for (const [id, text] of [['keySave', 'Save'], ['keyCancel', 'Cancel']]) {
    assert.match(tag(id), /^<button/); assert.match(tag(id), /type="button"/);
    assert.match(html, new RegExp('id="' + id + '"[^>]*>\\s*' + text + '\\s*<'));
  }
  tag('keyLine');
  const pos = id => html.indexOf('id="' + id + '"');
  assert.ok(pos('keyLine') < pos('keyEditor') && pos('keyEdit') < pos('keyEditor'), 'line and Edit sit outside and before the editor');
  assert.ok(pos('keyEditor') < pos('apiKey') && pos('apiKey') < pos('syncApiKey') && pos('syncApiKey') < pos('keySave') && pos('keySave') < pos('keyCancel') && pos('keyCancel') < pos('syncCard'), 'inputs and buttons inside the editor, before #syncCard');
  assert.ok(html.indexOf('keyEditor') > html.indexOf('Food databases'));
  assert.ok(html.includes('Sync my USDA key to my other devices') && html.includes('The key is stored in your sync account, readable only by you.'));
  assert.ok(html.includes('The built-in DEMO_KEY is heavily rate-limited'));
  // the all-fields change listener no longer includes the key or the switch
  const list = view.match(/\[([^\]]*)\]\s*\.forEach/);
  assert.ok(list, 'selector list not found');
  assert.doesNotMatch(list[1], /apiKey/i); assert.doesNotMatch(list[1], /syncApiKey/);
  for (const s of ['#keyEdit', '#keySave', '#keyCancel', '#keyLine', 'aria-expanded']) assert.ok(view.includes(s), s + ' not referenced');
  assert.ok((view.match(/\.focus\(\)/g) || []).length >= 2, 'focus moves on Edit and back on Save/Cancel');
  assert.match(view, /api-key\.js/); assert.match(view, /apiKeySummary/);
  assert.match(view, /keyLine[^\n;]*\.textContent|textContent[^\n;]*apiKeySummary/);
  assert.doesNotMatch(view, /innerHTML[^\n;]*(apiKey|keyLine)/);
  assert.equal((view.match(/state\.apiKey\s*=[^=]/g) || []).length, 1, 'the key is assigned in exactly one place (Save)');
  assert.equal((view.match(/state\.syncApiKey\s*=[^=]/g) || []).length, 1, 'the switch is assigned in exactly one place (Save)');
  assert.match(sw, /api-key\.js/);
});
