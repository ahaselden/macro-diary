// Spec: docs/specs/import-dev-tools.md (Part A). Dev stand-in for the fetch-recipe function. No network: fake fetch + fake DNS.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFetchRecipeHandler } from '../scripts/lib/fetch-recipe-core.mjs';
import { checkUrl, MAX_BYTES, TIMEOUT_MS } from '../supabase/functions/fetch-recipe/guard.js';

const PUBLIC = async () => ['93.184.216.34'];
const post = (obj) => ({ method: 'POST', bodyText: JSON.stringify(obj) });
const page = (body = '<html>ok</html>', type = 'text/html; charset=utf-8', status = 200) =>
  new Response(body, { status, headers: type === null ? {} : { 'content-type': type } });
const redirect = (to, status = 302) => new Response(null, { status, headers: { location: to } });

/** fetchImpl that answers from a list (one entry per call) and records every call. */
function seq(...answers) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url: String(url), init }); const a = answers[Math.min(calls.length - 1, answers.length - 1)]; return typeof a === 'function' ? a(url, init) : a.clone(); };
  f.calls = calls;
  return f;
}
const recorder = (addrs = ['93.184.216.34']) => { const hosts = []; const r = async h => { hosts.push(h); return addrs; }; r.hosts = hosts; return r; };
const refusedShape = r => r.json.ok === false && typeof r.json.error === 'string' && r.json.error.length > 0 && r.json.error.length <= 300;

test('1 non-POST methods answer 405 JSON and never fetch', async () => {
  const f = seq(page());
  const h = createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC });
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD', undefined]) {
    const r = await h({ method, bodyText: '{"url":"https://example.com/"}' });
    assert.equal(r.status, 405, String(method));
    assert.ok(refusedShape(r));
  }
  assert.equal(f.calls.length, 0);
});

test('2 body over 4096 chars -> 413; exactly 4096 is processed', async () => {
  const f = seq(page());
  const h = createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC });
  const big = await h({ method: 'POST', bodyText: JSON.stringify({ url: 'https://example.com/', pad: 'x'.repeat(5000) }) });
  assert.equal(big.status, 413);
  assert.ok(refusedShape(big));
  assert.equal(f.calls.length, 0);
  const base = JSON.stringify({ url: 'https://example.com/', pad: '' });
  const exact = JSON.stringify({ url: 'https://example.com/', pad: 'x'.repeat(4096 - base.length) });
  assert.equal(exact.length, 4096);
  const ok = await h({ method: 'POST', bodyText: exact });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
});

test('3 garbage bodies and bad url fields answer 400', async () => {
  const f = seq(page());
  const h = createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC });
  const bodies = ['', 'not json', '{', '[]', 'null', '"https://example.com/"', '42', '{}', '{"url":42}', '{"url":null}', '{"url":["https://example.com/"]}',
    '{"__proto__":{"url":"https://example.com/"}}', undefined, 123, null];
  for (const bodyText of bodies) {
    const r = await h({ method: 'POST', bodyText });
    assert.equal(r.status, 400, String(bodyText));
    assert.ok(refusedShape(r));
  }
  assert.equal(f.calls.length, 0);
});

test('4 checkUrl refusals answer 400 with the guard reason; no DNS, no fetch', async () => {
  const f = seq(page());
  const dns = recorder();
  const h = createFetchRecipeHandler({ fetchImpl: f, resolveHost: dns });
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'ftp://example.com/', 'https://user:pw@example.com/', 'https://example.com:8443/', 'javascript:alert(1)', 'nonsense', '']) {
    const r = await h(post({ url }));
    assert.equal(r.status, 400, url);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, checkUrl(url).reason, url);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(dns.hosts.length, 0);
});

test('5 host check: resolver failure, no addresses or ANY private address is refused; IP literals are not resolved', async () => {
  const cases = {
    throws: async () => { throw new Error('ENOTFOUND'); },
    none: async () => [],
    private: async () => ['10.0.0.5'],
    mixed: async () => ['93.184.216.34', '192.168.1.10'],
    loopback6: async () => ['2606:2800:220:1::1', '::1'],
    metadata: async () => ['169.254.169.254'],
    mapped: async () => ['::ffff:127.0.0.1'],
  };
  for (const [name, resolveHost] of Object.entries(cases)) {
    const f = seq(page());
    const r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost })(post({ url: 'https://rebind.example.com/x' }));
    assert.equal(r.json.ok, false, name);
    assert.ok(r.status >= 400 && r.status !== 404, `${name} status ${r.status}`);
    assert.ok(refusedShape(r), name);
    assert.equal(f.calls.length, 0, name);
  }
  const dns = recorder(); const f = seq(page());
  const r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: dns })(post({ url: 'http://8.8.8.8/' }));
  assert.equal(r.json.ok, true);
  assert.deepEqual(dns.hosts, []);
});

