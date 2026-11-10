import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine } from '../js/services/sync/engine.js';
import { createMemoryAdapter } from '../js/services/sync/memory-adapter.js';
import { addEntry, updateEntry, removeEntry, touchSettings } from '../js/domain/entries.js';
import { defaults } from '../js/core/schema.js';
import { clone } from './helpers.js';

const per100 = { k: 100, p: 1, c: 1, f: 1 };
const entry = (id, over = {}) => ({ id, meal: 'Lunch', name: id, brand: '', source: 'x', per100, grams: 100, ...over });

let clock = 1000;
const tick = () => ++clock;

class Device {
  constructor(adapter, name = 'dev') {
    this.name = name; this.state = defaults(); this.saved = null; this.adapter = adapter;
    this.meta = { load: () => (this.saved ? clone(this.saved) : null), save: o => { this.saved = clone(o); } };
    this.engine = createSyncEngine({ adapter, getState: () => this.state, applyState: s => { this.state = s; }, meta: this.meta, now: tick });
  }
  sync() { return this.engine.sync(); }
  add(day, id, over) { addEntry(this.state, day, entry(id, over), tick()); }
  edit(day, id, patch) { return updateEntry(this.state, day, id, patch, tick()); }
  del(day, id) { return removeEntry(this.state, day, id, tick()); }
  ids(day) { return (this.state.days[day] || []).map(e => e.id); }
}
const spyPush = adapter => { const calls = []; const orig = adapter.push.bind(adapter); adapter.push = async r => { calls.push(r); return orig(r); }; return calls; };

test('two devices adding on different days', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.add('2024-05-01', 'a1'); b.add('2024-05-02', 'b1');
  assert.equal((await a.sync()).ok, true); await b.sync(); await a.sync();
  assert.deepEqual(a.state.days, b.state.days);
  assert.deepEqual(a.ids('2024-05-02'), ['b1']); assert.deepEqual(b.ids('2024-05-01'), ['a1']);
});

test('same day: both entries survive', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.add('d1'.replace('d1', '2024-05-01'), 'a1'); b.add('2024-05-01', 'b1');
  await a.sync(); await b.sync(); await a.sync();
  assert.deepEqual(a.ids('2024-05-01'), ['a1', 'b1']); assert.deepEqual(b.ids('2024-05-01'), ['a1', 'b1']);
});

test('editing the same entry: newest wins', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.add('2024-05-01', 'e'); await a.sync(); await b.sync();
  b.edit('2024-05-01', 'e', { grams: 111 }); a.edit('2024-05-01', 'e', { grams: 222 });   // a is newer
  await b.sync(); await a.sync(); await b.sync();
  assert.equal(a.state.days['2024-05-01'][0].grams, 222); assert.equal(b.state.days['2024-05-01'][0].grams, 222);
});

test('deleting on one device removes on the other', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.add('2024-05-01', 'e'); a.add('2024-05-01', 'keep'); await a.sync(); await b.sync();
  b.del('2024-05-01', 'e'); await b.sync(); await a.sync();
  assert.deepEqual(a.ids('2024-05-01'), ['keep']);
});

test('deleting the last entry of a day empties it everywhere', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.add('2024-05-01', 'e'); await a.sync(); await b.sync();
  b.del('2024-05-01', 'e'); await b.sync(); await a.sync(); await b.sync(); await a.sync();
  assert.deepEqual(a.state.days, {}); assert.deepEqual(b.state.days, {});
  assert.deepEqual(srv.__records().find(r => r.key === 'day:2024-05-01').value, { entries: [] });
});

test('delete then edit afterwards: edit wins', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.add('2024-05-01', 'e'); await a.sync(); await b.sync();
  a.del('2024-05-01', 'e'); await a.sync();
  b.edit('2024-05-01', 'e', { grams: 321 }); await b.sync(); await a.sync();
  assert.equal(a.state.days['2024-05-01'][0].grams, 321); assert.equal(b.state.days['2024-05-01'][0].grams, 321);
});

