// Conversion between the whole app state and the per-key RECORDS that device sync moves around. Pure.
//
// A record is { key, value, updatedAt }. Keys:
//   settings            value { goals, weightUnit, useUSDA, useOFF, settingsUpdatedAt }
//   custom              value { custom: [foods] }
//   measures            value { measures: { foodKey: [{label,g,updatedAt}] } }
//   tombstones          value { tombstones: { id: deletedAtMs } }
//   day:YYYY-MM-DD      value { entries: [entry, ...] }
// Remote data is untrusted: applyRecords ignores anything malformed and never throws.
// theme / apiKey / recent never become records (docs/DECISIONS.md D10).
import { mergeStates } from './merge.js';
import { validEntry } from './entries.js';
import { sanitize } from '../core/schema.js';

const DAY_KEY = /^day:(\d{4}-\d{2}-\d{2})$/;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const stamp = x => (x && Number.isFinite(x.updatedAt) ? x.updatedAt : 0);
const maxStamp = list => list.reduce((m, x) => Math.max(m, stamp(x)), 0);

/** Is `key` one of the keys sync understands? */
export const isSyncKey = key => typeof key === 'string' && (key === 'settings' || key === 'custom' || key === 'measures' || key === 'tombstones' || DAY_KEY.test(key));

/** The records for the whole state. Settings always; the rest only when non-empty; empty days skipped. */
export function toRecords(state) {
  const out = [];
  const g = state.goals || {};
  const su = Number(state.settingsUpdatedAt) || 0;
  out.push({
    key: 'settings',
    value: { goals: { ...g }, weightUnit: state.weightUnit, useUSDA: state.useUSDA, useOFF: state.useOFF, settingsUpdatedAt: su },
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
  return out;
}

const clone = v => JSON.parse(JSON.stringify(v));

/** Turn one (untrusted) record into a partial state mergeStates understands, or null. */
function toPartial(rec) {
  if (!plain(rec) || !isSyncKey(rec.key) || !plain(rec.value)) return null;
  const v = clone(rec.value);
  const { key } = rec;
  if (key === 'settings') {
    const s = sanitize({ goals: v.goals, weightUnit: v.weightUnit, useUSDA: v.useUSDA, useOFF: v.useOFF, settingsUpdatedAt: v.settingsUpdatedAt });
    return { goals: s.goals, weightUnit: s.weightUnit, useUSDA: s.useUSDA, useOFF: s.useOFF, settingsUpdatedAt: s.settingsUpdatedAt };
  }
  if (key === 'custom') {
    if (!Array.isArray(v.custom)) return null;
    return { custom: v.custom.filter(f => plain(f) && typeof f.name === 'string' && f.name && plain(f.per100)) };
  }
  if (key === 'measures') {
    if (!plain(v.measures)) return null;
    const measures = {};
    for (const [k, list] of Object.entries(v.measures)) {
      if (Array.isArray(list)) measures[k] = list.filter(m => plain(m) && typeof m.label === 'string' && m.label && m.g > 0 && isFinite(m.g));
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
  if (!Array.isArray(v.entries)) return null;
  return { days: { [key.slice(4)]: v.entries.filter(e => plain(e) && validEntry(e)) } };
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
