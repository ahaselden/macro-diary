// Spec: docs/specs/sw-fresh-files.md. Runs sw.js in a vm sandbox with fakes (no browser, no deps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const swSource = readFileSync(join(root, 'sw.js'), 'utf8');
const ORIGIN = 'https://example.test';

const tick = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const resolve = x => new URL(typeof x === 'string' ? x : x.url, ORIGIN + '/').href;

class FakeResponse {
  constructor(body, { status = 200 } = {}) { this.body = body; this.status = status; this.ok = status >= 200 && status < 300; }
  clone() { return new FakeResponse(this.body, { status: this.status }); }
  async text() { return this.body; }
}
class FakeRequest {
  constructor(input, init = {}) {
    this.url = resolve(input);
    this.method = init.method ?? input.method ?? 'GET';
    this.cache = init.cache ?? input.cache ?? 'default';
    this.mode = input.mode ?? 'cors';
  }
  clone() { return this; }
}

// In-memory Cache API. addAll honours the cache mode of the Request it is given (strings become default-mode requests),
// and rejects on a network error or a non-ok status, like the real one.
function makeCaches(fetchFn) {
  const store = new Map();
  const mk = () => {
    const m = new Map();
    const c = {
      _m: m,
      async put(req, res) { m.set(resolve(req), res); },
      async match(req) { return m.get(resolve(req)); },
      async keys() { return [...m.keys()]; },
      async delete(req) { return m.delete(resolve(req)); },
      async addAll(reqs) {
        const rs = await Promise.all(reqs.map(r => fetchFn(typeof r === 'string' ? new FakeRequest(r) : r)));
        if (rs.some(r => !r.ok)) throw new TypeError('addAll: bad response');
        reqs.forEach((r, i) => m.set(resolve(r), rs[i]));
      },
    };
    return c;
  };
  return {
    _store: store,
    async open(name) { if (!store.has(name)) store.set(name, mk()); return store.get(name); },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
    async has(name) { return store.has(name); },
    async match(req) { for (const c of store.values()) { const r = await c.match(req); if (r) return r; } return undefined; },
  };
}

// opts.stale: urls (resolved) for which the "HTTP cache" holds an OLD copy, served unless the cache mode forces revalidation.
// opts.fail: predicate(url) -> 'network' | 404 | undefined.   opts.offline: every fetch rejects.
function boot(opts = {}) {
  const calls = [];
  const listeners = {};
  const flags = { skipWaiting: 0, claim: 0 };
  const staleSet = new Set((opts.stale ?? []).map(resolve));
  const state = { offline: !!opts.offline };
  const fetchFn = async (input, init = {}) => {
    const url = resolve(input);
    const cache = init.cache ?? input.cache ?? 'default';
    const method = init.method ?? input.method ?? 'GET';
    calls.push({ url, cache, method });
    if (state.offline) throw new TypeError('offline');
    const f = opts.fail?.(url);
    if (f === 'network') throw new TypeError('network error');
    if (f) return new FakeResponse('err', { status: f });
    const fromHttpCache = staleSet.has(url) && (cache === 'default' || cache === 'force-cache');
    return new FakeResponse(fromHttpCache ? `OLD ${url}` : `NEW ${url}`);
  };
  const caches = makeCaches(fetchFn);
  const self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: () => { flags.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => { flags.claim++; return Promise.resolve(); } },
  };
  const ctx = vm.createContext({
    self, caches, fetch: fetchFn, Request: FakeRequest, Response: FakeResponse, URL,
    location: { origin: ORIGIN }, console, Promise, setTimeout,
  });
  vm.runInContext(swSource, ctx, { filename: 'sw.js' });
  const consts = vm.runInContext('({ CACHE, OCR_CACHE, SHELL })', ctx);
  const install = async () => { let p; listeners.install({ waitUntil: x => { p = x; } }); await p; };
  const activate = async () => { let p; listeners.activate({ waitUntil: x => { p = x; } }); await p; };
  // Returns { handled, response } ; response is undefined when the worker did not call respondWith.
  const doFetch = async req => {
    let p; const waits = [];
    listeners.fetch({ request: req, respondWith: x => { p = Promise.resolve(x); }, waitUntil: x => waits.push(x) });
    if (!p) return { handled: false };
    let response, error;
    try { response = await p; } catch (e) { error = e; }
    await Promise.all(waits); await tick();
    return { handled: true, response, error };
  };
  return { ...consts, calls, caches, flags, state, install, activate, doFetch, listeners };
}
const get = (url, extra = {}) => ({ url: resolve(url), method: 'GET', cache: 'default', mode: 'cors', ...extra });

