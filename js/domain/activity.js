// Imported activity (steps, sleep, workouts per day) next to the diary. PURE: functions take the state (mutated like domain/entries.js) and plain data.
// Shape (D54): state.activity = { 'YYYY-MM-DD': { updatedAt, source, steps?, sleepMinutes?, sleepStart?, sleepEnd?, workouts? } }, cleaned by
// core/schema.js sanitizeActivityDay. It is separate from state.days and never changes a diary number.
import { sanitizeActivityDay, isDateKey } from '../core/schema.js';

const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const sortedJson = v => JSON.stringify(v, (k, x) => (isPlain(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const withoutStamp = r => { const { updatedAt, ...rest } = r; return sortedJson(rest); };   // eslint-disable-line no-unused-vars

/**
 * Put the days of an import (the `days` of combineActivity) into `state.activity`. A stored day is REPLACED as a whole (the export is the truth for the
 * days it holds; days not in the import are not touched). If the new record, ignoring `updatedAt`, equals the stored one nothing is written, so a
 * second import of the same zip changes nothing and sync pushes nothing. Returns { added, updated, unchanged }. A `now` that is not a finite number
 * above 0 applies nothing.
 */
export function applyActivityImport(state, days, now) {
  const res = { added: 0, updated: 0, unchanged: 0 };
  if (!isPlain(state) || !isPlain(days) || typeof now !== 'number' || !Number.isFinite(now) || now <= 0) return res;
  for (const [day, fields] of Object.entries(days)) {
    if (!isDateKey(day) || !isPlain(fields)) continue;
    const rec = sanitizeActivityDay({ ...fields, updatedAt: now, source: 'google-health' });
    if (!rec) continue;
    if (!isPlain(state.activity)) state.activity = {};
    const had = Object.prototype.hasOwnProperty.call(state.activity, day), old = had ? sanitizeActivityDay(state.activity[day]) : null;
    if (old && withoutStamp(old) === withoutStamp(rec)) { res.unchanged++; continue; }
    state.activity[day] = rec;
    if (had) res.updated++; else res.added++;
  }
  return res;
}

/** The stored record of a day (own key only), or null. */
export function activityForDay(state, day) {
  const a = isPlain(state) ? state.activity : null;
  return isPlain(a) && typeof day === 'string' && Object.prototype.hasOwnProperty.call(a, day) && isPlain(a[day]) ? a[day] : null;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** 'Steps 9,431 · Sleep 7 h 45 min · 2 workouts' (parts that are absent are left out), or '' when there is nothing to show. */
export function activityLine(rec) {
  if (!isPlain(rec)) return '';
  const parts = [];
  if (typeof rec.steps === 'number' && Number.isFinite(rec.steps) && rec.steps > 0) parts.push('Steps ' + Math.round(rec.steps).toLocaleString('en-US'));
  if (typeof rec.sleepMinutes === 'number' && Number.isFinite(rec.sleepMinutes) && rec.sleepMinutes > 0) {
    const m = Math.round(rec.sleepMinutes), h = Math.floor(m / 60), r = m % 60;
    parts.push('Sleep ' + [h ? h + ' h' : '', r ? r + ' min' : ''].filter(Boolean).join(' '));
  }
  if (Array.isArray(rec.workouts) && rec.workouts.length) parts.push(count(rec.workouts.length, 'workout', 'workouts'));
  return parts.join(' · ');
}

// ---- the Diary line of one workout (backlog item 24, D67) ---------------------------------------------------------------------------------------
const read = (o, k) => { try { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; } catch { return undefined; } };
const inRange = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/**
 * "Run · 31 min · 4.2 km · 312 kcal · avg 148 bpm": plain TEXT (the caller escapes it). Parts that are not recorded are left out; distance follows the
 * units setting ('oz' -> miles, anything else -> kilometres, one decimal); numbers outside the saved-shape ranges count as not recorded. '' for a
 * value that is not a workout. Own properties only; never throws.
 */
export function workoutLine(w, weightUnit) {
  try {
    if (!isPlain(w)) return '';
    const name = read(w, 'name'), shown = typeof name === 'string' && name.trim() ? name.trim() : 'Workout';
    const minutes = inRange(read(w, 'minutes'), 0, 1440), dist = inRange(read(w, 'distanceM'), 0, 1000000);
    const kcal = inRange(read(w, 'kcal'), 0, 20000), hr = inRange(read(w, 'avgHr'), 20, 300);
    const parts = [shown, `${minutes === null ? 0 : Math.round(minutes)} min`];
    if (dist !== null) { const oz = weightUnit === 'oz', shown1 = (oz ? dist / 1609.344 : dist / 1000).toFixed(1); if (shown1 !== '0.0') parts.push(`${shown1} ${oz ? 'mi' : 'km'}`); }   // a distance that rounds to 0.0 is left out
    if (kcal !== null) parts.push(`${Math.round(kcal)} kcal`);
    if (hr !== null) parts.push(`avg ${Math.round(hr)} bpm`);
    return parts.join(' · ');
  } catch { return ''; }
}
