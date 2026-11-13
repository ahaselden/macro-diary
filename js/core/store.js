// App state + persistence. The ONE place that touches localStorage. Imports only core/constants and core/schema.
//
// `state` is a single object that is mutated in place (never reassigned), so every module can hold a
// reference to it. Use `replace()` to swap in a whole new state (restore / wipe).
import { STORAGE_KEY } from './constants.js';
import { SCHEMA_VERSION, defaults, migrate, sanitize } from './schema.js';

// re-exported so existing imports (`import { defaults } from './core/store.js'`) keep working
export { SCHEMA_VERSION, defaults, migrate, sanitize };

/** `storage` is anything with getItem/setItem (localStorage in the browser, a fake in tests, or null). */
export function createStore(storage) {
  // the version is read BEFORE the defaults are spread in: a save without schemaVersion is v1 and must run every migration step, not look current
  const load = d => migrate({ ...defaults(), ...d, schemaVersion: Number.isFinite(d && d.schemaVersion) ? d.schemaVersion : 1 });
  const read = () => {
    try { const raw = storage && storage.getItem(STORAGE_KEY); if (raw) { const d = JSON.parse(raw); if (d) return load(d); } } catch { /* corrupt or blocked: fall back */ }
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
      Object.assign(state, load(next));
    },
  };
  return store;
}

const browserStorage = (() => { try { return globalThis.localStorage; } catch { return null; } })();
export const store = createStore(browserStorage);
export const state = store.state;
export const save = () => store.save();
export const replace = next => store.replace(next);
