// Tests for docs/specs/import-error-message.md, behaviours E1..E9. fetch is injected. NOT covered: the real browser/CORS behaviour, the UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = () => import('../js/services/recipe-fetch.js');
const KEY = 'anon-key-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const conn = () => ({ url: 'https://abcdefgh.supabase.co', anonKey: KEY, source: 'custom' });
const PAGE = 'https://example.com/secret-path/recipe-42?token=zzz';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const rejectWith = async (thrown, f) => {
  const { fetchRecipePage } = await mod();
  let calls = 0;
  const impl = f || (async () => { calls++; throw thrown; });
  try { await fetchRecipePage(conn(), PAGE, f ? async (...a) => { calls++; return f(...a); } : impl); } catch (e) { assert.ok(e instanceof Error); return { e, calls: () => calls }; }
  assert.fail('expected a rejection');
};

const THROWN = {
  'TypeError Failed to fetch': () => new TypeError('Failed to fetch'),
  'plain Error leaking path': () => new Error('boom https://example.com/secret-path/recipe-42?token=zzz ' + KEY),
  'string': () => 'a string with ' + KEY,
  'null': () => null,
  'undefined': () => undefined,
  'object': () => ({ message: 'secret-path', key: KEY }),
};

const REACH = /could not (be )?reach|couldn't reach|unable to reach|connection/i;
const SETUP = /not (been )?set up|not deployed|isn't set up|is not set up/i;
const FACT = /you are offline|you're offline|you are not connected|you're not connected|no internet|check your internet/i;

for (const [name, make] of Object.entries(THROWN)) {
  test(`E1-E6 non-abort rejection (${name}): reach + may-not-be-set-up + paste, hedged, short, no leak`, async () => {
    const { e } = await rejectWith(make());
    const m = e.message;
    assert.match(m, REACH, 'E1 could not reach / connection');
    assert.match(m, SETUP, 'E2 may not be set up');
    assert.match(m, /paste/i, 'E3 paste route still works');
    assert.ok(!FACT.test(m), 'E4 must not claim offline as fact');
    assert.match(m, /\b(may|might|could|possibly|or)\b/i, 'E4 hedged');
    assert.ok(m.length > 0 && m.length <= 300, `E5 length ${m.length}`);
    assert.ok(!m.includes(KEY) && !m.includes('secret-path') && !m.includes('token=zzz') && !m.includes('example.com'), 'E5 leak');
    assert.ok(!/boom|a string with/.test(m), 'E5 raw thrown text must not be echoed');
  });
}

test('E7 timeout/abort keep the took-too-long message and do not claim not-set-up', async () => {
  for (const n of ['AbortError', 'TimeoutError']) {
    const { e } = await rejectWith(null, async () => { throw new DOMException('The operation was aborted.', n); });
    assert.match(e.message, /time|slow|too long|took/i, n);
    assert.ok(!SETUP.test(e.message), `${n} must not say not set up`);
    assert.ok(!e.message.includes(KEY));
  }
});

test('E8 server answers unchanged: bare 404 says not set up; 404 with {ok:false} shows the page error', async () => {
  const miss = await rejectWith(null, async () => json({ code: 'NOT_FOUND', message: 'Requested function was not found' }, 404));
  assert.match(miss.e.message, /not set up/i);
  const page = await rejectWith(null, async () => json({ ok: false, error: 'That page was not found.' }, 404));
  assert.match(page.e.message, /That page was not found\./); assert.ok(!/not set up/i.test(page.e.message));
});

test('E9 exactly one fetch call on a rejection (no retry)', async () => {
  const r = await rejectWith(new TypeError('Failed to fetch'));
  assert.equal(r.calls(), 1);
});
