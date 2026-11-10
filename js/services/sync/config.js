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

export const isConfigured = cfg => !!(normalizeUrl(cfg.url) && cfg.anonKey && String(cfg.anonKey).length > 20);
export const isSignedIn = cfg => !!(cfg.session && cfg.session.refresh_token);
