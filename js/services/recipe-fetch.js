// Client for the fetch-recipe function (supabase/functions/fetch-recipe): asks it to download one recipe page for us, because a
// browser cannot read other sites. Sends ONLY the page address and the project's public key; never the diary, a sign-in session or
// anything else. `fetchImpl` is injectable for tests. Errors are friendly, short, and never contain the key or the page address.
const MAX_HTML = 2 * 1024 * 1024;       // same limit as the server
const MAX_MESSAGE = 300;
const CLIENT_TIMEOUT_MS = 15000;        // the server gives up after 8 s; this is the browser-side backstop

const GENERIC = 'The import service gave an unexpected response. Try again later or paste the recipe instead.';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const cap = s => (s.length > MAX_MESSAGE ? s.slice(0, MAX_MESSAGE - 1) + '…' : s);
const clean = s => String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const fail = msg => new Error(cap(msg));

/** True when this device has a project (URL + public key) the import service could live on. `conn` = effectiveConnection() result. */
export function recipeImportAvailable(conn) {
  return plain(conn) && typeof conn.url === 'string' && conn.url.trim() !== '' && typeof conn.anonKey === 'string' && conn.anonKey.trim() !== '' && conn.source !== 'none';
}

/** A plain http(s) address without credentials: [true, href] or [false]. */
function webAddress(s) {
  if (typeof s !== 'string' || !s.trim() || s.length > 2048) return [false];
  let u; try { u = new URL(s.trim()); } catch { return [false]; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return [false];
  return [true, u.href];
}

/** @returns {Promise<{html:string, finalUrl:string}>} rejects with a friendly Error */
export async function fetchRecipePage(conn, pageUrl, fetchImpl = (...a) => globalThis.fetch(...a)) {
  if (!recipeImportAvailable(conn)) throw fail('Importing from a web address needs a sync project. Set one up in Settings, or paste the recipe instead.');
  const [valid, href] = webAddress(pageUrl);
  if (!valid) throw fail('Enter a web address that starts with http:// or https://');
  const endpoint = conn.url.trim().replace(/\/+$/, '') + '/functions/v1/fetch-recipe';
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), CLIENT_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(endpoint, {
      method: 'POST', credentials: 'omit', signal: ctl.signal,
      headers: { 'Authorization': `Bearer ${conn.anonKey}`, 'apikey': conn.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: href }),
    });
  } catch (e) {
    clearTimeout(timer);
    const name = e && typeof e === 'object' ? e.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') throw fail('The page took too long to load. Try again, or paste the recipe instead.');
    throw fail('Network error: check your internet connection and try again.');
  }
  clearTimeout(timer);

  let data = null;
  try { data = JSON.parse(await res.text()); } catch { data = null; }

  if (plain(data) && data.ok === false && typeof data.error === 'string') {   // the function's own, page-level answer
    const m = clean(data.error);
    throw fail(m || GENERIC);
  }
  if (res.status === 404) throw fail('Recipe import is not set up on your project yet. Paste the recipe instead.');
  if (res.status === 401 || res.status === 403) throw fail('The import service did not accept your project key. Check the key in Settings.');
  if (res.status === 429) throw fail('Too many requests. Wait a minute and try again.');
  if (!res.ok) throw fail(`The import service had a problem (HTTP ${Number(res.status) || 'error'}). Try again later.`);

  if (!plain(data) || data.ok !== true || typeof data.html !== 'string' || typeof data.finalUrl !== 'string') throw fail(GENERIC);
  if (!webAddress(data.finalUrl)[0]) throw fail(GENERIC);
  if (data.html.length > MAX_HTML) throw fail('That page is too large to import. Paste the recipe instead.');
  return { html: data.html, finalUrl: data.finalUrl };
}