test('6 a public page answers 200 with exactly ok, finalUrl, contentType, html', async () => {
  const f = seq(page('<html><body>hello</body></html>'));
  const r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/recipe' }));
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['contentType', 'finalUrl', 'html', 'ok']);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.finalUrl, 'https://example.com/recipe');
  assert.ok(r.json.contentType.startsWith('text/html'));
  assert.equal(r.json.html, '<html><body>hello</body></html>');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://example.com/recipe');
});

test('7 redirects: manual, re-checked per hop, bounded', async () => {
  // followed, with the new host resolved
  let f = seq(redirect('https://other.example.org/b'), page('<p>final</p>'));
  let dns = recorder();
  let r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: dns })(post({ url: 'https://example.com/a' }));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.finalUrl, 'https://other.example.org/b');
  assert.equal(r.json.html, '<p>final</p>');
  assert.ok(dns.hosts.includes('example.com') && dns.hosts.includes('other.example.org'), dns.hosts.join());
  for (const c of f.calls) assert.equal(c.init.redirect, 'manual');
  // relative location, every redirect status
  for (const st of [301, 302, 303, 307, 308]) {
    f = seq(redirect('/next', st), page());
    r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/a' }));
    assert.equal(r.json.ok, true, String(st));
    assert.equal(r.json.finalUrl, 'https://example.com/next');
  }
  // private literal target never fetched
  for (const to of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'file:///etc/passwd', 'http://localhost/']) {
    f = seq(redirect(to), page('SECRET'));
    r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/a' }));
    assert.equal(r.json.ok, false, to);
    assert.equal(f.calls.length, 1, to);
    assert.ok(!JSON.stringify(r.json).includes('SECRET'));
  }
  // hostname that resolves privately on the second hop
  f = seq(redirect('https://evil.example.net/'), page('SECRET'));
  const resolve = async h => (h === 'evil.example.net' ? ['10.1.2.3'] : ['93.184.216.34']);
  r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: resolve })(post({ url: 'https://example.com/a' }));
  assert.equal(r.json.ok, false);
  assert.equal(f.calls.length, 1);
  // missing Location
  f = seq(new Response(null, { status: 302 }));
  r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/a' }));
  assert.equal(r.json.ok, false);
  assert.ok(refusedShape(r));
  // 3 hops ok, 4 hops not
  f = seq(redirect('/1'), redirect('/2'), redirect('/3'), page());
  r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/a' }));
  assert.equal(r.json.ok, true);
  f = seq(redirect('/1'), redirect('/2'), redirect('/3'), redirect('/4'), page());
  r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/a' }));
  assert.equal(r.json.ok, false);
  assert.ok(f.calls.length <= 4);
  // endless loop terminates
  f = seq(redirect('/loop'));
  r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/a' }));
  assert.equal(r.json.ok, false);
  assert.ok(f.calls.length <= 4);
});

test('8 a fetch that never finishes is aborted after TIMEOUT_MS via the AbortController signal', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let seen;
    const f = (url, init) => new Promise((_, reject) => {
      seen = init.signal;
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const p = createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/slow' }));
    for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));   // let the handler reach fetch
    assert.ok(seen instanceof AbortSignal, 'fetch received a signal');
    assert.equal(seen.aborted, false);
    mock.timers.tick(TIMEOUT_MS - 1);
    assert.equal(seen.aborted, false);
    mock.timers.tick(1);
    const r = await p;
    assert.equal(seen.aborted, true);
    assert.equal(r.json.ok, false);
    assert.ok(refusedShape(r));
  } finally { mock.timers.reset(); }
});

test('9 a page longer than MAX_BYTES is cut, not an error', async () => {
  const chunk = 'a'.repeat(64 * 1024);
  const total = MAX_BYTES + 100 * 1024;
  let sent = 0;
  const stream = new ReadableStream({
    pull(c) { if (sent >= total) { c.close(); return; } c.enqueue(new TextEncoder().encode(chunk)); sent += chunk.length; },
  });
  const f = async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } });
  const r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/huge' }));
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.html.length, MAX_BYTES);
  assert.ok(sent < total + chunk.length, 'did not need to read much beyond the limit');
});

test('10 only html-like content types are accepted', async () => {
  const good = ['text/html', 'text/html; charset=utf-8', 'Text/HTML; Charset=UTF-8', 'application/xhtml+xml', 'application/ld+json', 'text/plain'];
  for (const t of good) {
    const r = await createFetchRecipeHandler({ fetchImpl: seq(page('x', t)), resolveHost: PUBLIC })(post({ url: 'https://example.com/' }));
    assert.equal(r.json.ok, true, t);
  }
  const bad = ['image/png', 'application/json', 'application/pdf', 'application/octet-stream', 'text/css', 'text/htmlx', 'video/mp4', null];
  for (const t of bad) {
    const r = await createFetchRecipeHandler({ fetchImpl: seq(page('SECRET', t)), resolveHost: PUBLIC })(post({ url: 'https://example.com/' }));
    assert.equal(r.json.ok, false, String(t));
    assert.ok(refusedShape(r), String(t));
    assert.ok(!JSON.stringify(r.json).includes('SECRET'));
  }
});

