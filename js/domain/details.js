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
