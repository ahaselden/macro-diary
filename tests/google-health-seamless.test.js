// Spec: docs/specs/google-health-seamless.md. Test-designer file, written BEFORE the implementation. All data is made up (the Client IDs and tokens cannot be real).
// N1-N5 default Client ID, N6-N9 pure staleness rules, N10-N12 device-only sync prefs, N13-N19 the quiet (silent) sign-in in createHealthSync.run,
// N20-N22 are WEAK source-text checks for index.html and the view (the headless checklist in the spec is the real UI test).
// The existing tests/google-health-sync.test.js must keep passing unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { defaults } from '../js/core/schema.js';
import { STORAGE_KEY } from '../js/core/constants.js';
import { SYNC_KEY } from '../js/services/sync/config.js';

const read = p => { assert.ok(existsSync(new URL('../' + p, import.meta.url)), 'missing file: ' + p); return readFileSync(new URL('../' + p, import.meta.url), 'utf8'); };
const D = () => import('../js/domain/google-health-api.js');
const S = () => import('../js/services/google-health-api.js');
const ID = '123456-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com';
const ID2 = '987654-zyxwvutsrqponmlkjihgfedcba.apps.googleusercontent.com';
const SECRET = 'GOCSPX-abcdefghij';
const TOKEN = 'ya29.test-token-abc';
const EMAIL = 'owner@example.com';
const SCOPE = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly https://www.googleapis.com/auth/googlehealth.sleep.readonly';
const L = (y, m, d, h = 0) => new Date(y, m - 1, d, h, 0, 0);
const NOW = L(2026, 11, 16, 12);
const HOUR = 3600000, MIN = 60000, DAY = 24 * HOUR;
const T0 = 1794848400000; // 2026-11-16T17:00:00Z, hand computed: 20773 days * 86400 s + 17 * 3600 s

const M = {
  empty: 'Enter a Client ID first.',
  secret: 'That looks like a client secret, which must never be pasted here. Use the Client ID, which ends in .apps.googleusercontent.com.',
  noSave: 'Could not save the Client ID on this device.',
  busy: 'A sync is already running.',
  script: 'Could not load Google sign-in. Check your connection and try again.',
  denied: 'Google did not allow access. While the app is in test mode, only accounts added as test users can sign in.',
  closed: 'The Google sign-in window was closed before it finished. Tap Sync Google Health to try again.',
  blocked: 'The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  origin: 'Google does not accept this web address for your Client ID. Add it under Authorized JavaScript origins in the Google Cloud console.',
  failed: 'Google sign-in failed.',
  noToken: 'Google sign-in did not return an access token.',
  notLinked: 'This Google account is not linked in the Google Health app yet. Open the app on your phone, sign in, then try again.',
  s401: 'Google rejected the sign-in. Tap Sync Google Health to sign in again.',
  s403: 'Google refused access to your health data. Check that both Health permissions were ticked on the consent screen and the Google Health API is enabled.',
  s429: 'Google says there were too many requests. Wait a minute and try again.',
  http: n => `Google Health answered with an error (HTTP ${n}). Try again later.`,
  network: 'Could not reach Google. Check your connection and try again.',
  unreadable: 'Google Health sent an answer this app could not read.',
};

const fakeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial)), log = [];
  return { m, log, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { log.push(['set', k, String(v)]); m.set(k, String(v)); }, removeItem: k => { log.push(['remove', k]); m.delete(k); } };
};
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };

// ================================================================ default Client ID (N1-N5)
test('N1. store with a default: get() is the saved ID if valid, else the default; usingDefault() is true only when the default is the source', async () => {
  const { createClientIdStore, CLIENT_ID_KEY } = await S();
  const a = createClientIdStore(fakeStorage(), ID);
  assert.equal(a.get(), ID); assert.equal(a.usingDefault(), true);
  const b = createClientIdStore(fakeStorage({ [CLIENT_ID_KEY]: ID2 }), ID);
  assert.equal(b.get(), ID2); assert.equal(b.usingDefault(), false, 'a saved ID wins over the default');
  const c = createClientIdStore(fakeStorage(), '');
  assert.equal(c.get(), ''); assert.equal(c.usingDefault(), false);
  const d = createClientIdStore(fakeStorage());
  assert.equal(d.get(), ''); assert.equal(d.usingDefault(), false);
  // a default with stray spaces is validated like any ID and returned trimmed
  const e = createClientIdStore(fakeStorage(), '  ' + ID + '\n');
  assert.equal(e.get(), ID); assert.equal(e.usingDefault(), true);
  // a saved value that is garbage does not count: the default is used
  for (const junk of [SECRET, 'hello', '<b>x</b>', '', '  ', JSON.stringify({ id: ID2 })]) {
    const f = createClientIdStore(fakeStorage({ [CLIENT_ID_KEY]: junk }), ID);
    assert.equal(f.get(), ID, JSON.stringify(junk)); assert.equal(f.usingDefault(), true, JSON.stringify(junk));
  }
  // storage that is missing or throws: the default still works
  for (const bad of [null, undefined, blocked]) {
    const g = createClientIdStore(bad, ID);
    assert.equal(g.get(), ID); assert.equal(g.usingDefault(), true);
    assert.equal(createClientIdStore(bad, '').usingDefault(), false);
  }
});