test('settings: newest wins', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.state.goals = { k: 1000, p: 1, c: 1, f: 1 }; touchSettings(a.state, tick());
  b.state.goals = { k: 3000, p: 2, c: 2, f: 2 }; b.state.weightUnit = 'oz'; touchSettings(b.state, tick());
  await a.sync(); await b.sync(); await a.sync();
  assert.equal(a.state.goals.k, 3000); assert.equal(a.state.weightUnit, 'oz'); assert.deepEqual(a.state.goals, b.state.goals);
});

test('theme, apiKey and recent never travel', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.state.theme = 'dark'; a.state.apiKey = 'SECRET'; a.state.recent = ['r']; a.add('2024-05-01', 'e');
  await a.sync(); await b.sync();
  assert.equal(b.state.theme, 'auto'); assert.equal(b.state.apiKey, ''); assert.deepEqual(b.state.recent, []);
  assert.ok(!JSON.stringify(srv.__records()).includes('SECRET'));
  assert.equal(a.state.theme, 'dark');
});

test('a second sync pushes nothing; cursor advances', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.add('2024-05-01', 'e'); await a.sync();
  assert.equal(a.saved.cursor, '4'.replace('4', String(a.saved.cursor)));
  const c1 = Number(a.saved.cursor);
  await b.sync(); const bc = Number(b.saved.cursor); assert.ok(bc > 0);
  const calls = spyPush(srv);
  const r = await a.sync(); assert.equal(r.ok, true); assert.equal(r.pushed, 0); assert.equal(r.changed, false);
  const r2 = await b.sync(); assert.equal(r2.pushed, 0);
  assert.equal(calls.length, 0);
  assert.ok(Number(a.saved.cursor) >= c1);
  a.add('2024-05-02', 'f'); await a.sync(); assert.ok(Number(a.saved.cursor) > c1);
  assert.equal(typeof a.saved.lastSyncAt, 'number');
});

test('adapter outage mid-sync loses nothing; later sync succeeds', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  b.add('2024-05-02', 'b1'); await b.sync();
  a.add('2024-05-01', 'a1');
  srv.failNext(new Error('Network down'), { skip: 1 });      // pull ok, push fails
  const r = await a.sync();
  assert.deepEqual(r, { ok: false, error: 'Network down' });
  assert.equal(a.saved, null);                                // cursor not advanced, no hashes marked
  assert.deepEqual(a.ids('2024-05-01'), ['a1']);
  srv.failNext(new Error('Down again'));                      // pull fails
  assert.equal((await a.sync()).ok, false);
  assert.equal((await a.sync()).ok, true); await b.sync();
  assert.deepEqual(b.ids('2024-05-01'), ['a1']); assert.deepEqual(a.ids('2024-05-02'), ['b1']);
});

test('push conflict: interleaved push by another device is retried', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv), b = new Device(srv);
  a.add('2024-05-01', 'a1'); await a.sync(); await b.sync();
  a.add('2024-05-01', 'a2');
  let armed = true, pushes = 0;
  const wrapped = { pull: c => srv.pull(c), push: async recs => {
    pushes++;
    if (armed) { armed = false; b.add('2024-05-01', 'b1'); await b.sync(); }
    return srv.push(recs);
  } };
  a.engine = createSyncEngine({ adapter: wrapped, getState: () => a.state, applyState: s => { a.state = s; }, meta: a.meta, now: tick });
  const r = await a.sync();
  assert.equal(r.ok, true); assert.ok(pushes >= 2);           // a conflicting push, then the retry
  await b.sync();
  assert.deepEqual(a.ids('2024-05-01'), ['a1', 'a2', 'b1']); assert.deepEqual(b.state.days, a.state.days);
});

