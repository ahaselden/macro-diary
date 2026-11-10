// Device-sync engine: storage- and backend-agnostic. Talks to an adapter, merges with domain/sync-records.
//
// adapter (all async):
//   pull(cursor) -> { records: [{key,value,updatedAt,rev}], cursor }
//   push([{key,value,updatedAt,baseRev}]) -> { accepted: [{key,rev}], conflicts: [key] }
// meta: { load() -> {cursor, revs, hashes, lastSyncAt} | null, save(obj) }   (per-device bookkeeping, never in app state)
import { toRecords, applyRecords, recordHash, stableStringify, isSyncKey } from '../../domain/sync-records.js';

const MAX_ROUNDS = 4;

export function createSyncEngine({ adapter, getState, applyState, meta, now }) {
  let running = null;

  // Local records, plus an empty record for days that were emptied but are known to the server
  // (so the emptied day is pushed instead of leaving a stale copy there).
  function localMap(state, revs) {
    const map = new Map(toRecords(state).map(r => [r.key, r]));
    for (const key of Object.keys(revs)) {
      if (key.startsWith('day:') && !map.has(key)) map.set(key, { key, value: { entries: [] }, updatedAt: 0 });
    }
    return map;
  }

  function finish(cursor, revs, hashes, pulled, pushed, changed) {
    meta.save({ cursor, revs, hashes, lastSyncAt: now() });
    return { ok: true, pulled, pushed, changed };
  }

  async function run() {
    const saved = (meta && meta.load && meta.load()) || {};
    let cursor = saved.cursor ?? null;
    const revs = { ...(saved.revs || {}) };
    const hashes = { ...(saved.hashes || {}) };
    let pulled = 0, pushed = 0, changed = false;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // (a) pull + merge
      const res = await adapter.pull(cursor);
      const remote = Array.isArray(res && res.records) ? res.records : [];
      pulled += remote.length;
      const before = getState();
      const after = applyRecords(before, remote);
      if (stableStringify(before) !== stableStringify(after)) { applyState(after); changed = true; }
      const local = localMap(getState(), revs);
      for (const r of remote) {
        if (!r || typeof r !== 'object' || !isSyncKey(r.key)) continue;
        if (Number.isInteger(r.rev)) revs[r.key] = Math.max(revs[r.key] || 0, r.rev);
        const mine = local.get(r.key) || (r.key.startsWith('day:') ? { key: r.key, value: { entries: [] } } : null);
        if (mine && recordHash(mine) === recordHash(r)) hashes[r.key] = recordHash(r); else delete hashes[r.key];
      }
      if (res && res.cursor != null) cursor = res.cursor;

      // (b) what is dirty?
      const dirty = [...localMap(getState(), revs).values()].filter(r => hashes[r.key] !== recordHash(r));
      if (!dirty.length) return finish(cursor, revs, hashes, pulled, pushed, changed);

      // (c) push
      const out = await adapter.push(dirty.map(r => ({ key: r.key, value: r.value, updatedAt: r.updatedAt, baseRev: revs[r.key] || 0 })));
      const byKey = new Map(dirty.map(r => [r.key, r]));
      for (const a of (out && out.accepted) || []) {
        const r = byKey.get(a.key);
        if (!r) continue;
        revs[a.key] = a.rev; hashes[a.key] = recordHash(r); pushed++;
      }
      if (!((out && out.conflicts) || []).length) return finish(cursor, revs, hashes, pulled, pushed, changed);
      // conflicts: go round again, pulling the competing versions first
    }
    return { ok: false, error: 'Sync conflict, try again' };
  }

  return {
    async sync() {
      if (running) return running;           // never run two syncs of one device at once
      running = (async () => {
        try { return await run(); }
        catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
        finally { running = null; }
      })();
      return running;
    },
  };
}
