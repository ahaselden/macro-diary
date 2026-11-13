// Sync on launch (docs/specs/sync-on-launch.md). Service-level tests with a fake clock; nothing touches the network.
// Tests titled R<n> are REGRESSION GUARDS / characterisation of today's code and pass before the feature is built.
// Tests titled L<n> need the new `launch()` method, the `maxWaitMs` option and the `onLaunchFailure` option and must FAIL until they exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSyncService } from '../js/services/sync/index.js';
import { createSyncConfig, SYNC_KEY } from '../js/services/sync/config.js';
import { createMemoryAdapter } from '../js/services/sync/memory-adapter.js';
import { defaults } from '../js/core/schema.js';

const NO_DEFAULT = { url: '', anonKey: '' };
const jwt = role => `h.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.s`;
const ANON = jwt('anon') + 'x'.repeat(20);
const DEFAULT_PROJECT = { url: 'https://builtin.supabase.co', anonKey: ANON };
const SESSION = { access_token: 'a', refresh_token: 'r', expires_at: 4102444800 };   // year 2100 (seconds)

const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

// A hand-driven clock: setTimer/clearTimer/now are injected into the service, advance(ms) fires due timers in order.
function clock() {
  let t = 0, id = 0; const q = [];
  return {
    get t() { return t; }, now: () => t,
    setTimer: (fn, ms) => { q.push({ id: ++id, at: t + ms, fn }); return id; },
    clearTimer: i => { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); },
    pending: () => q.length,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = q.filter(x => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!next) break;
        q.splice(q.indexOf(next), 1); t = Math.max(t, next.at); next.fn(); await flush();
      }
      t = end; await flush();
    },
  };
}

function setup({ cfg = {}, withDefault = false, own = true, server = createMemoryAdapter(), maxWaitMs, adapter } = {}) {
  const config = createSyncConfig(store());
  config.set({ email: 'me@x.y', session: SESSION, ...(own ? { url: 'https://abc.supabase.co', anonKey: ANON } : {}), ...cfg });
  const clk = clock(); const statuses = []; const failures = []; const log = { pulls: 0 }; let current = defaults();
  const svc = createSyncService({
    config, getState: () => current, applyState: s => { current = s; }, onStatus: s => statuses.push(s),
    adapterFactory: () => adapter || { pull: c => { log.pulls++; return server.pull(c); }, push: r => server.push(r) },
    defaults: withDefault ? DEFAULT_PROJECT : NO_DEFAULT, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer,
    onLaunchFailure: e => failures.push(e),
    ...(maxWaitMs ? { maxWaitMs } : {}),
  });
  return { svc, config, clk, statuses, failures, log, server };
}

// ---------- regression guards (pass today) ----------

test('R1 [regression] schedule(1500) with the built-in project, auto never set, runs one sync and records lastSyncAt', async () => {
  const s = setup({ own: false, withDefault: true });
  assert.equal(s.config.get().auto, undefined);
  s.svc.schedule(1500);
  await s.clk.advance(1499); assert.equal(s.log.pulls, 0);
  await s.clk.advance(1); assert.equal(s.log.pulls, 1);
  assert.equal(s.svc.status().state, 'idle'); assert.equal(s.svc.status().lastSyncAt, 1500);
});

test('R2 [regression] auto undefined and true count as on, false as off, for schedule()', async () => {
  for (const [auto, expectTimer] of [[undefined, true], [true, true], [false, false]]) {
    const s = setup({ cfg: auto === undefined ? {} : { auto } });
    s.svc.schedule(1500); assert.equal(s.clk.pending(), expectTimer ? 1 : 0, `auto=${auto}`);
  }
});

test('R3 [characterisation] a later plain schedule() postpones an earlier pending one (why launch needs its own timer)', async () => {
  const s = setup();
  s.svc.schedule(1500);
  await s.clk.advance(500); s.svc.schedule();            // a diary:changed event: default 4 s debounce
  await s.clk.advance(2000); assert.equal(s.log.pulls, 0);   // the 1.5 s launch sync has been pushed past t=2 s
});

