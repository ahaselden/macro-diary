// Safety checks for the fetch-recipe function: which URLs it may fetch. Plain ES module with NO imports and no platform APIs, so
// the same file runs in the edge function and under Node tests (tests/recipe-import-guard.test.js).
// This file decides from the TEXT of a URL or an IP address. It cannot see what a hostname resolves to: the handler (index.ts)
// resolves DNS itself and re-checks every address with isPrivateAddress().

export const MAX_BYTES = 2 * 1024 * 1024;   // most of a page we will read
export const TIMEOUT_MS = 8000;             // whole request budget
export const MAX_REDIRECTS = 3;

const MAX_URL = 2048;
const BAD_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa'];

const fail = reason => ({ ok: false, reason });

/** Four dotted decimal parts, each 0..255, no leading zeros (an ambiguous spelling): [a,b,c,d] or null. */
function parseV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(p => (p.length > 1 && p[0] === '0' ? NaN : Number(p)));
  return parts.every(n => n >= 0 && n <= 255) ? parts : null;
}

function privateV4([a, b, c]) {
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

/** Eight 16-bit numbers or null. Accepts '::' compression and a trailing dotted IPv4. */
function parseV6(input) {
  let s = input;
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(':')) return null;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const v4 = parseV4(tail[1]);
    if (!v4) return null;
    s = s.slice(0, -tail[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const side = p => (p === '' ? [] : p.split(':'));
  const head = side(halves[0]);
  let groups;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    groups = head;
  } else {
    const rest = side(halves[1]);
    if (head.length + rest.length > 7) return null;
    groups = [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest];
  }
  if (!groups.every(g => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return groups.map(g => parseInt(g, 16));
}

const embeddedV4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/**
 * True when the address must NOT be fetched: private, loopback, link-local, multicast, reserved, documentation, or anything that is
 * not a valid IPv4/IPv6 address (fails closed).
 */
export function isPrivateAddress(ip) {
  if (typeof ip !== 'string') return true;
  const s = ip.split('%')[0];                       // drop an IPv6 zone such as fe80::1%eth0
  const v4 = parseV4(s);
  if (v4) return privateV4(v4);
  const g = parseV6(s);
  if (!g) return true;
  if (g.slice(0, 6).every(n => n === 0)) return true;                                   // ::, ::1 and the old IPv4-compatible range
  if (g.slice(0, 5).every(n => n === 0) && g[5] === 0xffff) return privateV4(embeddedV4(g[6], g[7]));   // IPv4-mapped
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(n => n === 0)) return privateV4(embeddedV4(g[6], g[7]));   // NAT64
  if (g[0] === 0x2002) return privateV4(embeddedV4(g[1], g[2]));                         // 6to4
  return (g[0] & 0xfe00) === 0xfc00                                                      // fc00::/7 unique local
    || (g[0] & 0xffc0) === 0xfe80                                                        // fe80::/10 link-local
    || (g[0] & 0xffc0) === 0xfec0                                                        // fec0::/10 old site-local
    || (g[0] & 0xff00) === 0xff00                                                        // ff00::/8 multicast
    || (g[0] === 0x2001 && g[1] === 0x0db8);                                             // 2001:db8::/32 documentation
}

/** { ok:true, url } with the normalised absolute URL, or { ok:false, reason }. */
export function checkUrl(input) {
  if (typeof input !== 'string') return fail('The address is not text.');
  if (!input.trim()) return fail('The address is empty.');
  if (input.length > MAX_URL) return fail('The address is too long.');
  let u;
  try { u = new URL(input.trim()); } catch { return fail('That is not a valid web address.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('Only http and https addresses can be imported.');
  if (u.username || u.password) return fail('Addresses with a user name or password are not allowed.');
  if (u.port !== '' && u.port !== '80' && u.port !== '443') return fail('Only the standard web ports are allowed.');
  let host = u.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    if (isPrivateAddress(host.slice(1, -1))) return fail('That address is not a public website.');
    return { ok: true, url: u.href };
  }
  host = host.replace(/\.+$/, '');
  if (!host) return fail('That is not a valid web address.');
  if (parseV4(host)) {
    if (isPrivateAddress(host)) return fail('That address is not a public website.');
    return { ok: true, url: u.href };
  }
  if (!host.includes('.') || host === 'localhost' || BAD_HOST_SUFFIXES.some(x => host.endsWith(x))) return fail('That address is not a public website.');
  return { ok: true, url: u.href };
}

/** Resolve a redirect Location against the current URL and re-check it. Returns the checked absolute URL or null. */
export function resolveRedirect(currentUrl, location) {
  if (typeof location !== 'string' || !location.trim() || !checkUrl(currentUrl).ok) return null;
  let next;
  try { next = new URL(location.trim(), currentUrl).href; } catch { return null; }
  const c = checkUrl(next);
  return c.ok ? c.url : null;
}
