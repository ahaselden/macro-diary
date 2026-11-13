// Identity of a food across sources/recents/custom foods/saved measures. Pure.
import { isFoodId, legacyFoodId } from '../core/schema.js';

export const foodKey = f => [f.name, f.brand, f.source].join('|');

/**
 * A new id for a saved food: 'f' + the time in base 36 (at least 2 characters) + 4 random base-36 characters, e.g. 'floyw3v28i000'. No '-', so it can never
 * look like a derived id. `now` and `rnd` are arguments (the UI passes Date.now() and Math.random) so this stays pure. Never throws; always isFoodId.
 */
export function makeFoodId(now, rnd) {
  const t = typeof now === 'number' && Number.isFinite(now) ? Math.min(Math.max(Math.floor(now), 0), 8.64e15) : 0;
  let r = 0;
  try { const x = typeof rnd === 'function' ? rnd() : 0; r = typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 1 ? x : 0; } catch { r = 0; }
  return 'f' + t.toString(36).padStart(2, '0') + Math.floor(r * 36 ** 4).toString(36).padStart(4, '0');
}

/** The saved-food id a food or a copy of it carries: a valid `foodId`, else a valid `id`, else ''. Anything that fails isFoodId is ignored. */
export const foodIdOf = f => (f && typeof f === 'object' ? (isFoodId(f.foodId) ? f.foodId : isFoodId(f.id) ? f.id : '') : '');

/** Where this food's saved measures live in state.measures: its saved-food id when it has one, else foodKey (database foods, old copies). Pure. */
export const measuresKey = f => foodIdOf(f) || foodKey(f);

/** A scanned/typed product code: 8-14 digits (EAN-8, UPC-A/E, EAN-13, GTIN-14). */
export const isBarcode = q => /^\d{8,14}$/.test(String(q || '').trim());

/**
 * Two codes name the same product when they differ only by leading zeros
 * (a UPC-A is an EAN-13 with a leading 0, and cameras report either form). Pure.
 */
export const sameBarcode = (a, b) => {
  const x = String(a || '').replace(/^0+/, ''), y = String(b || '').replace(/^0+/, '');
  return x.length >= 6 && x === y;
};

/**
 * Does saving custom food `neu` replace the saved custom food `old`? Same name/brand/source is not enough once barcodes exist:
 * two different products (different barcodes) may share a name, and a food typed without a barcode must not erase one that has it. Pure.
 */
export const replacesCustom = (old, neu) => {
  if (foodKey(old) === foodKey(neu) || (neu.barcode && sameBarcode(old.barcode, neu.barcode))) {
    if (neu.barcode && old.barcode) return sameBarcode(old.barcode, neu.barcode);   // both coded: only the same product
    return !old.barcode;                                                            // old has a code and neu has none -> keep old
  }
  return false;
};

