// The only sanctioned ways to change diary entries, so every change is timestamped (for sync/merge)
// and every deletion leaves a tombstone. These MUTATE the `state` they are given (callers then save()).
// `now` is a parameter so tests are deterministic; callers pass Date.now().

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
