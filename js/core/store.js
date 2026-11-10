// App state + persistence. The ONE place that touches localStorage. Imports only core/constants.
//
// `state` is a single object that is mutated in place (never reassigned), so every module can hold a
// reference to it. Use `replace()` to swap in a whole new state (restore / wipe).
import { STORAGE_KEY } from './constants.js';

/** Bump when the saved shape changes and add a step to `migrate`. v1 (no schemaVersion) -> v2 just stamps it. */
export const SCHEMA_VERSION = 2;

export const defaults = () => ({
  schemaVersion: SCHEMA_VERSION, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 },
  apiKey: '', useUSDA: true, useOFF: true, days: {}, recent: [], custom: [],
});

const goalNum = (v, fallback) => (v !== null && v !== '' && v !== true && v !== false && Number.isFinite(+v) && +v >= 0 ? +v : fallback);

/**
 * Make loaded/restored data safe to use: right types, finite non-negative goals, known units.
 * Untrusted input (a restored backup file) reaches HTML through these fields, so they are forced to
 * plain numbers/known strings here rather than trusted. Never drops diary data.
 */
export function sanitize(d) {
  const def = defaults(), g = d.goals && typeof d.goals === 'object' ? d.goals : {};
  d.goals = { k: goalNum(g.k, def.goals.k), p: goalNum(g.p, def.goals.p), c: goalNum(g.c, def.goals.c), f: goalNum(g.f, def.goals.f) };
  if (d.weightUnit !== 'g' && d.weightUnit !== 'oz') d.weightUnit = 'g';
  if (typeof d.theme !== 'string') d.theme = 'auto';
  if (typeof d.apiKey !== 'string') d.apiKey = '';
  d.useUSDA = d.useUSDA !== false;
  d.useOFF = d.useOFF !== false;
  if (!d.days || typeof d.days !== 'object' || Array.isArray(d.days)) d.days = {};
  if (!d.measures || typeof d.measures !== 'object' || Array.isArray(d.measures)) d.measures = {};
  if (!Array.isArray(d.recent)) d.recent = [];
  if (!Array.isArray(d.custom)) d.custom = [];
  return d;
}

/** Bring older saved data up to the current shape. Never drops user data. */
export function migrate(d) {
  const v = Number.isFinite(d.schemaVersion) ? d.schemaVersion : 1;
  if (v < 2) d.schemaVersion = 2;   // v1 -> v2: no structural change, just versioning
  // future: if (v < 3) { ...; d.schemaVersion = 3; }
  return sanitize(d);
}

/** `storage` is anything with getItem/setItem (localStorage in the browser, a fake in tests, or null). */
export function createStore(storage) {
  const read = () => {
    try { const raw = storage && storage.getItem(STORAGE_KEY); if (raw) { const d = JSON.parse(raw); if (d) return migrate({ ...defaults(), ...d }); } } catch { /* corrupt or blocked: fall back */ }
    return defaults();
  };
  const state = read();
  const store = {
    state,
    /** Called with no args when a save fails (storage full/blocked). Set by main.js to show a toast. */
    onSaveError: null,
    save() {
      try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
      catch { if (store.onSaveError) store.onSaveError(); return false; }
    },
    /** Swap in a whole new state while keeping the same `state` object identity. */
    replace(next) {
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, migrate({ ...defaults(), ...next }));
    },
  };
  return store;
}

const browserStorage = (() => { try { return globalThis.localStorage; } catch { return null; } })();
export const store = createStore(browserStorage);
export const state = store.state;
export const save = () => store.save();
export const replace = next => store.replace(next);
