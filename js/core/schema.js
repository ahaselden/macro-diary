// The saved-data schema: defaults, migrations and input sanitising. PURE (no browser APIs) so that
// domain/ code can use it and tests can run it in Node. core/store.js adds persistence on top.
//
// Versions:  1 = original app (no schemaVersion field)
//            2 = added schemaVersion
//            3 = sync-ready: tombstones (deleted entry ids) + settingsUpdatedAt; entries gain `updatedAt` when edited
//                (missing updatedAt means 0 = "older than any real edit", so old data needs no rewrite)
//            4 = meal planner data: recipes {id: recipe}, plan {date: {updatedAt, slots}}, shopping {checks, extras}
import { MEALS } from './constants.js';

export const SCHEMA_VERSION = 4;

export const defaults = () => ({
  schemaVersion: SCHEMA_VERSION, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 },
  apiKey: '', useUSDA: true, useOFF: true, days: {}, recent: [], custom: [],
  tombstones: {}, settingsUpdatedAt: 0,
  recipes: {}, plan: {}, shopping: { checks: {}, extras: {} },
});

const goalNum = (v, fallback) => (v !== null && v !== '' && v !== true && v !== false && Number.isFinite(+v) && +v >= 0 ? +v : fallback);
const plainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
// quantities are bounded (1e7) so a crafted value can't produce Infinity/NaN downstream; timestamps use `ts`
const numOr = (v, fallback, min = 0, max = 1e7) => (v !== null && v !== '' && v !== true && v !== false && Number.isFinite(+v) && +v >= min && +v <= max ? +v : fallback);
const ts = v => numOr(v, 0, 0, 8.64e15);
// a unit is a short word like 'cup' or 'fl oz': keep letters, spaces and dots only (it is later used in a pattern match)
const unitText = v => str(v, 40).toLowerCase().replace(/[^a-z .]/g, '').trim();
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A food as stored inside recipes/plans (same shape the diary uses). Returns null if unusable. */
export function sanitizeFood(f) {
  if (!plainObject(f) || typeof f.name !== 'string' || !f.name || !plainObject(f.per100)) return null;
  const p = f.per100;
  const out = { name: str(f.name, 200), brand: str(f.brand, 200), source: str(f.source, 40),
    per100: { k: numOr(p.k, 0), p: numOr(p.p, 0), c: numOr(p.c, 0), f: numOr(p.f, 0) },
    servingG: numOr(f.servingG, 0), servingLabel: str(f.servingLabel, 100) };
  if (typeof f.fdcId === 'number' || typeof f.fdcId === 'string') out.fdcId = f.fdcId;
  if (Array.isArray(f.portions)) out.portions = f.portions.filter(x => plainObject(x) && typeof x.label === 'string' && numOr(x.g, 0) > 0).slice(0, 30).map(x => ({ label: str(x.label, 100), g: +x.g }));
  return out;
}

function sanitizeIngredient(i, recipeId, idx) {
  if (!plainObject(i)) return null;
  return { id: str(i.id, 80) || `${recipeId}-i${idx}`, raw: str(i.raw, 300), name: str(i.name, 200), qty: numOr(i.qty, null), unit: unitText(i.unit),
    prep: str(i.prep, 200), food: sanitizeFood(i.food), grams: numOr(i.grams, null) };
}

/** A recipe from untrusted input (backup/sync). Returns null if it has no id or name. */
export function sanitizeRecipe(r, id) {
  if (!plainObject(r) || typeof id !== 'string' || !id || typeof r.name !== 'string' || !r.name.trim()) return null;
  const list = (v, max, n) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, n).map(x => x.slice(0, max)) : []);
  return { id, name: str(r.name, 200), description: str(r.description, 2000), source: str(r.source, 500),
    servings: numOr(r.servings, 4, 0.01), totalTime: numOr(r.totalTime, null), tags: list(r.tags, 40, 20), steps: list(r.steps, 2000, 100),
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).slice(0, 200).map((i, n) => sanitizeIngredient(i, id, n)).filter(Boolean),
    updatedAt: ts(r.updatedAt) };
}

