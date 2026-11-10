// Spec: docs/specs/sync-defaults-and-setup-link.md (behaviours D1-D14, U1-U8)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_SYNC } from '../js/services/sync/defaults.js';
import { createSyncConfig, effectiveConnection, normalizeUrl, isConfigured } from '../js/services/sync/config.js';
import { createSyncService } from '../js/services/sync/index.js';
import { createMemoryAdapter } from '../js/services/sync/memory-adapter.js';
import { defaults as emptyState } from '../js/core/schema.js';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const src = p => readFileSync(root + p, 'utf8');
const store = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const jwt = role => `h.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.s`;
const ANON = jwt('anon') + 'x'.repeat(20);
const MINE = { url: 'https://mine.supabase.co', anonKey: 'sb_publishable_' + 'm'.repeat(20) };
const DEF = { url: 'https://default.supabase.co/', anonKey: 'sb_publishable_' + 'd'.repeat(20) };
const NODEF = { url: '', anonKey: '' };
const NONE = { url: '', anonKey: '', source: 'none' };

// ---------- defaults.js ----------
test('D1 DEFAULT_SYNC exists with string url and anonKey', () => {
  assert.equal(typeof DEFAULT_SYNC.url, 'string'); assert.equal(typeof DEFAULT_SYNC.anonKey, 'string');
});
test('D2 DEFAULT_SYNC is either empty or a valid, non-secret https project (never service_role/sb_secret_)', () => {
  const { url, anonKey } = DEFAULT_SYNC;
  if (!url && !anonKey) return;   // shipped as empty placeholders until the owner decides
  assert.ok(normalizeUrl(url), 'url must be https'); assert.ok(anonKey.length > 20);
  assert.equal(/service_role|sb_secret_/i.test(anonKey), false);
  const part = anonKey.split('.')[1];
  if (part) assert.notEqual(JSON.parse(Buffer.from(part, 'base64url').toString() || '{}').role, 'service_role');
});
test('D3 defaults.js source contains no service_role / secret / password / token text', () => {
  assert.ok(existsSync(root + 'js/services/sync/defaults.js'));
  assert.equal(/service_role|sb_secret_|password|refresh_token|access_token/i.test(src('js/services/sync/defaults.js')), false);
});

// ---------- effectiveConnection ----------
test('D4 empty cfg + valid defaults -> default (url normalised, key as given)', () => {
  assert.deepEqual(effectiveConnection({}, DEF), { url: 'https://default.supabase.co', anonKey: DEF.anonKey, source: 'default' });
});
test('D5 empty cfg + empty/invalid defaults -> none', () => {
  for (const d of [NODEF, { url: 'http://x.supabase.co', anonKey: DEF.anonKey }, { url: DEF.url, anonKey: 'short' }, { url: DEF.url, anonKey: 'x'.repeat(20) }, null, undefined, {}, 'x'])
    assert.deepEqual(effectiveConnection({}, d), NONE, JSON.stringify(d));
});
test('D6 user-set url/key win over valid defaults -> custom', () => {
  assert.deepEqual(effectiveConnection({ url: MINE.url + '/', anonKey: MINE.anonKey }, DEF), { url: MINE.url, anonKey: MINE.anonKey, source: 'custom' });
});
test('D7 useOwnProject:true with own values -> custom, even when defaults are valid', () => {
  assert.equal(effectiveConnection({ useOwnProject: true, ...MINE }, DEF).source, 'custom');
  assert.equal(effectiveConnection({ useOwnProject: true, ...MINE }, DEF).url, MINE.url);
});
test('D8 useOwnProject:true must never fall back to the default project', () => {
  const r = effectiveConnection({ useOwnProject: true, url: '', anonKey: '' }, DEF);
  assert.notEqual(r.source, 'default'); assert.notEqual(r.url, 'https://default.supabase.co');
});
test('D9 with empty defaults, effectiveConnection equals the old cfg behaviour (custom iff isConfigured, else none)', () => {
  const cases = [{}, { url: MINE.url, anonKey: MINE.anonKey }, { url: 'http://a.supabase.co', anonKey: MINE.anonKey }, { url: MINE.url, anonKey: 'short' }, { useOwnProject: false, ...MINE }];
  for (const c of cases) {
    const r = effectiveConnection(c, NODEF);
    assert.equal(!!(normalizeUrl(r.url) && r.anonKey && r.anonKey.length > 20), isConfigured(c), JSON.stringify(c));
    if (isConfigured(c)) assert.deepEqual(r, { url: normalizeUrl(c.url), anonKey: c.anonKey, source: 'custom' });
    else assert.notEqual(r.source, 'default');
  }
});
test('D10 effectiveConnection is pure and never throws on hostile input', () => {
  const cfg = Object.freeze({ url: MINE.url }); const d = Object.freeze({ ...DEF });
  assert.doesNotThrow(() => effectiveConnection(cfg, d));
  for (const c of [null, undefined, 5, 'x', [], { url: {}, anonKey: [] }, { __proto__: { url: MINE.url } }]) assert.doesNotThrow(() => effectiveConnection(c, DEF));
  assert.deepEqual(effectiveConnection(null, NODEF), NONE);
});

