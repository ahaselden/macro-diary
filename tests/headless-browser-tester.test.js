import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');
const APP = 'http://127.0.0.1:5123';
const OFF = 'https://world.openfoodfacts.org/api/v2/product/3017620422003.json';

async function mod() { return import('../tools/browser-test/stubs.mjs'); }
async function route(url, opts) { return (await mod()).routeFor(url, opts); }

test('1. app origin continues, incl. localhost alias on same port, not another port', async () => {
  assert.deepEqual(await route(APP + '/index.html', { appOrigin: APP, stubs: [] }), { action: 'continue' });
  assert.deepEqual(await route('http://localhost:5123/js/main.js', { appOrigin: APP, stubs: [] }), { action: 'continue' });
  assert.deepEqual(await route('http://127.0.0.1:5123/', { appOrigin: 'http://localhost:5123', stubs: [] }), { action: 'continue' });
  assert.deepEqual(await route('http://127.0.0.1:9999/x', { appOrigin: APP, stubs: [] }), { action: 'abort' });
});

test('2. string stub fulfils; first match wins', async () => {
  const r = await route(OFF, { appOrigin: APP, stubs: [
    { match: 'openfoodfacts', json: { n: 1 } }, { match: 'openfoodfacts.org', json: { n: 2 } }] });
  assert.equal(r.action, 'fulfill');
  assert.equal(r.body, '{"n":1}');
});

test('3. json serialised, status 200 and application/json by default, overrides honoured', async () => {
  const r = await route(OFF, { appOrigin: APP, stubs: [{ match: 'openfoodfacts', json: { status: 0 } }] });
  assert.equal(r.status, 200);
  assert.equal(r.contentType, 'application/json');
  assert.deepEqual(JSON.parse(r.body), { status: 0 });
  const r2 = await route(OFF, { appOrigin: APP, stubs: [{ match: 'openfoodfacts', status: 404, json: [], contentType: 'application/x+json' }] });
  assert.equal(r2.status, 404);
  assert.equal(r2.contentType, 'application/x+json');
  assert.equal(r2.body, '[]');
});

test('4. body stub defaults to text/plain; RegExp match works', async () => {
  const r = await route('https://api.nal.usda.gov/fdc/v1/foods/search?q=egg', { appOrigin: APP, stubs: [{ match: /fdc\/v1\/foods\/search/, body: 'hello' }] });
  assert.deepEqual(r, { action: 'fulfill', status: 200, contentType: 'text/plain', body: 'hello' });
});

test('5. unmatched external URLs abort', async () => {
  for (const u of [OFF, 'https://api.nal.usda.gov/fdc/v1/foods/search', 'https://abc.supabase.co/rest/v1/x', 'https://fonts.googleapis.com/css?family=X', 'http://example.com/']) {
    assert.deepEqual(await route(u, { appOrigin: APP, stubs: [{ match: 'nomatch', json: 1 }] }), { action: 'abort' }, u);
  }
});

test('6. data:, blob:, about: continue', async () => {
  for (const u of ['data:text/plain,hi', 'blob:http://127.0.0.1:5123/abc', 'about:blank']) {
    assert.deepEqual(await route(u, { appOrigin: APP, stubs: [] }), { action: 'continue' }, u);
  }
});

test('7. hostile input never throws and aborts / ignores bad stubs', async () => {
  const { routeFor } = await mod();
  for (const u of [undefined, null, 42, {}, [], Symbol('x'), '', 'not a url', 'x'.repeat(1e6)]) {
    assert.deepEqual(routeFor(u, { appOrigin: APP, stubs: [] }), { action: 'abort' });
  }
  const bad = { get match() { throw new Error('boom'); } };
  const badRe = { match: Object.create(RegExp.prototype), json: 1 };
  for (const stubs of [undefined, null, 'x', 5, {}, [null, undefined, 3, 'x', bad, badRe]]) {
    assert.deepEqual(routeFor(OFF, { appOrigin: APP, stubs }), { action: 'abort' });
  }
  const good = routeFor(OFF, { appOrigin: APP, stubs: [bad, null, badRe, { match: 'openfoodfacts', json: { ok: 1 } }] });
  assert.equal(good.action, 'fulfill');
  assert.equal(good.body, '{"ok":1}');
  assert.deepEqual(routeFor(OFF), { action: 'abort' });
  assert.deepEqual(routeFor(OFF, null), { action: 'abort' });
  assert.deepEqual(routeFor(OFF, { stubs: [{ match: 'openfoodfacts', json: 1 }] }).action, 'fulfill');
});

test('8. app origin cannot be intercepted by stubs', async () => {
  const r = await route(APP + '/js/main.js', { appOrigin: APP, stubs: [{ match: '', body: 'pwned' }, { match: '127.0.0.1', body: 'pwned' }] });
  assert.deepEqual(r, { action: 'continue' });
});

test('9. summarize counts, ok, PASS/FAIL lines, final tally', async () => {
  const { summarize } = await mod();
  const s = summarize([
    { name: 'smoke', ok: true },
    { name: 'barcode', ok: false, error: 'selector missing', consoleErrors: ['Uncaught TypeError: x'] }]);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.ok, false);
  assert.match(s.text, /PASS.*smoke/);
  assert.match(s.text, /FAIL.*barcode/);
  assert.match(s.text, /selector missing/);
  assert.match(s.text, /Uncaught TypeError: x/);
  assert.match(s.text, /1 passed, 1 failed/);
  const all = summarize([{ name: 'a', ok: true }, { name: 'b', ok: true }]);
  assert.equal(all.ok, true);
  assert.match(all.text, /2 passed, 0 failed/);
});

