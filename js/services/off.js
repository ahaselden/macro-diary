// Open Food Facts search.
import { getJSON } from './http.js';
import { isBarcode } from '../domain/food.js';
import { parseServingText } from '../domain/units.js';
import { sanitizeNut } from '../core/schema.js';

const OFF_FIELDS = 'code,product_name,brands,nutriments,serving_quantity,serving_size';
// grams of one serving: serving_quantity when it is a usable number, else the grams written in the serving_size text ("1 scoop (37 g)"), else 0
function servingGrams(p){
  const q = Number(p.serving_quantity);
  if (Number.isFinite(q) && q > 0) return q;
  const t = parseServingText(p.serving_size);
  return t ? t.g : 0;
}
export function mapOFF(p){
  const n = p.nutriments || {}; if (!p.product_name) return null;
  let k = n['energy-kcal_100g']; if (k == null && n.energy_100g != null) k = n.energy_100g / 4.184;
  if (k == null) return null;
  const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined), mg = v => (num(v) === undefined ? undefined : v * 1000);
  const nut = sanitizeNut({ fiber: num(n.fiber_100g), sugars: num(n.sugars_100g), satFat: num(n['saturated-fat_100g']), sodium: mg(n.sodium_100g), cholesterol: mg(n.cholesterol_100g) });
  return {name:p.product_name, brand:(p.brands||'').split(',')[0].trim(), source:'OFF',
    per100:{k:+k, p:+n.proteins_100g||0, c:+n.carbohydrates_100g||0, f:+n.fat_100g||0}, servingG:servingGrams(p), servingLabel:p.serving_size == null ? '' : String(p.serving_size),
    ...(nut ? { nut } : {})};
}
export async function searchOFF(q){
  if (isBarcode(q)) {
    const j = await getJSON(`https://world.openfoodfacts.org/api/v2/product/${q}.json?fields=${OFF_FIELDS}`);
    const f = j.status === 1 && mapOFF(j.product); return f ? [f] : [];
  }
  const j = await getJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=15&fields=${OFF_FIELDS}`);
  return (j.products || []).map(mapOFF).filter(Boolean);
}
