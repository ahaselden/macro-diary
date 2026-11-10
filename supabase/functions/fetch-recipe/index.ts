// fetch-recipe: fetches ONE public web page so the browser app can read its recipe data (browsers cannot fetch other sites: CORS).
// It stores nothing, keeps no logs of what was asked for, uses no keys of its own and does not interpret the page: it returns the
// text and the app parses it. See docs/specs/recipe-import.md. Deploy: `supabase functions deploy fetch-recipe` (add
// `--no-verify-jwt` if the gateway rejects the app's publishable key; see docs/SYNC-SETUP.md).
import { checkUrl, resolveRedirect, isPrivateAddress, MAX_BYTES, TIMEOUT_MS, MAX_REDIRECTS } from './guard.js';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
const TYPES = ['text/html', 'application/xhtml+xml', 'application/ld+json', 'text/plain'];
const AGENT = 'Mozilla/5.0 (compatible; RecipeImport/1.0)';
const MAX_REQUEST_CHARS = 4096;

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 200) => reply({ ok: false, error }, status);

const isIp = (host: string) => /^[0-9.]+$/.test(host) || host.includes(':');

/** True when every address the host resolves to is public. A name that does not resolve counts as not allowed. */
async function hostIsPublic(host: string): Promise<boolean> {
  const bare = host.startsWith('[') ? host.slice(1, -1) : host;
  if (isIp(bare)) return !isPrivateAddress(bare);
  const found: string[] = [];
  for (const type of ['A', 'AAAA'] as const) {
    try { found.push(...(await Deno.resolveDns(bare, type))); } catch { /* no records of this type */ }
  }
  return found.length > 0 && found.every(a => !isPrivateAddress(a));
}

/** Read at most MAX_BYTES, then stop. A longer page is cut (recipe data is almost always near the top). */
async function readLimited(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader(), chunks: Uint8Array[] = [];
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

async function fetchPage(start: string, signal: AbortSignal) {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await hostIsPublic(new URL(current).hostname))) return { error: 'That address is not a public website.' };
    const res = await fetch(current, {
      method: 'GET', redirect: 'manual', signal,
      headers: { 'User-Agent': AGENT, 'Accept': 'text/html,application/xhtml+xml,application/ld+json;q=0.9,text/plain;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = resolveRedirect(current, res.headers.get('location'));
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!next) return { error: 'The site redirected somewhere that is not allowed.' };
      current = next;
      continue;
    }
    if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } return { error: `The site answered with an error (HTTP ${res.status}).` }; }
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.includes(contentType)) { try { await res.body?.cancel(); } catch { /* ignore */ } return { error: 'That address is not a web page.' }; }
    return { finalUrl: current, contentType, html: await readLimited(res) };
  }
  return { error: 'The site redirected too many times.' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('Use POST.', 405);
  let target: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_REQUEST_CHARS) return fail('The request is too large.', 413);
    target = JSON.parse(text)?.url;
  } catch { return fail('The request was not understood.', 400); }
  const checked = checkUrl(target);
  if (!checked.ok) return fail(checked.reason, 400);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const out = await fetchPage(checked.url, ctl.signal);
    return 'error' in out ? fail(out.error) : reply({ ok: true, ...out });
  } catch (e) {
    return fail((e as Error)?.name === 'AbortError' ? 'The site took too long to answer.' : 'The page could not be fetched.');
  } finally { clearTimeout(timer); }
});