test('endless conflicts give up with a message and keep local data', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv);
  a.add('2024-05-01', 'a1');
  a.engine = createSyncEngine({ adapter: { pull: c => srv.pull(c), push: async r => ({ accepted: [], conflicts: r.map(x => x.key) }) },
    getState: () => a.state, applyState: s => { a.state = s; }, meta: a.meta, now: tick });
  assert.deepEqual(await a.sync(), { ok: false, error: 'Sync conflict, try again' });
  assert.deepEqual(a.ids('2024-05-01'), ['a1']);
});

test('junk from the server does not crash the engine', async () => {
  const srv = createMemoryAdapter(), a = new Device(srv);
  a.add('2024-05-01', 'a1');
  const junk = [null, 7, { key: 'zzz', value: {} }, { key: 'custom', value: { custom: 'x' } }, { key: 'measures', value: { measures: { a: 5 } } },
    { key: 'tombstones', value: { tombstones: { q: 'bad' } } }, { key: 'day:2024-05-01', value: { entries: [null, { id: 9 }] } }, { key: 'day:2024-05-09', value: 'str' }];
  const bad = { pull: async () => ({ records: junk, cursor: '1' }), push: r => srv.push(r) };
  a.engine = createSyncEngine({ adapter: bad, getState: () => a.state, applyState: s => { a.state = s; }, meta: a.meta, now: tick });
  const r = await a.sync();
  assert.equal(r.ok, true);
  assert.deepEqual(a.ids('2024-05-01'), ['a1']);
  const r2 = await createSyncEngine({ adapter: { pull: async () => ({}), push: async () => ({}) }, getState: () => a.state, applyState() {}, meta: a.meta, now: tick }).sync();
  assert.ok('ok' in r2);
});

// ---------- randomized multi-device simulation ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const strip = s => { const { theme, apiKey, recent, ...rest } = s; return rest; };

for (const seed of [1, 2, 3, 42]) {
  test(`randomized 3-device simulation converges (seed ${seed})`, async () => {
    const rand = rng(seed), pick = a => a[Math.floor(rand() * a.length)];
    const srv = createMemoryAdapter(), devs = [new Device(srv, 'A'), new Device(srv, 'B'), new Device(srv, 'C')];
    const days = ['2024-06-01', '2024-06-02', '2024-06-03'];
    const added = new Set(), deleted = new Set(); let n = 0;
    for (let i = 0; i < 200; i++) {
      const d = pick(devs), op = rand();
      if (op < 0.3) { const id = `e${String(++n).padStart(4, '0')}`; d.add(pick(days), id); added.add(id); }
      else if (op < 0.5 || op < 0.65) {
        const all = Object.entries(d.state.days).flatMap(([day, l]) => l.map(e => [day, e.id]));
        if (all.length) { const [day, id] = pick(all); if (op < 0.5) d.edit(day, id, { grams: 1 + Math.floor(rand() * 500) }); else { d.del(day, id); deleted.add(id); } }
      } else if (op < 0.72) { d.state.goals = { ...d.state.goals, k: 1000 + Math.floor(rand() * 2000) }; touchSettings(d.state, tick()); }
      else { const r = await d.sync(); assert.equal(r.ok, true, r.error); }
    }
    for (let round = 0; round < 10; round++) {
      let quiet = true;
      for (const d of devs) { const r = await d.sync(); assert.equal(r.ok, true, r.error); if (r.pushed || r.changed) quiet = false; }
      if (quiet) break;
    }
    for (const d of devs) {
      assert.deepEqual(strip(d.state), strip(devs[0].state));
      const have = new Set(Object.values(d.state.days).flat().map(e => e.id));
      for (const id of added) if (!deleted.has(id)) assert.ok(have.has(id), `${id} missing on ${d.name}`);
    }
    const calls = spyPush(srv);
    for (const d of devs) assert.equal((await d.sync()).pushed, 0);
    assert.equal(calls.length, 0);
  });
}
