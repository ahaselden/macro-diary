// Tests for docs/specs/recipe-import.md, server-side guard (supabase/functions/fetch-recipe/guard.js, pure plain ESM) plus
// WEAK static checks on the Deno handler index.ts (G1..G12, F1..F4). The handler itself cannot run under Node: DNS, redirects,
// timeouts, CORS and streaming limits are UNVERIFIED until the owner deploys and runs the manual checklist in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guardUrl = '../supabase/functions/fetch-recipe/guard.js';
const mod = () => import(guardUrl);
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8');
const ok = async u => (await mod()).checkUrl(u);
const rejected = async u => { const r = await ok(u); assert.equal(r.ok, false, `should be rejected: ${String(u).slice(0, 80)}`); assert.equal(typeof r.reason, 'string'); assert.ok(r.reason.length > 0); return r; };

test('G1 constants: MAX_BYTES 2 MiB, TIMEOUT_MS 8000, MAX_REDIRECTS 3', async () => {
  const g = await mod();
  assert.equal(g.MAX_BYTES, 2 * 1024 * 1024); assert.equal(g.TIMEOUT_MS, 8000); assert.equal(g.MAX_REDIRECTS, 3);
});

test('G2 checkUrl accepts ordinary public http(s) URLs and returns the normalised absolute URL', async () => {
  for (const u of ['https://example.com/recipe?x=1', 'http://example.com/', 'https://www.example.co.uk/a/b.html', 'https://example.com:443/x', 'http://example.com:80/x', 'HTTPS://EXAMPLE.COM/Path', 'https://xn--bcher-kva.example/', 'https://sub.domain.example.org/a?b=c&d=e']) {
    const r = await ok(u);
    assert.equal(r.ok, true, u); assert.equal(typeof r.url, 'string');
    assert.ok(/^https?:\/\//.test(r.url), r.url);
    assert.equal(new URL(r.url).hostname, new URL(u).hostname.toLowerCase());
  }
  assert.ok((await ok('https://example.com/recipe?x=1')).url.startsWith('https://example.com/recipe?x=1'));
  for (const u of ['http://93.184.216.34/', 'https://8.8.8.8/x', 'https://[2606:4700:4700::1111]/', 'http://1.1.1.1/']) assert.equal((await ok(u)).ok, true, `public IP literal ${u}`);
});

test('G3 checkUrl rejects non-strings, empty, and over-long URLs (2048 is the limit)', async () => {
  for (const bad of [undefined, null, 42, true, {}, [], ['https://example.com/'], () => 'https://example.com/', '', '   ']) await rejected(bad);
  const base = 'https://example.com/';
  assert.equal((await ok(base + 'a'.repeat(2048 - base.length))).ok, true, '2048 chars is allowed');
  await rejected(base + 'a'.repeat(2049 - base.length));
  await rejected(base + 'a'.repeat(100000));
});

test('G4 checkUrl: only http and https', async () => {
  for (const bad of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'gopher://example.com/', 'ws://example.com/', 'wss://example.com/', 'blob:https://example.com/x',
    '//example.com/x', 'example.com/x', 'example.com', '/relative', 'mailto:a@example.com']) await rejected(bad);
});

test('G5 checkUrl: no credentials in the URL', async () => {
  for (const bad of ['https://user:pass@example.com/', 'https://user@example.com/', 'https://:pw@example.com/', 'http://a:b@93.184.216.34/']) await rejected(bad);
});

test('G6 checkUrl: only the default ports (80/443, explicit or implied)', async () => {
  for (const bad of ['https://example.com:8443/', 'http://example.com:8080/', 'http://example.com:22/', 'https://example.com:3000/x', 'http://example.com:65535/', 'https://example.com:0/']) await rejected(bad);
});

test('G7 checkUrl: localhost, *.localhost, *.local, *.internal, single-label and empty hosts (also with a trailing dot or odd case)', async () => {
  for (const bad of ['http://localhost/', 'http://LOCALHOST/', 'http://localhost./', 'http://foo.localhost/', 'http://a.b.localhost./', 'http://printer.local/', 'http://nas.LOCAL/', 'http://db.internal/', 'http://metadata.google.internal/computeMetadata/v1/',
    'http://intranet/', 'http://router/', 'https://example/', 'http://', 'http:///x', 'http://./', 'http://[::1]:80/'])
    await rejected(bad);
});

test('G8 checkUrl: private, loopback, link-local, metadata and other reserved IPv4 literals are rejected', async () => {
  for (const ip of ['0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.255.255.254', '169.254.169.254', '169.254.0.1', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.0.2.5', '192.168.1.1', '192.168.0.254', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255'])
    await rejected(`http://${ip}/`);
  await rejected('https://169.254.169.254/latest/meta-data/iam/security-credentials/');
});

