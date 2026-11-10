// In-memory sync "server" implementing the adapter contract (see engine.js). For tests and offline demos.
const clone = v => JSON.parse(JSON.stringify(v));

export function createMemoryAdapter() {
  const store = new Map();            // key -> { value, updatedAt, rev, seq }
  let seq = 0;
  let failure = null;                 // { error, skip }

  const checkFail = () => {
    if (!failure) return;
    if (failure.skip > 0) { failure.skip--; return; }
    const e = failure.error; failure = null;
    throw e instanceof Error ? e : new Error(String(e));
  };

  return {
    /** Make the next call (after `skip` successful calls) throw. */
    failNext(error = new Error('Network down'), { skip = 0 } = {}) { failure = { error, skip }; },

    async pull(cursor) {
      checkFail();
      const since = Number(cursor) || 0;
      const rows = [...store].filter(([, r]) => r.seq > since).sort((a, b) => a[1].seq - b[1].seq);
      const records = rows.map(([key, r]) => ({ key, value: clone(r.value), updatedAt: r.updatedAt, rev: r.rev }));
      return { records, cursor: String(seq) };
    },

    async push(records) {
      checkFail();
      const accepted = [], conflicts = [];
      for (const rec of records) {
        const cur = store.get(rec.key);
        const curRev = cur ? cur.rev : 0;
        if (curRev !== (rec.baseRev || 0)) { conflicts.push(rec.key); continue; }
        store.set(rec.key, { value: clone(rec.value), updatedAt: rec.updatedAt, rev: curRev + 1, seq: ++seq });
        accepted.push({ key: rec.key, rev: curRev + 1 });
      }
      return { accepted, conflicts };
    },

    /** Test helper: what the server holds. */
    __records() { return [...store].map(([key, r]) => ({ key, value: clone(r.value), updatedAt: r.updatedAt, rev: r.rev })); },
  };
}
