// Spec: docs/specs/probe-remember-client-id.md. Test-designer file, written BEFORE the implementation. All data is made up.
// R1-R8 run the page's module script against a FAKE DOM (the script text is taken from index.html, its imports are resolved by this test,
// so the real checkClientId and DEFAULT_CLIENT_ID are used; the fake DOM is small, so this is better than a text check but is still not a browser).
// R9-R11 are WEAK source-text checks (strings present or absent, not behaviour). R12-R13 are docs checks (WEAK: they prove words, not quality).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PAGE_URL = new URL('../tools/google-health-probe/index.html', import.meta.url);
const html = () => readFileSync(PAGE_URL, 'utf8');
const stripComments = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const moduleScript = () => { const m = html().match(/<script\b[^>]*\btype\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/i); assert.ok(m, 'a <script type="module"> exists'); return m[1]; };
const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g;

const MSG_EMPTY = 'Enter a Client ID first.';
const MSG_SECRET = 'That looks like a client secret, which must never be pasted here. Use the Client ID, which ends in .apps.googleusercontent.com.';
const MSG_SHAPE = 'That does not look like a Client ID. It should end in .apps.googleusercontent.com.';
const FAKE_ID = 'fake-test-client-123.apps.googleusercontent.com';     // valid shape, obviously not real
const FAKE_SECRET = 'GOCSPX-not-a-real-secret-value';                // built here; it must never appear in the page

// Run the page script with a fake document. Returns handles to inspect.
async function boot() {
  const els = {};
  const mk = id => {
    const e = { id, value: '', textContent: '', disabled: false, checked: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, click() { return this.listeners.click && this.listeners.click(); } };
    if (id === 'days') e.value = '3';
    return e;
  };
  const document = { getElementById: id => (els[id] = els[id] || mk(id)) };
  const gis = { configs: [], requests: 0 };
  const window = { google: { accounts: { oauth2: { initTokenClient: cfg => { gis.configs.push(cfg); return { requestAccessToken() { gis.requests++; } }; } } } } };
  const specs = [];
  const body = moduleScript().replace(IMPORT_RE, (_, names, spec) => {
    specs.push(spec);
    const n = specs.length - 1;
    return 'const {' + names.split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': ')).join(', ') + '} = __mods[' + n + '];';
  });
  const mods = [];
  for (const s of specs) mods.push(await import(new URL(s, PAGE_URL).href));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('document', 'window', 'fetch', 'navigator', 'setTimeout', '__mods', body);
  await fn(document, window, () => Promise.reject(new Error('no network in this test')), { clipboard: { writeText: async () => {} } }, () => 0, mods);
  return { el: id => document.getElementById(id), gis, specs };
}
const click = h => h.el('signIn').click();

test('R1. on load #clientId holds the built-in DEFAULT_CLIENT_ID (set by the script, not by the HTML)', async () => {
  const { DEFAULT_CLIENT_ID } = await import('../js/services/google-health-api.js');
  assert.ok(typeof DEFAULT_CLIENT_ID === 'string' && DEFAULT_CLIENT_ID.length > 20);
  const h = await boot();
  assert.equal(h.el('clientId').value, DEFAULT_CLIENT_ID);
});

test('R2. clicking Sign in with the pre-filled value starts sign-in with exactly the built-in ID', async () => {
  const { DEFAULT_CLIENT_ID } = await import('../js/services/google-health-api.js');
  const h = await boot(); click(h);
  assert.equal(h.gis.configs.length, 1); assert.equal(h.gis.requests, 1);
  assert.equal(h.gis.configs[0].client_id, DEFAULT_CLIENT_ID);
});

test('R3. an emptied box (or only spaces) is refused with "Enter a Client ID first." and no sign-in starts', async () => {
  for (const v of ['', '   ', '\t\n']) {
    const h = await boot(); h.el('clientId').value = v; click(h);
    assert.equal(h.el('status').textContent, MSG_EMPTY, JSON.stringify(v)); assert.equal(h.gis.configs.length, 0); assert.equal(h.gis.requests, 0);
  }
});

