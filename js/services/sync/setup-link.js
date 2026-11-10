// "Add another device" link: carries the sync project URL + publishable key (never a password, email or session) in the URL
// FRAGMENT, which browsers do not send to servers. Pure; no DOM/storage/network. See docs/specs/sync-defaults-and-setup-link.md.
import { normalizeUrl, isUsableKey, isSignedIn, effectiveConnection } from './config.js';

const PARAM = 'sync-setup';
const MAX_INPUT = 8192;   // a real link is a few hundred chars; refuse anything bigger before decoding

const toB64u = str => { let bin = ''; for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64u = s => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))); };

/** appUrl + project -> shareable link, or '' if the url/key are unusable. Only url and key are ever included. */
export function buildSetupLink(appUrl, conn) {
  try {
    const url = normalizeUrl(conn && conn.url), key = conn && conn.anonKey;
    if (!url || !isUsableKey(key)) return '';
    return `${String(appUrl).split('#')[0]}#${PARAM}=${toB64u(JSON.stringify({ v: 1, url, key }))}`;
  } catch { return ''; }
}

/** Link, '#sync-setup=…' or 'sync-setup=…' -> { url, anonKey } or null. Never throws; returns nothing but url + key. */
export function parseSetupLink(input) {
  try {
    if (typeof input !== 'string' || input.length > MAX_INPUT) return null;
    const hashAt = input.indexOf('#');
    const frag = hashAt >= 0 ? input.slice(hashAt + 1) : input;
    const part = frag.split('&').find(p => p.startsWith(PARAM + '='));
    const b64 = part && part.slice(PARAM.length + 1);
    if (!b64 || !/^[A-Za-z0-9_-]+$/.test(b64)) return null;
    const d = JSON.parse(fromB64u(b64));
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.v !== 1) return null;
    const url = typeof d.url === 'string' ? normalizeUrl(d.url) : null;
    if (!url || !isUsableKey(d.key)) return null;
    return { url, anonKey: d.key };
  } catch { return null; }
}

/**
 * What to do with a parsed link on this device: 'ignore' (nothing to do), 'apply' (safe: not signed in), or 'confirm'
 * (signed in to another project — the caller must ask first). `patch` is for config.set and holds only url/anonKey/useOwnProject.
 */
export function planSetupLinkApply(cfg, link, defaults) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  if (!link || typeof link !== 'object') return { action: 'ignore', patch: null };
  const cur = effectiveConnection(c, defaults);
  if (cur.url === link.url && cur.anonKey === link.anonKey) return { action: 'ignore', patch: null };
  const def = effectiveConnection({}, defaults);
  const isDefault = def.source === 'default' && def.url === link.url && def.anonKey === link.anonKey;
  const patch = isDefault ? { url: '', anonKey: '', useOwnProject: false } : { url: link.url, anonKey: link.anonKey, useOwnProject: true };
  return { action: isSignedIn(c) ? 'confirm' : 'apply', patch };
}
