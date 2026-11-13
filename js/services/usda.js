// USDA FoodData Central search and portions.
import { getJSON } from './http.js';
import { frac } from '../domain/units.js';
import { sanitizeNut } from '../core/schema.js';
import { usdaBarcodeQueries, usdaBarcodeMatch, normalizeBarcode } from '../domain/barcode.js';

export function usdaNut(list, num, unit){ const n = list.find(x => String(x.nutrientNumber) === num && (!unit || (x.unitName||'').toUpperCase() === unit)); return n ? +n.value : null; }
export function mapUSDA(f){
  const ns = f.foodNutrients || [];
  let k = usdaNut(ns,'208','KCAL') ?? usdaNut(ns,'957') ?? usdaNut(ns,'958');
  if (k == null) { const kj = usdaNut(ns,'268'); if (kj != null) k = kj / 4.184; }
  if (k == null) return null;
  const sg = f.servingSize && /^g/i.test(f.servingSizeUnit || '') ? +f.servingSize : 0;
  const name = f.description.toLowerCase() === f.description || f.description === f.description.toUpperCase()
    ? f.description.charAt(0).toUpperCase() + f.description.slice(1).toLowerCase() : f.description;
  const ok = v => (v != null && Number.isFinite(v) && v >= 0 ? v : undefined);
  const nut = sanitizeNut({ fiber: ok(usdaNut(ns,'291')), sugars: ok(usdaNut(ns,'269')), satFat: ok(usdaNut(ns,'606')), sodium: ok(usdaNut(ns,'307')), cholesterol: ok(usdaNut(ns,'601')) });
  return {name, brand:f.brandOwner || f.brandName || '', source:'USDA',
    per100:{k, p:usdaNut(ns,'203')||0, c:usdaNut(ns,'205')||0, f:usdaNut(ns,'204')||0}, servingG:sg,
    servingLabel:f.householdServingFullText || '', fdcId:f.fdcId, ...(nut ? { nut } : {}), ...(normalizeBarcode(f.gtinUpc) ? { barcode: normalizeBarcode(f.gtinUpc) } : {})};
}
export async function searchUSDA(q, apiKey){
  const key = encodeURIComponent((apiKey || '').trim() || 'DEMO_KEY');
  const url = t => `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}&query=${encodeURIComponent(q)}&pageSize=8&dataType=${t}`;
  // generic foods (Foundation / SR Legacy) first, then branded products
  const [g, b] = await Promise.all([getJSON(url('Foundation,SR%20Legacy')), getJSON(url('Branded')).catch(() => ({foods: []}))]);
  return [...(g.foods || []), ...(b.foods || [])].map(mapUSDA).filter(Boolean);
}
/** A scanned code -> [the USDA branded food with that exact barcode] or []. Rejects with the request error so the caller can report it. */
export async function searchUSDAByBarcode(code, apiKey){
  const queries = usdaBarcodeQueries(code);
  const key = encodeURIComponent((apiKey || '').trim() || 'DEMO_KEY');
  for (const q of queries) {
    const j = await getJSON(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}&query=${encodeURIComponent(q)}&pageSize=5&dataType=Branded`);
    const hit = usdaBarcodeMatch(code, j && Array.isArray(j.foods) ? j.foods : []);
    const food = hit ? mapUSDA(hit) : null;
    if (food) return [food];
  }
  return [];
}
// Pure part of the portions loader: food-detail JSON -> portions array.
export function mapPortions(j){
  const out = [], seen = new Set();
  (j.foodPortions || []).forEach(p => {
    const g = +p.gramWeight, amt = +p.amount || 1; if (!(g > 0)) return;
    const un = p.measureUnit && p.measureUnit.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
    let label, per;
    if (un || p.modifier) { label = [un, p.modifier].filter(Boolean).join(', '); per = g / amt; }
    else if (p.portionDescription) { const m = p.portionDescription.match(/^\s*(\d+(?:\.\d+)?(?:\s+\d+\/\d+|\/\d+)?)\s*(.*)$/); label = (m ? m[2] : p.portionDescription).trim(); per = g / (m ? frac(m[1]) : 1); }
    if (!label || /not specified|undetermined|quantity/i.test(label) || seen.has(label)) return;
    seen.add(label); out.push({label, g:per});
  });
  return out.slice(0, 14);
}
// USDA household measures (cups, tbsp, "1 medium" ...) live on the food detail record
export async function loadPortions(food, apiKey){
  const key = encodeURIComponent((apiKey || '').trim() || 'DEMO_KEY');
  const j = await getJSON(`https://api.nal.usda.gov/fdc/v1/food/${food.fdcId}?api_key=${key}`);
  food.portions = mapPortions(j);
}