// ---------- source checks (weak: they only prove the words are there) ----------

test('S1 source: install does not use cache.addAll(SHELL) through the HTTP cache and asks for cache "reload"', () => {
  const install = swSource.slice(swSource.indexOf("addEventListener('install'"), swSource.indexOf("addEventListener('activate'"));
  assert.doesNotMatch(install, /addAll\(\s*SHELL\s*\)/, 'plain addAll(SHELL) reads the HTTP cache');
  assert.match(install, /cache:\s*['"]reload['"]/);
});

test('S2 source: the network-first fetch uses cache "no-cache", and the OCR / non-GET / cross-origin branches are still there', () => {
  const fetchPart = swSource.slice(swSource.indexOf("addEventListener('fetch'"));
  assert.match(fetchPart, /['"]no-cache['"]/);
  assert.match(fetchPart, /e\.request\.method !== 'GET' \|\| url\.origin !== location\.origin\) return/);
  assert.match(fetchPart, /\/vendor\/tesseract\//);
  assert.match(fetchPart, /OCR_CACHE/);
  assert.match(fetchPart, /caches\.match\('index\.html'\)/);
});

test('S3 CACHE is at least v56 (main is v54; the open Settings-tab PR uses v55)', () => {
  const m = swSource.match(/const CACHE = 'macro-diary-v(\d+)'/);
  assert.ok(m, 'CACHE constant not found');
  assert.ok(Number(m[1]) >= 56, `CACHE is v${m[1]}, expected v56 or later`);
});

// ---------- sandbox behaviour (stronger: runs the real file against fakes) ----------

test('B1 install fetches every SHELL file with cache "reload" and stores all of them in the new cache', async () => {
  const sw = boot();
  await sw.install();
  assert.ok(sw.SHELL.length > 50);
  for (const f of sw.SHELL) {
    const hits = sw.calls.filter(c => c.url === resolve(f));
    assert.ok(hits.length >= 1, `${f} was never fetched`);
    assert.ok(hits.every(h => h.cache === 'reload'), `${f} fetched with cache ${hits.map(h => h.cache)}`);
  }
  const cache = await sw.caches.open(sw.CACHE);
  assert.equal((await cache.keys()).length, sw.SHELL.length);
  assert.equal(sw.flags.skipWaiting, 1);
});

test('B2 install stores the FRESH copy even when the HTTP cache holds an old css/js (mixed-version bug)', async () => {
  const stale = ['css/components.css', 'js/ui/settings-view.js', 'js/ui/theme.js'];
  const sw = boot({ stale });
  await sw.install();
  const cache = await sw.caches.open(sw.CACHE);
  for (const f of stale) assert.equal(await (await cache.match(f)).text(), `NEW ${resolve(f)}`);
  assert.equal(await (await cache.match('index.html')).text(), `NEW ${resolve('index.html')}`);
});

test('B3 install is atomic: one network failure rejects install, old cache untouched, no skipWaiting', async () => {
  const sw = boot({ fail: u => (u.endsWith('/js/ui/theme.js') ? 'network' : undefined) });
  const old = await sw.caches.open('macro-diary-v54');
  await old.put('index.html', new FakeResponse('old index'));
  await assert.rejects(sw.install());
  assert.equal(await (await old.match('index.html')).text(), 'old index');
  assert.equal(sw.flags.skipWaiting, 0);
  if (await sw.caches.has(sw.CACHE)) assert.ok((await (await sw.caches.open(sw.CACHE)).keys()).length < sw.SHELL.length);
});

test('B4 install treats a 404 for any file as a failure (must not store the error page as the app file)', async () => {
  const sw = boot({ fail: u => (u.endsWith('/css/themes.css') ? 404 : undefined) });
  await assert.rejects(sw.install());
  assert.equal(sw.flags.skipWaiting, 0);
  if (await sw.caches.has(sw.CACHE)) {
    const c = await sw.caches.open(sw.CACHE);
    assert.ok((await c.keys()).length < sw.SHELL.length);
  }
});

test('B5 online fetch of css, js and the page revalidates (cache "no-cache") and returns/stores the fresh copy', async () => {
  const urls = ['css/base.css', 'js/main.js', 'index.html', './'];
  const sw = boot({ stale: urls });
  for (const u of urls) {
    const { handled, response } = await sw.doFetch(get(u, u === 'index.html' || u === './' ? { mode: 'navigate' } : {}));
    assert.ok(handled, u);
    assert.equal(await response.text(), `NEW ${resolve(u)}`, `${u} came from a stale copy`);
    const calls = sw.calls.filter(c => c.url === resolve(u));
    assert.ok(calls.length >= 1 && calls.every(c => c.cache === 'no-cache' || c.cache === 'reload'), `${u}: ${calls.map(c => c.cache)}`);
    const stored = await (await sw.caches.open(sw.CACHE)).match(u);
    assert.equal(await stored.text(), `NEW ${resolve(u)}`);
  }
});

test('B6 offline: falls back to the cached file, then to index.html for an uncached path', async () => {
  const sw = boot({ offline: true });
  const c = await sw.caches.open(sw.CACHE);
  await c.put('index.html', new FakeResponse('cached index'));
  await c.put('css/base.css', new FakeResponse('cached css'));
  let r = await sw.doFetch(get('css/base.css'));
  assert.equal(await r.response.text(), 'cached css');
  r = await sw.doFetch(get('js/never-cached.js'));
  assert.equal(await r.response.text(), 'cached index');
  r = await sw.doFetch(get('./', { mode: 'navigate' }));
  assert.equal(await r.response.text(), 'cached index');
});

test('B7 tesseract files stay cache-first: a hit makes no network call, a miss fetches once into the OCR cache only', async () => {
  const sw = boot();
  const o = await sw.caches.open(sw.OCR_CACHE);
  await o.put('vendor/tesseract/core.wasm', new FakeResponse('cached wasm'));
  let r = await sw.doFetch(get('vendor/tesseract/core.wasm'));
  assert.equal(await r.response.text(), 'cached wasm');
  assert.equal(sw.calls.length, 0);
  r = await sw.doFetch(get('vendor/tesseract/worker.js'));
  assert.equal(sw.calls.length, 1);
  assert.equal(await (await o.match('vendor/tesseract/worker.js')).text(), `NEW ${resolve('vendor/tesseract/worker.js')}`);
  assert.equal(await (await sw.caches.open(sw.CACHE)).match('vendor/tesseract/worker.js'), undefined);
});

test('B8 non-GET and cross-origin requests are not intercepted (no respondWith, no fetch by the worker)', async () => {
  const sw = boot();
  let r = await sw.doFetch(get('index.html', { method: 'POST' }));
  assert.equal(r.handled, false);
  r = await sw.doFetch({ url: 'https://world.openfoodfacts.org/api/v2/product/1.json', method: 'GET', cache: 'default', mode: 'cors' });
  assert.equal(r.handled, false);
  r = await sw.doFetch({ url: 'https://api.nal.usda.gov/fdc/v1/foods/search', method: 'GET', cache: 'default', mode: 'cors' });
  assert.equal(r.handled, false);
  assert.equal(sw.calls.length, 0);
});

test('B9 activate deletes every other cache but keeps the OCR cache and the current one, then claims clients', async () => {
  const sw = boot();
  for (const n of ['macro-diary-v50', 'macro-diary-v54', 'something-else', sw.OCR_CACHE, sw.CACHE]) await sw.caches.open(n);
  await sw.activate();
  assert.deepEqual((await sw.caches.keys()).sort(), [sw.CACHE, sw.OCR_CACHE].sort());
  assert.equal(sw.flags.claim, 1);
});
