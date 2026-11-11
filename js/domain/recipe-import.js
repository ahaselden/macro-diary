// Recipe import: turn a recipe page (schema.org JSON-LD) or pasted text into a NEW app recipe. Pure: no DOM, network, storage, clock
// or randomness; every export returns a value on any input and never throws. Spec: docs/specs/recipe-import.md.
// Imported text is only ever treated as text: tags are removed, entities decoded once, and the UI escapes whatever is displayed.
// The page's per-serving calories and macros ARE kept (as the recipe's `stated` nutrition, always labelled as coming from the page) because
// a new import would otherwise show 0 kcal; linked foods replace them once every ingredient is linked (D31).
import { newRecipe, newIngredient } from './recipes.js';
import { sanitizeStated } from '../core/schema.js';

const LIM = { name: 200, description: 2000, tags: 20, tag: 40, steps: 100, step: 2000, ingredients: 200, ingredient: 300 };
const MAX_DEPTH = 8;          // how deep we follow nested lists/graphs
const MAX_NODES = 20000;      // and how many nodes in total
const MAX_BLOCK = 3e6;        // largest ld+json block we parse
const DEFAULT_SERVINGS = 4;

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => plain(o) && Object.hasOwn(o, k);
const field = (o, k) => (own(o, k) ? o[k] : undefined);
const finite = v => typeof v === 'number' && Number.isFinite(v);

// ---- text cleaning --------------------------------------------------------------------------------------------

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', times: '×', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ntilde: 'ñ', ouml: 'ö', uuml: 'ü' };
const BLOCK_TAG = /<\s*\/?\s*(?:br|p|li|ul|ol|div|tr|section|h[1-6])\b[^<>]*>/gi;
const ANY_TAG = /<\/?[a-zA-Z!][^<>]*>/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function codePoint(n) {
  if (!Number.isInteger(n) || n < 1 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) return null;
  return String.fromCodePoint(n);
}
function decodeOnce(s) {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,10}));/g, (all, dec, hex, name) => {
    if (dec !== undefined) return codePoint(Number(dec)) ?? all;
    if (hex !== undefined) return codePoint(parseInt(hex, 16)) ?? all;
    return Object.hasOwn(NAMED, name) ? NAMED[name] : all;
  });
}
/** Text -> clean single-spaced lines: block tags break lines, other tags go, entities decode once, whitespace collapses. */
function toLines(v, cap) {
  if (typeof v !== 'string') return [];
  const s = decodeOnce(v.slice(0, cap).replace(BLOCK_TAG, '\n').replace(ANY_TAG, '')).replace(CONTROL, '');
  return s.split(/\r\n|\r|\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const clean = (v, cap = 10000) => toLines(v, cap).join(' ');
const stripMark = l => l.replace(/^(?:[-*•–—·]\s+|\d{1,3}[.)]\s+)/, '');

// ---- numbers --------------------------------------------------------------------------------------------------

const MAX_MINUTES = 30 * 1440;
/** ISO-8601 duration (PnDTnHnMnS) -> whole minutes, or null. Bare numbers are not accepted: the unit would be a guess. */
export function parseDuration(v) {
  if (typeof v !== 'string') return null;
  const m = /^P(?:(\d{1,8})W)?(?:(\d{1,8})D)?(?:T(?:(\d{1,8})H)?(?:(\d{1,8})M)?(?:(\d{1,8})S)?)?$/i.exec(v.trim());
  if (!m || m.slice(1).every(x => x === undefined)) return null;
  const [w, d, h, mi, sec] = m.slice(1).map(x => Number(x || 0));
  const total = Math.round(w * 10080 + d * 1440 + h * 60 + mi + sec / 60);
  return total > 0 && total <= MAX_MINUTES ? total : null;
}

/** recipeYield -> servings (first number wins; arrays use the first element that parses), or null. */
export function parseYield(v) {
  if (finite(v)) return v > 0 && v <= 1000 ? v : null;
  if (typeof v === 'string') {
    const m = /(\d+(?:\.\d+)?)/.exec(v.slice(0, 200));
    const n = m ? Number(m[1]) : NaN;
    return n > 0 && n <= 1000 ? n : null;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < Math.min(v.length, 50); i++) { if (typeof v[i] === 'string' || finite(v[i])) { const n = parseYield(v[i]); if (n !== null) return n; } }
  }
  return null;
}

