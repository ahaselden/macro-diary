// Tests run against an in-memory MOCK of Supabase (GoTrue + PostgREST + push_record). No real server was involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseAdapter, signIn, signUp, signOut } from '../js/services/sync/supabase-adapter.js';

const URL_ = 'https://proj.supabase.co';
const ANON = 'anon-key';

function mockServer({ confirmEmail = false, ttl = 3600 } = {}) {
  const s = {
    clock: 1_000_000, // epoch seconds, controllable
    users: new Map(), access: new Map(), refresh: new Map(), tables: new Map(), seq: 0, n: 0,
    log: [], fail500: false, failRefresh: false, authLogout: 0,
  };
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const issue = uid => {
    const a = 'at' + ++s.n, r = 'rt' + ++s.n;
    s.access.set(a, { uid, exp: s.clock + ttl }); s.refresh.set(r, uid);
    return { access_token: a, refresh_token: r, expires_in: ttl, token_type: 'bearer' };
  };
  const addUser = (email, password) => { const id = 'u-' + email; s.users.set(email, { id, password }); return id; };
  const table = uid => { if (!s.tables.has(uid)) s.tables.set(uid, new Map()); return s.tables.get(uid); };
  s.addUser = addUser; s.issue = issue; s.table = table;
  s.expireAll = () => { for (const t of s.access.values()) t.exp = s.clock - 1; };
  s.invalidateAccess = () => s.access.clear();

  s.fetch = async (input, init = {}) => {
    const u = new globalThis.URL(input); const method = init.method || 'GET';
    const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    s.log.push({ method, url: String(input), headers: h, body: init.body });
    const body = init.body ? JSON.parse(init.body) : {};
    if (h.apikey !== ANON) return json({ message: 'Invalid API key' }, 401);
    if (u.pathname === '/auth/v1/token') {
      const g = u.searchParams.get('grant_type');
      if (g === 'password') {
        const usr = s.users.get(body.email);
        if (!usr || usr.password !== body.password) return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
        return json(issue(usr.id));
      }
      if (g === 'refresh_token') {
        if (s.failRefresh || !s.refresh.has(body.refresh_token)) return json({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400);
        const uid = s.refresh.get(body.refresh_token); s.refresh.delete(body.refresh_token); // rotation
        return json(issue(uid));
      }
    }
    if (u.pathname === '/auth/v1/signup') {
      if (s.users.has(body.email)) return json({ msg: 'User already registered' }, 422);
      const id = addUser(body.email, body.password);
      return confirmEmail ? json({ id, email: body.email }) : json({ ...issue(id), user: { id } });
    }
    if (u.pathname === '/auth/v1/logout') { s.authLogout++; return new Response(null, { status: 204 }); }

    // PostgREST: bearer must be valid (RLS identity = auth.uid())
    const m = /^Bearer (.+)$/.exec(h.authorization || '');
    const tok = m && s.access.get(m[1]);
    if (!tok || tok.exp <= s.clock) return json({ code: 'PGRST301', message: 'JWT expired' }, 401);
    if (s.fail500) return json({ message: 'internal boom' }, 500);
    const rows = table(tok.uid);
    if (u.pathname === '/rest/v1/records' && method === 'GET') {
      const gt = Number((u.searchParams.get('seq') || 'gt.0').slice(3));
      const limit = Number(u.searchParams.get('limit'));
      const out = [...rows.values()].filter(r => r.seq > gt).sort((a, b) => a.seq - b.seq).slice(0, limit)
        .map(r => ({ key: r.key, value: r.value, updated_at: r.updated_at, rev: r.rev, seq: r.seq }));
      return json(out);
    }
    if (u.pathname === '/rest/v1/rpc/push_record' && method === 'POST') {
      const cur = rows.get(body.p_key);
      const ok = cur ? cur.rev === body.p_base_rev : body.p_base_rev === 0;
      if (!ok) return json([{ accepted: false, rev: cur ? cur.rev : 0 }]);
      const rev = cur ? cur.rev + 1 : 1;
      rows.set(body.p_key, { key: body.p_key, value: body.p_value, updated_at: body.p_updated_at, rev, seq: ++s.seq });
      return json([{ accepted: true, rev }]);
    }
    return json({ message: 'not found' }, 404);
  };
  return s;
}

function setup(opts = {}, adapterOpts = {}) {
  const srv = mockServer(opts);
  srv.addUser('a@x.com', 'pw');
  const tok = srv.issue('u-a@x.com');
  const session = { ...tok, expires_at: srv.clock + 3600 };
  const sessions = [];
  const adapter = createSupabaseAdapter({
    url: URL_, anonKey: ANON, session, onSession: s => sessions.push(s), fetchImpl: srv.fetch, now: () => srv.clock * 1000, ...adapterOpts,
  });
  return { srv, adapter, sessions, session };
}
const rec = (key, v = 1, baseRev = 0) => ({ key, value: { v }, updatedAt: 111, baseRev });

test('pull from scratch on an empty server', async () => {
  const { adapter } = setup();
  assert.deepEqual(await adapter.pull(null), { records: [], cursor: null });
});

test('push new record (baseRev 0) is accepted at rev 1, then pull returns it', async () => {
  const { adapter } = setup();
  const r = await adapter.push([rec('day:2026-01-01', 5)]);
  assert.deepEqual(r, { accepted: [{ key: 'day:2026-01-01', rev: 1 }], conflicts: [] });
  const p = await adapter.pull(null);
  assert.deepEqual(p.records, [{ key: 'day:2026-01-01', value: { v: 5 }, updatedAt: 111, rev: 1 }]);
  assert.equal(typeof p.cursor, 'string'); assert.equal(p.cursor, '1');
});

test('stale baseRev is a conflict and is not written; accepted rev increments', async () => {
  const { adapter } = setup();
  await adapter.push([rec('k', 1, 0)]);
  const r2 = await adapter.push([rec('k', 2, 1)]);
  assert.deepEqual(r2.accepted, [{ key: 'k', rev: 2 }]);
  const r3 = await adapter.push([rec('k', 3, 1), rec('other', 9, 0)]);
  assert.deepEqual(r3, { accepted: [{ key: 'other', rev: 1 }], conflicts: ['k'] });
  const p = await adapter.pull(null);
  assert.equal(p.records.find(x => x.key === 'k').value.v, 2);
  // baseRev 0 on an existing key also conflicts
  assert.deepEqual((await adapter.push([rec('k', 4, 0)])).conflicts, ['k']);
});

test('incremental pull via cursor returns only newer records', async () => {
  const { adapter } = setup();
  await adapter.push([rec('a'), rec('b')]);
  const p1 = await adapter.pull(null);
  assert.equal(p1.records.length, 2);
  assert.deepEqual(await adapter.pull(p1.cursor), { records: [], cursor: p1.cursor });
  await adapter.push([rec('a', 2, 1), rec('c')]);
  const p2 = await adapter.pull(p1.cursor);
  assert.deepEqual(p2.records.map(r => [r.key, r.rev]), [['a', 2], ['c', 1]]);
  assert.equal(p2.cursor, '4');
});

test('pagination loops over more rows than pageSize', async () => {
  const { adapter, srv } = setup({}, { pageSize: 10 });
  const recs = Array.from({ length: 25 }, (_, i) => rec('k' + i, i));
  await adapter.push(recs);
  srv.log.length = 0;
  const p = await adapter.pull(null);
  assert.equal(p.records.length, 25);
  assert.equal(new Set(p.records.map(r => r.key)).size, 25);
  assert.equal(p.cursor, '25');
  assert.equal(srv.log.length, 3); // 10 + 10 + 5
  // exact multiple of page size needs one extra (empty) request, still correct
  const { adapter: a2 } = setup({}, { pageSize: 5 });
  await a2.push(Array.from({ length: 10 }, (_, i) => rec('k' + i)));
  assert.equal((await a2.pull(null)).records.length, 10);
});

test('default page size is 1000 (limit=1000 in the request)', async () => {
  const { adapter, srv } = setup();
  await adapter.pull(null);
  assert.match(srv.log.at(-1).url, /limit=1000/);
  assert.match(srv.log.at(-1).url, /select=key,value,updated_at,rev,seq&seq=gt\.0&order=seq\.asc/);
});

test('request headers: apikey + Bearer + JSON content type; url trailing slash is normalised', async () => {
  const { srv, session } = setup({}, { url: URL_ + '///' });
  const adapter = createSupabaseAdapter({ url: URL_ + '/', anonKey: ANON, session, fetchImpl: srv.fetch, now: () => srv.clock * 1000 });
  await adapter.push([rec('k')]);
  const last = srv.log.at(-1);
  assert.equal(last.url, URL_ + '/rest/v1/rpc/push_record');
  assert.equal(last.headers.apikey, ANON);
  assert.equal(last.headers.authorization, 'Bearer ' + session.access_token);
  assert.equal(last.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(last.body), { p_key: 'k', p_value: { v: 1 }, p_updated_at: 111, p_base_rev: 0 });
});

test('token expiring within 60 s is refreshed first and onSession is called', async () => {
  const { adapter, srv, sessions } = setup();
  srv.clock += 3600 - 30; // 30 s left
  await adapter.pull(null);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].expires_at, srv.clock + 3600);
  const urls = srv.log.map(l => l.url);
  assert.match(urls[0], /grant_type=refresh_token/);
  assert.equal(srv.log.at(-1).headers.authorization, 'Bearer ' + sessions[0].access_token);
  await adapter.pull(null); // no second refresh
  assert.equal(sessions.length, 1);
});