test('N2. a default that fails checkClientId is ignored: get() is "" (or the saved ID), usingDefault() false; never throws', async () => {
  const { createClientIdStore, CLIENT_ID_KEY } = await S();
  for (const bad of ['nope', SECRET, '   ', 5, null, undefined, {}, [], true, ID.replace('.apps', '.evil'), '<img src=x onerror=1>' + '.apps.googleusercontent.com', ID + ' ' + SECRET]) {
    const s = createClientIdStore(fakeStorage(), bad);
    assert.equal(s.get(), '', String(bad)); assert.equal(s.usingDefault(), false, String(bad));
    const t = createClientIdStore(fakeStorage({ [CLIENT_ID_KEY]: ID2 }), bad);
    assert.equal(t.get(), ID2, String(bad)); assert.equal(t.usingDefault(), false);
  }
});

test('N3. set / clear with a default: clear removes the device ID and get() falls back to the default; a secret is refused and nothing is written; the default is never written', async () => {
  const { createClientIdStore, CLIENT_ID_KEY } = await S();
  const st = fakeStorage(), s = createClientIdStore(st, ID);
  assert.equal(s.get(), ID); assert.equal(s.usingDefault(), true);
  assert.deepEqual(st.log, [], 'reading the default writes nothing');
  assert.deepEqual(s.set(SECRET), { ok: false, message: M.secret });
  assert.deepEqual(s.set('nope').ok, false); assert.deepEqual(s.set('').message, M.empty);
  assert.deepEqual(st.log, [], 'a refused text writes nothing, a secret is never stored');
  assert.equal(s.get(), ID, 'still the default after a refused set');
  assert.deepEqual(s.set('  ' + ID2 + ' '), { ok: true, id: ID2 });
  assert.equal(s.get(), ID2); assert.equal(s.usingDefault(), false);
  assert.deepEqual([...st.m.keys()], [CLIENT_ID_KEY]); assert.equal(st.m.get(CLIENT_ID_KEY), ID2);
  for (const v of st.m.values()) assert.notEqual(v, ID, 'the default is never written to storage');
  assert.equal(createClientIdStore(st, ID).get(), ID2, 'survives a reload');
  s.clear();
  assert.equal(s.get(), ID, 'clear restores the default'); assert.equal(s.usingDefault(), true);
  for (const v of st.m.values()) { assert.notEqual(v, ID2); assert.notEqual(v, ID); }
  assert.doesNotThrow(() => s.clear());
  assert.equal(s.get(), ID);
  // a store without a default: clear leaves nothing
  const n = createClientIdStore(st); n.set(ID2); n.clear(); assert.equal(n.get(), '');
  // set on a throwing storage still reports it
  assert.deepEqual(createClientIdStore(blocked, ID).set(ID2), { ok: false, message: M.noSave });
  assert.doesNotThrow(() => createClientIdStore(blocked, ID).clear());
});

test('N4. one-argument store: exactly the old behaviour (own key, set/get/clear, secret refused)', async () => {
  const { createClientIdStore, CLIENT_ID_KEY } = await S();
  assert.equal(CLIENT_ID_KEY, 'macrodiary.googleclient.v1');
  const st = fakeStorage(), c = createClientIdStore(st);
  assert.equal(c.get(), ''); assert.equal(c.usingDefault(), false);
  assert.deepEqual(c.set(ID), { ok: true, id: ID }); assert.equal(c.get(), ID); assert.equal(c.usingDefault(), false);
  assert.deepEqual(c.set(SECRET), { ok: false, message: M.secret }); assert.equal(c.get(), ID);
  c.clear(); assert.equal(c.get(), ''); assert.equal(c.usingDefault(), false);
});

test('N5. DEFAULT_CLIENT_ID is exported from the service, a string, and is "" or a valid Client ID (its value is not asserted); it is not a secret', async () => {
  const { DEFAULT_CLIENT_ID } = await S();
  const { checkClientId } = await D();
  assert.equal(typeof DEFAULT_CLIENT_ID, 'string');
  assert.ok(DEFAULT_CLIENT_ID === '' || checkClientId(DEFAULT_CLIENT_ID).ok === true, 'must be empty or pass checkClientId');
  assert.equal(/GOCSPX-/i.test(DEFAULT_CLIENT_ID), false);
});

// ================================================================ shouldAutoSync (N6, N7)
const base = (o = {}) => ({ enabled: true, hasClientId: true, lastSyncAt: T0 - 4 * HOUR, now: T0, ...o });

test('N6. shouldAutoSync is true only when enabled, an ID exists, a previous sync exists, and at least minHours (default 3) have passed (>=, boundary exact)', async () => {
  const { shouldAutoSync } = await D();
  assert.equal(shouldAutoSync(base()), true);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 3 * HOUR })), true, 'exactly 3 h is enough');
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 3 * HOUR + 1 })), false, '1 ms short');
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 2 * HOUR })), false);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 30 * DAY })), true);
  assert.equal(shouldAutoSync(base({ lastSyncAt: 1 })), true, 'a tiny positive stamp is a valid (very old) sync');
  // minHours
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - HOUR, minHours: 1 })), true);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - HOUR + 1, minHours: 1 })), false);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 5 * HOUR, minHours: 6 })), false);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 6 * HOUR, minHours: 6 })), true);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 90 * MIN, minHours: 1.5 })), true);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 89 * MIN, minHours: 1.5 })), false);
  // a bad minHours means the default 3: 2 h old is false, 4 h old is true
  for (const bad of [NaN, '2', '1', null, undefined, -1, Infinity, -Infinity, {}, [], true]) {
    assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 2 * HOUR, minHours: bad })), false, 'minHours ' + String(bad) + ' at 2 h');
    assert.equal(shouldAutoSync(base({ lastSyncAt: T0 - 4 * HOUR, minHours: bad })), true, 'minHours ' + String(bad) + ' at 4 h');
  }
});