test('R4 [regression] an expired access token is refreshed before the request, and the new session is stored', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init && init.headers && init.headers.Authorization });
    const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (/grant_type=refresh_token/.test(url)) return ok({ access_token: 'new', refresh_token: 'r2', expires_in: 3600 });
    if (/rpc\/push_record/.test(url)) return ok([{ accepted: true, rev: 1 }]);
    return ok([]);
  };
  const config = createSyncConfig(store());
  config.set({ url: 'https://abc.supabase.co', anonKey: ANON, email: 'me@x.y', session: { access_token: 'old', refresh_token: 'r1', expires_at: 1 } });
  const svc = createSyncService({ config, getState: defaults, applyState() {}, fetchImpl, defaults: NO_DEFAULT });
  const r = await svc.syncNow();
  assert.equal(r.ok, true);
  assert.match(calls[0].url, /grant_type=refresh_token/);                 // refresh first, not a failing request first
  assert.ok(calls.slice(1).length > 0 && calls.slice(1).every(c => c.auth === 'Bearer new'));
  assert.equal(config.get().session.refresh_token, 'r2');
});

test('R5 [regression] after a failed sync the error is in status() and the next online/visible schedule(1000) recovers', async () => {
  const s = setup(); s.server.failNext(new Error('offline'));
  await s.svc.syncNow();
  assert.equal(s.svc.status().state, 'error'); assert.match(s.svc.status().error, /offline/); assert.equal(s.svc.status().lastSyncAt, 0);
  s.svc.schedule(1000); await s.clk.advance(1000);
  assert.equal(s.svc.status().state, 'idle'); assert.ok(s.svc.status().lastSyncAt > 0);
});

// ---------- new behaviour (must fail until implemented) ----------

test('L1 launch(): signed in, own project, auto true: no sync at once, exactly one within 2 s, lastSyncAt set', async () => {
  const s = setup({ cfg: { auto: true } });
  s.svc.launch();
  await s.clk.advance(0); assert.equal(s.log.pulls, 0);
  await s.clk.advance(2000); assert.equal(s.log.pulls, 1);
  assert.equal(s.svc.status().state, 'idle'); assert.ok(s.svc.status().lastSyncAt > 0 && s.svc.status().lastSyncAt <= 2000);
  await s.clk.advance(60000); assert.equal(s.log.pulls, 1);              // and not again on its own
});

test('L2 launch(): built-in project with auto never set counts as on', async () => {
  const s = setup({ own: false, withDefault: true });
  s.svc.launch(); await s.clk.advance(2000);
  assert.equal(s.log.pulls, 1);
});

test('L3 launch(): auto false runs nothing; the manual sync still works', async () => {
  const s = setup({ cfg: { auto: false } });
  s.svc.launch(); assert.equal(s.clk.pending(), 0);
  await s.clk.advance(60000); assert.equal(s.log.pulls, 0);
  assert.equal((await s.svc.syncNow()).ok, true); assert.equal(s.log.pulls, 1);
});

test('L4 launch(): not signed in, or nothing configured, schedules nothing and does not throw', async () => {
  const out = setup({ cfg: { session: null } }); out.svc.launch(); assert.equal(out.clk.pending(), 0);
  await out.clk.advance(5000); assert.equal(out.log.pulls, 0); assert.equal(out.svc.status().state, 'signed-out');
  const none = setup({ own: false, cfg: { session: null } }); none.svc.launch(); assert.equal(none.clk.pending(), 0);
  assert.equal(none.svc.status().state, 'unconfigured');
});

test('L5 launch(): later diary/plan change events (schedule() 4 s debounce) do not postpone the launch sync past 2 s', async () => {
  const s = setup();
  s.svc.launch();
  await s.clk.advance(300); s.svc.schedule();
  await s.clk.advance(300); s.svc.schedule();
  await s.clk.advance(1400);                                              // t = 2000
  assert.ok(s.log.pulls >= 1, 'a sync must have started by 2 s');
});

test('L6 launch(): called twice still starts one sync', async () => {
  const s = setup(); s.svc.launch(); s.svc.launch();
  await s.clk.advance(5000); assert.equal(s.log.pulls, 1);
});

