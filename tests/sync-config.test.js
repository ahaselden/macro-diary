import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncConfig, normalizeUrl, isConfigured, isSignedIn, SYNC_KEY } from '../js/services/sync/config.js';
import { STORAGE_KEY } from '../js/core/constants.js';

const fake = initial => { const m = new Map(initial ? [[SYNC_KEY, initial]] : []); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test('sync settings live under their own key, never the app-state key', () => {
  assert.notEqual(SYNC_KEY, STORAGE_KEY);
  const st = fake(); createSyncConfig(st).set({ url: 'https://x.supabase.co' });
  assert.equal(st.m.has(STORAGE_KEY), false); assert.equal(st.m.has(SYNC_KEY), true);
});
test('set merges, get returns, clear wipes (including the session)', () => {
  const c = createSyncConfig(fake()); c.set({ email: 'a@b.c' }); c.set({ session: { refresh_token: 'r' } });
  assert.deepEqual(c.get(), { email: 'a@b.c', session: { refresh_token: 'r' } });
  c.clear(); assert.deepEqual(c.get(), {});
});
test('data survives a reload; corrupt or missing storage gives empty config', () => {
  const st = fake(); createSyncConfig(st).set({ auto: true });
  assert.equal(createSyncConfig(st).get().auto, true);
  assert.deepEqual(createSyncConfig(fake('{oops')).get(), {});
  assert.deepEqual(createSyncConfig(null).get(), {});
});
test('meta load/save round-trips', () => {
  const c = createSyncConfig(fake()); assert.equal(c.meta.load(), null);
  c.meta.save({ cursor: '5', revs: {}, hashes: {} }); assert.equal(c.meta.load().cursor, '5');
});
test('normalizeUrl: https only (http only for localhost), origin only', () => {
  assert.equal(normalizeUrl('https://abc.supabase.co/'), 'https://abc.supabase.co');
  assert.equal(normalizeUrl(' https://abc.supabase.co/rest/v1 '), 'https://abc.supabase.co');
  assert.equal(normalizeUrl('http://localhost:54321'), 'http://localhost:54321');
  for (const bad of ['http://abc.supabase.co', 'ftp://x.y', 'javascript:alert(1)', 'abc.supabase.co', '', null, undefined]) assert.equal(normalizeUrl(bad), null, String(bad));
});
test('isConfigured / isSignedIn', () => {
  assert.equal(isConfigured({ url: 'https://a.supabase.co', anonKey: 'x'.repeat(30) }), true);
  assert.equal(isConfigured({ url: 'http://a.supabase.co', anonKey: 'x'.repeat(30) }), false);
  assert.equal(isConfigured({ url: 'https://a.supabase.co', anonKey: 'short' }), false);
  assert.equal(isSignedIn({ session: { refresh_token: 'r' } }), true); assert.equal(isSignedIn({}), false);
});