test('N7. shouldAutoSync is false for: disabled, no ID, never synced (0 / missing), junk stamps, a stamp in the future, junk now; never throws', async () => {
  const { shouldAutoSync } = await D();
  assert.equal(shouldAutoSync(base({ enabled: false })), false);
  assert.equal(shouldAutoSync(base({ hasClientId: false })), false);
  assert.equal(shouldAutoSync(base({ enabled: false, hasClientId: false })), false);
  // falsy / missing flags are false (truthy non-boolean junk such as 1 or 'yes' is deliberately not tested: open question 6)
  for (const v of [undefined, null, 0, '', NaN]) {
    assert.equal(shouldAutoSync(base({ enabled: v })), false, 'enabled ' + String(v));
    assert.equal(shouldAutoSync(base({ hasClientId: v })), false, 'hasClientId ' + String(v));
  }
  // never synced on this device: the first sync is always an explicit tap
  for (const bad of [0, -0, -1, -5000, NaN, Infinity, -Infinity, '1000', String(T0 - 4 * HOUR), null, undefined, {}, [], true, [T0 - 4 * HOUR]]) {
    assert.equal(shouldAutoSync(base({ lastSyncAt: bad })), false, 'lastSyncAt ' + String(bad));
  }
  const noStamp = base(); delete noStamp.lastSyncAt; assert.equal(shouldAutoSync(noStamp), false);
  // the clock moved back: the stamp is in the future
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 + 1 })), false);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 + 100 * DAY })), false);
  assert.equal(shouldAutoSync(base({ lastSyncAt: T0 })), false, 'just synced');
  // junk now
  for (const bad of [NaN, undefined, null, '1794848400000', {}, [], Infinity, -Infinity, new Date(T0)]) assert.equal(shouldAutoSync(base({ now: bad })), false, 'now ' + String(bad));
  // junk arguments
  for (const bad of [undefined, null, 5, 'x', [], true, () => 1]) assert.equal(shouldAutoSync(bad), false, String(bad));
  assert.equal(shouldAutoSync(), false); assert.equal(shouldAutoSync({}), false);
  const boom = {}; for (const k of ['enabled', 'hasClientId', 'lastSyncAt', 'now', 'minHours']) Object.defineProperty(boom, k, { enumerable: true, get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => shouldAutoSync(boom)); assert.equal(shouldAutoSync(boom), false);
});

// ================================================================ syncAgoText (N8, N9)
test('N8. syncAgoText: fixed plain sentences, units floored, singular forms "a minute / an hour / a day"', async () => {
  const { syncAgoText } = await D();
  const ago = ms => syncAgoText(T0 - ms, T0);
  assert.equal(syncAgoText(T0, T0), 'Last synced just now');
  assert.equal(ago(1), 'Last synced just now');
  assert.equal(ago(59999), 'Last synced just now');
  assert.equal(ago(MIN), 'Last synced a minute ago');
  assert.equal(ago(2 * MIN - 1), 'Last synced a minute ago');
  assert.equal(ago(2 * MIN), 'Last synced 2 minutes ago');
  assert.equal(ago(5 * MIN), 'Last synced 5 minutes ago');
  assert.equal(ago(5 * MIN + 59999), 'Last synced 5 minutes ago');
  assert.equal(ago(59 * MIN), 'Last synced 59 minutes ago');
  assert.equal(ago(60 * MIN - 1), 'Last synced 59 minutes ago');
  assert.equal(ago(HOUR), 'Last synced an hour ago');
  assert.equal(ago(119 * MIN), 'Last synced an hour ago');
  assert.equal(ago(2 * HOUR), 'Last synced 2 hours ago');
  assert.equal(ago(3 * HOUR), 'Last synced 3 hours ago');
  assert.equal(ago(23 * HOUR + 59 * MIN), 'Last synced 23 hours ago');
  assert.equal(ago(DAY), 'Last synced a day ago');
  assert.equal(ago(47 * HOUR), 'Last synced a day ago');
  assert.equal(ago(2 * DAY), 'Last synced 2 days ago');
  assert.equal(ago(10 * DAY), 'Last synced 10 days ago');
  assert.equal(syncAgoText(1, 1e13), 'Last synced 115740 days ago', '(1e13 - 1) ms = 115740.74 days, floored');
});

