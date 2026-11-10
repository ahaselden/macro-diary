// Spec: docs/specs/sync-defaults-and-setup-link.md (behaviours S1-S20).
// Golden values are hand-built: payloads are encoded here with Buffer, never with the module under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSetupLink, parseSetupLink, planSetupLinkApply } from '../js/services/sync/setup-link.js';

const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o), 'utf8').toString('base64url');
const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${b64u({ role })}.c2ln${'x'.repeat(20)}`;
const ANON = jwt('anon');
const PUB = 'sb_publishable_' + 'a1B2'.repeat(8);
const URL1 = 'https://abc.supabase.co';
const APP = 'https://ahaselden.github.io/macro-diary/';
const link = payload => `${APP}#sync-setup=${b64u(payload)}`;
const decode = l => JSON.parse(Buffer.from(l.split('#sync-setup=')[1], 'base64url').toString('utf8'));

test('S1 build then parse round-trips exactly (jwt key and sb_publishable_ key)', () => {
  for (const key of [ANON, PUB]) {
    assert.deepEqual(parseSetupLink(buildSetupLink(APP, { url: URL1, anonKey: key })), { url: URL1, anonKey: key });
  }
});
test('S2 build puts the data in the URL FRAGMENT, not the query; payload is exactly {v:1,url,key}', () => {
  const l = buildSetupLink(APP, { url: URL1 + '/', anonKey: PUB });
  assert.ok(l.startsWith(APP + '#sync-setup='), l);
  assert.equal(l.includes('?'), false);
  assert.equal(l.split('#').length, 2);
  assert.match(l.split('#sync-setup=')[1], /^[A-Za-z0-9_-]+$/);   // base64url, no + / =
  assert.deepEqual(decode(l), { v: 1, url: URL1, key: PUB });      // url normalised to origin
});
test('S2b build replaces any existing hash on appUrl and keeps a query as is', () => {
  const l = buildSetupLink(APP + '?x=1#old', { url: URL1, anonKey: PUB });
  assert.ok(l.startsWith(APP + '?x=1#sync-setup='), l);
  assert.equal(l.includes('#old'), false);
});
test('S3 build never carries secrets even when passed them', () => {
  const l = buildSetupLink(APP, { url: URL1, anonKey: PUB, password: 'hunter2', session: { refresh_token: 'RT' }, access_token: 'AT', refresh_token: 'RT2', token: 'T', email: 'me@x.y' });
  assert.deepEqual(Object.keys(decode(l)).sort(), ['key', 'url', 'v']);
  for (const s of ['hunter2', 'RT', 'AT', 'RT2', 'me@x.y']) assert.equal(Buffer.from(l.split('#sync-setup=')[1], 'base64url').toString().includes(s), false, s);
});
test('S4 parse returns ONLY url and anonKey, ignoring every other field', () => {
  const r = parseSetupLink(link({ v: 1, url: URL1, key: PUB, password: 'p', session: { refresh_token: 'r' }, token: 't', access_token: 'a', refresh_token: 'r', email: 'e@x.y', extra: 1 }));
  assert.deepEqual(r, { url: URL1, anonKey: PUB });
  assert.deepEqual(Object.keys(r).sort(), ['anonKey', 'url']);
});
test('S5 parse accepts a full URL, "#sync-setup=..." and "sync-setup=..."', () => {
  const frag = 'sync-setup=' + b64u({ v: 1, url: URL1, key: PUB });
  const want = { url: URL1, anonKey: PUB };
  assert.deepEqual(parseSetupLink(APP + '#' + frag), want);
  assert.deepEqual(parseSetupLink('#' + frag), want);
  assert.deepEqual(parseSetupLink(frag), want);
});
test('S6 parse normalises the url to its origin', () => {
  assert.deepEqual(parseSetupLink(link({ v: 1, url: URL1 + '/rest/v1/', key: PUB })), { url: URL1, anonKey: PUB });
});
test('S7 parse refuses non-https urls; http only for localhost and 127.0.0.1', () => {
  for (const u of ['http://abc.supabase.co', 'ftp://abc.supabase.co', 'javascript:alert(1)', 'abc.supabase.co', '', 'data:text/html,x'])
    assert.equal(parseSetupLink(link({ v: 1, url: u, key: PUB })), null, u);
  assert.deepEqual(parseSetupLink(link({ v: 1, url: 'http://localhost:54321', key: PUB })), { url: 'http://localhost:54321', anonKey: PUB });
  assert.deepEqual(parseSetupLink(link({ v: 1, url: 'http://127.0.0.1:54321', key: PUB })), { url: 'http://127.0.0.1:54321', anonKey: PUB });
});
test('S8 parse refuses wrong or missing version', () => {
  for (const v of [0, 2, '1', null, undefined, 1.5]) assert.equal(parseSetupLink(link({ v, url: URL1, key: PUB })), null, String(v));
  assert.equal(parseSetupLink(link({ url: URL1, key: PUB })), null);
});
test('S9 parse refuses missing, short (<=20 chars) or non-string keys', () => {
  for (const key of [undefined, null, '', 'short', 'x'.repeat(20), 12345678901234567890123, ['x'.repeat(30)], { a: 1 }])
    assert.equal(parseSetupLink(link({ v: 1, url: URL1, key })), null, JSON.stringify(key));
  assert.notEqual(parseSetupLink(link({ v: 1, url: URL1, key: 'x'.repeat(21) })), null);
});
test('S10 parse and build refuse a service_role jwt key and sb_secret_ keys', () => {
  const sr = jwt('service_role');
  assert.equal(parseSetupLink(link({ v: 1, url: URL1, key: sr })), null);
  assert.equal(parseSetupLink(link({ v: 1, url: URL1, key: 'sb_secret_' + 'x'.repeat(30) })), null);
  assert.equal(parseSetupLink(link({ v: 1, url: URL1, key: 'xx service_role xx ' + 'y'.repeat(20) })), null);
  assert.equal(buildSetupLink(APP, { url: URL1, anonKey: sr }), '');
  assert.equal(buildSetupLink(APP, { url: URL1, anonKey: 'sb_secret_' + 'x'.repeat(30) }), '');
});
test('S11 build returns "" (never throws) for unusable input', () => {
  for (const arg of [{ url: 'http://abc.supabase.co', anonKey: PUB }, { url: URL1, anonKey: 'short' }, { url: '', anonKey: '' }, {}, null, undefined, { url: 5, anonKey: {} }])
    assert.equal(buildSetupLink(APP, arg), '', JSON.stringify(arg));
});
test('S12 parse returns null and never throws on garbage', () => {
  const junk = [null, undefined, 5, {}, [], '', '#', 'sync-setup=', '#sync-setup=', '#sync-setup=!!!notbase64???', '#sync-setup=' + b64u('not json'),
    '#sync-setup=' + b64u('null'), '#sync-setup=' + b64u('[]'), '#sync-setup=' + b64u('"str"'), '#sync-setup=' + b64u('42'),
    '#sync-setup=\u{1F600}\u0000\ud800', 'https://x.y/#other=1', '%%%', '#sync-setup=%E0%A4%A', '#sync-setup=' + 'A'.repeat(100000), 'x'.repeat(5_000_000)];
  for (const j of junk) assert.doesNotThrow(() => assert.equal(parseSetupLink(j), null), String(j).slice(0, 30));
});
test('S13 prototype keys in the payload do not leak or pollute', () => {
  const evil = `{"v":1,"url":"${URL1}","key":"${PUB}","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}`;
  const r = parseSetupLink('#sync-setup=' + b64u(evil));
  assert.deepEqual(r, { url: URL1, anonKey: PUB });
  assert.equal({}.polluted, undefined);
  assert.equal(r.polluted, undefined);
});
test('S14 link is built from the url+key only: decoding never yields html-active strings unescaped by the parser (url is an origin)', () => {
  const r = parseSetupLink(link({ v: 1, url: 'https://abc.supabase.co/"><script>alert(1)</script>', key: PUB }));
  if (r) assert.equal(/[<>"']/.test(r.url), false);   // either refused or reduced to a clean origin
});

// ---- planSetupLinkApply(cfg, parsedLink, defaults) -> { action: 'apply'|'confirm'|'ignore', patch } ----
const DEF = { url: 'https://default.supabase.co', anonKey: jwt('anon') + 'd'.repeat(5) };
const L = { url: URL1, anonKey: PUB };
const SESSION = { refresh_token: 'r' };

test('S15 plan: null link is ignored', () => {
  assert.equal(planSetupLinkApply({}, null, DEF).action, 'ignore');
  assert.equal(planSetupLinkApply({}, undefined, DEF).action, 'ignore');
});
test('S16 plan: not signed in and link differs from default -> apply {url, anonKey, useOwnProject:true}', () => {
  const p = planSetupLinkApply({}, L, DEF);
  assert.equal(p.action, 'apply');
  assert.deepEqual(p.patch, { url: URL1, anonKey: PUB, useOwnProject: true });
  assert.equal(planSetupLinkApply({}, L, { url: '', anonKey: '' }).action, 'apply');   // empty defaults: always custom
  assert.equal(planSetupLinkApply({}, L, { url: '', anonKey: '' }).patch.useOwnProject, true);
});
test('S17 plan: link equal to the default project -> apply with useOwnProject:false and no custom url/key', () => {
  const p = planSetupLinkApply({ url: 'https://old.supabase.co', anonKey: PUB }, { url: DEF.url, anonKey: DEF.anonKey }, DEF);
  assert.equal(p.action, 'apply');
  assert.equal(p.patch.useOwnProject, false);
  assert.equal(p.patch.url, ''); assert.equal(p.patch.anonKey, '');
});
test('S18 plan: signed in to a DIFFERENT project -> confirm, never apply automatically', () => {
  const cfg = { url: 'https://other.supabase.co', anonKey: PUB, useOwnProject: true, session: SESSION };
  assert.equal(planSetupLinkApply(cfg, L, DEF).action, 'confirm');
  const onDefault = { session: SESSION };   // signed in to the default project
  assert.equal(planSetupLinkApply(onDefault, L, DEF).action, 'confirm');
});
test('S19 plan: signed in and the link is the project already in use -> ignore (nothing to change, session kept)', () => {
  const cfg = { url: URL1, anonKey: PUB, useOwnProject: true, session: SESSION };
  assert.equal(planSetupLinkApply(cfg, L, DEF).action, 'ignore');
});
test('S20 plan: never puts session/password/email in the patch and does not throw on hostile cfg', () => {
  const p = planSetupLinkApply({ email: 'a@b.c', session: null, password: 'x' }, L, DEF);
  assert.deepEqual(Object.keys(p.patch).sort(), ['anonKey', 'url', 'useOwnProject']);
  for (const cfg of [null, undefined, 5, 'x', []]) assert.doesNotThrow(() => planSetupLinkApply(cfg, L, DEF));
  for (const d of [null, undefined, 5]) assert.doesNotThrow(() => planSetupLinkApply({}, L, d));
});