// ---- servings from the yield, and the page's nutrition --------------------------------------------------------

const SERVING_WORDS = new Set(['serving', 'servings', 'portion', 'portions', 'person', 'persons', 'people', 'serves']);
const sameNoun = (a, b) => a === b || a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a;
/** [number, noun] from "12 Wings" / "Makes 24 cookies" / "1.5 cups": the first number and the first word after it (lowercase), or null. */
function amountAndNoun(text) {
  if (typeof text !== 'string') return null;
  const m = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?/.exec(text.slice(0, 200));
  return m ? [Number(m[1]), (m[2] || '').toLowerCase()] : null;
}

/**
 * Servings from recipeYield, using the nutrition servingSize when they count the same thing: yield "12 Wings" with servingSize "12 Wings" is
 * ONE serving; "24 cookies" with "2 cookies" is 12. Otherwise the plain rule (parseYield). A number in (0, 1000] or null.
 */
export function servingsFromPage(recipeYield, servingSize) {
  try {
    const items = Array.isArray(recipeYield) ? recipeYield.slice(0, 50) : [recipeYield];
    const unit = items.map(amountAndNoun).find(a => a && a[1] && !SERVING_WORDS.has(a[1]));
    const per = amountAndNoun(servingSize);
    if (unit && per && per[0] > 0 && per[1] && sameNoun(unit[1], per[1])) {
      const v = Math.round((unit[0] / per[0]) * 100) / 100;
      if (Number.isFinite(v) && v > 0 && v <= 1000) return v;
    }
    return parseYield(recipeYield);
  } catch { return null; }
}

const KCAL = /^\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:kcal|calories?|cal)?\s*$/i;
const GRAMS = /^\s*(\d+(?:\.\d+)?)\s*(g|mg)?\s*$/i;
/** Calories per serving from "336", "434 calories", "172 kcal", "1,200 kcal" (kJ-only is not used); null unless 0 < value <= 20000. */
function parseCalories(v) {
  const text = typeof v === 'string' ? clean(v, 100) : finite(v) ? String(v) : '';
  const m = KCAL.exec(text);
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
  return n > 0 && n <= 20000 ? n : null;
}
/** Grams from "31.8g", "80", "3.7 g", "250 mg" (bare numbers are grams); null unless 0 <= value <= 5000. */
function parseGrams(v) {
  const text = typeof v === 'string' ? clean(v, 100) : finite(v) ? String(v) : '';
  const m = GRAMS.exec(text);
  if (!m) return null;
  const n = Number(m[1]) / (m[2] && m[2].toLowerCase() === 'mg' ? 1000 : 1);
  return Number.isFinite(n) && n >= 0 && n <= 5000 ? n : null;
}
const MACROS = [['p', 'protein'], ['c', 'carbs'], ['f', 'fat']];

/** The page's nutrition object -> { k, p, c, f, per } (macros not listed or unreadable are 0) plus which were missing, or null without calories. */
function pageNutrition(nut) {
  if (!plain(nut)) return null;
  const k = parseCalories(field(nut, 'calories'));
  if (k === null) return null;
  const grams = { p: parseGrams(field(nut, 'proteinContent')), c: parseGrams(field(nut, 'carbohydrateContent')), f: parseGrams(field(nut, 'fatContent')) };
  const ss = field(nut, 'servingSize');
  return { value: { k, p: grams.p ?? 0, c: grams.c ?? 0, f: grams.f ?? 0, per: typeof ss === 'string' ? clean(ss, 200).slice(0, 40) : '' },
    missing: MACROS.filter(([key]) => grams[key] === null).map(([, name]) => name) };
}

