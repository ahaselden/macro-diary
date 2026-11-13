// The numbers behind a day's nutrition details page. PURE.
// Calories and macros come from the entries as always; the extra nutrients (`nut`, per 100 g) are optional per entry,
// so each nutrient reports how many entries recorded it. A nutrient nobody recorded has total null ("Not recorded"), never 0.
import { NUT_KEYS } from '../core/schema.js';
import { validEntry } from './entries.js';
import { totals } from './nutrition.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const usable = e => !!e && typeof e === 'object' && !Array.isArray(e) && validEntry(e);

/** { items, macros {k,p,c,f}, pct {k,p,c,f} (whole % of goal, null without a goal), nutrients { key: { total, recorded, missing } } } */
export function dayDetails(entries, goals) {
  const list = Array.isArray(entries) ? entries.filter(usable) : [];
  const macros = totals(list), g = goals && typeof goals === 'object' ? goals : {};
  const pct = {};
  for (const k of ['k', 'p', 'c', 'f']) pct[k] = Number.isFinite(g[k]) && g[k] > 0 ? Math.round(macros[k] / g[k] * 100) : null;
  const nutrients = {};
  for (const key of NUT_KEYS) {
    let total = 0, recorded = 0;
    for (const e of list) {
      const v = e.nut && typeof e.nut === 'object' && Object.prototype.hasOwnProperty.call(e.nut, key) ? e.nut[key] : undefined;
      if (isNum(v)) { total += v * e.grams / 100; recorded++; }
    }
    nutrients[key] = { total: recorded ? total : null, recorded, missing: list.length - recorded };
  }
  return { items: list.length, macros, pct, nutrients };
}

/** One amount's extra nutrients: five { key, total } in NUT_KEYS order, scaled by grams/100; total null = not recorded (never 0), 0 = reported 0. */
export function itemFacts(food, grams) {
  const g = typeof grams === 'number' && Number.isFinite(grams) && grams > 0 ? grams : 0;
  const nut = food && typeof food === 'object' && food.nut && typeof food.nut === 'object' && !Array.isArray(food.nut) ? food.nut : null;
  return NUT_KEYS.map(key => {
    const v = nut && Object.prototype.hasOwnProperty.call(nut, key) ? nut[key] : undefined;
    return { key, total: isNum(v) ? v * g / 100 : null };
  });
}

/** "3.5 g", "500 mg", "<0.1 g" for a tiny amount, "Not recorded" for anything that is not a usable number. */
export function formatNut(total, unit) {
  if (!isNum(total)) return 'Not recorded';
  return (total > 0 && total < 0.1 ? '<0.1' : String(Math.round(total * 10) / 10)) + ' ' + unit;
}

