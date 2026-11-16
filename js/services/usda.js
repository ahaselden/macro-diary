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

// ---- search rows: household portions for the first few generic results, loaded lazily -------------------------------
// Generic USDA foods come back from the search without a serving, so a row could only say "per 100 g". This looks up their portions (one request each,
// the first few only, a couple at a time) so the row can say "105 kcal per medium (118 g)". DEMO_KEY is heavily rate limited: the caps and the session
// cache are part of the design (D63); a rate-limit answer stops the whole batch.
const portionCache = new Map();                                  // fdcId -> Promise<portions[]> (settled values stay; failures are removed)
const callIf = (fn, ...args) => { if (typeof fn !== 'function') return undefined; try { return fn(...args); } catch { return undefined; } };
const posInt = (v, dflt) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? n : dflt; };

/**
 * Sets `portions` on the first `limit` (5) USDA foods that have an fdcId, no serving and no portions yet, at most `concurrency` (2) lookups at once.
 * `load(food, apiKey)` sets food.portions (default loadPortions); `onUpdate(food)` runs for each food that gained portions; `cancelled()` returning true
 * stops new requests and further onUpdate calls. Resolves with the number of foods that gained portions. Never rejects.
 */
export async function enrichWithPortions(foods, opts) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const load = typeof o.load === 'function' ? o.load : loadPortions;
    const limit = posInt(o.limit === undefined ? 5 : o.limit, 5), conc = Math.max(1, posInt(o.concurrency === undefined ? 2 : o.concurrency, 2));
    const isCancelled = () => { try { return typeof o.cancelled === 'function' ? !!o.cancelled() : false; } catch { return true; } };
    const todo = [];
    for (const f of Array.isArray(foods) ? foods : []) {
      if (todo.length >= limit) break;
      try { if (f && typeof f === 'object' && !Array.isArray(f) && f.source === 'USDA' && f.fdcId && !(f.servingG > 0) && !Array.isArray(f.portions)) todo.push(f); } catch { /* skip */ }
    }
    let stopped = false, gained = 0, next = 0;
    const fetchFor = async f => {
      await load(f, o.apiKey);
      return Array.isArray(f.portions) ? f.portions : [];
    };
    const one = async f => {
      const id = String(f.fdcId);
      let p = portionCache.get(id);
      if (!p) { p = fetchFor(f); portionCache.set(id, p); p.catch(() => { if (portionCache.get(id) === p) portionCache.delete(id); }); }
      let list;
      try { list = await p; } catch (e) { if (/rate limited/i.test(String(e && e.message))) stopped = true; return; }
      f.portions = list.map(x => ({ ...x }));
      if (!f.portions.length) return;
      gained++;
      if (!isCancelled()) callIf(o.onUpdate, f);
    };
    const worker = async () => { while (!stopped && !isCancelled() && next < todo.length) await one(todo[next++]); };
    await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, worker));
    return gained;
  } catch { return 0; }
}
