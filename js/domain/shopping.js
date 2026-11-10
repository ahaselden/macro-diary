// Shopping lists. Pure. The LIST is derived from the plan + recipes every time (so it can never go stale); the only saved
// state is what the user does to it: ticking items (`state.shopping.checks`) and hand-added extras (`state.shopping.extras`) — see D13.
//
// Aggregation rule: the same ingredient from several recipes/days is summed when the units are COMPATIBLE:
//   weight  (g, kg, oz, lb)                          -> summed in grams
//   volume  (tsp, tbsp, cup, fl oz, ml, l, pint…)    -> summed in millilitres
//   count   ('' or a counted unit: clove, can, …)    -> summed per unit word
// Weight and volume of the same ingredient are NOT converted into each other (that needs a density we don't have for
// arbitrary ingredients) — they stay as separate lines rather than being guessed.
import { addDays } from '../core/dates.js';
import { MEALS } from '../core/constants.js';
import { OZ } from '../core/constants.js';
import { formatQty } from './ingredient-parse.js';
import { csvCell } from './reports.js';

const WEIGHT_G = { g: 1, kg: 1000, oz: OZ, lb: 453.592 };
const VOLUME_ML = { ml: 1, l: 1000, tsp: 4.92892, tbsp: 14.7868, 'fl oz': 29.5735, cup: 236.588, pint: 473.176, quart: 946.353, gallon: 3785.41 };

export const AISLES = ['Produce', 'Meat & seafood', 'Dairy & eggs', 'Bakery', 'Pantry', 'Spices', 'Frozen', 'Other'];
const AISLE_WORDS = {
  Produce: ['onion', 'garlic', 'tomato', 'lettuce', 'spinach', 'kale', 'carrot', 'potato', 'celery', 'cucumber', 'zucchini', 'squash', 'broccoli', 'cauliflower', 'mushroom', 'bell pepper', 'jalapeno', 'ginger', 'lemon', 'lime', 'orange', 'apple', 'banana', 'berry', 'strawberry', 'blueberry', 'avocado', 'cilantro', 'parsley', 'basil', 'mint', 'scallion', 'green onion', 'shallot', 'cabbage', 'corn', 'pea', 'grape', 'pear', 'peach', 'mango', 'pineapple', 'herb', 'thyme', 'rosemary', 'sage', 'dill', 'chive', 'leek', 'beet', 'radish', 'asparagus', 'eggplant'],
  'Meat & seafood': ['chicken', 'beef', 'pork', 'bacon', 'sausage', 'turkey', 'ham', 'lamb', 'steak', 'ground', 'fish', 'salmon', 'tuna', 'shrimp', 'cod', 'tilapia', 'crab', 'prosciutto'],
  'Dairy & eggs': ['milk', 'cheese', 'butter', 'yogurt', 'cream', 'egg', 'sour cream', 'mozzarella', 'parmesan', 'cheddar', 'feta', 'ricotta'],
  Bakery: ['bread', 'tortilla', 'bun', 'bagel', 'roll', 'pita', 'naan', 'baguette'],
  Spices: ['salt', 'black pepper', 'cumin', 'paprika', 'oregano', 'cinnamon', 'nutmeg', 'turmeric', 'chili powder', 'cayenne', 'coriander', 'curry', 'bay leaf', 'vanilla', 'garlic powder', 'onion powder', 'seasoning', 'clove', 'cardamom'],
  Frozen: ['frozen', 'ice cream'],
  Pantry: ['flour', 'sugar', 'rice', 'pasta', 'noodle', 'oil', 'vinegar', 'bean', 'lentil', 'chickpea', 'broth', 'stock', 'sauce', 'ketchup', 'mustard', 'mayo', 'honey', 'syrup', 'oat', 'cereal', 'nut', 'almond', 'peanut', 'walnut', 'baking', 'yeast', 'cocoa', 'chocolate', 'soy', 'tomato paste', 'canned', 'coconut milk', 'quinoa', 'breadcrumb', 'cornstarch', 'molasses', 'jam', 'tahini'],
};
// Check the more specific aisles first so "frozen peas" is Frozen, "garlic powder" is Spices, "tomato paste" is Pantry.
const AISLE_ORDER_CHECK = ['Frozen', 'Spices', 'Pantry', 'Meat & seafood', 'Dairy & eggs', 'Bakery', 'Produce'];
// Whole-word matching (optional plural s), so 'egg' matches 'eggs' but not 'eggplant', 'ham' not 'graham', 'butter' not 'butternut'.
const AISLE_RE = Object.fromEntries(AISLE_ORDER_CHECK.map(a => [a, new RegExp(`(?<![a-z])(?:${AISLE_WORDS[a].map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:e?s)?(?![a-z])`)]));
export function aisleOf(name) {
  const n = String(name || '').toLowerCase();
  for (const a of AISLE_ORDER_CHECK) if (AISLE_RE[a].test(n)) return a;
  return 'Other';
}