/** One planned day: { updatedAt, slots: { Breakfast: [item], Lunch: [], Dinner: [], Snacks: [] } }. */
export function sanitizePlanDay(d) {
  if (!plainObject(d)) return null;
  const slots = {};
  for (const m of MEALS) {
    const src = plainObject(d.slots) && Array.isArray(d.slots[m]) ? d.slots[m] : [];
    slots[m] = src.slice(0, 50).map((it, n) => {
      if (!plainObject(it)) return null;
      const type = it.type === 'food' ? 'food' : 'recipe';
      return { id: str(it.id, 80) || `${m}-${n}`, type, recipeId: type === 'recipe' ? str(it.recipeId, 80) : '', name: str(it.name, 200),
        servings: numOr(it.servings, 1, 0.01), food: type === 'food' ? sanitizeFood(it.food) : null, grams: numOr(it.grams, null),
        entryId: str(it.entryId, 80) };   // diary entry this item was logged as ('' = not logged yet)
    }).filter(it => it && (it.type === 'recipe' ? it.recipeId : it.food));
  }
  return { updatedAt: ts(d.updatedAt), slots };
}

/** Shopping-list state the user controls: ticked items and hand-added extras. */
export function sanitizeShopping(s) {
  const out = { checks: {}, extras: {} };
  if (!plainObject(s)) return out;
  if (plainObject(s.checks)) for (const [k, v] of Object.entries(s.checks)) if (plainObject(v)) out.checks[str(k, 200)] = { on: v.on === true, updatedAt: ts(v.updatedAt) };
  if (plainObject(s.extras)) for (const [id, v] of Object.entries(s.extras)) {
    if (plainObject(v) && typeof v.text === 'string' && v.text.trim()) out.extras[id] = { id, text: str(v.text, 200), on: v.on === true, updatedAt: ts(v.updatedAt) };
  }
  return out;
}

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
  // foods the UI reads field-by-field: drop anything without a name and nutrition so a bad backup can't crash the screens
  const usableFood = f => plainObject(f) && typeof f.name === 'string' && plainObject(f.per100);
  d.recent = Array.isArray(d.recent) ? d.recent.filter(usableFood) : [];
  d.custom = Array.isArray(d.custom) ? d.custom.filter(usableFood) : [];
  const tomb = {};
  if (plainObject(d.tombstones)) for (const [id, t] of Object.entries(d.tombstones)) if (Number.isFinite(+t) && +t >= 0) tomb[id] = +t;
  d.tombstones = tomb;
  d.settingsUpdatedAt = Number.isFinite(+d.settingsUpdatedAt) && +d.settingsUpdatedAt >= 0 ? +d.settingsUpdatedAt : 0;
  const recipes = {};
  if (plainObject(d.recipes)) for (const [id, r] of Object.entries(d.recipes)) { const s = sanitizeRecipe(r, id); if (s) recipes[id] = s; }
  d.recipes = recipes;
  const plan = {};
  if (plainObject(d.plan)) for (const [date, day] of Object.entries(d.plan)) { const s = DATE_KEY.test(date) && sanitizePlanDay(day); if (s) plan[date] = s; }
  d.plan = plan;
  d.shopping = sanitizeShopping(d.shopping);
  return d;
}

/** Bring older saved data up to the current shape. Never drops user data. Mutates and returns `d`. */
export function migrate(d) {
  const v = Number.isFinite(d.schemaVersion) ? d.schemaVersion : 1;
  if (v < 2) d.schemaVersion = 2;        // v1 -> v2: no structural change, just versioning
  if (v < 3) d.schemaVersion = 3;        // v2 -> v3: tombstones + settingsUpdatedAt (added by sanitize with empty defaults)
  if (v < 4) d.schemaVersion = 4;        // v3 -> v4: recipes / plan / shopping (added by sanitize, empty)
  // future: if (v < 5) { ...; d.schemaVersion = 5; }
  return sanitize(d);
}