test('R4. a client secret (GOCSPX-, any case, with spaces around) is refused, no sign-in starts, and the box is cleared', async () => {
  for (const v of [FAKE_SECRET, '  ' + FAKE_SECRET + '  ', FAKE_SECRET.toLowerCase(), 'abc.apps.googleusercontent.com GOCSPX-xyz']) {
    const h = await boot(); h.el('clientId').value = v; click(h);
    assert.equal(h.el('status').textContent, MSG_SECRET, v); assert.equal(h.el('clientId').value, '', 'box cleared for ' + v); assert.equal(h.gis.configs.length, 0); assert.equal(h.gis.requests, 0);
  }
});

test('R5. a malformed value is refused with the shape message and no sign-in starts (the box is left as typed)', async () => {
  for (const v of ['hello', 'stub-client.example', 'x.apps.googleusercontent.com', 'a b c.apps.googleusercontent.com', 'https://evil.example/' + FAKE_ID, '<img src=x onerror=alert(1)>', '__proto__', 'a'.repeat(5000)]) {
    const h = await boot(); h.el('clientId').value = v; click(h);
    assert.equal(h.el('status').textContent, MSG_SHAPE, v.slice(0, 40)); assert.equal(h.gis.configs.length, 0); assert.equal(h.gis.requests, 0);
  }
});

test('R6. a refusal message never echoes what was typed (secret, malformed, markup)', async () => {
  for (const v of [FAKE_SECRET, 'my-very-unusual-typed-text-77', '<b>bold-marker-88</b>']) {
    const h = await boot(); h.el('clientId').value = v; click(h);
    const s = h.el('status').textContent;
    assert.ok(s.length > 0 && !s.includes(v) && !s.includes('GOCSPX-') && !s.includes('unusual-typed') && !s.includes('bold-marker'), s);
    assert.ok(!h.el('summary').textContent.includes(v) && !h.el('gisError').textContent.includes(v));
  }
});

test('R7. a valid ID typed over the default (spaces around it) is trimmed and used; it is not echoed in the status or the result summary', async () => {
  const h = await boot(); h.el('clientId').value = '  ' + FAKE_ID + '  '; click(h);
  assert.equal(h.gis.configs.length, 1); assert.equal(h.gis.configs[0].client_id, FAKE_ID);
  for (const id of ['status', 'summary', 'tokenInfo', 'gisError', 'check-identity', 'check-steps', 'check-sleep', 'check-exercise']) assert.ok(!h.el(id).textContent.includes(FAKE_ID), id + ' must not show the Client ID');
});

test('R8. the page uses no storage: boot and every click path run with no storage global, and the code has no storage or saved-device-ID reference', async () => {
  // Node has no localStorage/sessionStorage/indexedDB global, so any use in the script would throw a ReferenceError inside boot() or the click.
  assert.equal(typeof globalThis.localStorage, 'undefined');
  const h = await boot(); click(h); h.el('clientId').value = ''; click(h); h.el('clientId').value = FAKE_SECRET; click(h);
  const code = stripComments(html());
  assert.doesNotMatch(code, /\b(localStorage|sessionStorage|indexedDB|caches)\b|document\.cookie|macrodiary\.googleclient|createClientIdStore|CLIENT_ID_KEY/);
});

