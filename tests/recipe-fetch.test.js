// Tests for docs/specs/recipe-import.md, client service (js/services/recipe-fetch.js), behaviours S1..S12.
// fetch is injected; responses are real `Response` objects. NOT covered: the real network, the deployed function, the real timeout
// duration (only that a signal is passed and that abort/timeout errors map to a friendly message).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mod = () => import('../js/services/recipe-fetch.js');
const KEY = 'anon-key-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const conn = (extra = {}) => ({ url: 'https://abcdefgh.supabase.co', anonKey: KEY, source: 'custom', ...extra });
const PAGE = 'https://example.com/secret-path/recipe-42?token=zzz';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const good = (over = {}) => json({ ok: true, finalUrl: 'https://example.com/final', contentType: 'text/html', html: '<html>hi</html>', ...over });
const recorder = respond => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); return typeof respond === 'function' ? respond(url, init) : respond; }; f.calls = calls; return f; };
const fail = async (c, url, f) => {
  const { fetchRecipePage } = await mod();
  let p;
  try { p = fetchRecipePage(c, url, f); } catch (e) { assert.fail('must return a rejected promise, not throw synchronously: ' + e.message); }
  assert.ok(p && typeof p.then === 'function', 'must return a promise');
  try { await p; } catch (e) { assert.ok(e instanceof Error, 'rejects with an Error'); assert.equal(typeof e.message, 'string'); assert.ok(e.message.length > 0 && e.message.length <= 300, `message length ${e.message.length}`); return e; }
  assert.fail('expected a rejection');
};
const noLeak = e => { assert.ok(!e.message.includes(KEY), 'anon key in message'); assert.ok(!e.message.includes('secret-path') && !e.message.includes('token=zzz'), 'page URL in message'); };

test('S1 recipeImportAvailable: true only for a connection with url and anonKey and source other than "none"', async () => {
  const { recipeImportAvailable } = await mod();
  assert.equal(recipeImportAvailable(conn()), true);
  assert.equal(recipeImportAvailable(conn({ source: 'default' })), true);
  for (const bad of [null, undefined, '', 'x', 42, [], {}, { url: '', anonKey: '', source: 'none' }, conn({ source: 'none' }), conn({ url: '' }), conn({ anonKey: '' }), conn({ url: undefined }), conn({ anonKey: null }), { anonKey: KEY, source: 'custom' }, { url: 'https://abcdefgh.supabase.co', source: 'custom' }])
    assert.equal(recipeImportAvailable(bad), false, JSON.stringify(bad));
});

test('S2 fetchRecipePage sends exactly one POST to <url>/functions/v1/fetch-recipe with Bearer + apikey + JSON body {url} and nothing else', async () => {
  const { fetchRecipePage } = await mod();
  const f = recorder(good());
  await fetchRecipePage(conn({ session: { access_token: 'SESSION-TOKEN-123', refresh_token: 'REFRESH-456' }, diary: { days: { '2025-01-01': [1] } } }), PAGE, f);
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(String(url), 'https://abcdefgh.supabase.co/functions/v1/fetch-recipe');
  assert.equal(init.method, 'POST');
  const h = new Headers(init.headers);
  assert.equal(h.get('authorization'), `Bearer ${KEY}`); assert.equal(h.get('apikey'), KEY); assert.match(h.get('content-type'), /application\/json/);
  for (const [k] of h) assert.ok(['authorization', 'apikey', 'content-type', 'x-client-info'].includes(k.toLowerCase()), `unexpected header ${k}`);
  assert.deepEqual(JSON.parse(init.body), { url: PAGE });
  const wire = JSON.stringify([String(url), init.body, [...h]]);
  for (const secret of ['SESSION-TOKEN-123', 'REFRESH-456', '2025-01-01']) assert.ok(!wire.includes(secret), `${secret} must never be sent`);
  assert.ok(init.credentials === undefined || init.credentials === 'omit');
  assert.ok(init.signal && typeof init.signal.aborted === 'boolean' && init.signal.aborted === false, 'a client-side timeout signal is passed');
});