// ---------- sync service ----------
const mk = ({ cfg = {}, defaults, fetchImpl, adapterFactory } = {}) => {
  const config = createSyncConfig(store()); config.set(cfg);
  const statuses = [];
  const svc = createSyncService({ config, getState: emptyState, applyState() {}, onStatus: s => statuses.push(s.state), defaults, fetchImpl, adapterFactory, now: () => 1000 });
  return { svc, config, statuses };
};
test('D11 service with empty defaults is unchanged: unconfigured, sign-in refused', async () => {
  const { svc } = mk({ defaults: NODEF });
  assert.equal(svc.status().state, 'unconfigured');
  await assert.rejects(() => svc.signIn('a@b.c', 'pw'), /project URL/i);
  assert.deepEqual(await svc.syncNow(), { ok: false, error: 'Not signed in' });
});
test('D12 service with valid defaults and empty cfg: status signed-out, and signIn contacts the DEFAULT project with the default key', async () => {
  const calls = [];
  const fetchImpl = async (u, o) => { calls.push({ u: String(u), o }); return { ok: false, status: 400, json: async () => ({ error: 'x' }), text: async () => '{}' }; };
  const { svc } = mk({ defaults: DEF, fetchImpl });
  assert.equal(svc.status().state, 'signed-out');
  await svc.signIn('a@b.c', 'pw').catch(() => {});
  assert.ok(calls.length >= 1, 'a request was made');
  assert.ok(calls[0].u.startsWith('https://default.supabase.co/'), calls[0].u);
  assert.ok(JSON.stringify(calls[0].o).includes(DEF.anonKey), 'default key sent as apikey');
});
test('D13 service: signed in on a default project syncs through the adapter built with the EFFECTIVE url/key; custom wins when set', async () => {
  const seen = [];
  const adapterFactory = c => { seen.push({ url: c.url, anonKey: c.anonKey }); return createMemoryAdapter(); };
  const a = mk({ defaults: DEF, adapterFactory, cfg: { session: { refresh_token: 'r' } } });
  assert.equal(a.svc.status().state, 'idle');
  assert.equal((await a.svc.syncNow()).ok, true);
  assert.deepEqual(seen[0], { url: 'https://default.supabase.co', anonKey: DEF.anonKey });
  const b = mk({ defaults: DEF, adapterFactory, cfg: { ...MINE, useOwnProject: true, session: { refresh_token: 'r' } } });
  await b.svc.syncNow();
  assert.deepEqual(seen[1], MINE);
});
test('D14 configure() stores the custom project and marks useOwnProject:true; validation unchanged', () => {
  const { svc, config } = mk({ defaults: DEF });
  assert.match(svc.configure({ url: 'http://abc.supabase.co', anonKey: ANON }), /https/);
  assert.match(svc.configure({ url: MINE.url, anonKey: jwt('service_role') + 'x'.repeat(20) }), /service_role/);
  assert.equal(config.get().useOwnProject, undefined);   // refused values change nothing
  assert.equal(svc.configure({ url: MINE.url, anonKey: MINE.anonKey }), '');
  assert.equal(config.get().useOwnProject, true);
  assert.equal(svc.status().state, 'signed-out');
});

// ---------- static source checks (weak: see spec) ----------
const view = () => src('js/ui/sync-view.js');
test('U1 sync-view offers "Advanced: use my own project" and "Add another device"', () => {
  assert.match(view(), /Advanced: use my own project/); assert.match(view(), /Add another device/);
});
test('U2 sync-view wording says the link has URL and key only (no password/session)', () => {
  assert.match(view(), /(project address|URL)[^`]*(and|\+)[^`]*key[^`]*(no|not|never)[^`]*(password|sign-in|session)/i);
});
test('U3 sync-view escapes every url/key/link interpolation it renders', () => {
  const bad = [...view().matchAll(/\$\{([^}]*)\}/g)].map(m => m[1]).filter(e => /\b(link|setupLink|url|anonKey|key)\b/i.test(e) && !/esc\(/.test(e));
  assert.deepEqual(bad, []);
});
test('U4 main.js reads the setup link from location.hash and strips it with history.replaceState', () => {
  const m = src('js/main.js');
  assert.match(m, /parseSetupLink/); assert.match(m, /location\.hash/); assert.match(m, /history\.replaceState/);
});
test('U5 main.js uses planSetupLinkApply (a signed-in device is never switched silently)', () => assert.match(src('js/main.js'), /planSetupLinkApply/));
test('U6 setup-link.js never touches query strings, storage, network or the DOM', () => {
  const s = src('js/services/sync/setup-link.js');
  assert.equal(/searchParams|location\.search|localStorage|fetch\(|document\./.test(s), false);
});
test('U7 setup-link.js imports only from the sync config (no UI/DOM layers)', () => {
  const imports = [...src('js/services/sync/setup-link.js').matchAll(/from\s+'([^']+)'/g)].map(m => m[1]);
  for (const i of imports) assert.match(i, /^\.\/(config|defaults)\.js$|^\.\.\/\.\.\/(core|domain)\//, i);
});
test('U8 sw.js ships the new files and CACHE is bumped past v19', () => {
  const sw = src('sw.js');
  assert.match(sw, /'js\/services\/sync\/defaults\.js'/); assert.match(sw, /'js\/services\/sync\/setup-link\.js'/);
  assert.ok(Number(sw.match(/const CACHE = 'macro-diary-v(\d+)'/)[1]) >= 20);
});