// ---------------------------------------------------------------- WEAK source checks
test('R9. (weak) the module script imports the probe helpers plus DEFAULT_CLIENT_ID and checkClientId from exactly two named relative paths; no other import', () => {
  const code = stripComments(moduleScript());
  const imps = [...code.matchAll(IMPORT_RE)].map(m => ({ names: m[1].split(',').map(s => s.trim()).filter(Boolean), spec: m[2] }));
  assert.deepEqual(imps.map(i => i.spec).sort(), ['../../js/domain/google-health-api.js', '../../js/services/google-health-api.js', './probe.js']);
  const by = Object.fromEntries(imps.map(i => [i.spec, i.names]));
  assert.deepEqual(by['../../js/services/google-health-api.js'], ['DEFAULT_CLIENT_ID']);
  assert.deepEqual(by['../../js/domain/google-health-api.js'], ['checkClientId']);
  assert.doesNotMatch(code, /\bimport\s*\(|from\s*['"]https?:|@import/);
  assert.match(code, /checkClientId\s*\(/); assert.match(code, /DEFAULT_CLIENT_ID/);
  const scripts = [...html().matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  assert.deepEqual(scripts, ['https://accounts.google.com/gsi/client'], 'the only external script is still Google Identity Services');
});

test('R10. (weak) the page does not hard-code a Client ID or a secret: #clientId has no value attribute, no *.apps.googleusercontent.com ID, no real default literal, no GOCSPX- literal', async () => {
  const h = html(), all = h + '\n' + read('tools/google-health-probe/probe.js');
  const tag = h.match(/<input\b[^>]*\bid\s*=\s*["']clientId["'][^>]*>/);
  assert.ok(tag, '#clientId input exists'); assert.doesNotMatch(tag[0], /\bvalue\s*=/i);
  assert.doesNotMatch(all, /[A-Za-z0-9_-]{10,}\.apps\.googleusercontent\.com/);
  const { DEFAULT_CLIENT_ID } = await import('../js/services/google-health-api.js');
  assert.ok(!all.includes(DEFAULT_CLIENT_ID) && !all.includes(DEFAULT_CLIENT_ID.split('.')[0]), 'the real default comes from the import');
  assert.doesNotMatch(all, /GOCSPX-|client_secret|ya29\./i);
  assert.match(stripComments(moduleScript()), /\$\(\s*['"]clientId['"]\s*\)\.value\s*=(?!=)|getElementById\(\s*['"]clientId['"]\s*\)\.value\s*=(?!=)/, 'the script assigns #clientId.value');
});

test('R11. (weak) the label for #clientId says it is pre-filled with the built-in ID and can be replaced, and still says never a secret; contract ids stay', () => {
  const h = html();
  const m = h.match(/<label\b[^>]*\bfor\s*=\s*["']clientId["'][^>]*>([\s\S]*?)<\/label>/);
  assert.ok(m, 'label for clientId');
  const t = m[1].replace(/<[^>]*>/g, ' ');
  assert.match(t, /pre-?filled/i); assert.match(t, /built-in/i); assert.match(t, /replace/i); assert.match(t, /secret/i); assert.match(t, /\.apps\.googleusercontent\.com/);
  for (const id of ['clientId', 'days', 'signIn', 'showNumbers', 'copySummary', 'status', 'tokenInfo', 'gisError', 'check-identity', 'check-steps', 'check-sleep', 'check-exercise', 'summary']) assert.match(h, new RegExp('\\bid\\s*=\\s*["\']' + id + '["\']'), 'id ' + id);
});

// ---------------------------------------------------------------- docs deliverables (WEAK)
test('R12. docs/BACKLOG.md has an unticked item 28 about replacing the built-in Client ID before going public', () => {
  const lines = read('docs/BACKLOG.md').split('\n');
  const line = lines.find(l => /^- \[ \] \*\*28\./.test(l));
  assert.ok(line, 'an unticked "- [ ] **28." line');
  assert.match(line, /Before making the app public: replace the built-in Google Client ID and finish Google's requirements/);
  for (const k of ['DEFAULT_CLIENT_ID', '100 users', 'verification', 'privacy policy', 'Authorized JavaScript origins']) assert.ok(line.includes(k), 'item 28 mentions ' + k);
  assert.match(line, /google-health-probe/); assert.match(line, /(change|replace|update)/i);
  assert.equal(lines.filter(l => /^- \[.\] \*\*28\./.test(l)).length, 1, 'only one item numbered 28');
});

test('R13. KNOWN-ISSUES has a row for the probe Client ID, and DECISIONS has a D66 heading about it', () => {
  const ki = read('docs/KNOWN-ISSUES.md').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l) && /probe/i.test(l) && /Client ID/.test(l) && /(not remembered|typed|default)/i.test(l));
  assert.ok(ki.length >= 1, 'a KNOWN-ISSUES row about the probe Client ID being pre-filled and a typed one not remembered');
  assert.match(read('docs/DECISIONS.md'), /^## D66\..*probe.*Client ID|^## D66\..*Client ID.*probe/im);
});
