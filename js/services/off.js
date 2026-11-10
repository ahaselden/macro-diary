// Open Food Facts search.
import { getJSON } from './http.js';

const OFF_FIELDS = 'code,product_name,brands,nutriments,serving_quantity,serving_size';
export function mapOFF(p){
  const n = p.nutriments || {}; if (!p.product_name) return null;
  let k = n['energy-kcal_100g']; if (k == null && n.energy_100g != null) k = n.energy_100g / 4.184;
  if (k == null) return null;
  return {name:p.product_name, brand:(p.brands||'').split(',')[0].trim(), source:'OFF',
    per100:{k:+k, p:+n.proteins_100g||0, c:+n.carbohydrates_100g||0, f:+n.fat_100g||0}, servingG:+p.serving_quantity || 0, servingLabel:p.serving_size || ''};
}
export async function searchOFF(q){
  if (/^\d{8,14}$/.test(q)) {
    const j = await getJSON(`https://world.openfoodfacts.org/api/v2/product/${q}.json?fields=${OFF_FIELDS}`);
    const f = j.status === 1 && mapOFF(j.product); return f ? [f] : [];
  }
  const j = await getJSON(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=15&fields=${OFF_FIELDS}`);
  return (j.products || []).map(mapOFF).filter(Boolean);
}
