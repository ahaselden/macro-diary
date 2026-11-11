// Recipes: construction, grams resolution, nutrition, persistence helpers (mutate state like domain/entries.js), search, scaling.
// Pure: time and ids are parameters.
import { unitsFor, volOf } from './units.js';
import { parseIngredient, formatQty } from './ingredient-parse.js';
import { sanitizeStated } from '../core/schema.js';

export function newRecipe(id, now) {
  return { id, name: '', description: '', source: '', servings: 4, totalTime: null, tags: [], steps: [], ingredients: [], favorite: false, stated: null, updatedAt: now };
}

export function newIngredient(text, id) {
  const p = parseIngredient(text);
  return { id, raw: p.raw, name: p.name, qty: p.qty, unit: p.unit, prep: p.prep, food: null, grams: null };
}

// ---- grams ---------------------------------------------------------------------------------------------------

const ML = { cup: 236.588, tbsp: 14.7868, tsp: 4.92892, 'fl oz': 29.5735, ml: 1, l: 1000, pt: 473.176, qt: 946.353, gal: 3785.41 };
const V_KEY = { 'v:ml': 1, 'v:tsp': 4.92892, 'v:tbsp': 14.7868, 'v:floz': 29.5735, 'v:cup': 236.588 };
const PINCH_G = { pinch: 0.4, dash: 0.6 };      // typical spice pinch/dash when the food has no matching portion
const GENERIC_COUNT_UNITS = new Set(['', 'piece']);
const DEFAULT_LABELS = ['medium', 'each', 'whole', 'piece', 'unit', 'item', 'large', 'small', 'slice', 'clove'];
const WEIGHT_LABEL = /^\s*[\d./\s]*(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg)\b/i;
const SIZE_IN_TEXT = /\b(extra[- ]large|jumbo|large|medium|small|mini)\b/;

/** grams per 1 ml for the food, from a 'v:' unit or a portion/serving label that is a volume; null if unknown */
function density(food, units) {
  for (const u of units) if (u.key in V_KEY) return u.g / V_KEY[u.key];
  for (const u of units) {
    const label = u.key === 's' ? food.servingLabel : u.key.startsWith('p:') ? u.short : null;
    const ml = label ? volOf(label) : null;
    if (ml > 0) return u.g / ml;
  }
  return null;
}

/** count portions: portion units whose label is neither a volume nor a weight; g normalised to ONE unit */
function countPortions(units) {
  const out = [];
  for (const u of units) {
    if (!u.key.startsWith('p:') || volOf(u.short) !== null || WEIGHT_LABEL.test(u.short)) continue;
    const m = u.short.match(/^\s*(\d+(?:\.\d+)?)\s+/);
    const n = m && +m[1] > 0 ? +m[1] : 1;
    out.push({ label: u.short.toLowerCase(), g: u.g / n });
  }
  return out;
}

function sizeFromPrep(prep) {
  const m = String(prep || '').match(/(\d+(?:\.\d+)?)\s*(ounces?|oz|pounds?|lbs?|grams?|g|kg)\b/i);
  if (!m) return null;
  const n = +m[1], u = m[2].toLowerCase();
  return n * (u.startsWith('o') ? 28.3495 : u.startsWith('p') || u.startsWith('lb') ? 453.592 : u === 'kg' ? 1000 : 1);
}

/**
 * Grams of the ingredient's FULL quantity from its linked `food`, or null. Fallback order:
 *  1. no food, or a non-positive/NaN qty -> null (qty null is only allowed for count foods, step 4).
 *  2. weights: g, kg (x1000), oz, lb via unitsFor's 'w:' units.
 *  3. volumes (cup, tbsp, tsp, fl oz, ml, l, pt, qt, gal): qty x ml x density, where density comes from a 'v:' unit
 *     (unitsFor only offers those when a density is known) or, failing that, a portion/serving whose label is a volume;
 *     no density -> null.
 *  4. counts ('' , piece, clove, slice, can, stick, package, bunch, ...), in this order:
 *     a. pinch/dash: unit-word portion if any, else 0.4 g / 0.6 g per pinch/dash (deviation: a "serving" of salt is silly);
 *     b. a portion (or the serving label) containing the ingredient's own unit word (clove, slice, can, ...);
 *     c. for container units (can/package/bottle/jar/bag/box/container): a size in prep ("14 oz") x qty;
 *     d. only for generic counts ('' / piece): a portion containing the size word in name/prep (large, medium, ...);
 *     e. a portion whose label contains a word of the ingredient's name;
 *     f. a portion labelled medium, each, whole, piece, unit, item, large, small, slice, clove (in that order);
 *     g. the food's serving (servingG) as ONE count.
 *     Portion labels with a leading number ("2 slices") are divided to a single unit. If qty is null, steps a-f
 *     (a real portion match) count as 1; step g never does (so "salt" with no amount stays null).
 */
