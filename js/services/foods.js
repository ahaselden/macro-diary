// Combined food search: network + merge logic from the original doSearch (no DOM).
import { searchOFF } from './off.js';
import { searchUSDA, searchUSDAByBarcode } from './usda.js';
import { isBarcode } from '../domain/food.js';

export async function searchAll(q, { useUSDA, useOFF, apiKey } = {}){
  const jobs = [];
  if (useOFF) jobs.push(searchOFF(q).then(r => ({n:'Open Food Facts', r}), e => ({n:'Open Food Facts', e})));
  if (useUSDA && !isBarcode(q)) jobs.push(searchUSDA(q, apiKey).then(r => ({n:'USDA', r}), e => ({n:'USDA', e})));
  const out = await Promise.all(jobs);
  const errors = out.filter(o => o.e).map(o => `${o.n}: ${o.e.message}`);
  // interleave sources so both are visible
  const lists = out.filter(o => o.r).map(o => o.r), results = [];
  for (let i = 0; lists.some(l => i < l.length); i++) lists.forEach(l => l[i] && results.push(l[i]));
  // A barcode Open Food Facts could not answer (no product, or the request failed): try USDA's branded foods by the same digits.
  if (isBarcode(q) && useUSDA && !results.length) {
    try { results.push(...await searchUSDAByBarcode(q, apiKey)); }
    catch (e) {
      const m = e && e.message ? e.message : 'failed';
      errors.push('USDA: ' + (/rate limit|429|too many/i.test(m) && !String(apiKey || '').trim() ? m + ' Add your own USDA key in Settings (the shared key is limited).' : m));
    }
  }
  return { results, errors };
}
