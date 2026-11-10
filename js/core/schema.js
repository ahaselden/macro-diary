// The saved-data schema: defaults, migrations and input sanitising. PURE (no browser APIs) so that
// domain/ code can use it and tests can run it in Node. core/store.js adds persistence on top.
//
// Versions:  1 = original app (no schemaVersion field)
//            2 = added schemaVersion
//            3 = sync-ready: tombstones (deleted entry ids) + settingsUpdatedAt; entries gain `updatedAt` when edited
//                (missing updatedAt means 0 = "older than any real edit", so old data needs no rewrite)
export const SCHEMA_VERSION = 3;

export const defaults = () => ({
  schemaVersion: SCHEMA_VERSION, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 },
  apiKey: '', useUSDA: true, useOFF: true, days: {}, recent: [], custom: [],
  tombstones: {}, settingsUpdatedAt: 0,
});

const goalNum = (v, fallback) => (v !== null && v !== '' && v !== true && v !== false && Number.isFinite(+v) && +v >= 0 ? +v : fallback);
const plainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Make loaded/restored data safe to use: right types, finite non-negative goals, known units.
 * Untrusted input (a restored backup file) reaches HTML through these fields, so they are forced to
 * plain numbers/known strings here rather than trusted. Never drops diary data.
 */
export function sanitize(d) {
  const def = defaults(), g = plainObject(d.goals) ? d.goals : {};
  d.goals = { k: goalNum(g.k, def.goals.k), p: goalNum(g.p, def.goals.p), c: goalNum(g.c, def.goals.c), f: goalNum(g.f, def.goals.f) };
  if (d.weightUnit !== 'g' && d.weightUnit !== 'oz') d.weightUnit = 'g';
  if (typeof d.theme !== 'string') d.theme = 'auto';
  if (typeof d.apiKey !== 'string') d.apiKey = '';
  d.useUSDA = d.useUSDA !== false;
  d.useOFF = d.useOFF !== false;
  if (!plainObject(d.days)) d.days = {};
  if (!plainObject(d.measures)) d.measures = {};
  if (!Array.isArray(d.recent)) d.recent = [];
  if (!Array.isArray(d.custom)) d.custom = [];
  const tomb = {};
  if (plainObject(d.tombstones)) for (const [id, t] of Object.entries(d.tombstones)) if (Number.isFinite(+t) && +t >= 0) tomb[id] = +t;
  d.tombstones = tomb;
  d.settingsUpdatedAt = Number.isFinite(+d.settingsUpdatedAt) && +d.settingsUpdatedAt >= 0 ? +d.settingsUpdatedAt : 0;
  return d;
}

/** Bring older saved data up to the current shape. Never drops user data. Mutates and returns `d`. */
export function migrate(d) {
  const v = Number.isFinite(d.schemaVersion) ? d.schemaVersion : 1;
  if (v < 2) d.schemaVersion = 2;        // v1 -> v2: no structural change, just versioning
  if (v < 3) d.schemaVersion = 3;        // v2 -> v3: tombstones + settingsUpdatedAt (added by sanitize with empty defaults)
  // future: if (v < 4) { ...; d.schemaVersion = 4; }
  return sanitize(d);
}
