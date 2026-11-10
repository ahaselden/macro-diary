// The weekly meal plan. Pure. Functions that change the plan MUTATE the `state` they are given (same convention as
// domain/entries.js and domain/recipes.js) and stamp `updatedAt` on the planned DAY, which is the unit of sync/merge (D13).
// `now` and `idGen` are parameters so tests are deterministic.
import { MEALS } from '../core/constants.js';
import { fmt, parse, addDays } from '../core/dates.js';
import { recipeNutrition } from './recipes.js';
import { addEntry } from './entries.js';

const ZERO = () => ({ k: 0, p: 0, c: 0, f: 0 });
const add = (a, b, m = 1) => { a.k += b.k * m; a.p += b.p * m; a.c += b.c * m; a.f += b.f * m; return a; };
const emptyDay = () => ({ updatedAt: 0, slots: Object.fromEntries(MEALS.map(m => [m, []])) });

/** Monday (as 'YYYY-MM-DD') of the week containing `date`. Weeks run Monday–Sunday, like the export ranges. */
export function weekStart(date) { const d = parse(date); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmt(d); }
export const weekDates = start => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const getDay = (state, date) => state.plan[date] || emptyDay();
function touch(state, date, now) { const d = (state.plan[date] ||= emptyDay()); for (const m of MEALS) d.slots[m] ||= []; d.updatedAt = now; return d; }
const find = (state, date, meal, id) => (state.plan[date]?.slots?.[meal] || []).find(i => i.id === id) || null;

export const recipeItem = (id, recipeId, servings = 1) => ({ id, type: 'recipe', recipeId, name: '', servings, food: null, grams: null, entryId: '' });
export const foodItem = (id, food, grams) => ({ id, type: 'food', recipeId: '', name: food.name, servings: 1, food, grams, entryId: '' });

export function addPlanItem(state, date, meal, item, now) {
  if (!MEALS.includes(meal)) return null;
  touch(state, date, now).slots[meal].push(item);
  return item;
}
export function updatePlanItem(state, date, meal, id, patch, now) {
  const it = find(state, date, meal, id); if (!it) return null;
  Object.assign(it, patch); touch(state, date, now); return it;
}
export function removePlanItem(state, date, meal, id, now) {
  const list = state.plan[date]?.slots?.[meal]; if (!list || !list.some(i => i.id === id)) return false;
  state.plan[date].slots[meal] = list.filter(i => i.id !== id); touch(state, date, now); return true;
}
/** Empty a day. The (empty) day stays as a record with a new timestamp so the clearing wins a sync. */
export function clearDay(state, date, now) { const d = touch(state, date, now); for (const m of MEALS) d.slots[m] = []; return d; }

/** Replace `to` with a copy of `from` (fresh item ids, nothing marked as logged). */
export function copyDay(state, from, to, now, idGen) {
  const src = getDay(state, from), d = clearDay(state, to, now);
  for (const m of MEALS) d.slots[m] = src.slots[m].map(i => ({ ...structuredClone(i), id: idGen(), entryId: '' }));
  return d;
}
export function copyWeek(state, fromStart, toStart, now, idGen) {
  weekDates(fromStart).forEach((d, i) => copyDay(state, d, addDays(toStart, i), now, idGen));
}

/** Calories/macros of ONE planned item. `complete` is false when a recipe is missing/incomplete or a food has no grams. */
export function itemNutrition(state, item) {
  if (item.type === 'recipe') {
    const r = state.recipes[item.recipeId];
    if (!r) return { ...ZERO(), complete: false, missing: true, name: item.name || '(deleted recipe)' };
    const n = recipeNutrition(r, state.measures);
    return { ...add(ZERO(), n.perServing, item.servings), complete: n.complete, missing: false, name: r.name };
  }
  const p = item.food?.per100 || ZERO(), g = item.grams || 0;
  return { ...add(ZERO(), p, g / 100), complete: g > 0, missing: false, name: item.name || item.food?.name || '' };
}

/** Totals for a planned day and per meal; `complete` only if every item is. */
export function dayNutrition(state, date) {
  const day = getDay(state, date), total = ZERO(), byMeal = {}; let complete = true, items = 0;
  for (const m of MEALS) {
    byMeal[m] = ZERO();
    for (const it of day.slots[m]) { const n = itemNutrition(state, it); add(byMeal[m], n); add(total, n); items++; if (!n.complete) complete = false; }
  }
  return { total, byMeal, complete, items };
}

/** The diary entry a planned item becomes. Recipes become "N serving(s)" with the recipe's real serving weight when known.
 *  A partly linked recipe logs only what is linked (the calories are an underestimate; the UI flags incomplete recipes). */
function entryFor(state, item, meal, idGen) {
  if (item.type === 'recipe') {
    const r = state.recipes[item.recipeId]; if (!r) return null;
    const n = recipeNutrition(r, state.measures);
    if (n.linked === 0) return null;   // no ingredient has nutrition data: nothing meaningful to log (the UI tells the user to link foods)
    const sw = n.totalGrams > 0 && r.servings > 0 ? n.totalGrams / r.servings : 100;   // grams per serving (100 = unknown weight)
    const per100 = { k: n.perServing.k * 100 / sw, p: n.perServing.p * 100 / sw, c: n.perServing.c * 100 / sw, f: n.perServing.f * 100 / sw };
    const servings = Math.round(item.servings * 100) / 100;
    return { id: idGen(), meal, name: r.name, brand: '', source: 'Recipe', per100, servingG: sw, servingLabel: '1 serving', grams: sw * item.servings, unitKey: 's', amount: item.servings, disp: `${servings} serving${servings === 1 ? '' : 's'}` };
  }
  if (!item.food || !(item.grams > 0)) return null;
  const f = item.food;
  return { id: idGen(), meal, name: f.name, brand: f.brand || '', source: f.source || '', per100: f.per100, servingG: f.servingG || 0, servingLabel: f.servingLabel || '', grams: item.grams, unitKey: 'w:g', amount: item.grams, disp: '' };
}

/**
 * Log one planned item to the diary for `date`. Idempotent: if the item was already logged and that diary entry
 * still exists, nothing happens (returns null). If the user deleted the entry, logging again is allowed.
 */
export function logItem(state, date, meal, itemId, now, idGen) {
  const it = find(state, date, meal, itemId); if (!it) return null;
  if (it.entryId && (state.days[date] || []).some(e => e.id === it.entryId)) return null;
  const entry = entryFor(state, it, meal, idGen); if (!entry) return null;
  addEntry(state, date, entry, now);
  it.entryId = entry.id; touch(state, date, now);
  return entry;
}
/** Log every not-yet-logged item of a day; returns how many entries were created. */
export function logDay(state, date, now, idGen) {
  let n = 0;
  for (const m of MEALS) for (const it of [...(state.plan[date]?.slots?.[m] || [])]) if (logItem(state, date, m, it.id, now, idGen)) n++;
  return n;
}
