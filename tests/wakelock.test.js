// docs/specs/cooking-mode.md behaviours 14-25: js/services/wakelock.js with fake navigator/document objects.
// The fakes prove our logic follows the documented API; they do NOT prove real browsers behave like them (see the spec's unverified list).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const load = async () => (await import('../js/services/wakelock.js')).createWakeLock;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };

function makeSentinel() {
  const s = { released: false, releaseCalls: 0, listeners: [], releaseThrows: false,
    addEventListener(t, fn) { if (t === 'release') s.listeners.push(fn); },
    removeEventListener(t, fn) { s.listeners = s.listeners.filter(f => f !== fn); },
    fire() { for (const fn of [...s.listeners]) fn({ type: 'release' }); },
    async release() { s.releaseCalls++; if (s.releaseThrows) throw new Error('boom'); if (!s.released) { s.released = true; s.fire(); } },
    browserRelease() { s.released = true; s.fire(); },   // what the browser does when the page is hidden
  };
  return s;
}
function makeNav() {
  const nav = { requests: [], sentinels: [], mode: 'ok', pending: [],
    wakeLock: { request(type) {
      nav.requests.push(type);
      if (nav.mode === 'throw') throw new Error('sync');
      if (nav.mode === 'reject') return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
      const s = makeSentinel(); nav.sentinels.push(s);
      if (nav.mode === 'defer') return new Promise(res => nav.pending.push(() => res(s)));
      return Promise.resolve(s);
    } } };
  return nav;
}
function makeDoc() {
  const d = { visibilityState: 'visible', l: {},
    addEventListener(t, fn) { (d.l[t] ||= []).push(fn); },
    removeEventListener(t, fn) { d.l[t] = (d.l[t] || []).filter(f => f !== fn); },
    count(t) { return (d.l[t] || []).length; },
    set(state) { d.visibilityState = state; for (const fn of [...(d.l.visibilitychange || [])]) fn({ type: 'visibilitychange' }); } };
  return d;
}

test('14 isSupported: false without nav / wakeLock / request function, true with a fake', async () => {
  const create = await load();
  for (const n of [undefined, null, {}, { wakeLock: null }, { wakeLock: {} }, { wakeLock: { request: 'x' } }, 5, 'nav'])
    assert.equal(create(n, makeDoc()).isSupported(), false, String(JSON.stringify(n)));
  assert.equal(create(makeNav(), makeDoc()).isSupported(), true);
  assert.equal(create(makeNav(), makeDoc()).status(), 'off');
});

test('15 enable when unsupported -> "unsupported", no request, no throw', async () => {
  const create = await load();
  const doc = makeDoc(); const wl = create({}, doc);
  assert.equal(await wl.enable(), 'unsupported'); assert.equal(wl.status(), 'unsupported');
  assert.equal(doc.count('visibilitychange'), 0);
  await wl.disable();
});

test('16 enable requests "screen" once and returns "on"', async () => {
  const create = await load(); const nav = makeNav(); const wl = create(nav, makeDoc());
  assert.equal(await wl.enable(), 'on');
  assert.deepEqual(nav.requests, ['screen']); assert.equal(wl.status(), 'on');
});

test('17 request rejection (NotAllowedError) or sync throw -> "failed", never rejects', async () => {
  const create = await load();
  for (const mode of ['reject', 'throw']) {
    const nav = makeNav(); nav.mode = mode; const wl = create(nav, makeDoc());
    assert.equal(await wl.enable(), 'failed', mode); assert.equal(wl.status(), 'failed');
    await wl.disable(); assert.equal(wl.status(), 'off');
  }
});

test('18 disable releases the sentinel, status off, listener removed; safe when idle, twice, or release throws', async () => {
  const create = await load(); const nav = makeNav(); const doc = makeDoc(); const wl = create(nav, doc);
  await wl.disable();   // never enabled
  await wl.enable(); assert.equal(doc.count('visibilitychange'), 1);
  await wl.disable();
  assert.equal(nav.sentinels[0].releaseCalls, 1); assert.equal(wl.status(), 'off'); assert.equal(doc.count('visibilitychange'), 0);
  await wl.disable();   // twice
  const nav2 = makeNav(); const wl2 = create(nav2, makeDoc()); await wl2.enable(); nav2.sentinels[0].releaseThrows = true;
  await wl2.disable(); assert.equal(wl2.status(), 'off');
});