export function resolveGrams(ingredient, measures) {
  const food = ingredient && ingredient.food;
  if (!food) return null;
  const unit = String(ingredient.unit || '');
  let qty = ingredient.qty;
  const hasQty = typeof qty === 'number' && Number.isFinite(qty) && qty > 0;
  if (qty !== null && qty !== undefined && !hasQty) return null;
  const units = unitsFor(food, measures);
  const by = k => units.find(u => u.key === k);

  if (unit === 'g' || unit === 'kg' || unit === 'oz' || unit === 'lb') {
    if (!hasQty) return null;
    return unit === 'g' ? qty : unit === 'kg' ? qty * 1000 : qty * by(unit === 'oz' ? 'w:oz' : 'w:lb').g;
  }
  if (unit in ML) {
    if (!hasQty) return null;
    const d = density(food, units);
    return d > 0 ? qty * ML[unit] * d : null;
  }

  // count-like
  const ports = countPortions(units);
  const candidates = ports.slice();
  if (food.servingG > 0 && food.servingLabel && volOf(food.servingLabel) === null && !WEIGHT_LABEL.test(food.servingLabel)) candidates.push({ label: String(food.servingLabel).toLowerCase(), g: food.servingG });
  const n = hasQty ? qty : 1;
  const find = pred => { const c = candidates.find(pred); return c ? c.g * n : null; };
  const text = `${ingredient.name || ''} ${ingredient.prep || ''}`.toLowerCase();

  if (PINCH_G[unit] && !hasQty && !candidates.length) return null;
  if (unit) {
    const re = new RegExp(`\\b${unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?\\b`, 'i');   // unit comes from data: escape it
    const g = find(c => re.test(c.label));
    if (g !== null) return g;
    if (PINCH_G[unit]) return hasQty ? qty * PINCH_G[unit] : null;
    if (CONTAINER_UNITS.has(unit)) {
      const sz = sizeFromPrep(ingredient.prep);
      if (sz && hasQty) return qty * sz;
    }
  }
  if (GENERIC_COUNT_UNITS.has(unit)) {
    const sm = text.match(SIZE_IN_TEXT);
    let g = sm ? find(c => c.label.replace('-', ' ').includes(sm[1].replace('-', ' '))) : null;
    if (g === null) {
      const stems = String(ingredient.name || '').toLowerCase().split(/\s+/).map(w => w.replace(/(es|s)$/, '')).filter(w => w.length >= 3);
      g = find(c => stems.some(s => c.label.includes(s)));
    }
    if (g === null) for (const l of DEFAULT_LABELS) { g = find(c => c.label.includes(l)); if (g !== null) break; }
    if (g !== null) return g;
  }
  if (!hasQty) return null;           // no real portion matched: a missing amount is not "1 serving"
  return food.servingG > 0 ? qty * food.servingG : null;
}
const CONTAINER_UNITS = new Set(['can', 'package', 'bottle', 'jar', 'bag', 'box', 'container']);

// ---- nutrition -----------------------------------------------------------------------------------------------

const NOT_MEANINGFUL = /^(?:(?:ground|black|white|freshly ground|cracked|sea|kosher|table|iodized|flaky|coarse|fine|cold|hot|warm|boiling|lukewarm|ice|filtered|tap)\s+)*(?:water|salt|pepper|ice|ice cubes?)(?:\s+(?:and|&)\s+(?:salt|pepper))?$/;

/** Ingredients that need not be linked for a recipe to be "complete": water, salt, pepper, ice, "to taste", optional, pinch/dash. */
export function isIgnorable(ing) {
  const name = String(ing.name || '').toLowerCase().trim();
  const note = `${ing.prep || ''} ${ing.raw || ''}`.toLowerCase();
  return NOT_MEANINGFUL.test(name) || /\bto taste\b/.test(note) || /\boptional\b/.test(note) || ing.unit === 'pinch' || ing.unit === 'dash';
}

const z = () => ({ k: 0, p: 0, c: 0, f: 0 });

/**
 * Totals over linked ingredients (grams = ingredient.grams if a positive number, else resolveGrams). Ignorable
 * ingredients (isIgnorable) are not counted and never listed as missing, but if they happen to be linked and
 * resolvable they still add to the totals. count = counted ingredients, linked = counted ones with a food AND grams.
 */
export function recipeNutrition(recipe, measures) {
  const total = z();
  let totalGrams = 0, linked = 0, count = 0;
  const missing = [];
  for (const ing of (recipe && recipe.ingredients) || []) {
    const ignorable = isIgnorable(ing);
    if (!ignorable) count++;
    let g = null;
    if (ing.food && ing.food.per100) g = typeof ing.grams === 'number' && ing.grams > 0 ? ing.grams : resolveGrams(ing, measures);
    if (g > 0 && Number.isFinite(g)) {
      const p = ing.food.per100, f = g / 100;
      total.k += p.k * f; total.p += p.p * f; total.c += p.c * f; total.f += p.f * f; totalGrams += g;
      if (!ignorable) linked++;
    } else if (!ignorable) missing.push(ing.name || ing.raw || '');
  }
  const sv = recipe && recipe.servings > 0 ? recipe.servings : 1;
  const perServing = { k: total.k / sv, p: total.p / sv, c: total.c / sv, f: total.f / sv };
  const complete = count > 0 && linked === count;
  const foods = { total, perServing, totalGrams, linked, count, complete, missing };
  // Stated nutrition (the page's per-serving numbers, or ones the user typed) is used until every ingredient is linked; then the linked foods win.
  const st = sanitizeStated(recipe && recipe.stated);
  if (st && !complete) {
    const per = { k: st.k, p: st.p, c: st.c, f: st.f };
    return { ...foods, total: { k: per.k * sv, p: per.p * sv, c: per.c * sv, f: per.f * sv }, perServing: per, complete: true, source: 'stated', estimated: true };
  }
  return { ...foods, source: linked > 0 ? 'foods' : 'none', estimated: false };
}

