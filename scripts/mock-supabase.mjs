// DEVELOPMENT ONLY: a tiny in-memory stand-in for the Supabase endpoints the sync adapter uses, so sync can be
// tried end-to-end (two browser "devices") without a Supabase project. NOT a real database: data is lost on exit,
// any email/password is accepted, and it mirrors the documented behaviour that docs/SYNC-SETUP.md's SQL implements.
// It also answers POST /functions/v1/fetch-recipe with a Node stand-in for the recipe-import function (scripts/lib/fetch-recipe-core.mjs,
// same rules as supabase/functions/fetch-recipe, real fetch and Node DNS), so Import by web address can be tried without deploying it.
// Listens on 127.0.0.1 only. Usage: node scripts/mock-supabase.mjs [port]   (default 54321) — then use http://localhost:54321 and any 20+ char "anon key".
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createFetchRecipeHandler } from './lib/fetch-recipe-core.mjs';

const port = Number(process.argv[2] || 54321);
const users = new Map();              // email -> { id, password }
const tokens = new Map();             // access_token -> user id ; refresh_token -> user id
const rows = new Map();               // `${uid}|${key}` -> { key, value, updated_at, rev, seq, uid }
let seq = 0;

const fetchRecipe = createFetchRecipeHandler({ resolveHost: async h => (await lookup(h, { all: true })).map(a => a.address) });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const send = (res, code, body) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const session = uid => {
  const access = 'acc_' + randomUUID(), refresh = 'ref_' + randomUUID();
  tokens.set(access, uid); tokens.set(refresh, uid);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, refresh_token: refresh, user: { id: uid } };
};

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  let body = ''; for await (const c of req) body += c;
  if (url.pathname === '/functions/v1/fetch-recipe') { const r = await fetchRecipe({ method: req.method, bodyText: body }); return send(res, r.status, r.json); }
  const json = body ? JSON.parse(body) : {};
  const uid = tokens.get((req.headers.authorization || '').replace(/^Bearer /, ''));

  if (url.pathname === '/auth/v1/signup') {
    if (users.has(json.email)) return send(res, 422, { msg: 'User already registered' });
    const id = randomUUID(); users.set(json.email, { id, password: json.password }); return send(res, 200, session(id));
  }
  if (url.pathname === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const id = tokens.get(json.refresh_token); return id ? send(res, 200, session(id)) : send(res, 400, { error_description: 'Invalid Refresh Token' });
    }
    const u = users.get(json.email);
    return u && u.password === json.password ? send(res, 200, session(u.id)) : send(res, 400, { error_description: 'Invalid login credentials' });
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204);

  if (!uid) return send(res, 401, { message: 'JWT expired or invalid' });
  if (url.pathname === '/rest/v1/records' && req.method === 'GET') {
    const gt = Number((url.searchParams.get('seq') || 'gt.0').replace('gt.', '')), limit = Number(url.searchParams.get('limit') || 1000);
    const out = [...rows.values()].filter(r => r.uid === uid && r.seq > gt).sort((a, b) => a.seq - b.seq).slice(0, limit)
      .map(({ key, value, updated_at, rev, seq: s }) => ({ key, value, updated_at, rev, seq: s }));
    return send(res, 200, out);
  }
  if (url.pathname === '/rest/v1/rpc/push_record') {
    const id = `${uid}|${json.p_key}`, cur = rows.get(id), baseRev = Number(json.p_base_rev) || 0;
    if ((cur ? cur.rev : 0) !== baseRev) return send(res, 200, [{ accepted: false, rev: cur ? cur.rev : 0 }]);
    const rev = (cur ? cur.rev : 0) + 1;
    rows.set(id, { uid, key: json.p_key, value: json.p_value, updated_at: json.p_updated_at, rev, seq: ++seq });
    return send(res, 200, [{ accepted: true, rev }]);
  }
  send(res, 404, { message: 'not found' });
}).listen(port, '127.0.0.1', () => console.log(`Mock Supabase (dev only, in-memory) on http://127.0.0.1:${port} (use http://localhost:${port} in Settings)`));
