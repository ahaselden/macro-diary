// Looking up suggested food matches for a recipe's ingredients, one at a time. Everything outside is injected (search, loadPortions, sleep, isCancelled,
// onProgress) so it can be tested without a network. It only RETURNS suggestions: it never changes the ingredients and never links anything.
import { searchQuery, pickSuggestion, shouldSuggest, suggestionFood } from '../domain/food-match.js';

const MAX_LOOKUPS = 60, DEFAULT_DELAY_MS = 250, MAX_MESSAGE = 200;
const WEIGHT_UNITS = new Set(['g', 'kg', 'oz', 'lb']);
const RATE_LIMIT = /rate limit|429|too many/i;

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (plain(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const message = e => {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return (m.replace(/\s+/g, ' ').trim() || 'The food search failed.').slice(0, MAX_MESSAGE);
};

/**
 * @returns {Promise<{suggestions: Object<string,{food:object, confidence:'likely'|'check', score:number}>, skipped:number, errors:string[], stoppedEarly:boolean, reason:string}>}
 */
export async function suggestMatches(ingredients, opts) {
  const o = plain(opts) ? opts : {};
  const out = { suggestions: {}, skipped: 0, errors: [], stoppedEarly: false, reason: '' };
  if (!Array.isArray(ingredients) || typeof o.search !== 'function') return out;
  const note = m => { if (!out.errors.includes(m)) out.errors.push(m); };
  const delay = Number.isFinite(o.delayMs) && o.delayMs >= 0 ? o.delayMs : DEFAULT_DELAY_MS;
  const sleep = typeof o.sleep === 'function' ? o.sleep : ms => new Promise(r => setTimeout(r, ms));
  const cancelled = () => { try { return typeof o.isCancelled === 'function' && !!o.isCancelled(); } catch { return false; } };

  let list = [];
  for (const ing of ingredients) { if (shouldSuggest(ing)) list.push(ing); else out.skipped++; }
  if (list.length > MAX_LOOKUPS) { list = list.slice(0, MAX_LOOKUPS); note(`Only the first ${MAX_LOOKUPS} ingredients were looked up.`); }

  for (let n = 0; n < list.length; n++) {
    if (cancelled()) { out.stoppedEarly = true; out.reason = 'cancelled'; break; }
    const ing = list[n], id = own(ing, 'id');
    let res;
    try { res = await o.search(searchQuery(ing)); }
    catch (e) {
      const m = message(e); note(m);
      if (RATE_LIMIT.test(m)) { out.stoppedEarly = true; out.reason = 'rate-limit'; break; }
      res = null;
    }
    const results = plain(res) && Array.isArray(res.results) ? res.results : [];
    const errors = plain(res) && Array.isArray(res.errors) ? res.errors.filter(x => typeof x === 'string') : [];
    if (!results.length && errors.length) {
      const m = errors.map(x => x.replace(/\s+/g, ' ').trim()).join(' · ').slice(0, MAX_MESSAGE); note(m);
      if (RATE_LIMIT.test(m)) { out.stoppedEarly = true; out.reason = 'rate-limit'; break; }
    }
    const pick = pickSuggestion(ing, results);
    const base = pick ? suggestionFood(pick.food) : null;
    if (base && typeof id === 'string' && id) {
      const unit = typeof own(ing, 'unit') === 'string' ? own(ing, 'unit') : '';
      if (!WEIGHT_UNITS.has(unit) && typeof o.loadPortions === 'function') {
        try { await o.loadPortions(base); } catch { /* keep the suggestion without household measures */ }
      }
      Object.defineProperty(out.suggestions, id, { value: { food: suggestionFood(base) || base, confidence: pick.confidence, score: pick.score }, enumerable: true, writable: true, configurable: true });
    }
    try { if (typeof o.onProgress === 'function') o.onProgress({ done: n + 1, total: list.length, current: id }); } catch { /* progress is optional */ }
    if (n < list.length - 1) await sleep(delay);
  }
  return out;
}