test('G9 checkUrl: IPv6 literals that are private/loopback/link-local/multicast/documentation/mapped are rejected', async () => {
  for (const ip of ['::', '::1', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'febf::1', 'ff02::1', '2001:db8::1', '2001:db8:ffff::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.169.254', '::127.0.0.1'])
    await rejected(`http://[${ip}]/`);
});

test('G10 checkUrl: odd IPv4 spellings are rejected after the URL parser normalises them', async () => {
  for (const host of ['2130706433', '0x7f.1', '0x7f.0.0.1', '0177.0.0.1', '127.1', '0x7f000001', '017700000001', '0', '0.0.0', '127.0.1', '3232235777', '0xa.0.0.1', '012.0.0.1', '0xA9FEA9FE', '2852039166', '167772161'])
    await rejected(`http://${host}/`);
});

test('G11 isPrivateAddress: true for every reserved range edge, false just outside them', async () => {
  const { isPrivateAddress } = await mod();
  const yes = ['0.0.0.0', '0.255.255.255', '10.0.0.0', '10.255.255.255', '100.64.0.0', '100.127.255.255', '127.0.0.1', '127.255.255.255', '169.254.0.0', '169.254.169.254', '169.254.255.255', '172.16.0.0', '172.31.255.255',
    '192.0.0.0', '192.0.0.255', '192.0.2.0', '192.0.2.255', '192.168.0.0', '192.168.255.255', '198.18.0.0', '198.19.255.255', '198.51.100.0', '198.51.100.255', '203.0.113.0', '203.0.113.255', '224.0.0.0', '239.255.255.255',
    '240.0.0.0', '254.255.255.255', '255.255.255.255',
    '::', '::1', 'fc00::', 'fc00::1', 'fdff:ffff::1', 'fe80::', 'fe80::1', 'FE80::1', 'febf::1', 'fe80::1%eth0', 'ff00::', 'ff02::1', '2001:db8::', '2001:db8::1', '2001:0db8:0:0:0:0:0:1', '2001:DB8:abcd::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7F00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:192.168.1.1', '::ffff:169.254.169.254', '::127.0.0.1', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:7f00:0001'];
  for (const ip of yes) assert.equal(isPrivateAddress(ip), true, ip);
  const no = ['1.1.1.1', '8.8.8.8', '93.184.216.34', '11.0.0.1', '9.255.255.255', '100.63.255.255', '100.128.0.1', '126.255.255.255', '128.0.0.1', '169.253.255.255', '169.255.0.0', '172.15.255.255', '172.32.0.0', '192.0.1.1', '192.0.3.0',
    '192.167.255.255', '192.169.0.0', '198.17.255.255', '198.20.0.0', '198.51.99.255', '198.51.101.0', '203.0.112.255', '203.0.114.0', '223.255.255.255',
    '2606:4700:4700::1111', '2001:4860:4860::8888', '2001:db7::1', '2001:db9::1', '2a00:1450:4001::1', 'fbff::1', '::ffff:8.8.8.8', '::ffff:808:808', '::ffff:93.184.216.34'];
  for (const ip of no) assert.equal(isPrivateAddress(ip), false, ip);
});

test('G12 isPrivateAddress fails CLOSED: anything that is not a valid IP address counts as private', async () => {
  const { isPrivateAddress } = await mod();
  for (const bad of ['', ' ', 'example.com', 'abc', '999.1.1.1', '1.2.3', '1.2.3.4.5', '1.2.3.256', '01.2.3.4x', '::g', ':::', '1:2:3:4:5:6:7:8:9', '[::1]', 'http://1.1.1.1', null, undefined, 42, {}, [], true])
    assert.equal(isPrivateAddress(bad), true, String(bad));
});

test('G13 resolveRedirect: relative and absolute Location values are resolved against the current URL and re-checked', async () => {
  const { resolveRedirect } = await mod();
  const cur = 'https://example.com/a/b';
  assert.equal(resolveRedirect(cur, '/c'), 'https://example.com/c');
  assert.equal(resolveRedirect(cur, 'c'), 'https://example.com/a/c');
  assert.equal(resolveRedirect(cur, '../d?x=1'), 'https://example.com/d?x=1');
  assert.equal(resolveRedirect(cur, '//cdn.example.org/x'), 'https://cdn.example.org/x');
  assert.equal(resolveRedirect(cur, 'https://other.example.org/recipe'), 'https://other.example.org/recipe');
  assert.equal(resolveRedirect(cur, 'http://other.example.org/recipe'), 'http://other.example.org/recipe', 'a downgrade to http is allowed (http is a valid scheme)');
  assert.equal(resolveRedirect('http://example.com/', 'https://example.com:443/x'), 'https://example.com/x');
});

test('G14 resolveRedirect: a redirect to a private address, bad scheme, credentials, odd port, bad host or garbage is refused (null)', async () => {
  const { resolveRedirect } = await mod();
  const cur = 'https://example.com/a';
  for (const loc of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://10.0.0.5/', 'http://localhost/', 'http://2130706433/', 'http://0x7f.1/', 'http://intranet/x', 'http://db.internal/',
    'javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com/', 'data:text/html,x', 'https://user:pw@example.com/', 'https://example.com:8443/', '', '   ', null, undefined, 42, {}, 'https://' + 'a'.repeat(3000) + '.example.com/'])
    assert.equal(resolveRedirect(cur, loc), null, String(loc).slice(0, 60));
  for (const badCur of [null, undefined, '', 'not a url', 42, 'javascript:1', {}]) assert.equal(resolveRedirect(badCur, '/x'), null, String(badCur));
});

