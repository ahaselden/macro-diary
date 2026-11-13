// The sync service the UI talks to: owns config + session, builds the adapter, runs the engine one sync at a time,
// and debounces automatic syncs after local changes. No DOM. Everything time/network related is injectable for tests.
import { createSyncEngine } from './engine.js';
import { createSupabaseAdapter, signIn as sbSignIn, signUp as sbSignUp, signOut as sbSignOut } from './supabase-adapter.js';
import { normalizeUrl, isSignedIn, tokenRole, effectiveConnection } from './config.js';
import { DEFAULT_SYNC } from './defaults.js';

export { tokenRole };

/**
 * @param config        a createSyncConfig() object (url, anonKey, email, session, auto, meta)
 * @param getState      () => current app state
 * @param applyState    (newState) => replace + save + refresh UI (called only when a sync changed the state)
 * @param defaults       built-in project { url, anonKey } used when the user has not set their own (defaults.js)
 * @param adapterFactory optional (cfg, onSession) => adapter — tests inject a memory adapter
 * @param onLaunchFailure optional (errorText) => void, called once if the first sync after launch() fails (the UI shows a toast)
 * @param maxWaitMs     longest an automatic sync can be postponed by repeated schedule() calls (default 30 s)
 */
export function createSyncService({ config, getState, applyState, onStatus = () => {}, adapterFactory, fetchImpl, defaults = DEFAULT_SYNC, now = Date.now,
  debounceMs = 4000, setTimer = setTimeout, clearTimer = clearTimeout, onLaunchFailure = () => {}, maxWaitMs = 30000, launchDelayMs = 1500 }) {
  let syncing = false, again = false, timer = null, lastError = '';
  let windowStart = null;                                  // when the pending automatic sync was first requested (for the maxWaitMs cap)
  let launched = false, launchTimer = null, reportNext = false, syncCount = 0;

  const conn = () => effectiveConnection(config.get(), defaults);   // own project, else the built-in default, else none
  const status = () => {
    const c = config.get();
    const state = conn().source === 'none' ? 'unconfigured' : !isSignedIn(c) ? 'signed-out' : syncing ? 'syncing' : lastError ? 'error' : 'idle';
    return { state, email: c.email || '', auto: c.auto !== false, lastSyncAt: (c.meta && c.meta.lastSyncAt) || 0, error: lastError };
  };
  const emit = () => onStatus(status());

  const makeAdapter = () => {
    const { url, anonKey } = conn();
    const c = { ...config.get(), url, anonKey };
    const onSession = s => config.set({ session: s });
    if (adapterFactory) return adapterFactory(c, onSession);
    return createSupabaseAdapter({ url, anonKey, session: c.session, onSession, fetchImpl });
  };

  async function syncNow() {
    const c = config.get();
    if (conn().source === 'none' || !isSignedIn(c)) { emit(); return { ok: false, error: 'Not signed in' }; }
    if (syncing) { again = true; return { ok: false, error: 'busy' }; }
    syncing = true; syncCount++; lastError = ''; emit();
    const report = reportNext; reportNext = false;           // the first sync after launch() reports a failure through onLaunchFailure
    let result;
    try {
      const engine = createSyncEngine({ adapter: makeAdapter(), getState, applyState, meta: config.meta, now });
      result = await engine.sync();
    } catch (e) { result = { ok: false, error: e && e.message ? e.message : 'Sync failed' }; }
    syncing = false;
    if (!result.ok) {
      lastError = result.error || 'Sync failed';
      if (report) { try { onLaunchFailure(lastError); } catch { /* the UI callback must not break syncing */ } }
      if (/signed out/i.test(lastError)) config.set({ session: null });   // refresh token rejected: ask the user to sign in again
    }
    emit();
    if (again) { again = false; schedule(0); }
    return result;
  }

  /** Call after any local change: runs a sync shortly after the user stops editing. No-op unless signed in with auto on. */
  function schedule(delay = debounceMs) {
    const c = config.get();
    if (conn().source === 'none' || !isSignedIn(c) || c.auto === false) return;
    if (timer) clearTimer(timer);
    const t = now();
    if (windowStart === null) windowStart = t;
    const wait = Math.max(0, Math.min(delay, windowStart + maxWaitMs - t));   // repeated edits cannot postpone the sync beyond maxWaitMs
    timer = setTimer(() => { timer = null; windowStart = null; syncNow(); }, wait);
  }

  /** Call once when the app opens: one sync shortly after, on its own timer so that later change events cannot postpone it. Same gating as schedule(). */
  function launch() {
    if (launched) return;
    const c = config.get();
    if (conn().source === 'none' || !isSignedIn(c) || c.auto === false) return;
    launched = true; reportNext = true;
    const startedBefore = syncCount;
    launchTimer = setTimer(() => {
      launchTimer = null;
      const c2 = config.get();
      if (conn().source === 'none' || !isSignedIn(c2) || c2.auto === false) { reportNext = false; return; }   // switched off meanwhile
      if (syncing) { again = true; return; }                  // a sync is running: run once more right after it
      if (syncCount > startedBefore) return;                  // another sync already ran since launch(): nothing more to do
      if (timer) { clearTimer(timer); timer = null; windowStart = null; }
      syncNow();
    }, launchDelayMs);
  }

  async function auth(fn, email, password) {
    const { url, anonKey } = conn();
    if (!url || !anonKey) throw new Error('Enter the project URL and anon key first');
    const session = await fn(url, anonKey, String(email || '').trim(), password, fetchImpl);
    config.set({ session, email: String(email || '').trim() }); lastError = ''; emit();
    return session;
  }

  return {
    status, syncNow, schedule, launch,
    signIn: (email, password) => auth(sbSignIn, email, password),
    signUp: (email, password) => auth(sbSignUp, email, password),
    async signOut() {
      const c = config.get();
      if (c.session) { try { await sbSignOut(conn().url, conn().anonKey, c.session, fetchImpl); } catch { /* best effort */ } }
      reportNext = false; config.set({ session: null, meta: null }); lastError = ''; emit();   // forget bookkeeping so a later sign-in does a full pull
    },
    /** Save server URL + anon key (validated). Returns an error string or ''. */
    configure({ url, anonKey }) {
      const u = normalizeUrl(url);
      if (!u) return 'The project URL must start with https:// (e.g. https://abcd.supabase.co)';
      if (!anonKey || String(anonKey).trim().length < 20) return 'Paste the anon public key from Supabase → Settings → API';
      if (/service_role/i.test(anonKey) || tokenRole(anonKey) === 'service_role') return 'That looks like the service_role key — never use it here. Use the anon public key.';
      config.set({ url: u, anonKey: String(anonKey).trim(), useOwnProject: true }); emit();
      return '';
    },
    setAuto(auto) { config.set({ auto: !!auto }); if (!auto) reportNext = false; emit(); },
  };
}