test('N9. syncAgoText: "" for unknown, future or junk; never throws; the text is plain (no HTML, no NaN / undefined)', async () => {
  const { syncAgoText } = await D();
  for (const bad of [0, -1, NaN, Infinity, -Infinity, '1000', null, undefined, {}, [], true]) assert.equal(syncAgoText(bad, T0), '', 'lastSyncAt ' + String(bad));
  assert.equal(syncAgoText(T0 + 1, T0), '', 'future by 1 ms');
  assert.equal(syncAgoText(T0 + 5 * DAY, T0), '');
  for (const bad of [NaN, undefined, null, '1794848400000', {}, [], Infinity, -Infinity, 0, -5]) assert.equal(syncAgoText(T0 - HOUR, bad), '', 'now ' + String(bad));
  assert.equal(syncAgoText(), ''); assert.equal(syncAgoText(undefined, undefined), '');
  const hostile = '<img src=x onerror=window.__pwned=1>';
  assert.equal(syncAgoText(hostile, T0), ''); assert.equal(syncAgoText(T0 - HOUR, hostile), '');
  for (const ms of [0, 1, MIN, HOUR, DAY, 400 * DAY]) assert.doesNotMatch(syncAgoText(T0 - ms, T0), /[<>&]|NaN|undefined|null|\[object/);
});

// ================================================================ sync prefs (N10-N12)
test('N10. createSyncPrefs: own key (not state, not client id, not the sync key), defaults (0 / auto TRUE), round trip through a NEW instance, the two fields are independent', async () => {
  const { createSyncPrefs, SYNC_PREFS_KEY, CLIENT_ID_KEY } = await S();
  assert.equal(SYNC_PREFS_KEY, 'macrodiary.googlesync.v1');
  for (const other of [STORAGE_KEY, SYNC_KEY, CLIENT_ID_KEY]) assert.notEqual(SYNC_PREFS_KEY, other);
  const st = fakeStorage(), p = createSyncPrefs(st);
  assert.equal(p.getLastSyncAt(), 0); assert.equal(p.getAuto(), true, 'default is on when nothing is stored');
  assert.deepEqual(st.log, [], 'reading writes nothing');
  p.setLastSyncAt(T0);
  assert.equal(p.getLastSyncAt(), T0); assert.equal(p.getAuto(), true, 'setting the stamp does not change auto');
  p.setAuto(false);
  assert.equal(p.getAuto(), false); assert.equal(p.getLastSyncAt(), T0, 'setting auto does not erase the stamp');
  const q = createSyncPrefs(st);
  assert.equal(q.getLastSyncAt(), T0); assert.equal(q.getAuto(), false, 'survives a reload');
  q.setAuto(true); assert.equal(createSyncPrefs(st).getAuto(), true); assert.equal(createSyncPrefs(st).getLastSyncAt(), T0);
  q.setLastSyncAt(T0 + 5 * MIN); assert.equal(createSyncPrefs(st).getLastSyncAt(), T0 + 5 * MIN);
  assert.deepEqual([...st.m.keys()], [SYNC_PREFS_KEY], 'only the one key is ever written');
  assert.ok(st.log.every(e => e[1] === SYNC_PREFS_KEY));
  // auto false alone (no stamp yet) round-trips too
  const st2 = fakeStorage(); createSyncPrefs(st2).setAuto(false);
  assert.equal(createSyncPrefs(st2).getAuto(), false); assert.equal(createSyncPrefs(st2).getLastSyncAt(), 0);
});

test('N11. createSyncPrefs hostile storage and values: never throws, garbage reads as the defaults, junk is not stored, prototype keys are not data', async () => {
  const { createSyncPrefs, SYNC_PREFS_KEY } = await S();
  for (const bad of [null, undefined, blocked, {}, 5]) {
    let p; assert.doesNotThrow(() => { p = createSyncPrefs(bad); });
    assert.equal(p.getLastSyncAt(), 0); assert.equal(p.getAuto(), true);
    assert.doesNotThrow(() => { p.setLastSyncAt(T0); p.setAuto(false); });
  }
  // garbage in the stored value
  const raw = ['', 'not json at all', '{', 'null', '[]', '5', '"x"', 'true', '{}',
    JSON.stringify({ lastSyncAt: 'x', auto: 'no' }), JSON.stringify({ lastSyncAt: -5, auto: 0 }), JSON.stringify({ lastSyncAt: null, auto: null }),
    JSON.stringify({ lastSyncAt: '<img src=x onerror=window.__pwned=1>', auto: '<b>' }), JSON.stringify({ lastSyncAt: [T0], auto: [false] }), JSON.stringify({ lastSyncAt: { v: T0 }, auto: {} }),
    '{"__proto__":{"lastSyncAt":5,"auto":false}}', '{"constructor":{"auto":false}}'];
  for (const r of raw) {
    const p = createSyncPrefs(fakeStorage({ [SYNC_PREFS_KEY]: r }));
    assert.equal(p.getLastSyncAt(), 0, r); assert.equal(p.getAuto(), true, r);
  }
  // partly valid: a valid stamp with garbage auto and the reverse
  assert.equal(createSyncPrefs(fakeStorage({ [SYNC_PREFS_KEY]: JSON.stringify({ lastSyncAt: T0, auto: 'no' }) })).getLastSyncAt(), T0);
  assert.equal(createSyncPrefs(fakeStorage({ [SYNC_PREFS_KEY]: JSON.stringify({ lastSyncAt: T0, auto: 'no' }) })).getAuto(), true);
  assert.equal(createSyncPrefs(fakeStorage({ [SYNC_PREFS_KEY]: JSON.stringify({ lastSyncAt: 'x', auto: false }) })).getAuto(), false);
  assert.equal(createSyncPrefs(fakeStorage({ [SYNC_PREFS_KEY]: JSON.stringify({ lastSyncAt: 'x', auto: false }) })).getLastSyncAt(), 0);
  // the stored stamp must be a finite positive number (Infinity cannot be JSON, 1e999 parses to Infinity)
  assert.equal(createSyncPrefs(fakeStorage({ [SYNC_PREFS_KEY]: '{"lastSyncAt":1e999}' })).getLastSyncAt(), 0);
  // junk is not stored: the previous good value stays
  const st = fakeStorage(), p = createSyncPrefs(st);
  p.setLastSyncAt(T0); p.setAuto(false);
  for (const bad of [NaN, Infinity, -Infinity, 0, -1, '5', null, undefined, {}, [], true, '<b>']) p.setLastSyncAt(bad);
  for (const bad of ['false', 0, 1, null, undefined, {}, []]) p.setAuto(bad);
  assert.equal(p.getLastSyncAt(), T0); assert.equal(p.getAuto(), false);
  assert.equal(createSyncPrefs(st).getLastSyncAt(), T0);
  assert.equal(({}).lastSyncAt, undefined); assert.equal(({}).auto, undefined);
});

test('N12. sync prefs hold only the two fields: no token, no Client ID, no email, in no other key; the state defaults mention neither', async () => {
  const { createSyncPrefs, createClientIdStore, SYNC_PREFS_KEY } = await S();
  const st = fakeStorage();
  const p = createSyncPrefs(st);
  p.setLastSyncAt(T0); p.setAuto(true); p.setAuto(false);
  const text = JSON.stringify([...st.m.entries()]);
  for (const bad of [TOKEN, 'ya29', 'access_token', EMAIL, ID, 'googleusercontent', 'GOCSPX']) assert.equal(text.includes(bad), false, bad);
  assert.equal(st.m.size, 1);
  const v = st.m.get(SYNC_PREFS_KEY);
  assert.doesNotThrow(() => JSON.parse(v), 'the value is one JSON object');
  assert.deepEqual(Object.keys(JSON.parse(v)).sort(), ['auto', 'lastSyncAt']);
  // the Client ID store and the prefs use different keys and do not touch each other
  const cs = createClientIdStore(st, ID); cs.set(ID2); cs.clear();
  assert.equal(createSyncPrefs(st).getLastSyncAt(), T0);
  // not part of the saved diary data
  const d = JSON.stringify(defaults());
  assert.equal(/googlesync|lastSyncAt|syncAuto/i.test(d), false, 'no sync pref field in the saved defaults');
});

// ================================================================ silent sign-in (N13-N19)
const cdt = (y, m, d) => ({ date: { year: y, month: m, day: d }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } });
const pt = (y, m, d, count) => ({ civilStartTime: { date: { year: y, month: m, day: d }, time: {} }, civilEndTime: { date: { year: y, month: m, day: d }, time: {} }, ...(count === undefined ? {} : { steps: { countSum: count } }) });
const stepsAns = { rollupDataPoints: [pt(2026, 11, 16, '1226'), pt(2026, 11, 15, '2919'), pt(2026, 11, 14, '12921')] };
const sleepAns = { dataPoints: [
  { sleep: { interval: { startTime: '2026-11-14T03:30:00Z', startUtcOffset: '-18000s', endTime: '2026-11-14T11:30:00Z', endUtcOffset: '-18000s' }, summary: { minutesAsleep: '435' } } }], nextPageToken: '' };