test('11 non-2xx upstream answers are ok:false', async () => {
  for (const st of [400, 403, 404, 410, 429, 500, 503]) {
    const r = await createFetchRecipeHandler({ fetchImpl: seq(page('<h1>SECRET-ERROR-PAGE</h1>', 'text/html', st)), resolveHost: PUBLIC })(post({ url: 'https://example.com/' }));
    assert.equal(r.json.ok, false, String(st));
    assert.ok(refusedShape(r));
    assert.ok(!JSON.stringify(r.json).includes('SECRET-ERROR-PAGE'));
  }
});

test('12 outgoing headers are exactly a fixed User-Agent and Accept, whatever the caller sent', async () => {
  const headerSets = [];
  for (const extra of [{}, { headers: { Authorization: 'Bearer SECRETTOKEN', apikey: 'KEY', Cookie: 'a=b' }, authorization: 'x', userAgent: 'evil' }]) {
    const f = seq(page());
    await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/', ...extra }));
    assert.equal(f.calls.length, 1);
    const h = new Headers(f.calls[0].init.headers);
    assert.deepEqual([...h.keys()].sort(), ['accept', 'user-agent']);
    assert.ok(h.get('user-agent').length > 0 && !/SECRETTOKEN|evil/.test(h.get('user-agent')));
    assert.ok(h.get('accept').length > 0);
    headerSets.push([...h.entries()].sort().join('|'));
  }
  assert.equal(headerSets[0], headerSets[1]);
});

test('13 errors are fixed strings: no page content, no thrown-error text', async () => {
  const f = async () => { throw new Error('boom SECRET-ERR-TEXT at 10.0.0.1'); };
  const r = await createFetchRecipeHandler({ fetchImpl: f, resolveHost: PUBLIC })(post({ url: 'https://example.com/' }));
  assert.equal(r.json.ok, false);
  assert.ok(refusedShape(r));
  assert.ok(!/SECRET-ERR-TEXT|10\.0\.0\.1/.test(JSON.stringify(r.json)));
  const g = async () => { throw 'a string with SECRET-THROWN'; };
  const r2 = await createFetchRecipeHandler({ fetchImpl: g, resolveHost: async () => { throw new Error('SECRET-DNS'); } })(post({ url: 'https://example.com/' }));
  assert.ok(!/SECRET/.test(JSON.stringify(r2.json)));
  // the same failure gives the same message regardless of the page behind it
  const a = await createFetchRecipeHandler({ fetchImpl: seq(page('AAA', 'text/html', 500)), resolveHost: PUBLIC })(post({ url: 'https://example.com/' }));
  const b = await createFetchRecipeHandler({ fetchImpl: seq(page('BBBBBB', 'text/html', 500)), resolveHost: PUBLIC })(post({ url: 'https://example.com/' }));
  assert.equal(a.json.error, b.json.error);
});

test('14 static: the core imports only node: modules and the guard', () => {
  const src = readFileSync(new URL('../scripts/lib/fetch-recipe-core.mjs', import.meta.url), 'utf8');
  const specs = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(specs.some(s => s === '../../supabase/functions/fetch-recipe/guard.js'), 'imports the guard');
  for (const s of specs) assert.ok(s.startsWith('node:') || s === '../../supabase/functions/fetch-recipe/guard.js', `unexpected import ${s}`);
  assert.ok(!/from\s+['"](?:\.\.\/)+js\//.test(src), 'must not import app code');
});

// ---- Part A2: the mock server. STATIC source checks only (weak: they prove strings, not behaviour). ----
const mockSrc = readFileSync(new URL('../scripts/mock-supabase.mjs', import.meta.url), 'utf8');

test('15 mock server: route present, imports the core and node:dns/promises (static)', () => {
  assert.ok(mockSrc.includes('/functions/v1/fetch-recipe'));
  assert.ok(/from\s+['"]\.\/lib\/fetch-recipe-core\.mjs['"]/.test(mockSrc));
  assert.ok(mockSrc.includes('createFetchRecipeHandler'));
  assert.ok(/from\s+['"]node:dns\/promises['"]/.test(mockSrc));
});

test('16 mock server listens on 127.0.0.1 only (static)', () => {
  const calls = [...mockSrc.matchAll(/\.listen\s*\(([^)]*)\)/g)].map(m => m[0]);
  assert.ok(calls.length >= 1, 'a listen call exists');
  for (const c of calls) assert.ok(c.includes('127.0.0.1'), `listen call must name 127.0.0.1: ${c}`);
  assert.ok(!/0\.0\.0\.0|['"]::['"]/.test(mockSrc), 'never binds all interfaces');
});

test('17 mock server header comment warns development only and mentions fetch-recipe; nothing under scripts/ is in the SW shell (static)', () => {
  const header = mockSrc.split('\n').slice(0, 15).filter(l => l.startsWith('//')).join('\n');
  assert.ok(/development only/i.test(header));
  assert.ok(/fetch-recipe/i.test(header));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(!/scripts\//.test(sw));
});