test('L7 launch(): auto switched off before the timer fires cancels it', async () => {
  const s = setup(); s.svc.launch();
  await s.clk.advance(500); s.svc.setAuto(false);
  await s.clk.advance(5000); assert.equal(s.log.pulls, 0);
});

test('L8 launch(): the app resuming (schedule(1000)) while the launch sync is pending does not make two syncs', async () => {
  const s = setup(); s.svc.launch();
  await s.clk.advance(300); s.svc.schedule(1000);                         // visibilitychange -> visible
  await s.clk.advance(5000); assert.equal(s.log.pulls, 1);
});

test('L9 launch(): a manual sync running when the timer fires is not run in parallel and the launch request is not lost', async () => {
  let release; const gate = new Promise(r => { release = r; }); let inFlight = 0, max = 0, pulls = 0;
  const slow = { pull: async () => { pulls++; inFlight++; max = Math.max(max, inFlight); await gate; inFlight--; return { records: [], cursor: '0' }; }, push: async () => ({ accepted: [], conflicts: [] }) };
  const s = setup({ adapter: slow });
  s.svc.launch();
  const manual = s.svc.syncNow(); await flush();                          // user pressed Sync now at t=0
  await s.clk.advance(1500);                                              // launch timer fires while it runs
  release(); await manual; await s.clk.advance(100);
  assert.equal(max, 1);
  assert.equal(pulls, 2);                                                 // the launch sync ran afterwards
});

test('L10 launch(): status shows Syncing then idle with a last-synced time', async () => {
  const s = setup(); s.svc.launch(); await s.clk.advance(2000);
  const states = s.statuses.map(x => x.state);
  assert.ok(states.includes('syncing')); assert.equal(states.at(-1), 'idle');
  assert.ok(s.statuses.at(-1).lastSyncAt > 0);
});

test('L11 launch(): a failed launch sync is visible (error status, lastSyncAt unchanged) and a later online/visible retry recovers', async () => {
  const s = setup(); s.server.failNext(new Error('offline'));
  s.svc.launch(); await s.clk.advance(2000);
  assert.equal(s.svc.status().state, 'error'); assert.match(s.svc.status().error, /offline/); assert.equal(s.svc.status().lastSyncAt, 0);
  assert.equal(s.statuses.at(-1).state, 'error');                         // the UI was told, not left on "Syncing"
  s.svc.schedule(1000); await s.clk.advance(1000);
  assert.equal(s.svc.status().state, 'idle'); assert.ok(s.svc.status().lastSyncAt > 0);
});

test('L12 launch(): expired access token is refreshed first; a rejected refresh token ends signed out with a visible message', async () => {
  const mk = refreshStatus => {
    const calls = [];
    const fetchImpl = async url => {
      calls.push(url);
      const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
      if (/grant_type=refresh_token/.test(url)) return refreshStatus === 200 ? res(200, { access_token: 'new', refresh_token: 'r2', expires_in: 3600 }) : res(400, { error_description: 'Invalid Refresh Token' });
      if (/rpc\/push_record/.test(url)) return res(200, [{ accepted: true, rev: 1 }]);
      return res(200, []);
    };
    const clk = clock(); const config = createSyncConfig(store());
    config.set({ url: 'https://abc.supabase.co', anonKey: ANON, email: 'me@x.y', session: { access_token: 'old', refresh_token: 'r1', expires_at: 1 } });
    const svc = createSyncService({ config, getState: defaults, applyState() {}, fetchImpl, defaults: NO_DEFAULT, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer });
    return { svc, config, clk, calls };
  };
  const ok = mk(200); ok.svc.launch(); await ok.clk.advance(2000);
  assert.match(ok.calls[0], /grant_type=refresh_token/); assert.equal(ok.svc.status().state, 'idle'); assert.equal(ok.config.get().session.refresh_token, 'r2');
  const bad = mk(400); bad.svc.launch(); await bad.clk.advance(2000);
  assert.equal(bad.calls.length, 1);                                       // only the refresh attempt, no data request
  assert.equal(bad.config.get().session, null); assert.equal(bad.svc.status().state, 'signed-out'); assert.match(bad.svc.status().error, /Signed out/);
});