const GOLD = { '2026-11-16': { steps: 1226 }, '2026-11-15': { steps: 2919 }, '2026-11-14': { steps: 12921, sleepMinutes: 435, sleepStart: '2026-11-14T03:30:00Z', sleepEnd: '2026-11-14T11:30:00Z' } };
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const R = (body, status = 200) => () => jsonRes(body, status);
// CHANGED for docs/specs/google-health-workouts.md: a third (exercise) request exists now; routes without an `exercise` entry answer with an empty list.
const kindOf = url => (url.includes('dailyRollUp') ? 'steps' : url.includes('dataTypes/sleep') ? 'sleep' : url.includes('dataTypes/exercise') ? 'exercise' : 'other');
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: String(init.method || 'GET').toUpperCase(), body: init.body, headers: init.headers });
    const kind = kindOf(String(url)), r = routes[kind] !== undefined ? routes[kind] : kind === 'exercise' ? () => jsonRes({ dataPoints: [] }) : undefined;
    const out = typeof r === 'function' ? r() : r;
    if (out instanceof Error) throw out;
    if (out === undefined) throw new Error('no route');
    return out;
  };
  f.calls = calls;
  return f;
}
const TOKEN_OK = { access_token: TOKEN, expires_in: 3599, scope: SCOPE, token_type: 'Bearer' };
/** A fake Google that ALSO captures the argument of requestAccessToken (the existing fake in google-health-sync.test.js captures only the init config). */
function capGoogle(script = {}) {
  const g = { inits: [], reqArgs: [], release: null };
  g.google = { accounts: { oauth2: { initTokenClient(cfg) {
    g.inits.push(cfg);
    if (script.initThrows) throw new Error('init ' + TOKEN + ' ' + EMAIL);
    return { requestAccessToken(...args) {
      g.reqArgs.push(args);
      if (script.requestThrows) throw new Error('request ' + TOKEN);
      const go = () => {
        if (script.errorCallback) cfg.error_callback(script.errorCallback);
        else cfg.callback(Object.hasOwn(script, 'callback') ? script.callback : TOKEN_OK);
      };
      if (script.hold) g.release = go; else setTimeout(go, 0);
    } };
  } } } };
  return g;
}
const happy = () => ({ steps: R(stepsAns), sleep: R(sleepAns) });
async function harness({ google = capGoogle(), routes = happy(), loadGoogle } = {}) {
  const { createHealthSync } = await S();
  const f = fakeFetch(routes);
  const sync = createHealthSync({ fetch: f, loadGoogle: async () => { if (loadGoogle) return loadGoogle(); return google.google; }, now: () => NOW });
  return { sync, f, google };
}
async function spyConsole(fn) {
  const calls = [], names = ['log', 'info', 'warn', 'error', 'debug', 'trace'], orig = {};
  for (const n of names) { orig[n] = console[n]; console[n] = (...a) => calls.push(a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); }
  try { await fn(); } finally { for (const n of names) console[n] = orig[n]; }
  return calls;
}