test('10. summarize: empty/non-array not ok; malformed tolerated; error truncated', async () => {
  const { summarize } = await mod();
  for (const v of [[], undefined, null, 'x', 7, {}]) {
    const s = summarize(v);
    assert.equal(s.ok, false);
    assert.match(s.text, /no scenarios/i);
  }
  const s = summarize([null, {}, 'x', { name: 'n', ok: false, consoleErrors: 'nope' }, { name: 'ok', ok: true }]);
  assert.equal(typeof s.text, 'string');
  assert.equal(s.passed, 1, 'only the well-formed ok entry counts as passed');
  assert.equal(s.ok, false);
  const long = summarize([{ name: 'big', ok: false, error: 'E'.repeat(5000) }]);
  assert.ok(!long.text.includes('E'.repeat(501)), 'error not truncated');
  assert.ok(long.text.includes('E'.repeat(500)), 'truncated too much');
});

test('11. isLocalUrl only local http(s) hosts', async () => {
  const { isLocalUrl } = await mod();
  for (const u of ['http://localhost:8080/', 'https://localhost/', 'http://127.0.0.1:1/x', 'http://[::1]:8080/']) assert.equal(isLocalUrl(u), true, u);
  for (const u of ['http://localhost.evil.com/', 'http://127.0.0.1.evil.com/', 'http://evil.com@127.0.0.1.evil.com/', 'https://example.com', 'file:///C:/x', 'ftp://localhost/', 'data:text/plain,x', '', 'localhost', undefined, null, 5, {}]) {
    assert.equal(isLocalUrl(u), false, String(u));
  }
});

test('12. root package.json has no dependencies (weak static check)', () => {
  const p = JSON.parse(read('package.json'));
  assert.ok(!('dependencies' in p));
  assert.ok(!('devDependencies' in p));
});

test('13. tools/browser-test/package.json private, playwright-core only (weak)', () => {
  assert.ok(existsSync(join(root, 'tools/browser-test/package.json')));
  const p = JSON.parse(read('tools/browser-test/package.json'));
  assert.equal(p.private, true);
  assert.deepEqual(Object.keys(p.dependencies || {}), ['playwright-core']);
  assert.ok(!p.devDependencies || Object.keys(p.devDependencies).length === 0);
});

test('14. .gitignore ignores tools/browser-test/node_modules (weak)', () => {
  assert.match(read('.gitignore'), /^\/?tools\/browser-test\/node_modules\/?\s*$/m);
});

test('15. no Co-Authored-By under tools/ (excl. node_modules) or in the agent file (weak)', () => {
  const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.name === 'node_modules' ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const files = [...walk(join(root, 'tools')), join(root, '.claude/agents/browser-tester.md')];
  assert.ok(files.length > 1, 'tools/ should have files');
  for (const f of files) {
    assert.ok(existsSync(f), f + ' missing');
    assert.ok(!/Co-Authored-By/i.test(readFileSync(f, 'utf8')), f);
  }
});

test('16. sw.js does not mention tools/ (weak)', () => {
  assert.ok(!/tools\//.test(read('sw.js')));
});

test('17. agent definition: name, description, no Edit tool, safety statements (weak)', () => {
  const t = read('.claude/agents/browser-tester.md');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t);
  assert.ok(fm, 'frontmatter');
  assert.match(fm[1], /^name:\s*browser-tester\s*$/m);
  assert.match(fm[1], /^description:\s*\S+/m);
  const tools = /^tools:\s*(.*)$/m.exec(fm[1]);
  assert.ok(tools, 'tools line');
  assert.ok(!/\bEdit\b/.test(tools[1]), 'must not have Edit');
  const body = t.slice(fm[0].length);
  assert.match(body, /never edit/i);
  for (const x of ['js/', 'css/', 'sw.js']) assert.ok(body.includes(x), x);
  assert.match(body, /never push|not push|never.*push/i);
  assert.match(body, /merge/i);
  assert.match(body, /own port|free port/i);
  assert.match(body, /stop.*server|server.*stop/i);
});

test('18. runner, lib and scenarios exist; scenarios export default async (weak)', () => {
  for (const f of ['run.mjs', 'lib.mjs']) assert.ok(existsSync(join(root, 'tools/browser-test', f)), f);
  for (const f of ['smoke.mjs', 'barcode-from-photo.mjs']) {
    const p = 'tools/browser-test/scenarios/' + f;
    assert.ok(existsSync(join(root, p)), p);
    assert.match(read(p), /export\s+default\s+async/);
  }
});

test('19. README: install, Windows/Edge, and what is NOT covered (weak)', () => {
  const r = read('tools/browser-test/README.md');
  assert.match(r, /npm install/);
  assert.match(r, /Edge/);
  assert.match(r, /Windows/);
  assert.match(r, /camera/i);
  assert.match(r, /wake lock/i);
  assert.match(r, /food[- ]database|USDA|Open Food Facts/i);
  assert.match(r, /not covered|NOT covered|does not cover|cannot/i);
});