test('S3 success: resolves { html, finalUrl } from the server answer', async () => {
  const { fetchRecipePage } = await mod();
  const r = await fetchRecipePage(conn(), PAGE, recorder(good()));
  assert.equal(r.html, '<html>hi</html>'); assert.equal(r.finalUrl, 'https://example.com/final');
  const small = await fetchRecipePage(conn(), PAGE, recorder(good({ html: '' })));
  assert.equal(small.html, '');
});

test('S4 the default fetch is the global fetch (injectable for tests, real in the browser)', async () => {
  const { fetchRecipePage } = await mod();
  const orig = globalThis.fetch; const calls = [];
  globalThis.fetch = async (u, i) => { calls.push(u); return good(); };
  try { const r = await fetchRecipePage(conn(), PAGE); assert.equal(r.html, '<html>hi</html>'); assert.equal(calls.length, 1); } finally { globalThis.fetch = orig; }
});

test('S5 the page URL is validated BEFORE any request: only http/https, no credentials; bad input rejects without calling fetch', async () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://example.com/', 'https://user:pw@example.com/', 'https://user@example.com/', 'not a url', '', '   ', '//example.com/x', 'example.com', null, undefined, 42, {}, [], 'https://' + 'a'.repeat(3000) + '.com/']) {
    const f = recorder(good());
    const e = await fail(conn(), bad, f);
    assert.equal(f.calls.length, 0, `fetch must not be called for ${String(bad).slice(0, 40)}`);
    assert.ok(!e.message.includes(KEY));
  }
  const f = recorder(good());
  await fail(null, PAGE, f); await fail({}, PAGE, f); await fail(conn({ source: 'none' }), PAGE, f); await fail(conn({ anonKey: '' }), PAGE, f);
  assert.equal(f.calls.length, 0, 'no request without a usable connection');
});

test('S6 network failure and timeout map to friendly messages (no key, no page URL, no raw stack text)', async () => {
  const net = await fail(conn(), PAGE, async () => { throw new TypeError('Failed to fetch'); });
  assert.match(net.message, /network|connection|internet|offline|reach/i); noLeak(net);
  for (const name of ['AbortError', 'TimeoutError']) {
    const e = await fail(conn(), PAGE, async () => { throw new DOMException('The operation was aborted.', name); });
    assert.match(e.message, /time|slow|too long|took/i, name); noLeak(e);
  }
  const weird = await fail(conn(), PAGE, async () => { throw 'a string'; });
  noLeak(weird);
  const weird2 = await fail(conn(), PAGE, async () => { throw null; });
  noLeak(weird2);
});

test('S7 404 without the function JSON shape means the import service is not deployed; 404 WITH {ok:false,error} is that page-level error', async () => {
  const miss = await fail(conn(), PAGE, recorder(json({ code: 'NOT_FOUND', message: 'Requested function was not found' }, 404)));
  assert.match(miss.message, /not set up/i); noLeak(miss);
  const miss2 = await fail(conn(), PAGE, recorder(new Response('Not Found', { status: 404 })));
  assert.match(miss2.message, /not set up/i);
  const page404 = await fail(conn(), PAGE, recorder(json({ ok: false, error: 'That page was not found.' }, 404)));
  assert.match(page404.message, /That page was not found\./); assert.ok(!/not set up/i.test(page404.message));
});

test('S8 401/403 point at the project key; 429 says to wait; other server failures are generic', async () => {
  for (const st of [401, 403]) {
    const e = await fail(conn(), PAGE, recorder(json({ code: st, message: 'Invalid JWT' }, st)));
    assert.match(e.message, /key|settings|access|authori[sz]|permission/i, String(st)); noLeak(e);
  }
  const rl = await fail(conn(), PAGE, recorder(json({ message: 'rate' }, 429)));
  assert.match(rl.message, /too many|rate|wait|again|later/i); noLeak(rl);
  for (const st of [500, 502, 503]) {
    const e = await fail(conn(), PAGE, recorder(new Response('<html>Bad gateway <script>alert(1)</script></html>', { status: st })));
    assert.ok(!/<html|<script/i.test(e.message), 'raw body must not be echoed'); noLeak(e);
  }
});

