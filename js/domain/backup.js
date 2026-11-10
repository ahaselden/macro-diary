// Pure backup-restore logic (extracted from the legacy inline script). No DOM, storage or globals.
import { foodKey } from './food.js';

/** Loose truthiness check, kept identical to the original (returns a truthy/falsy value, not strictly boolean). */
export const validEntry = e => e && typeof e.id === 'string' && e.per100 && isFinite(e.grams) && e.grams > 0;

/** Entries in the backup that this state doesn't have yet (matched by entry id): { [day]: entries[] }. */
export function newEntries(state, backup) {
  const out = {};
  for (const [day, list] of Object.entries(backup.days)) {
    if (!Array.isArray(list)) continue;
    const have = new Set((state.days[day] || []).map(e => e.id)), add = list.filter(e => validEntry(e) && !have.has(e.id));
    if (add.length) out[day] = add;
  }
  return out;
}

/** Returns a NEW state with the backup merged in. Does not mutate `state` or `backup`; the caller saves. */
export function mergeBackup(state, backup) {
  const days = { ...state.days };
  for (const [day, add] of Object.entries(newEntries(state, backup))) days[day] = [...(days[day] || []), ...add];
  const union = (a, b) => { const seen = new Set(a.map(foodKey)); return [...a, ...b.filter(x => x && x.name && x.per100 && !seen.has(foodKey(x)))]; };
  const custom = union(state.custom, backup.custom || []).slice(0, 100);
  const recent = union(state.recent, backup.recent || []).slice(0, 30);
  const measures = { ...state.measures };
  for (const [k, list] of Object.entries(backup.measures || {})) {
    const mine = measures[k] || [], seen = new Set(mine.map(m => m.label));
    const add = (Array.isArray(list) ? list : []).filter(m => m && m.label && m.g > 0 && !seen.has(m.label));
    if (add.length) measures[k] = [...mine, ...add];
  }
  return { ...state, days, custom, recent, measures };
}
