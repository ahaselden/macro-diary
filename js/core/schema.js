// The saved-data schema: defaults, migrations and input sanitising. PURE (no browser APIs) so that
// domain/ code can use it and tests can run it in Node. core/store.js adds persistence on top.
//
// Versions:  1 = original app (no schemaVersion field)
//            2 = added schemaVersion
//            3 = sync-ready: tombstones (deleted entry ids) + settingsUpdatedAt; entries gain `updatedAt` when edited
//                (missing updatedAt means 0 = "older than any real edit", so old data needs no rewrite)
//            4 = meal planner data: recipes {id: recipe}, plan {date: {updatedAt, slots}}, shopping {checks, extras}
//            5 = recipes gain `favorite` (boolean; missing = false)
//            6 = recipes gain `stated` (null, or the page's per-serving { k, p, c, f, per }; missing = null)
//            7 = syncApiKey (the opt-in to carry the USDA key in the sync account)
//            8 = foods and diary entries may carry `nut` (optional extra nutrients per 100 g; absent = not recorded)
//            9 = saved foods (`custom`) carry a stable `id`; copies of a saved food (entries, recents, recipe and plan foods) may carry `foodId`;
//                saved measures of a saved food are keyed by that id instead of its name|brand|source (D53)
import { MEALS } from './constants.js';

export const SCHEMA_VERSION = 9;

