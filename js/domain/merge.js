// Conflict-free merge of two app states, used by "Restore → Merge" now and by device sync later. Pure.
//
// Rule: LAST WRITER WINS PER RECORD, using `updatedAt` (ms since epoch; missing = 0 = "older than any real edit").
//   • diary entry      → record = one entry (matched by id)
//   • custom food      → record = one food (matched by foodKey)
//   • saved measure    → record = one measure of one food (matched by label)
//   • settings         → ONE record (goals, weightUnit, useUSDA, useOFF, syncApiKey and, when that is on, apiKey), stamped by `settingsUpdatedAt`
//   • deletions        → `tombstones[id] = deletedAt`; a tombstone beats an entry last edited before it,
//                        an edit made after the deletion beats the tombstone (resurrects the entry)
//   • recipe           → record = one recipe (by id); tombstones apply to recipe ids too
//   • plan             → record = one planned DAY (the newer edit replaces the whole day; clearing a day is an edit)
//   • shopping         → ticked items (per key) and hand-added extras (per id; tombstones apply)
// Never merged (stay as this device has them): theme, recent. The USDA key follows the settings record only while `syncApiKey` is on (D42).
//
// Properties (tested): commutative, associative, idempotent — so any number of devices syncing in any
// order converge on the same result. Ties on equal timestamps are broken by comparing the serialised
// records, which is arbitrary but identical on every device. Pass { preferLocal: true } to break ties
// in favour of the first argument instead (used for restoring an old backup that has no timestamps);
// that mode is NOT commutative and must not be used for sync.
import { foodKey } from './food.js';
import { validEntry } from './entries.js';

const stamp = x => (x && Number.isFinite(x.updatedAt) ? x.updatedAt : 0);
const canon = x => JSON.stringify(x);

/** Pick the winning record of two versions of the same thing. */
function newer(a, b, preferA) {
  const sa = stamp(a), sb = stamp(b);
  if (sa !== sb) return sa > sb ? a : b;
  if (preferA) return a;
  return canon(a) >= canon(b) ? a : b;
}

const SETTINGS_KEYS = ['goals', 'weightUnit', 'useUSDA', 'useOFF', 'syncApiKey'];