test('19 after the browser releases the lock, visible re-requests; hidden does nothing; held lock is not re-requested', async () => {
  const create = await load(); const nav = makeNav(); const doc = makeDoc(); const wl = create(nav, doc);
  await wl.enable();
  doc.set('visible'); await flush(); assert.equal(nav.requests.length, 1, 'still held');
  doc.set('hidden'); nav.sentinels[0].browserRelease(); await flush(); assert.equal(nav.requests.length, 1, 'hidden');
  doc.set('visible'); await flush();
  assert.equal(nav.requests.length, 2); assert.deepEqual(nav.requests, ['screen', 'screen']); assert.equal(wl.status(), 'on');
  doc.set('visible'); await flush(); assert.equal(nav.requests.length, 2, 'second lock still held');
});

test('20 after disable, visibility changes never request', async () => {
  const create = await load(); const nav = makeNav(); const doc = makeDoc(); const wl = create(nav, doc);
  await wl.enable(); doc.set('hidden'); nav.sentinels[0].browserRelease(); await wl.disable();
  doc.set('visible'); await flush(); doc.set('hidden'); doc.set('visible'); await flush();
  assert.equal(nav.requests.length, 1);
});

test('21 a stale release event from an old sentinel is ignored', async () => {
  const create = await load(); const nav = makeNav(); const doc = makeDoc(); const wl = create(nav, doc);
  await wl.enable(); const a = nav.sentinels[0];
  doc.set('hidden'); a.browserRelease(); doc.set('visible'); await flush();
  assert.equal(nav.requests.length, 2); assert.equal(wl.status(), 'on');
  a.fire(); a.fire(); await flush();   // late duplicate events from the old sentinel
  assert.equal(wl.status(), 'on');
  doc.set('visible'); await flush(); assert.equal(nav.requests.length, 2, 'new sentinel must still count as held');
  await wl.disable(); assert.equal(nav.sentinels[1].releaseCalls, 1);
});

test('22 enable twice requests once and registers one listener', async () => {
  const create = await load(); const nav = makeNav(); const doc = makeDoc(); const wl = create(nav, doc);
  await wl.enable(); assert.equal(await wl.enable(), 'on');
  assert.equal(nav.requests.length, 1); assert.equal(doc.count('visibilitychange'), 1);
  const nav2 = makeNav(); nav2.mode = 'defer'; const doc2 = makeDoc(); const wl2 = create(nav2, doc2);
  const p1 = wl2.enable(); const p2 = wl2.enable(); nav2.pending.forEach(f => f()); await Promise.all([p1, p2]);
  assert.ok(nav2.requests.length <= 1 || nav2.sentinels.slice(1).every(s => s.releaseCalls === 1), 'no leaked second lock');
  assert.equal(doc2.count('visibilitychange'), 1);
});

test('23 disable while enable is pending releases the sentinel once it resolves', async () => {
  const create = await load(); const nav = makeNav(); nav.mode = 'defer'; const doc = makeDoc(); const wl = create(nav, doc);
  const p = wl.enable(); await flush();
  const d = wl.disable();
  nav.pending[0](); await Promise.all([p, d]); await flush();
  assert.equal(nav.sentinels[0].releaseCalls, 1, 'leaked lock'); assert.equal(wl.status(), 'off'); assert.equal(doc.count('visibilitychange'), 0);
});

test('24 a failed re-request on visible does not throw; status failed', async () => {
  const create = await load(); const nav = makeNav(); const doc = makeDoc(); const wl = create(nav, doc);
  const unhandled = []; const h = e => unhandled.push(e); process.on('unhandledRejection', h);
  try {
    await wl.enable(); doc.set('hidden'); nav.sentinels[0].browserRelease(); nav.mode = 'reject';
    assert.doesNotThrow(() => doc.set('visible')); await flush();
    assert.equal(wl.status(), 'failed'); assert.equal(nav.requests.length, 2);
    nav.mode = 'throw'; doc.set('hidden'); assert.doesNotThrow(() => doc.set('visible')); await flush();
  } finally { process.off('unhandledRejection', h); }
  assert.deepEqual(unhandled, []);
});

test('25 works with doc undefined', async () => {
  const create = await load(); const nav = makeNav(); const wl = create(nav, undefined);
  assert.equal(await wl.enable(), 'on'); await wl.disable(); assert.equal(nav.sentinels[0].releaseCalls, 1); assert.equal(wl.status(), 'off');
});