function humanMinutes(s) {
  const t = String(s).toLowerCase();
  let min = 0, any = false;
  const h = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/.exec(t), m = /(\d+)\s*(?:minutes?|mins?|m)\b/.exec(t);
  if (h) { min += Number(h[1]) * 60; any = true; }
  if (m) { min += Number(m[1]); any = true; }
  return any && min > 0 && min <= MAX_MINUTES ? Math.round(min) : null;
}

// ---- finding the Recipe in a page -----------------------------------------------------------------------------

const isRecipeType = t => {
  const one = x => typeof x === 'string' && /^(?:https?:\/\/schema\.org\/|schema:)?Recipe$/.test(x.trim());
  return Array.isArray(t) ? t.slice(0, 20).some(one) : one(t);
};

function collect(node, out, depth, budget) {
  if (depth > MAX_DEPTH || budget.n-- <= 0) return;
  if (Array.isArray(node)) { for (let i = 0; i < Math.min(node.length, 2000); i++) collect(node[i], out, depth + 1, budget); return; }
  if (!plain(node)) return;
  if (isRecipeType(field(node, '@type'))) { out.push(node); return; }
  const g = field(node, '@graph');
  if (Array.isArray(g)) collect(g, out, depth + 1, budget);
}

/** Remove the wrappers pages put around JSON in a script block (HTML comment, CDATA in three spellings). */
function unwrap(content) {
  let t = content.trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    if (t.startsWith('<!--') && t.endsWith('-->') && t.length >= 7) t = t.slice(4, -3).trim();
    for (const [a, b] of [['<![CDATA[', ']]>'], ['//<![CDATA[', '//]]>'], ['/*<![CDATA[*/', '/*]]>*/']]) {
      if (t.startsWith(a) && t.endsWith(b) && t.length >= a.length + b.length) { t = t.slice(a.length, t.length - b.length).trim(); break; }
    }
    if (t === before) break;
  }
  return t;
}

const SCRIPT_OPEN = /<script(?=[\s>\/])/gi;
const SCRIPT_CLOSE = /<\/script/gi;
const TYPE_ATTR = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** Every schema.org Recipe node found in <script type="application/ld+json"> blocks, in document order. */
export function extractRecipeJsonLd(html) {
  const found = [];
  try {
    if (typeof html !== 'string' || !html) return found;
    const open = new RegExp(SCRIPT_OPEN.source, 'gi'), close = new RegExp(SCRIPT_CLOSE.source, 'gi');
    let gt = -2;                                            // index of the next '>' at or after the current position (cached: keeps scanning linear)
    for (let m = open.exec(html); m; m = open.exec(html)) {
      const at = m.index + 7;
      if (gt < at) { gt = html.indexOf('>', at); if (gt < 0) break; }
      if (gt - at > 2000) continue;                         // not a sane tag
      const attrs = html.slice(at, gt), t = TYPE_ATTR.exec(attrs);
      close.lastIndex = gt + 1;
      const c = close.exec(html);
      if (!c) break;                                        // unterminated: nothing after this can be a block
      open.lastIndex = c.index + 8;
      const type = t ? (t[1] ?? t[2] ?? t[3] ?? '').trim().toLowerCase() : '';
      if (type !== 'application/ld+json') continue;
      const body = html.slice(gt + 1, c.index);
      if (body.length > MAX_BLOCK) continue;
      let json;
      try { json = JSON.parse(unwrap(body)); } catch { continue; }
      collect(json, found, 0, { n: MAX_NODES });
    }
  } catch { /* return what we have */ }
  return found;
}

// ---- JSON-LD -> result ----------------------------------------------------------------------------------------

const W = {
  title: 'This recipe has no title. Add one before saving.',
  ing: 'No ingredients were found. Add them in the editor.',
  steps: 'No steps were found. Add them in the editor.',
  serv: `The number of servings was not found, so ${DEFAULT_SERVINGS} is assumed. Check it in the editor.`,
  note: 'Calories and macros come from the page (per serving), so treat them as an estimate: link foods to replace them.',
  unusable: 'This page lists nutrition information, but the calories could not be read, so it was not used. Link foods in the editor to get calories and macros.',
  missing: names => `Not listed on the page, so counted as 0: ${names.join(', ')}.`,
};