test('N13. run(id, { silent: true }) requests the token with prompt "none"; initTokenClient is otherwise identical to a normal run', async () => {
  const hs = await harness();
  const res = await hs.sync.run(ID, { silent: true });
  assert.equal(res.ok, true);
  assert.equal(hs.google.reqArgs.length, 1, 'one token request');
  const arg = hs.google.reqArgs[0][0];
  assert.ok(arg && typeof arg === 'object', 'requestAccessToken gets a config object');
  assert.equal(arg.prompt, 'none');
  const hn = await harness();
  assert.equal((await hn.sync.run(ID)).ok, true);
  // the init config: same client id, same scope, same callbacks, same keys (a prompt key, if any, is not what makes the difference)
  const a = hs.google.inits[0], b = hn.google.inits[0];
  assert.equal(a.client_id, ID); assert.equal(a.scope, SCOPE); assert.equal(b.client_id, ID); assert.equal(b.scope, SCOPE);
  assert.equal(typeof a.callback, 'function'); assert.equal(typeof a.error_callback, 'function');
  const keys = o => Object.keys(o).filter(k => k !== 'prompt').sort();
  assert.deepEqual(keys(a), keys(b));
  assert.notEqual(a.prompt, 'consent'); assert.notEqual(a.prompt, 'select_account');
});

test('N14. a normal run never asks for prompt "none": run(id), run(id, undefined), run(id, {}), run(id, { silent: false }) behave as before, failures carry no silent flag', async () => {
  for (const args of [[ID], [ID, undefined], [ID, {}], [ID, { silent: false }]]) {
    const h = await harness();
    assert.deepEqual(await h.sync.run(...args), { ok: true, days: GOLD }, JSON.stringify(args));
    const a = h.google.reqArgs[0][0];
    assert.notEqual(a && a.prompt, 'none', 'a tap must be allowed to show the sign-in: ' + JSON.stringify(args));
    assert.notEqual(h.google.inits[0].prompt, 'none');
    assert.equal(h.f.calls.length, 3);   // CHANGED for docs/specs/google-health-workouts.md: three requests per run now
    const g2 = capGoogle({ callback: { error: 'access_denied' } });
    const h2 = await harness({ google: g2 });
    assert.deepEqual(await h2.sync.run(...args), { ok: false, message: M.denied }, 'no silent key on a normal failure');
    const h3 = await harness({ google: capGoogle({ errorCallback: { type: 'popup_closed' } }) });
    assert.deepEqual(await h3.sync.run(...args), { ok: false, message: M.closed });
  }
  // an invalid ID is refused the same way in both modes, before anything loads
  const h = await harness();
  assert.deepEqual(await h.sync.run('', {}), { ok: false, message: M.empty });
  assert.deepEqual(await h.sync.run(SECRET, { silent: false }), { ok: false, message: M.secret });
  assert.equal(h.google.inits.length, 0);
});

test('N15. every sign-in failure in silent mode is { ok: false, silent: true, message } with today\'s fixed message, and no Health request is made', async () => {
  const cases = [
    ['interaction_required', { callback: { error: 'interaction_required' } }, 'Google sign-in failed (interaction_required).'],
    ['login_required', { callback: { error: 'login_required' } }, 'Google sign-in failed (login_required).'],
    ['consent_required', { callback: { error: 'consent_required' } }, 'Google sign-in failed (consent_required).'],
    ['access_denied', { callback: { error: 'access_denied', error_description: EMAIL } }, M.denied],
    ['origin_mismatch', { callback: { error: 'origin_mismatch' } }, M.origin],
    ['hostile code', { callback: { error: TOKEN } }, M.failed],
    ['popup_closed', { errorCallback: { type: 'popup_closed' } }, M.closed],
    ['popup_failed_to_open', { errorCallback: { type: 'popup_failed_to_open' } }, M.blocked],
    ['unknown error_callback type', { errorCallback: { type: 'unknown' } }, M.failed],
    ['init throws', { initThrows: true }, M.failed],
    ['requestAccessToken throws', { requestThrows: true }, M.failed],
    ['no token, no error', { callback: {} }, M.noToken],
    ['empty token', { callback: { access_token: '' } }, M.noToken],
    ['null response', { callback: null }, M.noToken],
    ['token and an error together', { callback: { access_token: TOKEN, error: 'access_denied' } }, M.denied],
  ];
  for (const [name, script, message] of cases) {
    const h = await harness({ google: capGoogle(script) });
    assert.deepEqual(await h.sync.run(ID, { silent: true }), { ok: false, silent: true, message }, name);
    assert.equal(h.f.calls.length, 0, name + ': no request');
  }
  for (const lg of [() => { throw new Error('offline'); }, () => Promise.reject(new Error('offline')), () => undefined, () => ({}), () => ({ accounts: {} }), () => ({ accounts: { oauth2: {} } })]) {
    const h = await harness({ loadGoogle: lg });
    assert.deepEqual(await h.sync.run(ID, { silent: true }), { ok: false, silent: true, message: M.script });
    assert.equal(h.f.calls.length, 0);
  }
});

