// DEVELOPMENT ONLY. A Node stand-in for supabase/functions/fetch-recipe/index.ts so recipe import can be tried locally without
// deploying the real function. It follows the same contract and uses the same safety rules (guard.js), but it is NOT the real
// runtime: DNS comes from Node, not Deno, and there are no platform limits, CORS or key checks here.
// Pure of the network and DNS: both are injected (fetchImpl, resolveHost), so tests use fakes. Never throws out of handle().
import { checkUrl, resolveRedirect, isPrivateAddress, MAX_BYTES, TIMEOUT_MS, MAX_REDIRECTS } from '../../supabase/functions/fetch-recipe/guard.js';

const TYPES = ['text/html', 'application/xhtml+xml', 'application/ld+json', 'text/plain'];
const AGENT = 'Mozilla/5.0 (compatible; RecipeImport/1.0)';
const MAX_REQUEST_CHARS = 4096;

const answer = (status, json) => ({ status, json });
const refuse = (error, status = 200) => answer(status, { ok: false, error });
const isIp = h => /^[0-9.]+$/.test(h) || h.includes(':');

async function hostIsPublic(host, resolveHost) {
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIp(bare)) return !isPrivateAddress(bare);
  let found;
  try { found = await resolveHost(bare); } catch { return false; }
  return Array.isArray(found) && found.length > 0 && found.every(a => !isPrivateAddress(a));
}

async function readLimited(res) {
  if (!res.body) return '';
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const room = MAX_BYTES - size;
    chunks.push(value.length > room ? value.subarray(0, room) : value);
    size += Math.min(value.length, room);
  }
  try { await reader.cancel(); } catch { /* already finished */ }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder('utf-8').decode(all);
}

// Not awaited: cancelling one branch of a cloned body (as test fakes use) only settles when the other branch is read too.
const drop = async res => { try { res.body?.cancel().catch(() => {}); } catch { /* ignore */ } };

async function fetchPage(start, signal, fetchImpl, resolveHost) {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await hostIsPublic(new URL(current).hostname, resolveHost))) return { error: 'That address is not a public website.', status: 403 };
    const res = await fetchImpl(current, {
      method: 'GET', redirect: 'manual', signal,
      headers: { 'User-Agent': AGENT, 'Accept': 'text/html,application/xhtml+xml,application/ld+json;q=0.9,text/plain;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = resolveRedirect(current, res.headers.get('location'));
      await drop(res);
      if (!next) return { error: 'The site redirected somewhere that is not allowed.', status: 403 };
      current = next;
      continue;
    }
    if (!res.ok) { await drop(res); return { error: `The site answered with an error (HTTP ${res.status}).` }; }
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.includes(contentType)) { await drop(res); return { error: 'That address is not a web page.' }; }
    return { finalUrl: current, contentType, html: await readLimited(res) };
  }
  return { error: 'The site redirected too many times.' };
}

/** @returns {(req:{method?:string, bodyText?:unknown}) => Promise<{status:number, json:object}>} */
export function createFetchRecipeHandler({ fetchImpl = globalThis.fetch, resolveHost } = {}) {
  return async function handle({ method, bodyText } = {}) {
    try {
      if (method !== 'POST') return refuse('Use POST.', 405);
      if (typeof bodyText !== 'string') return refuse('The request was not understood.', 400);
      if (bodyText.length > MAX_REQUEST_CHARS) return refuse('The request is too large.', 413);
      let parsed;
      try { parsed = JSON.parse(bodyText); } catch { return refuse('The request was not understood.', 400); }
      const target = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.hasOwn(parsed, 'url') ? parsed.url : undefined;
      const checked = checkUrl(target);
      if (!checked.ok) return refuse(checked.reason, 400);
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const out = await fetchPage(checked.url, ctl.signal, fetchImpl, resolveHost);
        return 'error' in out ? refuse(out.error, out.status) : answer(200, { ok: true, ...out });
      } finally { clearTimeout(timer); }
    } catch (e) {
      return refuse(e && e.name === 'AbortError' ? 'The site took too long to answer.' : 'The page could not be fetched.');
    }
  };
}