test('S9 {ok:false,error} from the function is shown (bounded to the 300-char message limit); an HTML or non-string error is not echoed raw', async () => {
  const e = await fail(conn(), PAGE, recorder(json({ ok: false, error: 'The page is not a recipe site we can read.' }, 422)));
  assert.match(e.message, /not a recipe site we can read/);
  const e200 = await fail(conn(), PAGE, recorder(json({ ok: false, error: 'Blocked address.' }, 200)));
  assert.match(e200.message, /Blocked address\./);
  const huge = await fail(conn(), PAGE, recorder(json({ ok: false, error: 'x'.repeat(5000) }, 502)));
  assert.ok(huge.message.length <= 300);
  const odd = await fail(conn(), PAGE, recorder(json({ ok: false, error: { a: 1 } }, 502)));
  assert.ok(odd.message.length > 0);
  const html = await fail(conn(), PAGE, recorder(json({ ok: false, error: '<img src=x onerror=alert(1)>' }, 502)));
  assert.ok(!/<img|onerror/i.test(html.message), 'markup stripped from server messages');
});

test('S10 a non-JSON body or the wrong shape is an "unexpected response" error, never a crash', async () => {
  for (const res of [new Response('hello', { status: 200 }), new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }), new Response('', { status: 200 }),
    json(null), json([]), json('str'), json(42), json({}), json({ ok: true }), json({ ok: true, finalUrl: 'https://example.com/', contentType: 'text/html' }), json({ ok: true, finalUrl: 'https://example.com/', html: 12345 }),
    json({ ok: true, finalUrl: 'https://example.com/', html: ['<p>'] }), json({ ok: true, html: '<p>x</p>' }), json({ ok: true, finalUrl: 42, html: '<p>x</p>' }), json({ ok: 'yes', finalUrl: 'https://example.com/', html: '<p>x</p>' })]) {
    const e = await fail(conn(), PAGE, recorder(res)); noLeak(e);
  }
  const e = await fail(conn(), PAGE, recorder(new Response('hello', { status: 200 })));
  assert.match(e.message, /unexpected|invalid|unreadable|response|understand/i);
});

test('S11 finalUrl must itself be a plain http(s) URL (it becomes the recipe source link); javascript:/data:/credentials are refused', async () => {
  for (const finalUrl of ['javascript:alert(1)', 'data:text/html,x', 'https://user:pw@example.com/', 'not a url', 'file:///etc/passwd'])
    await fail(conn(), PAGE, recorder(good({ finalUrl })));
});

test('S12 oversize pages are refused: html longer than 2 MiB (the server limit) is an error; exactly 2 MiB is accepted', async () => {
  const { fetchRecipePage } = await mod();
  const e = await fail(conn(), PAGE, recorder(good({ html: 'x'.repeat(2 * 1024 * 1024 + 1) })));
  assert.match(e.message, /too large|too big|size|large/i);
  const r = await fetchRecipePage(conn(), PAGE, recorder(good({ html: 'x'.repeat(2 * 1024 * 1024) })));
  assert.equal(r.html.length, 2 * 1024 * 1024);
});

test('S13 recipe-fetch.js has no DOM, storage or UI imports and does not log', () => {
  const src = readFileSync(new URL('../js/services/recipe-fetch.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const banned of [/\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bconsole\./, /\beval\s*\(/, /\bnew Function\b/, /\binnerHTML\b/, /\bXMLHttpRequest\b/])
    assert.ok(!banned.test(code), String(banned));
  for (const m of src.matchAll(/(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g)) assert.ok(!/\/ui\//.test(m[1]), `services must not import ui: ${m[1]}`);
});