function emptyResult() { return { name: '', description: '', servings: DEFAULT_SERVINGS, totalTime: null, tags: [], steps: [], ingredients: [], nutrition: null, warnings: [] }; }

function finish(r, servingsKnown, nut) {              // nut: { used, missing } | { unusable: true } | nothing
  const w = [];
  if (!r.name) w.push(W.title);
  if (!r.ingredients.length) w.push(W.ing);
  if (!r.steps.length) w.push(W.steps);
  if (!servingsKnown) w.push(W.serv);
  if (nut && nut.used) { w.push(W.note); if (nut.missing.length) w.push(W.missing(nut.missing)); }
  else if (nut && nut.unusable) w.push(W.unusable);
  r.warnings = w;
  return r;
}

// A line that only labels a group ("Optional Toppings:", "For the sauce:") ends with a colon and has no quantity: it is not an ingredient.
const isLabel = l => l.endsWith(':') && !/\d/.test(l);

/** Split on commas that are outside (...) and [...]; parts are trimmed and empty ones dropped. One pass; an unclosed bracket swallows later commas. */
function commaParts(line) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (c === ',' && depth === 0) { parts.push(line.slice(start, i)); start = i + 1; }
  }
  parts.push(line.slice(start));
  return parts.map(x => x.trim()).filter(Boolean);
}

/**
 * Collects ingredient lines into `out` (capped). Group labels are dropped. After a label, a line with no digit and at least 3 comma parts
 * ("sour cream, salsa, olives, lime wedges") is a list of separate items and is split; the rule lasts until a line with a digit or the next
 * label. Everything else is kept as one line.
 */
function ingredientSink(out) {
  let run = false;
  return (line, dropIt = false) => {                    // dropIt: the caller discards this line (it still counts as a digit line and ends the rule)
    if (!line) return;
    if (isLabel(line)) { run = true; return; }
    if (/\d/.test(line)) { run = false; if (dropIt) return; }
    else if (run) {
      const parts = commaParts(line);
      if (parts.length >= 3) { for (const part of parts) if (out.length < LIM.ingredients) out.push(part.slice(0, LIM.ingredient)); return; }
    }
    if (out.length < LIM.ingredients) out.push(line.slice(0, LIM.ingredient));
  };
}

/** A lone string is split into lines (one ingredient per line); each array element is ONE ingredient, its own line breaks joined. */
function ingredientList(v) {
  const out = [], push = ingredientSink(out);
  if (typeof v === 'string') for (const l of toLines(v, 400000)) push(l);
  else if (Array.isArray(v)) for (let i = 0; i < v.length && out.length < LIM.ingredients; i++) if (typeof v[i] === 'string') push(clean(v[i], 6000));
  return out;
}

function stepList(v) {
  const out = [], seen = new WeakSet(), budget = { n: MAX_NODES };
  const add = s => { const t = stripMark(s); if (t && out.length < LIM.steps) out.push(t.slice(0, LIM.step)); };
  const walk = (x, depth) => {
    if (out.length >= LIM.steps || depth > MAX_DEPTH || budget.n-- <= 0) return;
    if (typeof x === 'string') { for (const l of (depth === 0 ? toLines(x, 400000) : [clean(x, 40000)])) add(l); return; }
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) { for (let i = 0; i < x.length && out.length < LIM.steps; i++) walk(x[i], depth + 1); return; }
    if (own(x, 'itemListElement')) { walk(field(x, 'itemListElement'), depth + 1); return; }
    const t = field(x, 'text'), n = field(x, 'name');
    if (typeof t === 'string' && clean(t)) add(clean(t, 40000)); else if (typeof n === 'string') add(clean(n, 40000));
  };
  walk(v, 0);
  return out;
}