test('L13 debounce cap: edits every 3 s cannot postpone an automatic sync beyond maxWaitMs', async () => {
  const s = setup({ maxWaitMs: 10000 });
  s.svc.schedule();                                                       // t = 0, 4 s debounce
  for (const t of [3000, 6000, 9000]) { await s.clk.advance(t - s.clk.t); assert.equal(s.log.pulls, 0, `t=${t}`); s.svc.schedule(); }
  await s.clk.advance(999); assert.equal(s.log.pulls, 0);                  // t = 9999
  await s.clk.advance(1); assert.equal(s.log.pulls, 1);                    // t = 10000: the cap fires
});

test('L14 debounce cap: a plain schedule() with no further edits still waits the normal 4 s, and the window restarts after a sync', async () => {
  const s = setup({ maxWaitMs: 10000 });
  s.svc.schedule(); await s.clk.advance(3999); assert.equal(s.log.pulls, 0); await s.clk.advance(1); assert.equal(s.log.pulls, 1);
  s.svc.schedule(); await s.clk.advance(3000); s.svc.schedule();          // a fresh window: the cap counts from here, not from t=4000
  await s.clk.advance(4000); assert.equal(s.log.pulls, 2);
});

test('L15 hostile stored config: launch() never throws and schedules nothing', async () => {
  for (const raw of ['null', '[]', '"x"', '{"session":"garbage","auto":"no"}', '{bad json']) {
    const st = { getItem: () => raw, setItem() {} };
    const clk = clock();
    const svc = createSyncService({ config: createSyncConfig(st), getState: defaults, applyState() {}, defaults: NO_DEFAULT, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer });
    assert.doesNotThrow(() => svc.launch(), raw); assert.equal(clk.pending(), 0, raw);
  }
});

test('L16 [weak source check] sync-view.js starts the launch sync through svc.launch(), not the shared debounce, and toasts a launch failure', () => {
  const src = readFileSync(new URL('../js/ui/sync-view.js', import.meta.url), 'utf8');
  assert.match(src, /svc\.launch\s*\(/);
  assert.doesNotMatch(src, /svc\.schedule\(\s*1500\s*\)/);
  assert.match(src, /onLaunchFailure/); assert.match(src, /Sync failed: /);
  assert.ok(SYNC_KEY === 'macrodiary.sync.v1');                           // the per-device key is unchanged
});

test('L17 onLaunchFailure is called once, with the reason, only when the LAUNCH sync fails; later automatic and manual failures do not call it', async () => {
  const s = setup(); s.server.failNext(new Error('offline'));
  s.svc.launch(); await s.clk.advance(2000);
  assert.equal(s.failures.length, 1); assert.match(String(s.failures[0] && (s.failures[0].message || s.failures[0])), /offline/);
  s.server.failNext(new Error('again')); s.svc.schedule(); await s.clk.advance(4000);   // a later automatic sync fails
  s.server.failNext(new Error('manual')); await s.svc.syncNow();                        // and a manual one
  assert.equal(s.failures.length, 1);
  const ok = setup(); ok.svc.launch(); await ok.clk.advance(2000); assert.equal(ok.failures.length, 0);   // success: silent
});

test('L18 a rejected refresh token at launch also reports through onLaunchFailure with the signed-out reason', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '{"error_description":"Invalid Refresh Token"}' });
  const clk = clock(); const failures = []; const config = createSyncConfig(store());
  config.set({ url: 'https://abc.supabase.co', anonKey: ANON, email: 'me@x.y', session: { access_token: 'old', refresh_token: 'r1', expires_at: 1 } });
  const svc = createSyncService({ config, getState: defaults, applyState() {}, fetchImpl, defaults: NO_DEFAULT, now: clk.now, setTimer: clk.setTimer, clearTimer: clk.clearTimer, onLaunchFailure: e => failures.push(e) });
  svc.launch(); await clk.advance(2000);
  assert.equal(failures.length, 1); assert.match(String(failures[0] && (failures[0].message || failures[0])), /Signed out/);
});
