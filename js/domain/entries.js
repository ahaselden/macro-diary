// The only sanctioned ways to change diary entries, so every change is timestamped (for sync/merge)
// and every deletion leaves a tombstone. These MUTATE the `state` they are given (callers then save()).
// `now` is a parameter so tests are deterministic; callers pass Date.now().
import { MEALS } from '../core/constants.js';

/** Is this a usable diary entry? Loose truthiness (kept identical to the original app): string id, nutrition data, positive grams. */
export const validEntry = e => e && typeof e.id === 'string' && e.per100 && isFinite(e.grams) && e.grams > 0;

export function addEntry(state, day, entry, now) {
  entry.updatedAt = now;
  (state.days[day] ||= []).push(entry);
  if (state.tombstones) delete state.tombstones[entry.id];   // re-adding an id undoes its deletion
  return entry;
}

export function updateEntry(state, day, id, patch, now) {
  const e = (state.days[day] || []).find(x => x.id === id);
  if (!e) return null;
  Object.assign(e, patch, { updatedAt: now });
  return e;
}

export function removeEntry(state, day, id, now) {
  const list = state.days[day] || [];
  if (!list.some(e => e.id === id)) return false;
  state.days[day] = list.filter(e => e.id !== id);
  if (!state.days[day].length) delete state.days[day];
  (state.tombstones ||= {})[id] = now;
  return true;
}

/** Call after changing goals/units/source toggles so the change wins a sync. */
export function touchSettings(state, now) { state.settingsUpdatedAt = now; }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

/** Copy entries of `fromDay` (those whose id is in `ids`) to `toDay` under meal `toMeal`. The originals are untouched; each copy is a deep copy
 *  with a new id from `makeId()`, stamped `now` by addEntry (so sync picks it up). Returns the new entries in the diary order of `fromDay`.
 *  Copies nothing (returns []) for an unknown meal, a day that is not YYYY-MM-DD, non-array ids, unknown ids or entries that are not valid. */
export function copyEntries(state, fromDay, ids, toDay, toMeal, now, makeId) {
  if (!MEALS.includes(toMeal) || typeof toDay !== 'string' || !DAY_RE.test(toDay)) return [];
  if (typeof fromDay !== 'string' || !Array.isArray(ids) || !state || !state.days || !own(state.days, fromDay)) return [];
  const want = new Set(ids.filter(i => typeof i === 'string'));
  const src = Array.isArray(state.days[fromDay]) ? state.days[fromDay] : [];
  const picked = [], seen = new Set();
  for (const e of src) {
    if (!validEntry(e) || !want.has(e.id) || seen.has(e.id)) continue;
    seen.add(e.id); picked.push(e);
  }
  return picked.map(e => addEntry(state, toDay, { ...structuredClone(e), id: makeId(), meal: toMeal }, now));
}
