// Per-device sync settings and bookkeeping, kept in their OWN localStorage key — never inside the app
// state — so they are not exported in backups, not merged, and not synced (a session token must stay on the device).
// `storage` is injected (localStorage in the browser, a fake in tests).
export const SYNC_KEY = 'macrodiary.sync.v1';

export function createSyncConfig(storage) {
  const read = () => { try { const d = JSON.parse(storage && storage.getItem(SYNC_KEY)); return d && typeof d === 'object' ? d : {}; } catch { return {}; } };
  let data = read();
  const write = () => { try { storage.setItem(SYNC_KEY, JSON.stringify(data)); } catch { /* storage blocked: keep in memory only */ } };
  return {
    /** { url, anonKey, email, session, auto, meta, lastError } — any may be missing */
    get: () => data,
    set(patch) { data = { ...data, ...patch }; write(); },
    clear() { data = {}; write(); },
    /** The engine's bookkeeping (cursor, revs, hashes, lastSyncAt). */
    meta: { load: () => data.meta || null, save(m) { data = { ...data, meta: m }; write(); } },
  };
}

/**
 * Accept only https URLs (or http on localhost for development), without trailing slash.
 * Credentials are sent to this URL, so anything else is refused. Returns null if unacceptable.
 */
export function normalizeUrl(u) {
  let url;
  try { url = new URL(String(u || '').trim()); } catch { return null; }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return url.origin;     // origin = scheme + host + port, no path/trailing slash
}

/** Supabase keys are JWTs; decode the payload's `role` (best effort) so the dangerous service_role key can be refused. */
export function tokenRole(jwt) {
  try {
    const part = String(jwt).split('.')[1]; if (!part) return '';
    const json = typeof atob === 'function' ? atob(part.replace(/-/g, '+').replace(/_/g, '/')) : Buffer.from(part, 'base64url').toString('utf8');
    return JSON.parse(json).role || '';
  } catch { return ''; }
}

/** A key we are willing to store or share: a string longer than 20 chars that is not a service_role / secret key. */
export const isUsableKey = k => typeof k === 'string' && k.length > 20 && !/service_role/i.test(k) && !k.startsWith('sb_secret_') && tokenRole(k) !== 'service_role';

export const isConfigured = cfg => !!(normalizeUrl(cfg.url) && cfg.anonKey && String(cfg.anonKey).length > 20);
export const isSignedIn = cfg => !!(cfg.session && cfg.session.refresh_token);

/**
 * Which project this device talks to. A project the user set themselves (or the "use my own project" switch) always wins and
 * never falls back to the built-in default; otherwise the built-in default is used when it is valid; else nothing.
 * Pure; never throws.
 */
export function effectiveConnection(cfg, defaults) {
  const none = { url: '', anonKey: '', source: 'none' };
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  if (c.useOwnProject === true || c.url || c.anonKey) {
    const url = normalizeUrl(c.url);
    return url && isConfigured(c) ? { url, anonKey: c.anonKey, source: 'custom' } : none;
  }
  const d = defaults && typeof defaults === 'object' ? defaults : {};
  const url = normalizeUrl(d.url);
  return url && isUsableKey(d.anonKey) ? { url, anonKey: d.anonKey, source: 'default' } : none;
}
