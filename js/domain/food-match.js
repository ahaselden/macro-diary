// Suggesting a food-database match for a recipe ingredient. Pure: no DOM, network, clock or randomness; never throws; reads own properties only.
// The score is a heuristic (see docs/specs/suggest-food-matches.md for the constants), which is why the app only ever SUGGESTS: a person confirms
// every link, because a wrong silent match would give wrong calories.
import { isIgnorable } from './recipes.js';

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (plain(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const text = v => (typeof v === 'string' ? v : '');
const finite = v => typeof v === 'number' && Number.isFinite(v);

const NAME_CAP = 2000, QUERY_CAP = 80;
const FILLERS = new Set(['fresh', 'freshly', 'fresh-ground', 'large', 'medium', 'small', 'extra', 'boneless', 'skinless', 'chopped', 'minced', 'diced', 'sliced', 'optional', 'ground']);
const FORM_WORDS = new Set(['powder', 'juice', 'dried', 'canned', 'frozen', 'cooked', 'flour', 'sauce', 'soup', 'mix', 'flavored', 'breaded', 'candy', 'cereal', 'bar', 'drink']);

/** The text to search the food databases with: the ingredient's name, lowercase, parentheses and leading filler words ("fresh", "large", "chopped"...) removed. */
export function searchQuery(ingredient) {
  const name = text(own(ingredient, 'name'));
  if (!name) return '';
  const s = name.slice(0, NAME_CAP)
    .replace(/<\/?[a-zA-Z!][^<>]*>/g, ' ').replace(/[<>]/g, ' ')
    .replace(/\([^)]*(?:\)|$)/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
  const words = s ? s.split(' ') : [];
  while (words.length && FILLERS.has(words[0]) && (words[0] !== 'ground' || words.length > 1)) words.shift();
  return words.join(' ').slice(0, QUERY_CAP).trim();
}

const fold = t => {
  if (t.length < 4) return t;
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('es') && /(?:[sxzo]|ch|sh)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
};
const tokens = s => [...new Set(String(s).toLowerCase().split(/[^a-z]+/).filter(Boolean).map(fold))];

/** How well a food matches an ingredient, 0..1, deterministic. { score, reasons }. Never throws. */
export function scoreMatch(ingredient, food) {
  const none = () => ({ score: 0, reasons: [] });
  try {
    if (!plain(ingredient) || !plain(food)) return none();
    const name = text(own(food, 'name')), brand = text(own(food, 'brand')), source = text(own(food, 'source'));
    const foodTokens = tokens(name.slice(0, NAME_CAP));
    const brandTokens = tokens(brand.slice(0, 200));
    let ingTokens = tokens(searchQuery(ingredient));
    const brandInIngredient = brandTokens.length > 0 && ingTokens.some(t => brandTokens.includes(t));
    if (brandInIngredient) ingTokens = ingTokens.filter(t => !brandTokens.includes(t));       // "acme chicken breast": the brand word is not part of the food's name
    if (!ingTokens.length || !foodTokens.length) return none();
    const found = ingTokens.filter(t => foodTokens.includes(t)).length;
    if (!found) return none();
    const reasons = [];
    let score = 0.8 * (found / ingTokens.length);
    if (found === ingTokens.length) reasons.push('covers every word of the ingredient');
    const extra = foodTokens.filter(t => !ingTokens.includes(t)).length;
    if (extra) { score -= 0.02 * Math.min(extra, 6); reasons.push('the food name has extra words'); }
    if (found === ingTokens.length && extra === 0) { score += 0.10; reasons.push('exact name'); }
    const branded = brand !== '' || source === 'OFF';
    if (!branded && source === 'USDA') { score += 0.10; reasons.push('generic food'); }
    const forms = foodTokens.filter(t => FORM_WORDS.has(t) && !ingTokens.includes(t));
    if (forms.length) { score -= Math.min(0.70, 0.50 * forms.length); reasons.push('a different form: ' + forms.join(', ')); }
    if (branded && !brandInIngredient) { score -= 0.20; reasons.push('a branded product'); }
    return { score: Math.min(1, Math.max(0, score)), reasons };
  } catch { return none(); }
}

// A word that changes WHAT the food is. If the ingredient says it and the food's name does not, the match is at most "check" (e.g. "ground beef" vs "Beef, tenderloin").
const QUALIFIERS = new Set(['ground', 'canned', 'dried', 'frozen', 'smoked', 'cooked', 'roasted', 'pickled']);

const usableK = f => { const p = own(f, 'per100'); const k = own(p, 'k'); return finite(k) && k >= 0; };

/** The best candidate as { food, confidence: 'likely' | 'check', score }, or null. 'likely' needs a strong score AND a clear lead over the runner-up. */
export function pickSuggestion(ingredient, candidates) {
  try {
    if (!Array.isArray(candidates)) return null;
    let best = null, bestScore = -1, second = -1;
    for (const c of candidates) {
      if (!plain(c) || !usableK(c)) continue;
      const { score } = scoreMatch(ingredient, c);
      if (score > bestScore) { second = bestScore; bestScore = score; best = c; }
      else if (score > second) second = score;
    }
    if (!best || bestScore < 0.45) return null;
    const clear = second < 0 || bestScore - second >= 0.15;
    const said = tokens(text(own(ingredient, 'name')).slice(0, NAME_CAP)).filter(t => QUALIFIERS.has(t));
    const foodWords = tokens(text(own(best, 'name')).slice(0, NAME_CAP));
    const lost = said.some(t => !foodWords.includes(t));
    return { food: best, confidence: bestScore >= 0.75 && clear && !lost ? 'likely' : 'check', score: bestScore };
  } catch { return null; }
}

/** Should this ingredient get a suggestion: not linked yet, has a usable name, and is not salt/water/"to taste"/optional... */
export function shouldSuggest(ingredient) {
  try {
    if (!plain(ingredient)) return false;
    if (own(ingredient, 'food')) return false;
    if (!searchQuery(ingredient)) return false;
    return !isIgnorable(ingredient);
  } catch { return false; }
}

const num = (v, max = 1e7) => (finite(v) && v >= 0 ? Math.min(v, max) : 0);

/** The plain food object to store on an ingredient: only the known fields, fresh copies, strings capped. null when the food is unusable. */
export function suggestionFood(food) {
  try {
    if (!plain(food)) return null;
    const name = text(own(food, 'name')), per = own(food, 'per100');
    if (!name || !plain(per)) return null;
    const g = own(food, 'servingG');
    const out = {
      name: name.slice(0, 200), brand: text(own(food, 'brand')).slice(0, 200), source: text(own(food, 'source')).slice(0, 40),
      per100: { k: num(own(per, 'k')), p: num(own(per, 'p')), c: num(own(per, 'c')), f: num(own(per, 'f')) },
      servingG: finite(g) && g > 0 ? Math.min(g, 1e7) : 0, servingLabel: text(own(food, 'servingLabel')).slice(0, 100),
    };
    const id = own(food, 'fdcId');
    if (finite(id) || (typeof id === 'string' && id)) out.fdcId = id;
    const ports = own(food, 'portions');
    if (Array.isArray(ports)) {
      out.portions = ports.filter(p => plain(p) && typeof own(p, 'label') === 'string' && own(p, 'label') && finite(own(p, 'g')) && own(p, 'g') > 0)
        .slice(0, 30).map(p => ({ label: own(p, 'label').slice(0, 100), g: own(p, 'g') }));
    }
    return out;
  } catch { return null; }
}