test('N16. failures AFTER a token was obtained are reported exactly as today in silent mode: no silent flag (the UI must show them)', async () => {
  const ERR = (code, status, extra = {}) => ({ error: { code, message: 'text ' + TOKEN + ' ' + EMAIL, status, ...extra } });
  const NOT_LINKED = { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCOUNT_NOT_LINKED', domain: 'health.googleapis.com' }] };
  const cases = [
    ['401', () => jsonRes(ERR(401, 'UNAUTHENTICATED'), 401), M.s401],
    ['403', () => jsonRes(ERR(403, 'PERMISSION_DENIED'), 403), M.s403],
    ['429', () => jsonRes(ERR(429, 'RESOURCE_EXHAUSTED'), 429), M.s429],
    ['not linked', () => jsonRes(ERR(400, 'FAILED_PRECONDITION', NOT_LINKED), 400), M.notLinked],
    ['500', () => jsonRes(ERR(500, 'INTERNAL'), 500), M.http(500)],
    ['not JSON', () => new Response('<html>', { status: 200 }), M.unreadable],
    ['fetch rejects', () => new TypeError('Failed to fetch'), M.network],
  ];
  for (const [name, bad, message] of cases) {
    let h = await harness({ routes: { steps: bad, sleep: happy().sleep } });
    let res = await h.sync.run(ID, { silent: true });
    assert.deepEqual(res, { ok: false, message }, 'steps ' + name);
    assert.equal('silent' in res, false);
    h = await harness({ routes: { steps: happy().steps, sleep: bad } });
    res = await h.sync.run(ID, { silent: true });
    assert.deepEqual(res, { ok: false, message }, 'sleep ' + name);
    assert.equal('days' in res, false, 'all-or-nothing is unchanged');
  }
});

test('N17. a silent run that gets its token makes exactly the same two requests as a normal run and returns { ok: true, days } (no silent flag on success)', async () => {
  const hs = await harness(), hn = await harness();
  const rs = await hs.sync.run(ID, { silent: true }), rn = await hn.sync.run(ID);
  assert.deepEqual(rs, { ok: true, days: GOLD }); assert.deepEqual(rn, rs);
  assert.deepEqual(hs.f.calls.map(c => [c.method, c.url, c.body]), hn.f.calls.map(c => [c.method, c.url, c.body]));
  assert.equal(hs.f.calls.length, 3);   // CHANGED for docs/specs/google-health-workouts.md: three requests per run now
  assert.deepEqual(JSON.parse(hs.f.calls[0].body), { range: { start: cdt(2026, 11, 10), end: cdt(2026, 11, 17) }, windowSizeDays: 1 });
  for (const c of hs.f.calls) { const h = c.headers; assert.equal(new Headers(h).get('authorization'), 'Bearer ' + TOKEN); }
});

test('N18. silent runs share the one-at-a-time rule and release it after success and after failure', async () => {
  const g = capGoogle({ hold: true });
  const h = await harness({ google: g });
  const first = h.sync.run(ID, { silent: true });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(g.reqArgs.length, 1);
  for (const second of [await h.sync.run(ID, { silent: true }), await h.sync.run(ID)]) { assert.equal(second.ok, false); assert.equal(second.busy, true); }
  assert.equal(g.inits.length, 1, 'no second sign-in was started'); assert.equal(g.reqArgs.length, 1); assert.equal(h.f.calls.length, 0);
  g.release(); assert.equal((await first).ok, true);
  assert.equal(h.f.calls.length, 3);   // CHANGED for docs/specs/google-health-workouts.md: three requests per run now
  // released after a silent failure
  const g2 = capGoogle({ callback: { error: 'interaction_required' } }), h2 = await harness({ google: g2 });
  assert.equal((await h2.sync.run(ID, { silent: true })).silent, true);
  assert.equal((await h2.sync.run(ID, { silent: true })).silent, true);
  assert.equal(g2.inits.length, 2, 'a later run is not stuck behind the failed one');
  // a normal tap after a silent failure is a normal run (no prompt none)
  const g3 = capGoogle({ callback: { error: 'interaction_required' } }), h3 = await harness({ google: g3 });
  await h3.sync.run(ID, { silent: true }); await h3.sync.run(ID);
  assert.equal(g3.reqArgs[0][0].prompt, 'none'); assert.notEqual(g3.reqArgs[1][0] && g3.reqArgs[1][0].prompt, 'none');
});

test('N19. silent mode never leaks the token or an email (result, console, URLs, bodies), on success and on every failure', async () => {
  const hostile = { error: { code: 500, message: 'oops ' + TOKEN + ' ' + EMAIL, status: 'INTERNAL', details: [{ reason: TOKEN + EMAIL }] } };
  const scenarios = [
    {},
    { google: capGoogle({ callback: { error: 'interaction_required', error_description: EMAIL + ' ' + TOKEN } }) },
    { google: capGoogle({ errorCallback: { type: 'popup_failed_to_open', message: EMAIL + TOKEN } }) },
    { google: capGoogle({ initThrows: true }) },
    { google: capGoogle({ requestThrows: true }) },
    { routes: { steps: R(hostile, 401), sleep: happy().sleep } },
    { routes: { steps: happy().steps, sleep: () => new Response(TOKEN + EMAIL, { status: 200 }) } },
    { loadGoogle: () => { throw new Error('script ' + TOKEN + EMAIL); } },
  ];
  for (const [i, sc] of scenarios.entries()) {
    const h = await harness(sc);
    let res;
    const out = await spyConsole(async () => { res = await h.sync.run(ID, { silent: true }); });
    const seen = [JSON.stringify(res), ...out, ...h.f.calls.map(c => c.url + '|' + String(c.body || ''))];
    for (const s of seen) { assert.equal(s.includes(TOKEN), false, `scenario ${i}`); assert.equal(s.includes('ya29'), false); assert.equal(s.includes(EMAIL), false, `scenario ${i}: email`); }
    if (res.ok === false) assert.doesNotMatch(res.message, /undefined|NaN|\[object|ya29|@/);
  }
});

// ================================================================ static source checks (WEAK, N20-N22)
const code = p => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const tag = (src, id) => { const m = src.match(new RegExp('<[^>]*\\bid="' + id + '"[^>]*>')); assert.ok(m, 'missing #' + id); return m[0]; };
const count = (s, n) => s.split(n).length - 1;

test('N20. (weak) index.html: #ghSyncAuto checkbox with the exact label, #ghSyncLast, both inside the Google Health sync card; the existing ids and the hidden Diary button stay', () => {
  const html = read('index.html');
  assert.equal(count(html, 'id="ghSyncAuto"'), 1); assert.equal(count(html, 'id="ghSyncLast"'), 1);
  const start = html.indexOf('id="ghSyncCard"'), end = html.indexOf('id="syncCard"');
  assert.ok(start > -1 && end > start);
  const card = html.slice(start, end);
  assert.ok(card.includes('id="ghSyncAuto"') && card.includes('id="ghSyncLast"'), 'both live in the card');
  const box = tag(card, 'ghSyncAuto'); assert.match(box, /^<input\b/); assert.match(box, /type="checkbox"/);
  const text = card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('Sync when I open the app (if the last sync is over 3 hours old)'), 'exact label text');
  assert.match(card, /<label[^>]*for="ghSyncAuto"[^>]*>|<label[^>]*>(?:(?!<\/label>)[\s\S])*id="ghSyncAuto"/, 'the checkbox has a label (for= or wrapping)');
  assert.doesNotMatch(box, /\bchecked\b/, 'the checked state comes from the saved pref (default true is set by the view), not hard-coded markup');
  const last = tag(card, 'ghSyncLast'); assert.doesNotMatch(last, /^<(input|button)\b/);
  for (const id of ['ghSyncClientId', 'ghSyncSave', 'ghSyncRemove', 'ghSyncBtn', 'ghSyncStatus', 'ghSyncDiary']) assert.equal(count(html, `id="${id}"`), 1, '#' + id + ' still exactly once');
  assert.match(tag(html, 'ghSyncDiary'), /\bhidden\b/, 'the Diary button starts hidden; the view shows it when an ID is available');
});

test('N21. (weak) health-sync-view.js wiring: prefs, staleness rule, silent run, visibilitychange, status texts, textContent only, no token', () => {
  const ui = code('js/ui/health-sync-view.js');
  assert.match(ui, /createSyncPrefs\(/); assert.match(ui, /shouldAutoSync\(/); assert.match(ui, /syncAgoText\(/); assert.match(ui, /\.usingDefault\(/);
  assert.match(ui, /DEFAULT_CLIENT_ID/);
  assert.match(ui, /createClientIdStore\(\s*[^)]*DEFAULT_CLIENT_ID/, 'the default is handed to the store');
  assert.match(ui, /silent\s*:\s*true/); assert.match(ui, /visibilitychange/);
  assert.match(ui, /setLastSyncAt\(/); assert.match(ui, /getLastSyncAt\(/); assert.match(ui, /getAuto\(/); assert.match(ui, /setAuto\(/);
  for (const id of ['ghSyncAuto', 'ghSyncLast']) assert.ok(ui.includes(id), 'uses #' + id);
  for (const text of ['Using the built-in Client ID.', 'Using the Client ID saved on this device.', 'Client ID removed.', 'Client ID saved on this device.', 'Syncing with Google Health…']) assert.ok(ui.includes(text), 'text: ' + text);
  assert.match(ui, /textContent/);
  assert.doesNotMatch(ui, /\binnerHTML|outerHTML|insertAdjacentHTML|document\.write/, 'stored prefs and Google text are only ever written with textContent');
  assert.doesNotMatch(ui, /\bconsole\.(log|info|warn|error|debug|trace)\b/);
  assert.doesNotMatch(ui, /localStorage\s*\.|sessionStorage|access_token|accessToken|\.setItem\(|\.getItem\(/, 'storage goes through the injected store / prefs; no token here');
  const main = code('js/main.js');
  assert.doesNotMatch(main, /\bsilent\s*:|shouldAutoSync|\.run\(/, 'main.js only wires initHealthSync(); the auto-sync decision lives in the view');
});

test('N22. (weak) no saved-shape change and no secrets in shipped sources: STORAGE_KEY unchanged, prefs key literal present, no real-looking secret or token', () => {
  assert.equal(STORAGE_KEY, 'macrodiary.v1');
  const svc = code('js/services/google-health-api.js');
  assert.ok(svc.includes('macrodiary.googlesync.v1'));
  assert.match(svc, /export\s+(const|function)\s+DEFAULT_CLIENT_ID\b/); assert.match(svc, /export\s+function\s+createSyncPrefs\b/); assert.match(svc, /export\s+const\s+SYNC_PREFS_KEY\b/);
  assert.match(svc, /prompt\s*:\s*['"]none['"]/);
  assert.doesNotMatch(svc, /localStorage\s*\.\s*(getItem|setItem|removeItem)/, 'storage stays injected');
  const dom = code('js/domain/google-health-api.js');
  assert.match(dom, /export\s+function\s+shouldAutoSync\b/); assert.match(dom, /export\s+function\s+syncAgoText\b/);
  assert.doesNotMatch(dom, /\bDate\.now|\bnew Date\(\)|\bdocument\b|\blocalStorage\b/, 'the staleness rule takes `now` as an argument and stays pure');
  for (const p of ['js/domain/google-health-api.js', 'js/services/google-health-api.js', 'js/ui/health-sync-view.js', 'index.html'])
    assert.doesNotMatch(read(p), /GOCSPX-[A-Za-z0-9_-]{8,}|ya29\.[A-Za-z0-9_-]{8,}/, p + ': no secret or token');
});