function tagList(node) {
  const raw = [];
  for (const k of ['recipeCategory', 'recipeCuisine']) {
    const v = field(node, k);
    for (const s of Array.isArray(v) ? v.slice(0, 50) : [v]) if (typeof s === 'string') raw.push(...clean(s, 2000).split(','));
  }
  const kw = field(node, 'keywords');
  if (typeof kw === 'string') raw.push(...clean(kw, 20000).split(','));
  else if (Array.isArray(kw)) for (const s of kw.slice(0, 200)) if (typeof s === 'string') raw.push(clean(s, 400));
  const seen = new Set(), out = [];
  for (const t of raw) {
    const tag = t.trim().slice(0, LIM.tag).trim(), key = tag.toLowerCase();
    if (tag && !seen.has(key) && out.length < LIM.tags) { seen.add(key); out.push(tag); }
  }
  return out;
}

/** One schema.org Recipe node -> result. Reads only the node's OWN properties. Anything else gives the empty result with warnings. */
export function importFromJsonLd(node) {
  const r = emptyResult();
  try {
    if (!plain(node)) return finish(r, false, false);
    r.name = clean(field(node, 'name'), 2000).slice(0, LIM.name);
    r.description = clean(field(node, 'description'), 20000).slice(0, LIM.description);
    r.tags = tagList(node);
    r.ingredients = ingredientList(field(node, 'recipeIngredient'));
    r.steps = stepList(field(node, 'recipeInstructions'));
    const nutNode = field(node, 'nutrition');
    const yieldN = servingsFromPage(field(node, 'recipeYield'), plain(nutNode) ? field(nutNode, 'servingSize') : undefined);
    if (yieldN !== null) r.servings = yieldN;
    let total = parseDuration(field(node, 'totalTime'));
    if (total === null) {
      const prep = parseDuration(field(node, 'prepTime')), cook = parseDuration(field(node, 'cookTime'));
      if (prep !== null || cook !== null) { const s = (prep || 0) + (cook || 0); total = s > 0 && s <= MAX_MINUTES ? s : null; }
    }
    r.totalTime = total;
    const got = pageNutrition(nutNode);
    if (got) r.nutrition = got.value;
    const listed = plain(nutNode) ? Object.keys(nutNode).length > 0 : typeof nutNode === 'string' && nutNode.trim() !== '';
    return finish(r, yieldN !== null, got ? { used: true, missing: got.missing } : listed ? { unusable: true } : null);
  } catch { return finish(emptyResult(), false, false); }
}

/** First Recipe on the page, or null (no ld+json Recipe: microdata-only and scripted pages fall back to pasting). */
export function importFromHtml(html) {
  const nodes = extractRecipeJsonLd(html);
  return nodes.length ? importFromJsonLd(nodes[0]) : null;
}

// ---- pasted text -> result ------------------------------------------------------------------------------------