export const defaults = () => ({
  schemaVersion: SCHEMA_VERSION, theme: 'auto', weightUnit: 'g', measures: {}, goals: { k: 2000, p: 150, c: 200, f: 65 },
  apiKey: '', syncApiKey: false, useUSDA: true, useOFF: true, days: {}, recent: [], custom: [],
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

// ---- ids of saved foods (D53) ---------------------------------------------------------------------------------------------------------------
// Generated ids ('f' + time + random, no '-') are made by domain/food.js; derived ids ('f-' + 16 hex) are made here from the food's identity so that two
// devices that never saw each other's data give the same legacy food the same id.
const FOOD_ID = /^f(?:-[0-9a-f]{16}|[0-9a-z]{6,24})$/;
/** Is `v` a saved-food id: a string of the generated or the derived shape. Never throws. */
export const isFoodId = v => typeof v === 'string' && FOOD_ID.test(v);
/** Object keys that must never be used as a bucket name in a map built from untrusted data. */
export const isSafeKey = k => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
const foodKeyOf = f => [f.name, f.brand, f.source].join('|');   // the same text as domain/foodKey (core may not import domain; a test checks they agree)

/**
 * The id a saved food WITHOUT one gets: 'f-' + the 64-bit FNV-1a hash (16 lowercase hex digits) of the UTF-8 bytes of `name|brand|source|barcode`,
 * where the barcode (only when it is 8 to 14 digits) has its leading zeros removed. Only those four fields count, so every device derives the same id.
 * null for anything that is not a plain object. Pure; never throws.
 */
export function legacyFoodId(food) {
  if (!plainObject(food)) return null;
  const text = k => { try { const v = food[k]; return typeof v === 'string' ? v : ''; } catch { return ''; } };
  let code = ''; try { code = (sanitizeBarcode(food.barcode) || '').replace(/^0+/, ''); } catch { code = ''; }
  const bytes = new TextEncoder().encode([text('name'), text('brand'), text('source')].join('|') + '|' + code);
  // 64-bit FNV-1a as two 32-bit halves (offset basis 0xcbf29ce484222325, prime 2^40 + 0x1b3): no BigInt, fast for long names
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (const byte of bytes) {
    lo = (lo ^ byte) >>> 0;
    const m = lo * 0x1b3;
    hi = (hi * 0x1b3 + Math.floor(m / 4294967296) + lo * 256) % 4294967296;
    lo = m % 4294967296;
  }
  return 'f-' + hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

const stampOf = x => (x && Number.isFinite(x.updatedAt) ? x.updatedAt : 0);
const canonOf = x => { try { return JSON.stringify(x); } catch { return ''; } };
const newerOf = (a, b) => { const sa = stampOf(a), sb = stampOf(b); return sa !== sb ? (sa > sb ? a : b) : (canonOf(a) >= canonOf(b) ? a : b); };

/**
 * A NEW list of saved foods in which every food has a valid, unique `id`: a valid id is kept, anything else (missing, hostile, wrong type) becomes
 * legacyFoodId(food). Foods that end up with the same id are collapsed to the newest (`updatedAt`, tie: the larger JSON), at the place of the first.
 * Foods that already have a valid id are reused as they are, the others are copied, so frozen input is fine. Entries that are not objects are dropped.
 */
export function withFoodIds(list) {
  const out = [], at = new Map();
  for (const f of Array.isArray(list) ? list : []) {
    if (!plainObject(f)) continue;
    const id = isFoodId(f.id) ? f.id : legacyFoodId(f), g = f.id === id ? f : { ...f, id }, i = at.get(id);
    if (i === undefined) { at.set(id, out.length); out.push(g); } else out[i] = newerOf(out[i], g);
  }
  return out;
}

/**
 * Union of two lists of saved measures [{label, g, updatedAt}] by label: the newer `updatedAt` wins (missing = 0). A tie goes to `a` when `preferA`,
 * else to the larger JSON, so the result does not depend on the argument order. Junk items (no label, no positive grams) are dropped.
 * Order: the labels of `a`, then the new labels of `b`. Pure.
 */
export function unionMeasures(a, b, preferA = false) {
  const byLabel = new Map();
  for (const m of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!m || typeof m.label !== 'string' || !m.label || !(m.g > 0)) continue;
    const cur = byLabel.get(m.label);
    byLabel.set(m.label, !cur ? m : stampOf(cur) !== stampOf(m) ? (stampOf(cur) > stampOf(m) ? cur : m) : preferA || canonOf(cur) >= canonOf(m) ? cur : m);
  }
  return [...byLabel.values()];
}

/** Optional extra nutrients per 100 g (sodium and cholesterol in mg, the rest in g) and their allowed ranges. Absent = "not recorded", never 0. */
export const NUT_KEYS = ['fiber', 'sugars', 'satFat', 'sodium', 'cholesterol'];
const NUT_MAX = { fiber: 100, sugars: 100, satFat: 100, sodium: 40000, cholesterol: 5000 };
/** A fresh object holding only the known keys whose value is a finite in-range number; undefined when nothing valid is left. */
export function sanitizeNut(v) {
  if (!plainObject(v)) return undefined;
  const out = {};
  for (const k of NUT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    const x = v[k];
    if (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= NUT_MAX[k]) out[k] = x;
  }
  return Object.keys(out).length ? out : undefined;
}
/** A barcode kept on a food or entry: a string of 8 to 14 digits (no trimming), else undefined. */
export const sanitizeBarcode = v => (typeof v === 'string' && /^\d{8,14}$/.test(v) ? v : undefined);
const cleanNut = o => {
  if (!plainObject(o)) return;
  if ('nut' in o) { const n = sanitizeNut(o.nut); if (n) o.nut = n; else delete o.nut; }
  if ('barcode' in o) { const b = sanitizeBarcode(o.barcode); if (b) o.barcode = b; else delete o.barcode; }
  if ('foodId' in o && !isFoodId(o.foodId)) delete o.foodId;
};

/**
 * A recipe's stated nutrition: per SERVING calories and grams of protein/carbs/fat as the source (a web page, or the user) says, plus the
 * page's serving-size text. Exactly the five keys, numbers finite and in range, otherwise null. Returns a fresh object.
 */
const STATED_KEYS = ['k', 'p', 'c', 'f', 'per'];
export function sanitizeStated(s) {
  if (!plainObject(s)) return null;
  const keys = Object.keys(s);
  if (keys.length !== STATED_KEYS.length || !keys.every(k => STATED_KEYS.includes(k))) return null;
  const inRange = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  if (!inRange(s.k, 20000) || !inRange(s.p, 5000) || !inRange(s.c, 5000) || !inRange(s.f, 5000) || typeof s.per !== 'string') return null;
  return { k: s.k, p: s.p, c: s.c, f: s.f, per: s.per.slice(0, 40) };
}

/** A food as stored inside recipes/plans (same shape the diary uses). Returns null if unusable. */
export function sanitizeFood(f) {
  if (!plainObject(f) || typeof f.name !== 'string' || !f.name || !plainObject(f.per100)) return null;
  const p = f.per100;
  const out = { name: str(f.name, 200), brand: str(f.brand, 200), source: str(f.source, 40),
    per100: { k: numOr(p.k, 0), p: numOr(p.p, 0), c: numOr(p.c, 0), f: numOr(p.f, 0) },
    servingG: numOr(f.servingG, 0), servingLabel: str(f.servingLabel, 100) };
  const nut = sanitizeNut(f.nut); if (nut) out.nut = nut;
  if (typeof f.fdcId === 'number' || typeof f.fdcId === 'string') out.fdcId = f.fdcId;
  const foodId = isFoodId(f.foodId) ? f.foodId : isFoodId(f.id) ? f.id : '';   // a saved food linked directly carries its own id; copies carry foodId
  if (foodId) out.foodId = foodId;
  if (typeof f.barcode === 'string' && /^\d{8,14}$/.test(f.barcode)) out.barcode = f.barcode;   // set on custom foods so a scan finds them
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
    favorite: r.favorite === true, stated: sanitizeStated(r.stated), updatedAt: ts(r.updatedAt) };
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
  d.syncApiKey = d.syncApiKey === true;                    // the owner's opt-in to carry the USDA key in the sync account (D42)
  d.useUSDA = d.useUSDA !== false;
  d.useOFF = d.useOFF !== false;
  if (!plainObject(d.days)) d.days = {};
  if (!plainObject(d.measures)) d.measures = {};
  // foods the UI reads field-by-field: drop anything without a name and nutrition so a bad backup can't crash the screens
  const usableFood = f => plainObject(f) && typeof f.name === 'string' && plainObject(f.per100);
  d.recent = Array.isArray(d.recent) ? d.recent.filter(usableFood) : [];
  d.custom = Array.isArray(d.custom) ? d.custom.filter(usableFood) : [];
  for (const f of [...d.recent, ...d.custom]) cleanNut(f);
  d.custom = withFoodIds(d.custom);                       // every saved food has a valid unique id (D53)
  for (const list of Object.values(d.days)) if (Array.isArray(list)) for (const e of list) cleanNut(e);
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
  if (v < 5) d.schemaVersion = 5;        // v4 -> v5: recipe.favorite (added by sanitize, false)
  if (v < 6) d.schemaVersion = 6;        // v5 -> v6: recipe.stated (added by sanitize, null)
  if (v < 7) d.schemaVersion = 7;        // v6 -> v7: syncApiKey (added by sanitize, false)
  if (v < 8) d.schemaVersion = 8;        // v7 -> v8: optional `nut` on foods and entries (nothing added)
  if (v < 9) {                                // v8 -> v9: ids for saved foods, their measures under the id, foodId on copies (D53)
    sanitize(d);                              // gives every saved food its id first
    moveMeasuresToIds(d);
    stampCopies(d);
    d.schemaVersion = 9;
  }
  return sanitize(d);
}

/** v9 step 2: a saved food's measures move from measures[name|brand|source] to measures[id] (lists merged, the id bucket wins ties). Other buckets stay. */
function moveMeasuresToIds(d) {
  const src = d.measures, out = {}, saved = new Set(d.custom.map(foodKeyOf));
  for (const [k, list] of Object.entries(src)) if (isSafeKey(k) && !saved.has(k)) out[k] = list;
  for (const f of d.custom) {
    const k = foodKeyOf(f);
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    const list = unionMeasures(Array.isArray(out[f.id]) ? out[f.id] : Array.isArray(src[f.id]) ? src[f.id] : [], src[k], true);
    if (list.length) out[f.id] = list;
  }
  d.measures = out;
}

/** v9 step 3: copies of a saved food get its id as `foodId` when exactly one saved food matches (see spec D-D). Nothing else on the copy changes. */
function stampCopies(d) {
  const byKey = new Map();
  for (const f of d.custom) { const k = foodKeyOf(f); byKey.set(k, [...(byKey.get(k) || []), f]); }
  const same = (a, b) => { const x = String(a || '').replace(/^0+/, ''), y = String(b || '').replace(/^0+/, ''); return x.length >= 6 && x === y; };
  const stamp = c => {
    if (!plainObject(c) || isFoodId(c.foodId)) return;
    const cands = byKey.get(foodKeyOf(c)); if (!cands) return;
    const bar = sanitizeBarcode(c.barcode), hit = bar ? cands.filter(f => same(f.barcode, bar)) : cands;
    if (hit.length === 1) c.foodId = hit[0].id;
  };
  d.recent.forEach(stamp);
  for (const list of Object.values(d.days)) if (Array.isArray(list)) list.forEach(stamp);
  for (const r of Object.values(d.recipes)) for (const i of r.ingredients) stamp(i.food);
  for (const day of Object.values(d.plan)) for (const items of Object.values(day.slots)) for (const it of items) stamp(it.food);
}

/** A USDA key that arrived from another device: a plain string without control characters, trimmed, at most 200 characters, else ''. */
export function cleanApiKey(v) {
  if (typeof v !== 'string') return '';
  return v.slice(0, 1000).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 200);
}

/** An empty, whitespace-only, non-string or DEMO_KEY (any case) USDA key: nothing worth keeping over a real one. */
export function isPlaceholderKey(v) {
  if (typeof v !== 'string') return true;
  const t = v.trim();
  return t === '' || t.toLowerCase() === 'demo_key';
}

/** A USDA key that looks real: 20 to 200 letters, digits, '-' or '_' after trimming. A heuristic, not validation. */
export function isLegitKey(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{20,200}$/.test(v.trim());
}

