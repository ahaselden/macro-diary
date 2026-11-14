// Conversion between the whole app state and the per-key RECORDS that device sync moves around. Pure.
//
// A record is { key, value, updatedAt }. Keys:
//   settings            value { goals, weightUnit, useUSDA, useOFF, settingsUpdatedAt }
//   custom              value { custom: [foods] }            (each saved food carries its `id`; an old-app device sends none and merge derives it, D53)
//   measures            value { measures: { savedFoodId | foodKey: [{label,g,updatedAt}] } }
//   tombstones          value { tombstones: { id: deletedAtMs } }
//   day:YYYY-MM-DD      value { entries: [entry, ...] }
//   recipe:<id>         value { recipe }
//   plan:YYYY-MM-DD     value { plan: { updatedAt, slots } }
//   shopping            value { shopping: { checks, extras } }
//   activity:YYYY-MM-DD value { activity: { updatedAt, source, steps?, sleepMinutes?, sleepStart?, sleepEnd?, workouts? } }   (imported from Google Health, D54; one record per day)
// Remote data is untrusted: applyRecords ignores anything malformed and never throws.
// theme / recent never become records; the USDA key only travels in the settings record while the owner's syncApiKey switch is on (D42, reverses part of D10).
import { mergeStates } from './merge.js';
import { validEntry } from './entries.js';
import { sanitize, sanitizeRecipe, sanitizePlanDay, sanitizeActivityDay, isDateKey, sanitizeShopping, cleanApiKey, isPlaceholderKey, sanitizeNut, sanitizeBarcode, isFoodId, isSafeKey, withFoodIds } from '../core/schema.js';

const DAY_KEY = /^day:(\d{4}-\d{2}-\d{2})$/;
const PLAN_KEY = /^plan:(\d{4}-\d{2}-\d{2})$/;
const ACTIVITY_KEY = /^activity:(\d{4}-\d{2}-\d{2})$/;
const RECIPE_KEY = /^recipe:(.{1,80})$/;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const stamp = x => (x && Number.isFinite(x.updatedAt) ? x.updatedAt : 0);
const maxStamp = list => list.reduce((m, x) => Math.max(m, stamp(x)), 0);

/** Is `key` one of the keys sync understands? */
export const isSyncKey = key => typeof key === 'string' && (key === 'settings' || key === 'custom' || key === 'measures' || key === 'tombstones' || key === 'shopping' || DAY_KEY.test(key) || PLAN_KEY.test(key) || ACTIVITY_KEY.test(key) || RECIPE_KEY.test(key));

/** The records for the whole state. Settings always; the rest only when non-empty; empty days skipped. */
export function toRecords(state) {
  const out = [];
  const g = state.goals || {};
  const su = Number(state.settingsUpdatedAt) || 0;
  out.push({
    key: 'settings',
    value: { goals: { ...g }, weightUnit: state.weightUnit, useUSDA: state.useUSDA, useOFF: state.useOFF, syncApiKey: state.syncApiKey === true,
      ...(state.syncApiKey === true && !isPlaceholderKey(cleanApiKey(state.apiKey)) ? { apiKey: cleanApiKey(state.apiKey) } : {}), settingsUpdatedAt: su },
    updatedAt: su,
  });
  if (Array.isArray(state.custom) && state.custom.length) out.push({ key: 'custom', value: { custom: state.custom }, updatedAt: maxStamp(state.custom) });
  const measures = state.measures || {};
  const mKeys = Object.keys(measures).filter(k => Array.isArray(measures[k]) && measures[k].length);
  if (mKeys.length) {
    const value = {}; let u = 0;
    for (const k of mKeys) { value[k] = measures[k]; u = Math.max(u, maxStamp(measures[k])); }
    out.push({ key: 'measures', value: { measures: value }, updatedAt: u });
  }
  const tomb = state.tombstones || {};
  const tIds = Object.keys(tomb);
  if (tIds.length) out.push({ key: 'tombstones', value: { tombstones: tomb }, updatedAt: Math.max(0, ...tIds.map(id => Number(tomb[id]) || 0)) });
  for (const day of Object.keys(state.days || {}).sort()) {
    const entries = state.days[day];
    if (Array.isArray(entries) && entries.length) out.push({ key: 'day:' + day, value: { entries }, updatedAt: maxStamp(entries) });
  }
  for (const [id, r] of Object.entries(state.recipes || {}).sort(([a], [b]) => (a < b ? -1 : 1))) out.push({ key: 'recipe:' + id, value: { recipe: r }, updatedAt: stamp(r) });
  for (const [date, d] of Object.entries(state.plan || {}).sort(([a], [b]) => (a < b ? -1 : 1))) out.push({ key: 'plan:' + date, value: { plan: d }, updatedAt: stamp(d) });
  if (plain(state.activity)) {
    for (const [day, r] of Object.entries(state.activity).sort(([a], [b]) => (a < b ? -1 : 1))) if (plain(r) && ACTIVITY_KEY.test('activity:' + day)) out.push({ key: 'activity:' + day, value: { activity: r }, updatedAt: stamp(r) });
  }
  const sh = state.shopping || {};
  if (Object.keys(sh.checks || {}).length || Object.keys(sh.extras || {}).length) {
    out.push({ key: 'shopping', value: { shopping: sh }, updatedAt: Math.max(maxStamp(Object.values(sh.checks || {})), maxStamp(Object.values(sh.extras || {}))) });
  }
  return out;
}