test('G15 guard.js is plain pure ESM: no imports, no Deno/Node/browser globals, no network or clock', () => {
  const src = read(`${guardUrl}`);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/^\s*import\s/m.test(code), 'guard.js must not import anything');
  for (const banned of [/\bDeno\b/, /\bprocess\b/, /\bfetch\s*\(/, /\bdocument\b/, /\bwindow\b/, /\brequire\s*\(/, /\bDate\.now\b/, /\bMath\.random\b/, /\blocalStorage\b/, /\beval\s*\(/, /\bnew Function\b/])
    assert.ok(!banned.test(code), String(banned));
  assert.ok(/export\s+(?:function|const)\s+checkUrl\b|export\s*\{[^}]*\bcheckUrl\b/.test(src));
});

// ---- WEAK static checks on the Deno handler (it cannot run under Node) ----------------------------------------------

const handler = () => read('../supabase/functions/fetch-recipe/index.ts');
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('F1 (weak, source text only) index.ts imports guard.js and uses its limits, manual redirects, an abort, and DNS re-check of resolved addresses', () => {
  const code = noComments(handler());
  assert.match(code, /from\s*['"]\.\/guard\.js['"]/);
  for (const n of ['checkUrl', 'resolveRedirect', 'isPrivateAddress', 'MAX_BYTES', 'TIMEOUT_MS', 'MAX_REDIRECTS']) assert.match(code, new RegExp(`\\b${n}\\b`), n);
  assert.match(code, /redirect\s*:\s*['"]manual['"]/);
  assert.match(code, /AbortController|AbortSignal\.timeout/);
  assert.match(code, /Deno\.resolveDns|resolveDns/);
  assert.match(code, /User-Agent/i);
});

test('F2 (weak) index.ts answers CORS preflight with the required headers and only accepts the four content types', () => {
  const code = noComments(handler());
  assert.match(code, /OPTIONS/);
  assert.match(code, /Access-Control-Allow-Origin/i); assert.match(code, /Access-Control-Allow-Headers/i);
  for (const h of ['authorization', 'apikey', 'content-type', 'x-client-info']) assert.match(code, new RegExp(h, 'i'), h);
  for (const t of ['text/html', 'application/xhtml+xml', 'application/ld+json', 'text/plain']) assert.ok(code.includes(t), t);
  assert.match(code, /POST/);
  assert.match(code, /ok\s*:\s*(true|false)/);
});

test('F3 (weak) index.ts uses no secrets, no service_role, no database client, no storage; does not log URLs or page bodies', () => {
  const raw = handler(); const code = noComments(raw);
  assert.ok(!/service_role/i.test(raw), 'service_role must not appear anywhere, even in a comment');
  assert.ok(!/SUPABASE_SERVICE|SERVICE_ROLE|secret/i.test(code));
  assert.ok(!/createClient|supabase-js|@supabase|Deno\.openKv|Deno\.writeFile|Deno\.writeTextFile|localStorage|caches\.open/.test(code), 'never stores anything');
  for (const line of code.split('\n').filter(l => /\bconsole\.(log|info|debug|warn|error)\b/.test(l)))
    assert.ok(!/\b(url|body|html|text|page|location|target)\b/i.test(line), `logging page data: ${line.trim()}`);
  assert.ok(!/console\.(log|info|debug)/.test(code), 'no console.log/info/debug at all');
});

test('F4 (weak) index.ts never forwards the caller Authorization/apikey headers to the target site', () => {
  const code = noComments(handler());
  assert.ok(!/req(uest)?\.headers[^;\n]*(authorization|apikey)[^;\n]*fetch/i.test(code));
  assert.ok(!/headers\s*:\s*(req|request)\.headers/.test(code), 'outgoing headers must be built from scratch, not copied from the request');
  assert.ok(!/credentials\s*:\s*['"]include['"]/.test(code));
});
