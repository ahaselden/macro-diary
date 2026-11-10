import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncService, tokenRole } from '../js/services/sync/index.js';
import { createSyncConfig } from '../js/services/sync/config.js';
import { createMemoryAdapter } from '../js/services/sync/memory-adapter.js';
import { defaults } from '../js/core/schema.js';
import { addEntry } from '../js/domain/entries.js';
// These tests are about a device with nothing configured; the shipped built-in project (defaults.js) must not change that.
const NO_DEFAULT_PROJECT = { url: '', anonKey: '' };

const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const jwt = role => `h.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.s`;
const ANON = jwt('anon') + 'x'.repeat(20);
const entry = id => ({ id, meal: 'Lunch', name: id, brand: '', source: 'x', per100: { k: 100, p: 1, c: 1, f: 1 }, grams: 100 });

function setup({ signedIn = true, server = createMemoryAdapter(), state = defaults() } = {}) {
  const config = createSyncConfig(store());
  config.set({ url: 'https://abc.supabase.co', anonKey: ANON, email: 'me@x.y', ...(signedIn ? { session: { access_token: 'a', refresh_token: 'r' } } : {}) });
  const statuses = []; const timers = []; let current = state;
  const svc = createSyncService({
    config, getState: () => current, applyState: s => { current = s; }, onStatus: s => statuses.push(s.state),
    adapterFactory: () => server, now: () => 1000,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => { timers.pop(); },
  });
  return { svc, config, statuses, timers, server, get state() { return current; }, set state(v) { current = v; } };
}

test('status reflects configuration, sign-in and sync state', async () => {
  const c = createSyncConfig(store()); const mk = () => createSyncService({ config: c, getState: defaults, applyState() {}, defaults: NO_DEFAULT_PROJECT });
  assert.equal(mk().status().state, 'unconfigured');
  c.set({ url: 'https://abc.supabase.co', anonKey: ANON }); assert.equal(mk().status().state, 'signed-out');
  c.set({ session: { refresh_token: 'r' } }); assert.equal(mk().status().state, 'idle');
});

test('configure rejects http urls, short keys and the service_role key', () => {
  const svc = createSyncService({ config: createSyncConfig(store()), getState: defaults, applyState() {}, defaults: NO_DEFAULT_PROJECT });
  assert.match(svc.configure({ url: 'http://abc.supabase.co', anonKey: ANON }), /https/);
  assert.match(svc.configure({ url: 'https://abc.supabase.co', anonKey: 'short' }), /anon/);
  assert.match(svc.configure({ url: 'https://abc.supabase.co', anonKey: jwt('service_role') + 'x'.repeat(20) }), /service_role/);
  assert.equal(svc.configure({ url: 'https://abc.supabase.co/', anonKey: ANON }), '');
});

test('tokenRole decodes a JWT role and tolerates garbage', () => {
  assert.equal(tokenRole(jwt('anon')), 'anon'); assert.equal(tokenRole('nope'), ''); assert.equal(tokenRole(null), '');
});

test('syncNow pushes local data and pulls remote data through the engine', async () => {
  const server = createMemoryAdapter();
  const a = setup({ server }); addEntry(a.state, '2026-01-01', entry('phone1'), 10);
  assert.equal((await a.svc.syncNow()).ok, true);
  const b = setup({ server });
  const r = await b.svc.syncNow();
  assert.equal(r.ok, true);
  assert.deepEqual((b.state.days['2026-01-01'] || []).map(e => e.id), ['phone1']);
  assert.ok(a.statuses.includes('syncing') && a.statuses.at(-1) === 'idle');
});

test('syncNow when signed out does nothing and says so', async () => {
  const s = setup({ signedIn: false }); const r = await s.svc.syncNow();
  assert.equal(r.ok, false); assert.match(r.error, /Not signed in/);
});

test('a failed sync sets the error status and keeps the data; a later one recovers', async () => {
  const server = createMemoryAdapter(); const s = setup({ server }); addEntry(s.state, 'd', entry('x'), 5);
  server.failNext(new Error('offline'));
  const bad = await s.svc.syncNow(); assert.equal(bad.ok, false); assert.equal(s.svc.status().state, 'error');
  assert.match(s.svc.status().error, /offline/);
  const good = await s.svc.syncNow(); assert.equal(good.ok, true); assert.equal(s.svc.status().state, 'idle');
});

test('a "Signed out" error forgets the session so the UI asks for sign-in', async () => {
  const bad = { pull: async () => { throw new Error('Signed out — please sign in again'); }, push: async () => ({ accepted: [], conflicts: [] }) };
  const config = createSyncConfig(store()); config.set({ url: 'https://abc.supabase.co', anonKey: ANON, session: { refresh_token: 'r' } });
  const svc = createSyncService({ config, getState: defaults, applyState() {}, adapterFactory: () => bad });
  await svc.syncNow(); assert.equal(config.get().session, null); assert.equal(svc.status().state, 'signed-out');
});

test('schedule debounces: restarts the timer and only syncs when signed in with auto on', async () => {
  const s = setup(); s.svc.schedule(); s.svc.schedule();
  assert.equal(s.timers.length, 1);                       // the earlier timer was cleared
  s.svc.setAuto(false); s.timers.length = 0; s.svc.schedule(); assert.equal(s.timers.length, 0);
  const out = setup({ signedIn: false }); out.svc.schedule(); assert.equal(out.timers.length, 0);
});

test('a sync requested while one is running is queued, not dropped or run in parallel', async () => {
  let release; const gate = new Promise(r => { release = r; }); let inFlight = 0, maxInFlight = 0;
  const slow = { pull: async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await gate; inFlight--; return { records: [], cursor: '0' }; }, push: async () => ({ accepted: [], conflicts: [] }) };
  const config = createSyncConfig(store()); config.set({ url: 'https://abc.supabase.co', anonKey: ANON, session: { refresh_token: 'r' } });
  const timers = [];
  const svc = createSyncService({ config, getState: defaults, applyState() {}, adapterFactory: () => slow, setTimer: fn => timers.push(fn), clearTimer() {} });
  const first = svc.syncNow(); const second = await svc.syncNow();
  assert.equal(second.error, 'busy'); release(); await first;
  assert.equal(maxInFlight, 1); assert.equal(timers.length, 1);   // a follow-up sync was scheduled
});

test('signOut clears session and sync bookkeeping', async () => {
  const s = setup(); s.config.meta.save({ cursor: '9' });
  const calls = []; const svc = createSyncService({ config: s.config, getState: defaults, applyState() {}, fetchImpl: async u => { calls.push(u); return { ok: true, status: 204, json: async () => ({}), text: async () => '' }; } });
  await svc.signOut();
  assert.equal(s.config.get().session, null); assert.equal(s.config.meta.load(), null);
  assert.ok(calls.some(u => /logout/.test(u)));
});

test('signIn stores the session and email', async () => {
  const config = createSyncConfig(store()); config.set({ url: 'https://abc.supabase.co', anonKey: ANON });
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600, user: {} }), text: async () => '' });
  const svc = createSyncService({ config, getState: defaults, applyState() {}, fetchImpl, now: () => 1000 });
  await svc.signIn(' me@x.y ', 'pw');
  assert.equal(config.get().email, 'me@x.y'); assert.equal(config.get().session.refresh_token, 'R');
  const nokey = createSyncService({ config: createSyncConfig(store()), getState: defaults, applyState() {}, defaults: NO_DEFAULT_PROJECT });
  await assert.rejects(() => nokey.signIn('a', 'b'), /URL and anon key/);
});
