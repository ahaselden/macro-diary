// Units & amount-picker logic extracted from the legacy inline script. Pure.
import { foodKey } from './food.js';
import { OZ } from '../core/constants.js';
import { rd } from '../core/format.js';

export const frac = t => t.trim().split(/\s+/).reduce((a, x) => a + (x.includes('/') ? +x.split('/')[0] / +x.split('/')[1] : +x), 0);

// millilitres described by a label like "1 cup", "2 tbsp (30 ml)" or "cup, sliced"; null if it isn't a volume
export function volOf(label){
  const m = String(label || '').match(/^\s*(\d+(?:\.\d+)?(?:\s+\d+\/\d+|\/\d+)?)?\s*(cups?|tbsp|tablespoons?|tsp|teaspoons?|fl\.?\s*oz|fluid\s+ounces?|ml|milliliters?|millilitres?|liters?|litres?|pints?|quarts?)\b/i);
  if (!m) return null;
  const n = m[1] ? frac(m[1]) : 1, u = m[2].toLowerCase();
  const per = u.startsWith('cup') ? 236.588 : /^(tbsp|tablespoon)/.test(u) ? 14.7868 : /^(tsp|teaspoon)/.test(u) ? 4.92892 : /^(fl|fluid)/.test(u) ? 29.5735
    : u.startsWith('pint') ? 473.176 : u.startsWith('quart') ? 946.353 : /^(liter|litre)/.test(u) ? 1000 : 1;
  return n * per;
}

// every unit this food can be entered in; g = grams per 1 unit
// measures = saved custom measures map { [foodKey]: [{label, g}] }
export function unitsFor(food, measures){
  const u = [{key:'w:g', label:'grams (g)', short:'g', g:1}, {key:'w:oz', label:'ounces (oz)', short:'oz', g:OZ}, {key:'w:lb', label:'pounds (lb)', short:'lb', g:453.592}];
  if (food.servingG > 0) u.push({key:'s', short:'serving', g:food.servingG,
    label:`serving (${food.servingLabel ? food.servingLabel : rd(food.servingG) + ' g'})`});
  const ports = [...(food.portions || []), ...((measures || {})[foodKey(food)] || [])];
  ports.forEach(p => u.push({key:'p:' + p.label, label:`${p.label} (${rd(p.g)} g)`, short:p.label, g:p.g}));
  const cands = ports.map(p => [p.label, p.g]); if (food.servingG > 0 && food.servingLabel) cands.unshift([food.servingLabel, food.servingG]);
  let d = null; for (const [l, g] of cands) { const ml = volOf(l); if (ml > 0) { d = g / ml; break; } }
  if (d) [['ml','milliliters (ml)',1],['tsp','teaspoons (tsp)',4.92892],['tbsp','tablespoons (tbsp)',14.7868],['floz','fluid ounces (fl oz)',29.5735],['cup','cups',236.588]]
    .forEach(([k, l, ml]) => { if (!cands.some(([pl]) => Math.abs((volOf(pl) || 0) - ml) < ml * 0.01)) u.push({key:'v:' + k, label:l, short:k === 'floz' ? 'fl oz' : k, g:ml * d}); });
  const seen = new Set(); return u.filter(x => x.g > 0 && !seen.has(x.key) && seen.add(x.key));
}

// ---- starting a food at a serving instead of a weight --------------------------------------------------------

const MAX_TEXT = 300, MAX_SERVING_G = 5000, OZ_G = 28.3495;
const stripTags = s => s.replace(/<\/?[a-zA-Z!][^<>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Grams (and a label) from serving-size text such as Open Food Facts writes it: "37 g", "1 scoop (37 g)", "30g (1 scoop)", "1.5 oz (42 g)", "1 oz".
 * Grams win over ounces; a volume alone (ml, cup, tbsp, fl oz) is not a weight, so it gives null. {g, label} with 0 < g <= 5000, or null. Never throws.
 */
export function parseServingText(text) {
  if (typeof text !== 'string') return null;
  const clean = stripTags(text.slice(0, MAX_TEXT));
  if (!clean) return null;
  const first = (re, mult) => {
    for (const m of clean.matchAll(re)) { const g = Number(m[1]) * mult; if (Number.isFinite(g) && g > 0 && g <= MAX_SERVING_G) return g; }
    return null;
  };
  const grams = first(/(?<![\w.\-])(\d+(?:\.\d+)?)\s*(?:g|gr|grams?)\b/gi, 1);
  const g = grams ?? first(/(?<![\w.\-])(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b/gi, OZ_G);
  if (g === null) return null;
  const bare = /^\d+(?:\.\d+)?\s*(?:g|gr|grams?)$/i.test(clean);
  return { g, label: (bare ? `${Number(g.toFixed(4))} g` : clean).slice(0, 60) };
}

const NOT_COUNTABLE = /\b(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|fl|fluid|ml|milliliters?|millilitres?|litres?|liters?|quarts?|pints?|gallons?|oz|ounces?|lbs?|pounds?|g|grams?|kg)\b/i;
const countable = label => !NOT_COUNTABLE.test(label.slice(0, 200));

/**
 * Where a NEW food amount should start, as { key, amount } (a key from `units`): the user's own saved measure for this food (the most recent), else the
 * serving, else the first household portion that is a count of something ("large", "slice": not cups or weights), else the weight default
 * (4 oz or 100 g, the user's preference). Pure; never throws; `units` is what unitsFor returns, `savedMeasures` the user's [{label, g, updatedAt}].
 */
export function startingUnit(food, units, savedMeasures, weightPref) {
  const weight = weightPref === 'w:oz' ? { key: 'w:oz', amount: 4 } : { key: 'w:g', amount: 100 };
  try {
    const keys = new Set((Array.isArray(units) ? units : []).filter(u => u && typeof u.key === 'string').map(u => u.key));
    const saved = (Array.isArray(savedMeasures) ? savedMeasures : []).filter(m => m && typeof m === 'object' && typeof m.label === 'string');
    const userKeys = new Set(saved.map(m => 'p:' + m.label));
    let best = null, bestAt = -Infinity;
    for (const m of saved) {
      const key = 'p:' + m.label;
      if (!keys.has(key)) continue;
      const at = Number.isFinite(m.updatedAt) ? m.updatedAt : 0;
      if (at >= bestAt) { best = key; bestAt = at; }
    }
    if (best !== null) return { key: best, amount: 1 };
    if (keys.has('s')) return { key: 's', amount: 1 };
    for (const key of keys) if (key.startsWith('p:') && !userKeys.has(key) && countable(key.slice(2))) return { key, amount: 1 };
  } catch { /* fall through to the weight default */ }
  return weight;
}