export function mergeStates(local, remote, opts = {}) {
  const pref = !!opts.preferLocal;

  // tombstones: union, latest deletion time wins
  const tombstones = {};
  for (const src of [local.tombstones, remote.tombstones]) {
    for (const [id, t] of Object.entries(src || {})) tombstones[id] = Math.max(tombstones[id] || 0, Number(t) || 0);
  }

  // diary days
  const days = {};
  const dayKeys = new Set([...Object.keys(local.days || {}), ...Object.keys(remote.days || {})]);
  for (const day of dayKeys) {
    const byId = new Map();
    for (const e of [...(local.days?.[day] || []), ...(remote.days?.[day] || [])]) {
      if (!validEntry(e)) continue;                                 // junk (no id / no nutrition / bad grams): skip
      const cur = byId.get(e.id);
      byId.set(e.id, cur ? newer(cur, e, pref) : e);                // local entries are inserted first
    }
    const list = [...byId.values()]
      .filter(e => !(e.id in tombstones) || stamp(e) > tombstones[e.id])
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));    // ids are time-ordered; makes the order identical on every device
    if (list.length) days[day] = list;
  }

  // custom foods (most recently changed first, then by key — deterministic)
  const foods = new Map();
  for (const f of [...(local.custom || []), ...(remote.custom || [])]) {
    if (!f || !f.name || !f.per100) continue;
    const k = foodKey(f), cur = foods.get(k);
    foods.set(k, cur ? newer(cur, f, pref) : f);
  }
  const custom = [...foods.entries()].sort(([ka, a], [kb, b]) => stamp(b) - stamp(a) || (ka < kb ? -1 : ka > kb ? 1 : 0)).map(([, f]) => f).slice(0, 100);

  // saved measures
  const measures = {};
  for (const k of new Set([...Object.keys(local.measures || {}), ...Object.keys(remote.measures || {})])) {
    const byLabel = new Map();
    for (const m of [...(local.measures?.[k] || []), ...(remote.measures?.[k] || [])]) {
      if (!m || !m.label || !(m.g > 0)) continue;
      const cur = byLabel.get(m.label);
      byLabel.set(m.label, cur ? newer(cur, m, pref) : m);
    }
    const list = [...byLabel.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    if (list.length) measures[k] = list;
  }

  // settings: one record, newest wins as a whole
  const pick = (x, y) => {
    const rec = x => ({ updatedAt: x.settingsUpdatedAt, ...Object.fromEntries(SETTINGS_KEYS.map(k => [k, x[k]])), ...(x.syncApiKey === true && typeof x.apiKey === 'string' ? { apiKey: x.apiKey } : {}) });   // the key is part of the record only while its sync switch is on
    const a = rec(local), b = rec(remote);
    return newer(a, b, pref);
  };
  const winner = pick();
  const settings = Object.fromEntries(SETTINGS_KEYS.map(k => [k, winner[k] !== undefined ? winner[k] : local[k]]));
  // USDA key: adopted only from a winning record whose sync switch is on; a switch turned off elsewhere never wipes this device's key
  const apiKey = winner.syncApiKey === true && typeof winner.apiKey === 'string' ? winner.apiKey : local.apiKey;

  // recipes (a deleted recipe stays deleted unless it was edited after the deletion)
  const isRecipe = r => r && typeof r.id === 'string' && typeof r.name === 'string';
  const recipes = {};
  for (const id of [...new Set([...Object.keys(local.recipes || {}), ...Object.keys(remote.recipes || {})])].sort()) {
    const cands = [local.recipes?.[id], remote.recipes?.[id]].filter(isRecipe);
    if (!cands.length) continue;
    const win = cands.length === 2 ? newer(cands[0], cands[1], pref) : cands[0];
    if (id in tombstones && stamp(win) <= tombstones[id]) continue;
    recipes[id] = win;
  }

  // plan: one record per day
  const plan = {};
  for (const date of [...new Set([...Object.keys(local.plan || {}), ...Object.keys(remote.plan || {})])].sort()) {
    const cands = [local.plan?.[date], remote.plan?.[date]].filter(d => d && typeof d === 'object' && d.slots);
    if (cands.length) plan[date] = cands.length === 2 ? newer(cands[0], cands[1], pref) : cands[0];
  }

  // shopping: ticks per item key, extras per id
  const checks = {};
  for (const k of [...new Set([...Object.keys(local.shopping?.checks || {}), ...Object.keys(remote.shopping?.checks || {})])].sort()) {
    const cands = [local.shopping?.checks?.[k], remote.shopping?.checks?.[k]].filter(Boolean);
    checks[k] = cands.length === 2 ? newer(cands[0], cands[1], pref) : cands[0];
  }
  const extras = {};
  for (const id of [...new Set([...Object.keys(local.shopping?.extras || {}), ...Object.keys(remote.shopping?.extras || {})])].sort()) {
    const cands = [local.shopping?.extras?.[id], remote.shopping?.extras?.[id]].filter(x => x && typeof x.text === 'string');
    if (!cands.length) continue;
    const win = cands.length === 2 ? newer(cands[0], cands[1], pref) : cands[0];
    if (id in tombstones && stamp(win) <= tombstones[id]) continue;
    extras[id] = win;
  }

  return {
    ...local,                                              // theme, apiKey, recent… stay as this device has them
    ...settings,
    ...(apiKey !== undefined ? { apiKey } : {}),
    settingsUpdatedAt: Math.max(Number(local.settingsUpdatedAt) || 0, Number(remote.settingsUpdatedAt) || 0),
    schemaVersion: Math.max(Number(local.schemaVersion) || 0, Number(remote.schemaVersion) || 0),
    days, custom, measures, tombstones, recipes, plan, shopping: { checks, extras },
  };
}

/** Drop tombstones older than `before` (ms). Only safe once every device has synced since then. */
export function pruneTombstones(state, before) {
  const tombstones = {};
  for (const [id, t] of Object.entries(state.tombstones || {})) if (t >= before) tombstones[id] = t;
  return { ...state, tombstones };
}