/**
 * How one ingredient should be summarised in the editor: the parsed quantity/name/prep and the link state, with calories computed from the
 * linked food and grams. Pure; reads own properties only; never throws; strings are returned verbatim (the UI escapes them).
 *   needsGrams = a food is linked but the grams are unknown (the user must enter them).
 */
export function ingredientStatus(ing) {
  const o = ing && typeof ing === 'object' && !Array.isArray(ing) ? ing : {};
  const own = (obj, k) => (obj && typeof obj === 'object' && Object.hasOwn(obj, k) ? obj[k] : undefined);
  const text = v => (typeof v === 'string' ? v : '');
  const q = own(o, 'qty');
  const qty = ((q == null || q === '' ? '' : formatQty(q)) + ' ' + text(own(o, 'unit'))).trim();
  const food = own(o, 'food');
  const linked = !!food && typeof food === 'object' && !Array.isArray(food);
  const g = own(o, 'grams');
  const gn = typeof g === 'number' || typeof g === 'string' ? Number(g) : NaN;
  const grams = Number.isFinite(gn) && gn > 0 ? gn : null;
  const per = linked ? own(food, 'per100') : undefined;
  const kRaw = own(per, 'k');
  const k = typeof kRaw === 'number' || typeof kRaw === 'string' ? Number(kRaw) : NaN;
  return {
    qty, name: text(own(o, 'name')), prep: text(own(o, 'prep')), linked,
    foodName: linked ? text(own(food, 'name')) : '',
    kcal: linked && grams !== null && Number.isFinite(k) ? (k * grams) / 100 : null,
    grams, needsGrams: linked && grams === null,
  };
}

// ---- persistence (MUTATES state) -----------------------------------------------------------------------------

export function saveRecipe(state, recipe, now) {
  recipe.updatedAt = now;
  (state.recipes ||= {})[recipe.id] = recipe;
  if (state.tombstones) delete state.tombstones[recipe.id];
  return recipe;
}

export function deleteRecipe(state, id, now) {
  if (!state.recipes || !Object.hasOwn(state.recipes, id)) return false;
  delete state.recipes[id];
  (state.tombstones ||= {})[id] = now;
  return true;
}

/** Star/unstar a recipe. Stamps updatedAt so sync and merge treat it like any edit. False (no change) for an unknown id. */
export function setFavorite(state, id, on, now) {
  const r = state && state.recipes && typeof id === 'string' && Object.hasOwn(state.recipes, id) ? state.recipes[id] : null;
  if (!r || typeof r !== 'object') return false;
  r.favorite = on === true;
  r.updatedAt = now;
  return true;
}

export function searchRecipes(state, q, opts) {
  const favOnly = !!opts && opts.favoritesOnly === true;
  const all = Object.values(state.recipes || {}).filter(r => !favOnly || r.favorite === true);
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = r => {
    if (!words.length) return true;
    const hay = [r.name, ...(r.tags || []), ...(r.ingredients || []).map(i => i.name)].join('\n').toLowerCase();
    return words.every(w => hay.includes(w));
  };
  return all.filter(hit).sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()) || String(a.id).localeCompare(String(b.id)));
}

// ---- scaling -------------------------------------------------------------------------------------------------

const UNIT_LABEL = { pt: ['pint', 'pints'], qt: ['quart', 'quarts'], gal: ['gallon', 'gallons'], pinch: ['pinch', 'pinches'], dash: ['dash', 'dashes'],
  bunch: ['bunch', 'bunches'], box: ['box', 'boxes'], cup: ['cup', 'cups'] };
const INVARIANT = new Set(['tbsp', 'tsp', 'g', 'kg', 'oz', 'lb', 'ml', 'l', 'fl oz']);
const unitLabel = (u, q) => INVARIANT.has(u) ? u : (UNIT_LABEL[u] || [u, u + 's'])[q > 1.0001 ? 1 : 0];

/** "3 cups flour, sifted". Size-like prep ("14 oz") is omitted because it does not scale. Falls back to `raw` when qty is null. */
export function scaleIngredientText(ingredient, factor) {
  const i = ingredient || {};
  if (typeof i.qty !== 'number' || !Number.isFinite(i.qty) || !(factor > 0)) return i.raw || i.name || '';
  const q = i.qty * factor;
  const parts = String(i.prep || '').split(', ').filter(p => p && !/^\d/.test(p));
  const head = [formatQty(q), i.unit ? unitLabel(i.unit, q) : '', i.name || ''].filter(Boolean).join(' ');
  return parts.length ? `${head}, ${parts.join(', ')}` : head;
}
