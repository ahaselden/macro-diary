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