test('a 401 triggers exactly one refresh + retry', async () => {
  const { adapter, srv, sessions } = setup();
  srv.invalidateAccess(); // server forgets the access token (e.g. revoked) while the client thinks it is fresh
  const p = await adapter.pull(null);
  assert.deepEqual(p.records, []);
  assert.equal(sessions.length, 1);
  assert.equal(srv.log.filter(l => /grant_type=refresh_token/.test(l.url)).length, 1);
});

test('refresh failure -> Signed out error (before request and after 401)', async () => {
  let t = setup();
  t.srv.failRefresh = true; t.srv.clock += 3590;
  await assert.rejects(t.adapter.pull(null), /Signed out — please sign in again/);
  t = setup();
  t.srv.failRefresh = true; t.srv.invalidateAccess();
  await assert.rejects(t.adapter.push([rec('k')]), /Signed out — please sign in again/);
  assert.equal(t.sessions.length, 0);
  const none = createSupabaseAdapter({ url: URL_, anonKey: ANON, session: null, fetchImpl: t.srv.fetch });
  await assert.rejects(none.pull(null), /Signed out/);
});

test('HTTP errors are mapped to readable messages', async () => {
  const { adapter, srv } = setup();
  srv.fail500 = true;
  await assert.rejects(adapter.pull(null), /internal boom \(HTTP 500\)/);
  await assert.rejects(adapter.push([rec('k')]), /internal boom/);
  const err = createSupabaseAdapter({ url: URL_, anonKey: ANON, session: { access_token: 'x', refresh_token: 'y', expires_at: 9e9 },
    fetchImpl: async () => new Response('<html>bad gateway</html>', { status: 502 }) });
  await assert.rejects(err.pull(null), /Server error \(HTTP 502\)/);
  const net = createSupabaseAdapter({ url: URL_, anonKey: ANON, session: { access_token: 'x', refresh_token: 'y', expires_at: 9e9 },
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(net.pull(null), /Network error/);
});

test('two users cannot see each other\'s rows (RLS-like isolation in the mock)', async () => {
  const srv = mockServer();
  srv.addUser('a@x.com', 'pw'); srv.addUser('b@x.com', 'pw2');
  const mk = async (email, pw) => createSupabaseAdapter({ url: URL_, anonKey: ANON, session: await signIn(URL_, ANON, email, pw, srv.fetch), fetchImpl: srv.fetch, now: () => srv.clock * 1000 });
  const A = await mk('a@x.com', 'pw'), B = await mk('b@x.com', 'pw2');
  await A.push([rec('shared-key', 'A')]);
  assert.deepEqual((await B.pull(null)).records, []);
  assert.deepEqual((await B.push([rec('shared-key', 'B', 0)])).accepted, [{ key: 'shared-key', rev: 1 }]); // not a conflict: separate namespace
  assert.equal((await A.pull(null)).records[0].value.v, 'A');
});

test('signIn returns the session shape (expires_at computed from expires_in); bad password errors', async () => {
  const srv = mockServer(); srv.addUser('a@x.com', 'pw');
  const s = await signIn(URL_ + '/', ANON, 'a@x.com', 'pw', srv.fetch);
  assert.deepEqual(Object.keys(s).sort(), ['access_token', 'expires_at', 'refresh_token']);
  assert.ok(s.expires_at >= Math.floor(Date.now() / 1000) + 3500);
  assert.match(srv.log[0].url, /^https:\/\/proj\.supabase\.co\/auth\/v1\/token\?grant_type=password$/);
  assert.equal(srv.log[0].headers.apikey, ANON);
  await assert.rejects(signIn(URL_, ANON, 'a@x.com', 'nope', srv.fetch), /Invalid login credentials/);
});

test('signUp: returns a session, or tells the user to confirm email when no token comes back', async () => {
  const srv = mockServer();
  const s = await signUp(URL_, ANON, 'n@x.com', 'pw', srv.fetch);
  assert.ok(s.access_token && s.refresh_token);
  const srv2 = mockServer({ confirmEmail: true });
  await assert.rejects(signUp(URL_, ANON, 'n@x.com', 'pw', srv2.fetch), /Account created — confirm your email, then sign in/);
  await assert.rejects(signUp(URL_, ANON, 'n@x.com', 'pw', srv2.fetch), /already registered/);
});

test('signOut calls logout with the bearer token and never throws', async () => {
  const srv = mockServer(); srv.addUser('a@x.com', 'pw');
  const s = await signIn(URL_, ANON, 'a@x.com', 'pw', srv.fetch);
  await signOut(URL_, ANON, s, srv.fetch);
  assert.equal(srv.authLogout, 1);
  assert.equal(srv.log.at(-1).headers.authorization, 'Bearer ' + s.access_token);
  await signOut(URL_, ANON, s, async () => { throw new Error('offline'); });
  await signOut(URL_, ANON, null, srv.fetch);
});