/** "148 kcal per 1 scoop (37 g)": the calories in the food's serving, or '' when it has no usable serving. Plain text (the UI escapes it). */
export function servingSummary(food) {
  try {
    if (!food || typeof food !== 'object' || Array.isArray(food)) return '';
    const g = food.servingG, k = food.per100 && typeof food.per100 === 'object' ? Number(food.per100.k) : NaN;
    if (typeof g !== 'number' || !Number.isFinite(g) || !(g > 0) || !Number.isFinite(k)) return '';
    const raw = typeof food.servingLabel === 'string' ? food.servingLabel.slice(0, 300).replace(/<\/?[a-zA-Z!][^<>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    return `${Math.round(k * g / 100)} kcal per ${raw || Math.round(g) + ' g'}`;
  } catch { return ''; }
}

/** A food or entry name made safe to store: trimmed, whitespace collapsed, capped (default 100), '' for anything that is not a usable string. Plain text (the UI escapes it). */
export function cleanFoodName(raw, max = 100) {
  try {
    if (typeof raw !== 'string') return '';
    return raw.slice(0, 4 * max + 200).replace(/\s+/g, ' ').trim().slice(0, max).trimEnd();
  } catch { return ''; }
}

const isOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const num = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Save a NEW custom food (D53). It REPLACES every saved food `f` with replacesCustom(f, food): it inherits the id of the first replaced food (so that food's
 * measures and its copies on other devices follow), the ids of any further replaced foods get a tombstone at `now`, and the food goes first with
 * updatedAt = now. With nothing replaced it gets `makeId()`. The list is then cut to 100 (the oldest drop; that is NOT a deletion, no tombstone).
 * Mutates `state` (custom, tombstones) and returns the saved food; the input `food` is not changed. Returns null with `state` untouched for an unusable
 * state or food (no name, no per100), a non-finite `now`, a `makeId` that is not a function or gives an invalid or already used id.
 */
export function addCustomFood(state, food, now, makeId) {
  try {
    if (!state || typeof state !== 'object' || !Array.isArray(state.custom) || typeof makeId !== 'function' || !num(now)) return null;
    if (!food || typeof food !== 'object' || Array.isArray(food) || typeof food.name !== 'string' || !food.name || !food.per100 || typeof food.per100 !== 'object') return null;
    const live = state.custom.filter(f => f && typeof f === 'object');
    const replaced = live.filter(f => replacesCustom(f, food));
    const idOf = f => (isFoodId(f.id) ? f.id : legacyFoodId(f));
    const id = replaced.length ? idOf(replaced[0]) : makeId();
    if (!isFoodId(id) || (!replaced.length && live.some(f => f.id === id))) return null;
    const saved = { ...food, id, updatedAt: now };
    delete saved.foodId;
    const tomb = state.tombstones && typeof state.tombstones === 'object' && !Array.isArray(state.tombstones) ? state.tombstones : {};
    for (const f of replaced.slice(1)) if (idOf(f) !== id) tomb[idOf(f)] = now;      // the extra replaced foods are deleted on every device
    delete tomb[id];                                                                  // adding an id again undoes an earlier deletion of it
    state.tombstones = tomb;
    state.custom = [saved, ...state.custom.filter(f => !replaced.includes(f))].slice(0, 100);
    return saved;
  } catch { return null; }
}

/**
 * Edit a saved custom food in place (state.custom). `id` is the food's `id` (D53); `patch` may hold name, brand, servingG, barcode ('' removes it)
 * and k, p, c, f (per SERVING, stored per 100 g). Stamps updatedAt = now; the id never changes and saved measures never move (they live under the id).
 * Returns the food, or null with `state` untouched for: anything that is not the id of a saved food, empty name, bad numbers or barcode, a collision
 * with a DIFFERENT saved food, unusable input.
 */
export function updateCustomFood(state, id, patch, now) {
  try {
    if (!state || typeof state !== 'object' || !Array.isArray(state.custom) || !isFoodId(id) || !num(now)) return null;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
    const hits = state.custom.reduce((a, f, j) => (f && typeof f === 'object' && f.id === id ? [...a, j] : a), []);
    if (hits.length !== 1) return null;                 // unknown id, or (corrupt data) two saved foods share it: refuse rather than edit the wrong one
    const i = hits[0];
    const old = state.custom[i], has = k => isOwn(patch, k) && patch[k] !== undefined;
    const next = { name: old.name, brand: old.brand || '', servingG: old.servingG, per100: { ...old.per100 }, barcode: old.barcode };
    if (has('name')) { next.name = cleanFoodName(patch.name); if (!next.name) return null; }
    if (has('brand')) { if (typeof patch.brand !== 'string') return null; next.brand = cleanFoodName(patch.brand); }
    if (has('servingG')) { if (!num(patch.servingG) || !(patch.servingG > 0)) return null; next.servingG = patch.servingG; }
    if (has('barcode')) {
      if (typeof patch.barcode !== 'string') return null;
      if (patch.barcode === '') next.barcode = undefined; else if (isBarcode(patch.barcode) && patch.barcode === patch.barcode.trim()) next.barcode = patch.barcode; else return null;
    }
    const serving = num(next.servingG) && next.servingG > 0 ? next.servingG : 100;
    for (const n of ['k', 'p', 'c', 'f']) if (has(n)) {
      if (!num(patch[n]) || patch[n] < 0) return null;
      next.per100[n] = patch[n] * 100 / serving;
    }
    if (!['k', 'p', 'c', 'f'].every(n => Number.isFinite(next.per100[n]))) return null;
    const cand = { name: next.name, brand: next.brand, source: old.source, barcode: next.barcode };
    if (state.custom.some((f, j) => j !== i && f && typeof f === 'object' && replacesCustom(f, cand))) return null;   // would be the same product as another saved food

    old.name = next.name; old.brand = next.brand; old.per100 = next.per100; old.updatedAt = now;
    if (has('servingG')) old.servingG = next.servingG;
    if (has('barcode')) { if (next.barcode) old.barcode = next.barcode; else delete old.barcode; }
    return old;
  } catch { return null; }
}