const sing = w => {
  if (w.length <= 3 || /(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  return w.endsWith('s') ? w.slice(0, -1) : w;
};
// Size words don't change what you buy at the shop: "2 large eggs" and "3 eggs" are one line.
const SIZE_WORDS = new Set(['small', 'medium', 'large', 'jumbo']);
/** Grouping key for an ingredient name: lowercase, punctuation and size words removed, naively singularised ("Large Tomatoes" == "tomato"). */
export const nameKey = n => String(n || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => !SIZE_WORDS.has(w)).map(sing).join(' ');

function family(unit) {
  if (Object.hasOwn(WEIGHT_G, unit)) return { fam: 'w', base: WEIGHT_G[unit] };       // own-property checks: a unit like 'toString' must not hit Object.prototype
  if (Object.hasOwn(VOLUME_ML, unit)) return { fam: 'v', base: VOLUME_ML[unit] };
  return { fam: 'c:' + (unit || ''), base: 1 };
}

/** Collect raw {name, qty, unit, from} lines for every planned item in [from, to]. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function collect(state, from, to) {
  const lines = [], skipped = [];
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) return { lines, skipped };   // bad range -> empty list (never loops)
  for (let d = from, days = 0; d <= to && days < 400; d = addDays(d, 1), days++) {      // hard cap: at most ~13 months

    const day = state.plan[d]; if (!day) continue;
    for (const m of MEALS) for (const it of day.slots[m] || []) {
      if (it.type === 'recipe') {
        const r = state.recipes[it.recipeId];
        if (!r) { skipped.push(`${d} ${m}: a deleted recipe`); continue; }
        const factor = (it.servings || 1) / (r.servings > 0 ? r.servings : 1);
        for (const ing of r.ingredients) {
          const name = (ing.name || ing.raw || '').trim(); if (!name) continue;
          lines.push({ name, qty: ing.qty == null ? null : ing.qty * factor, unit: ing.unit || '', from: r.name });
        }
      } else if (it.food) lines.push({ name: it.food.name, qty: it.grams || null, unit: it.grams ? 'g' : '', from: 'Planned food' });
    }
  }
  return { lines, skipped };
}

/** Nicest unit to show an amount in. `weightUnit` is the user's setting ('g'|'oz'). */
export function displayAmount(fam, base, weightUnit) {
  if (fam === 'w') {
    if (weightUnit === 'oz') return base >= 16 * OZ ? [base / 453.592, 'lb'] : [base / OZ, 'oz'];
    return base >= 1000 ? [base / 1000, 'kg'] : [base, 'g'];
  }
  if (fam === 'v') {
    if (base >= 0.25 * 236.588 - 0.01) return [base / 236.588, 'cup'];
    if (base >= 14.7868 - 0.01) return [base / 14.7868, 'tbsp'];
    return [base / 4.92892, 'tsp'];
  }
  return [base, fam.slice(2)];
}
const plural = (unit, q) => (q > 1 && ['cup', 'clove', 'can', 'slice', 'stick', 'pinch', 'piece', 'bunch', 'pint', 'quart', 'gallon'].includes(unit) ? (unit === 'pinch' ? 'pinches' : unit + 's') : unit);
const r2 = n => Math.round(n * 100) / 100;

/**
 * The shopping list for plan days [from, to] (inclusive, 'YYYY-MM-DD'). Returns `{ items, skipped }`.
 * item = { key, tick, name, display, qty, unit, from:[recipe names], aisle, checked }, ordered by aisle then name.
 * `tick` is the key to pass to setChecked() (it includes the range start so ticks belong to one shopping trip).
 * Hand-added extras are appended as aisle 'Extras' (see `extrasList`).
 */
export function buildShoppingList(state, from, to, weightUnit = 'g') {
  const { lines, skipped } = collect(state, from, to), groups = new Map();
  for (const l of lines) {
    const { fam, base } = family(l.unit);
    const key = `${nameKey(l.name)}|${fam}`;
    const g = groups.get(key) || { key, name: l.name.toLowerCase(), fam, total: 0, any: false, from: new Set() };
    if (l.qty != null && isFinite(l.qty)) { g.total += l.qty * base; g.any = true; }
    g.from.add(l.from); groups.set(key, g);
  }
  const items = [...groups.values()].map(g => {
    let qty = null, unit = '', display = '';
    if (g.any && g.total > 0) { [qty, unit] = displayAmount(g.fam, g.total, weightUnit); qty = r2(qty); display = `${formatQty(qty)}${unit ? ' ' + plural(unit, qty) : ''}`; }
    // Ticks are scoped to the shopping range (`tick` = range start + item key): ticking onions this week must not tick them next week.
    const tick = `${from}|${g.key}`;
    return { key: g.key, tick, name: g.name, display, qty, unit, from: [...g.from].sort(), aisle: aisleOf(g.name), checked: !!state.shopping.checks[tick]?.on };
  });
  items.sort((a, b) => AISLES.indexOf(a.aisle) - AISLES.indexOf(b.aisle) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { items, skipped };
}

export const extrasList = state => Object.values(state.shopping.extras).sort((a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : 1));

// ---- changes the user makes (mutate state; stamped so they sync — same convention as entries.js) ----
export function setChecked(state, key, on, now) { state.shopping.checks[key] = { on: !!on, updatedAt: now }; }
export function addExtra(state, text, id, now) {
  const t = String(text || '').trim(); if (!t) return null;
  const e = { id, text: t.slice(0, 200), on: false, updatedAt: now }; state.shopping.extras[id] = e;
  if (state.tombstones) delete state.tombstones[id];
  return e;
}
export function toggleExtra(state, id, on, now) { const e = state.shopping.extras[id]; if (!e) return false; e.on = !!on; e.updatedAt = now; return true; }
export function removeExtra(state, id, now) {
  if (!state.shopping.extras[id]) return false;
  delete state.shopping.extras[id]; state.tombstones[id] = now; return true;
}
/** Untick everything (items and extras) — "start the next shop". */
export function clearTicks(state, now) {
  for (const k of Object.keys(state.shopping.checks)) state.shopping.checks[k] = { on: false, updatedAt: now };
  for (const e of Object.values(state.shopping.extras)) { e.on = false; e.updatedAt = now; }
}

// ---- output ----
/** Plain text for sharing/copying: grouped by aisle, "[ ]" boxes, ticked items marked. */
export function shoppingText(state, list, title = 'Shopping list') {
  const out = [title];
  for (const a of [...AISLES, 'Extras']) {
    const rows = a === 'Extras' ? extrasList(state).map(e => ({ line: e.text, on: e.on })) : list.items.filter(i => i.aisle === a).map(i => ({ line: i.display ? `${i.display} ${i.name}` : i.name, on: i.checked }));
    if (!rows.length) continue;
    out.push('', a.toUpperCase(), ...rows.map(r => `${r.on ? '[x]' : '[ ]'} ${r.line}`));
  }
  return out.join('\n');
}
export function shoppingCsv(state, list) {
  const rows = [['Aisle', 'Item', 'Amount', 'Used in', 'Got it']];
  for (const i of list.items) rows.push([i.aisle, i.name, i.display, i.from.join('; '), i.checked ? 'yes' : '']);
  for (const e of extrasList(state)) rows.push(['Extras', e.text, '', '', e.on ? 'yes' : '']);
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}