const header = l => {
  const t = l.replace(/^#+\s*/, '').replace(/^[*_]+|[*_]+$/g, '').replace(/\s*:\s*$/, '').trim().toLowerCase();
  if (/^ingredients?$/.test(t)) return 'ing';
  if (/^(?:instructions?|method|directions?|steps?|preparation)$/.test(t)) return 'steps';
  return '';
};

/** Pasted recipe text: a title, optional Serves/time lines, an Ingredients section and an Instructions/Method section. */
export function importFromText(text) {
  const r = emptyResult();
  try {
    if (typeof text !== 'string') return finish(r, false, false);
    const lines = toLines(text, 2000000);
    let mode = 'pre', title = '', servings = null, total = null, prep = null, cook = null;
    const stated = { k: null, p: null, c: null, f: null };
    const addIngredient = ingredientSink(r.ingredients);
    const intro = [];
    for (const raw of lines) {
      const h = header(raw);
      if (h) { mode = h; continue; }
      if (mode === 'pre') {
        const sv = /^(?:serves|servings?|yield)\s*:?\s*(\d.*)$/i.exec(raw);
        if (sv && servings === null) { const n = parseYield(sv[1]); if (n !== null) { servings = n; continue; } }
        const nl = /^(calories?|kcal|protein|carbohydrates?|carbs?|fat)\b\s*:?\s*(.+)$/i.exec(raw);
        if (nl) {                                                   // Calories / Protein / Carbs / Fat lines (per serving) before the first section
          const key = nl[1].toLowerCase();
          const kind = key.startsWith('cal') || key === 'kcal' ? 'k' : key === 'protein' ? 'p' : key.startsWith('carb') ? 'c' : 'f';
          stated[kind] = kind === 'k' ? parseCalories(nl[2]) : parseGrams(nl[2]);
          continue;
        }
        const tm = /^(total(?:\s+time)?|prep(?:aration)?(?:\s+time)?|cook(?:ing)?(?:\s+time)?|ready\s+in)\s*:?\s*(.+)$/i.exec(raw);
        if (tm) {
          const mins = humanMinutes(tm[2]);
          if (mins !== null) { const k = tm[1].toLowerCase(); if (k.startsWith('prep')) prep = mins; else if (k.startsWith('cook')) cook = mins; else total = mins; continue; }
        }
        const t = stripMark(raw.replace(/^#+\s*/, ''));
        if (!title) title = t; else if (intro.length < 50) intro.push(t);
        continue;
      }
      const item = stripMark(raw);
      if (!item) continue;
      if (mode === 'ing') addIngredient(item, item.endsWith(':') && /\d/.test(item));   // a colon line WITH a number is dropped, as before (but it ends a label's list); one without is a group label
      else if (r.steps.length < LIM.steps) r.steps.push(item.slice(0, LIM.step));
    }
    r.name = title.slice(0, LIM.name);
    r.description = intro.join(' ').slice(0, LIM.description);
    if (servings !== null) r.servings = servings;
    r.totalTime = total ?? (prep !== null || cook !== null ? (prep || 0) + (cook || 0) : null);
    let nut = null;
    if (stated.k !== null) {
      r.nutrition = { k: stated.k, p: stated.p ?? 0, c: stated.c ?? 0, f: stated.f ?? 0, per: '' };
      nut = { used: true, missing: MACROS.filter(([key]) => stated[key] === null).map(([, name]) => name) };
    }
    return finish(r, servings !== null, nut);
  } catch { return finish(emptyResult(), false, false); }
}

// ---- result -> app recipe -------------------------------------------------------------------------------------

function validSource(s) {
  if (typeof s !== 'string' || s.length > 500 || s !== s.trim()) return '';
  try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password ? s : ''; } catch { return ''; }
}
const strings = (v, max, cap) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.trim().slice(0, cap)).filter(Boolean).slice(0, max) : []);

/**
 * An app recipe from an import result: a new, unsaved recipe (favorite false, no linked foods). `source` is kept only when it is a
 * plain http(s) link. The caller supplies the id and the time.
 */
export function toRecipe(result, id, now, sourceUrl) {
  const rec = newRecipe(id, now);
  try {
    const r = plain(result) ? result : {};
    rec.name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, LIM.name) : 'Imported recipe';
    rec.description = typeof r.description === 'string' ? r.description.slice(0, LIM.description) : '';
    rec.servings = finite(r.servings) && r.servings >= 0.01 && r.servings <= 1000 ? r.servings : DEFAULT_SERVINGS;
    rec.totalTime = finite(r.totalTime) && r.totalTime > 0 ? r.totalTime : null;
    rec.tags = strings(r.tags, LIM.tags, LIM.tag);
    rec.steps = strings(r.steps, LIM.steps, LIM.step);
    rec.ingredients = strings(r.ingredients, LIM.ingredients, LIM.ingredient).map((line, n) => newIngredient(line, `i${n}_${id}`.slice(0, 80)));
    rec.stated = sanitizeStated(r.nutrition);
    rec.source = validSource(sourceUrl);
  } catch { /* keep the safe defaults */ }
  return rec;
}
