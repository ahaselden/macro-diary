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
 */
export function createSyncService({ config, getState, applyState, onStatus = () => {}, adapterFactory, fetchImpl, defaults = DEFAULT_SYNC, now = Date.now,
  debounceMs = 4000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let syncing = false, again = false, timer = null, lastError = '';

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
    syncing = true; lastError = ''; emit();
    let result;
    try {
      const engine = createSyncEngine({ adapter: makeAdapter(), getState, applyState, meta: config.meta, now });
      result = await engine.sync();
    } catch (e) { result = { ok: false, error: e && e.message ? e.message : 'Sync failed' }; }
    syncing = false;
    if (!result.ok) {
      lastError = result.error || 'Sync failed';
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
    timer = setTimer(() => { timer = null; syncNow(); }, delay);
  }

  async function auth(fn, email, password) {
    const { url, anonKey } = conn();
    if (!url || !anonKey) throw new Error('Enter the project URL and anon key first');
    const session = await fn(url, anonKey, String(email || '').trim(), password, fetchImpl);
    config.set({ session, email: String(email || '').trim() }); lastError = ''; emit();
    return session;
  }

  return {
    status, syncNow, schedule,
    signIn: (email, password) => auth(sbSignIn, email, password),
    signUp: (email, password) => auth(sbSignUp, email, password),
    async signOut() {
      const c = config.get();
      if (c.session) { try { await sbSignOut(conn().url, conn().anonKey, c.session, fetchImpl); } catch { /* best effort */ } }
      config.set({ session: null, meta: null }); lastError = ''; emit();   // forget bookkeeping so a later sign-in does a full pull
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
    setAuto(auto) { config.set({ auto: !!auto }); emit(); },
  };
}
