// Conflict-free merge of two app states, used by "Restore → Merge" now and by device sync later. Pure.
//
// Rule: LAST WRITER WINS PER RECORD, using `updatedAt` (ms since epoch; missing = 0 = "older than any real edit").
//   • diary entry      → record = one entry (matched by id)
//   • custom food      → record = one saved food (matched by its `id`, D53; a food without a valid id first gets the id derived from its name/brand/source/barcode)
//   • saved measure    → record = one measure of one food (matched by label); buckets are keyed by the saved food's id (foods that are not saved: by foodKey)
//   • settings         → ONE record (goals, weightUnit, useUSDA, useOFF, syncApiKey and, when that is on, apiKey), stamped by `settingsUpdatedAt`
//   • deletions        → `tombstones[id] = deletedAt`; a tombstone beats an entry last edited before it,
//                        an edit made after the deletion beats the tombstone (resurrects the entry)
//   • recipe           → record = one recipe (by id); tombstones apply to recipe ids too
//   • plan             → record = one planned DAY (the newer edit replaces the whole day; clearing a day is an edit)
//   • shopping         → ticked items (per key) and hand-added extras (per id; tombstones apply)
//   • activity         → record = one imported day (Google Health, D54); the newer `updatedAt` replaces the whole day; tombstones do NOT apply (no delete action)
// Never merged (stay as this device has them): theme, recent. The USDA key follows the settings record only while `syncApiKey` is on (D42).
// One deliberate exception to commutativity: when the winning settings record has the switch OFF, `apiKey` stays whatever THIS device has, so that field
// depends on which side is local (a key is never wiped by another device's switch). Every other synced field commutes.
//
// Properties (tested): commutative, associative, idempotent — so any number of devices syncing in any
// order converge on the same result. Ties on equal timestamps are broken by comparing the serialised
// records, which is arbitrary but identical on every device. Pass { preferLocal: true } to break ties
// in favour of the first argument instead (used for restoring an old backup that has no timestamps);
// that mode is NOT commutative and must not be used for sync.
import { isLegitKey, isPlaceholderKey, withFoodIds, unionMeasures, isSafeKey, isDateKey } from '../core/schema.js';
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

  // custom foods: matched by id (withFoodIds gives a food without a valid id the id derived from its identity, so an old-app copy meets the same food);
  // the newest record wins as a whole; a tombstone hides a food last edited at or before it; most recently changed first, then by id; at most 100 (D53)
  const foods = new Map(), idsByKey = new Map();
  for (const f of [...withFoodIds(local.custom), ...withFoodIds(remote.custom)]) {
    if (!f.name || !f.per100) continue;
    const cur = foods.get(f.id);
    foods.set(f.id, cur ? newer(cur, f, pref) : f);
    const k = foodKey(f); if (!idsByKey.has(k)) idsByKey.set(k, new Set());
    idsByKey.get(k).add(f.id);                                       // every name this food was seen under, winner or not
  }
  const custom = [...foods.values()].filter(f => !(f.id in tombstones) || stamp(f) > tombstones[f.id])
    .sort((a, b) => stamp(b) - stamp(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 100);

  // saved measures
  const measures = {};
  const listOf = (src, k) => (src && Object.prototype.hasOwnProperty.call(src, k) && Array.isArray(src[k]) ? src[k] : []);
  for (const k of new Set([...Object.keys(local.measures || {}), ...Object.keys(remote.measures || {})])) {
    if (!isSafeKey(k)) continue;                                     // never a bucket named after a prototype key
    const byLabel = new Map();
    for (const m of [...listOf(local.measures, k), ...listOf(remote.measures, k)]) {
      if (!m || !m.label || !(m.g > 0)) continue;
      const cur = byLabel.get(m.label);
      byLabel.set(m.label, cur ? newer(cur, m, pref) : m);
    }
    const list = [...byLabel.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    if (list.length) measures[k] = list;
  }
  // an old-app device keeps writing a saved food's measures under name|brand|source: fold those buckets into the food's id bucket (all names it was seen under)
  const byLabelAsc = (a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  for (const [k, ids] of idsByKey) {
    if (!Object.prototype.hasOwnProperty.call(measures, k)) continue;
    for (const id of ids) measures[id] = unionMeasures(measures[id], measures[k]).sort(byLabelAsc);
  }
  for (const k of idsByKey.keys()) delete measures[k];

  // settings: one record, newest wins as a whole
  const pick = (x, y) => {
    const rec = x => ({ updatedAt: x.settingsUpdatedAt, ...Object.fromEntries(SETTINGS_KEYS.map(k => [k, x[k]])), ...(x.syncApiKey === true && typeof x.apiKey === 'string' ? { apiKey: x.apiKey } : {}) });   // the key is part of the record only while its sync switch is on
    const a = rec(local), b = rec(remote);
    return newer(a, b, pref);
  };
  const winner = pick();
  const settings = Object.fromEntries(SETTINGS_KEYS.map(k => [k, winner[k] !== undefined ? winner[k] : local[k]]));
  // USDA key (D42, D46): a legitimate key always beats an empty or demo one, whichever settings record is newer. Otherwise it is adopted only
  // from a winning record whose sync switch is on; a switch turned off elsewhere never wipes this device's key.
  const offered = remote.syncApiKey === true && typeof remote.apiKey === 'string' ? remote.apiKey : undefined;
  const apiKey = isLegitKey(local.apiKey) && isPlaceholderKey(offered) ? local.apiKey
    : isPlaceholderKey(local.apiKey) && isLegitKey(offered) ? offered
    : isPlaceholderKey(local.apiKey) && isPlaceholderKey(offered) && winner.syncApiKey === true
      ? (typeof winner.apiKey === 'string' ? winner.apiKey : typeof local.apiKey === 'string' ? local.apiKey : typeof offered === 'string' ? offered : local.apiKey)   // two placeholders: a string whenever either side has one, the same in either order
    : winner.syncApiKey === true && typeof winner.apiKey === 'string' ? winner.apiKey : local.apiKey;

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

  // activity: one record per day, newest wins as a whole (keys must be real dates, so a hostile key such as __proto__ never becomes a bucket)
  const activity = {};
  const actOf = (src, day) => { const a = src && src.activity; return a && typeof a === 'object' && !Array.isArray(a) && Object.prototype.hasOwnProperty.call(a, day) ? a[day] : undefined; };
  const isAct = r => !!r && typeof r === 'object' && !Array.isArray(r);
  const actKeys = src => (src && src.activity && typeof src.activity === 'object' && !Array.isArray(src.activity) ? Object.keys(src.activity) : []);
  for (const day of [...new Set([...actKeys(local), ...actKeys(remote)])].filter(isDateKey).sort()) {
    const cands = [actOf(local, day), actOf(remote, day)].filter(isAct);
    if (cands.length) activity[day] = cands.length === 2 ? newer(cands[0], cands[1], pref) : cands[0];
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
    ...(apiKey !== undefined || 'apiKey' in local ? { apiKey } : {}),
    settingsUpdatedAt: Math.max(Number(local.settingsUpdatedAt) || 0, Number(remote.settingsUpdatedAt) || 0),
    schemaVersion: Math.max(Number(local.schemaVersion) || 0, Number(remote.schemaVersion) || 0),
    days, custom, measures, tombstones, recipes, plan, shopping: { checks, extras }, activity,
  };
}

/** Drop tombstones older than `before` (ms). Only safe once every device has synced since then. */
export function pruneTombstones(state, before) {
  const tombstones = {};
  for (const [id, t] of Object.entries(state.tombstones || {})) if (t >= before) tombstones[id] = t;
  return { ...state, tombstones };
}