const clone = v => JSON.parse(JSON.stringify(v));
/** Replace a food's / entry's `nut` by its sanitised form, or drop it (a copy arriving from another device is untrusted). */
const withCleanNut = o => {
  if ('nut' in o) { const n = sanitizeNut(o.nut); if (n) o.nut = n; else delete o.nut; }
  if ('barcode' in o) { const b = sanitizeBarcode(o.barcode); if (b) o.barcode = b; else delete o.barcode; }
  if ('foodId' in o && !isFoodId(o.foodId)) delete o.foodId;
  return o;
};

/** Turn one (untrusted) record into a partial state mergeStates understands, or null. */
function toPartial(rec) {
  if (!plain(rec) || !isSyncKey(rec.key) || !plain(rec.value)) return null;
  const v = clone(rec.value);
  const { key } = rec;
  if (key === 'settings') {
    const s = sanitize({ goals: v.goals, weightUnit: v.weightUnit, useUSDA: v.useUSDA, useOFF: v.useOFF, settingsUpdatedAt: v.settingsUpdatedAt });
    const on = v.syncApiKey === true;                       // only a literal true opts in; the key is cleaned and never trusted otherwise
    return { goals: s.goals, weightUnit: s.weightUnit, useUSDA: s.useUSDA, useOFF: s.useOFF, settingsUpdatedAt: s.settingsUpdatedAt,
      syncApiKey: on, ...(on && typeof v.apiKey === 'string' ? { apiKey: cleanApiKey(v.apiKey) } : {}) };
  }
  if (key === 'custom') {
    if (!Array.isArray(v.custom)) return null;
    return { custom: withFoodIds(v.custom.filter(f => plain(f) && typeof f.name === 'string' && f.name && plain(f.per100)).map(withCleanNut)) };   // a hostile or missing id becomes the derived one
  }
  if (key === 'measures') {
    if (!plain(v.measures)) return null;
    const measures = {};
    for (const [k, list] of Object.entries(v.measures)) {
      if (isSafeKey(k) && Array.isArray(list)) measures[k] = list.filter(m => plain(m) && typeof m.label === 'string' && m.label && m.g > 0 && isFinite(m.g));
    }
    return { measures };
  }
  if (key === 'tombstones') {
    if (!plain(v.tombstones)) return null;
    const tombstones = {};
    for (const [id, t] of Object.entries(v.tombstones)) {
      if (typeof t === 'number' && Number.isFinite(t) && t >= 0) tombstones[id] = t;
    }
    return { tombstones };
  }
  if (key === 'shopping') return plain(v.shopping) ? { shopping: sanitizeShopping(v.shopping) } : null;
  if (RECIPE_KEY.test(key)) { const r = sanitizeRecipe(v.recipe, key.slice(7)); return r ? { recipes: { [r.id]: r } } : null; }
  if (PLAN_KEY.test(key)) { const d = sanitizePlanDay(v.plan); return d ? { plan: { [key.slice(5)]: d } } : null; }
  if (ACTIVITY_KEY.test(key)) {
    const day = key.slice(9), a = isDateKey(day) && sanitizeActivityDay(v.activity);
    return a ? { activity: { [day]: a } } : null;
  }
  if (!Array.isArray(v.entries)) return null;
  return { days: { [key.slice(4)]: v.entries.filter(e => plain(e) && validEntry(e)).map(withCleanNut) } };
}

/** NEW state = `state` with the remote records merged in (symmetric LWW; never throws on junk). */
export function applyRecords(state, records) {
  let cur = state;
  for (const rec of Array.isArray(records) ? records : []) {
    try {
      const partial = toPartial(rec);
      if (partial) cur = mergeStates(cur, partial);
    } catch { /* untrusted record: skip it */ }
  }
  return cur === state ? { ...state } : cur;
}

/** JSON with object keys sorted, so equal data always serialises identically. */
export function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(x => (x === undefined ? 'null' : stableStringify(x))).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined && typeof v[k] !== 'function').map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

/** cyrb53: fast, non-cryptographic 53-bit string hash. */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Short string identifying a record's VALUE (key order independent). */
export const recordHash = record => cyrb53(stableStringify(record && record.value)).toString(36);
