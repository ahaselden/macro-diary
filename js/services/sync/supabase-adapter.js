// Supabase sync adapter: PostgREST + GoTrue over plain `fetch` (no SDK). See docs/SYNC-SETUP.md for the server side.
// HONESTY NOTE: verified only against an in-memory mock (tests/supabase-adapter.test.js). No real Supabase project
// has been exercised yet; the first real run is the owner's. Anything that differs from the mock is a bug to report.
//
// Adapter contract (backend-agnostic engine):
//   pull(cursor) -> { records: [{key, value, updatedAt, rev}], cursor }     cursor = opaque string (server `seq`)
//   push(records) -> { accepted: [{key, rev}], conflicts: [key] }           record = {key, value, updatedAt, baseRev}
// Session shape: { access_token, refresh_token, expires_at } with expires_at in epoch SECONDS.

const SIGNED_OUT = 'Signed out — please sign in again';
const REFRESH_MARGIN_S = 60;

const cleanUrl = u => String(u || '').trim().replace(/\/+$/, '');

// Turn an error response (PostgREST {message}, GoTrue {msg|error_description|message}) into a human message.
async function errorMessage(res) {
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  const m = body && (body.message || body.msg || body.error_description || (typeof body.error === 'string' ? body.error : ''));
  if (m) return `${m} (HTTP ${res.status})`;
  if (res.status === 429) return 'Rate limited by the server — try again in a minute (HTTP 429)';
  return `Server error (HTTP ${res.status})`;
}

async function doFetch(fetchImpl, url, init) {
  try { return await fetchImpl(url, init); }
  catch (e) { throw new Error('Network error — check your connection' + (e && e.message ? ` (${e.message})` : '')); }
}

function toSession(data, now = Date.now) {
  if (!data || !data.access_token) throw new Error('Unexpected response from the auth server');
  const expires_at = Number.isFinite(data.expires_at) ? data.expires_at
    : Math.floor(now() / 1000) + (Number(data.expires_in) || 3600);
  return { access_token: data.access_token, refresh_token: data.refresh_token || null, expires_at };
}

async function authCall(fetchImpl, url, anonKey, path, body, extraHeaders = {}) {
  const res = await doFetch(fetchImpl, `${cleanUrl(url)}${path}`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  return res;
}

export async function signIn(url, anonKey, email, password, fetchImpl = globalThis.fetch) {
  const res = await authCall(fetchImpl, url, anonKey, '/auth/v1/token?grant_type=password', { email, password });
  if (!res.ok) throw new Error(await errorMessage(res));
  return toSession(await res.json());
}

export async function signUp(url, anonKey, email, password, fetchImpl = globalThis.fetch) {
  const res = await authCall(fetchImpl, url, anonKey, '/auth/v1/signup', { email, password });
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = await res.json();
  if (!data || !data.access_token) throw new Error('Account created — confirm your email, then sign in');
  return toSession(data);
}

export async function signOut(url, anonKey, session, fetchImpl = globalThis.fetch) {
  try {
    if (!session || !session.access_token) return;
    await fetchImpl(`${cleanUrl(url)}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    });
  } catch { /* best effort: the caller drops the local session regardless */ }
}

export function createSupabaseAdapter({ url, anonKey, session, onSession, fetchImpl = globalThis.fetch, pageSize = 1000, now = Date.now } = {}) {
  const base = cleanUrl(url);
  if (!base || !anonKey) throw new Error('Supabase URL and anon key are required');
  let sess = session || null;
  let refreshing = null; // dedupe concurrent refreshes (refresh tokens rotate: a second use would fail)

  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      if (!sess || !sess.refresh_token) throw new Error(SIGNED_OUT);
      const res = await authCall(fetchImpl, base, anonKey, '/auth/v1/token?grant_type=refresh_token', { refresh_token: sess.refresh_token });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) throw new Error(SIGNED_OUT);
        throw new Error(await errorMessage(res)); // 5xx/429: the session may still be fine, don't claim signed out
      }
      sess = toSession(await res.json(), now);
      if (onSession) onSession({ ...sess });
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function request(path, init = {}) {
    if (!sess || !sess.access_token) throw new Error(SIGNED_OUT);
    if (sess.expires_at - now() / 1000 < REFRESH_MARGIN_S) await refresh();
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(fetchImpl, `${base}${path}`, {
        ...init,
        headers: { apikey: anonKey, Authorization: `Bearer ${sess.access_token}`, 'Content-Type': 'application/json' },
      });
      if (res.status === 401) {
        if (attempt === 0) { await refresh(); continue; }
        throw new Error(SIGNED_OUT);
      }
      if (!res.ok) throw new Error(await errorMessage(res));
      return res;
    }
  }

  async function pull(cursor = null) {
    let cur = cursor == null || cursor === '' ? '0' : String(cursor);
    if (!/^\d+$/.test(cur)) throw new Error('Invalid sync cursor');
    const records = [];
    let max = BigInt(cur);
    for (;;) {
      const res = await request(`/rest/v1/records?select=key,value,updated_at,rev,seq&seq=gt.${cur}&order=seq.asc&limit=${pageSize}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error('Unexpected response from the server');
      for (const r of rows) {
        records.push({ key: r.key, value: r.value, updatedAt: Number(r.updated_at), rev: Number(r.rev) });
        const s = BigInt(r.seq);
        if (s > max) max = s;
      }
      if (rows.length < pageSize) break;
      cur = String(max);
    }
    return { records, cursor: records.length ? String(max) : (cursor == null ? null : String(cursor)) };
  }

  async function push(recs) {
    const accepted = [], conflicts = [];
    for (const r of recs || []) {
      const res = await request('/rest/v1/rpc/push_record', {
        method: 'POST',
        body: JSON.stringify({ p_key: r.key, p_value: r.value, p_updated_at: r.updatedAt, p_base_rev: r.baseRev || 0 }),
      });
      const out = await res.json();
      const row = Array.isArray(out) ? out[0] : out;
      if (!row || typeof row.accepted !== 'boolean') throw new Error('Unexpected response from the server');
      if (row.accepted) accepted.push({ key: r.key, rev: Number(row.rev) });
      else conflicts.push(r.key);
    }
    return { accepted, conflicts };
  }

  return { pull, push };
}
