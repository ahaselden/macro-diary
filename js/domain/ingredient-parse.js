// Free-text ingredient line -> { raw, name, qty, unit, prep }. Pure; never throws.
// Behaviour ported from MealPlannerPC (IngredientParser / IngredientParsingUtils / IngredientNormalization):
// leading quantity (integer, decimal, fraction, mixed number, unicode fraction), unit lookup via the token map,
// parenthesised sizes dropped from the name, brands / packaging / descriptors stripped from the name, synonym map last.
// Deviations (all deliberate):
//  - RANGES ("2-3", "2 to 3", "1 1/2 to 2"): the UPPER bound is used (so shopping lists never come up short).
//  - Stripped descriptors are not thrown away: preparation words and comma/parenthesis text go to `prep`.
//  - Sizes in parentheses "(14 oz)" and "15-ounce can" are kept in `prep` as "14 oz" (C# discarded them); they let
//    resolveGrams size a can.
//  - Names are NOT singularised (C# used Humanizer): "tomatoes" stays "tomatoes" so food search still works.
//  - 'light', 'dry', 'hot', 'cold' stay in the name ("light brown sugar", "hot sauce"); the C# stripped them.
//  - A size adjective directly before a count word ("2 large eggs") stays in the name ("large eggs"), as in the C#;
//    before a container unit ("1 large can tomatoes") it goes to prep.
//  - Count/unitless -> unit '' (C# used "each"/"count"); canonical units are 'cup', 'lb', ... (see ingredient-tokens.js).
//  - "a/an/one..twelve" before a unit/size word read as a quantity; "pinch/dash/handful of X" with no number -> qty 1.
//  - "juice of 1 lemon" -> qty 1, name "lemon juice" (same for "zest of").
import {
  UNIT_MAP, APPROX_UNITS, SYNONYMS, MULTI_PHRASES, BRANDS, PACKAGING, IDENTITY_DESCRIPTORS, NOISE_WORDS, PREP_WORDS,
  SIZE_WORDS, NUMBER_WORDS, UNICODE_FRACTIONS,
} from './ingredient-tokens.js';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byLen = list => [...list].sort((a, b) => b.length - a.length);
const wordRe = (p, flags = 'g') => new RegExp(`(?<![\\p{L}\\p{N}])${esc(p)}(?![\\p{L}\\p{N}])`, flags + 'u');

const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)`;
const QTY_RE = new RegExp(String.raw`^(${NUM})(?:(?:\s*-\s*|\s+to\s+)(${NUM}))?`);
const CONTAINERS = 'cans?|tins?|packages?|pkgs?|packets?|jars?|bottles?|bags?|boxe?s?|containers?';
const SIZE_PREFIX_RE = new RegExp(String.raw`^(\d+(?:\.\d+)?)\s*-?\s*(ounces?|oz|pounds?|lbs?|grams?|g|ml|kg)\.?\s+(?=(?:${CONTAINERS})(?![\p{L}]))`, 'u');
const CONTAINER_UNITS = new Set(['can', 'package', 'bottle', 'jar', 'bag', 'box', 'container']);

/** Canonical unit for a token, or undefined when it is not a unit ('' = known count word such as "each"). */
function lookupUnit(token) {
  let t = String(token ?? '').toLowerCase().replace(/\./g, '').replace(/[,;:]+$/, '').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  if (Object.hasOwn(UNIT_MAP, t)) return UNIT_MAP[t];
  if (t.endsWith('s') && !t.endsWith('ss') && Object.hasOwn(UNIT_MAP, t.slice(0, -1))) return UNIT_MAP[t.slice(0, -1)];
  return undefined;
}

/** Canonical unit token ('cup', 'tbsp', 'g', 'lb', 'fl oz', 'clove', ...) or '' when unknown / a plain count. */
export function normalizeUnit(token) { try { return lookupUnit(token) ?? ''; } catch { return ''; } }

function numVal(s) {
  const parts = s.trim().split(/\s+/);
  let t = 0;
  for (const p of parts) {
    if (p.includes('/')) { const [a, b] = p.split('/').map(Number); if (!(b > 0)) return NaN; t += a / b; } else t += Number(p);
  }
  return t;
}

function normalizeText(s) {
  s = String(s ?? '').replace(/^﻿/, '').replace(/[   ]/g, ' ').replace(/[–—]/g, '-');
  s = s.replace(/(\d)\s*([¼-¾⅐-⅞])/g, '$1 $2');
  s = s.replace(/[¼-¾⅐-⅞]/g, c => ' ' + UNICODE_FRACTIONS[c] + ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const MULTI = byLen(MULTI_PHRASES);
const BRAND_RES = BRANDS.map(b => wordRe(b));
const PREP = byLen(PREP_WORDS).map(p => [p, wordRe(p)]);
const NOISE = NOISE_WORDS.filter(w => !IDENTITY_DESCRIPTORS.includes(w)).map(w => wordRe(w));
const SIZE_RE = new RegExp(`^(${SIZE_WORDS.map(esc).join('|')})$`);

function cleanName(s) {
  s = s.replace(/[^\p{L}\p{N}\s'&-]/gu, ' ').replace(/\s+/g, ' ').trim();
  let prev;
  do { prev = s; s = s.replace(/^(?:and|or|of|&|-)\s+/, '').replace(/\s+(?:and|or|of|&|-)$/, '').replace(/^-+|-+$/g, '').trim(); } while (s !== prev);
  return s;
}

function parseCore(input) {
  const raw = String(input ?? '');
  const text = normalizeText(raw);
  const out = { raw, name: '', qty: null, unit: '', prep: '' };
  if (!text) return out;

  const jz = text.match(/^(?:grated\s+)?(juice|zest)\s+of\s+(.+)$/i);
  if (jz) {
    const r = parseCore(jz[2]);
    return { raw, name: cleanName(`${r.name} ${jz[1].toLowerCase()}`), qty: r.qty, unit: r.unit, prep: r.prep };
  }

  let rest = text, qty = null;
  const qm = rest.match(QTY_RE);
  if (qm) {
    const v = numVal(qm[2] || qm[1]);   // upper bound of a range
    if (Number.isFinite(v)) { qty = v; rest = rest.slice(qm[0].length).replace(/^[-,.\s]+/, ''); }
  } else {
    const wm = rest.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?=\S)/i);
    if (wm) {
      const w = wm[1].toLowerCase(), after = rest.slice(wm[0].length), t1 = after.split(' ')[0].toLowerCase();
      const unitOrSize = lookupUnit(t1) !== undefined || SIZE_RE.test(t1);
      if (w in NUMBER_WORDS || unitOrSize) { qty = NUMBER_WORDS[w] ?? 1; rest = after; }
    }
  }

  const prep = [];
  rest = rest.replace(/\(([^()]*)\)/g, (_, c) => { if (c.trim()) prep.push(c.trim().toLowerCase()); return ' '; }).replace(/\s+/g, ' ').trim();
  rest = rest.toLowerCase();
  for (const p of MULTI) rest = rest.replace(wordRe(p), () => { prep.push(p.replace(/,/g, '')); return ' '; });

  // comma tail = preparation note
  let head = rest;
  const ci = rest.indexOf(',');
  if (ci >= 0) { head = rest.slice(0, ci); const tail = rest.slice(ci + 1).replace(/[,\s]+/g, ' ').trim(); if (tail) prep.push(tail); }
  head = head.replace(/\s+/g, ' ').trim();

  // "15-ounce can" style size
  const sp = head.match(SIZE_PREFIX_RE);
  if (sp) { prep.push(`${sp[1]} ${sp[2].replace(/s$/, '')}`); head = head.slice(sp[0].length); }

  // unit
  let unit = '';
  const tokens = head.split(' ').filter(Boolean);
  const take = n => { head = tokens.slice(n).join(' '); };
  if (tokens.length) {
    const two = tokens.length > 1 ? lookupUnit(`${tokens[0]} ${tokens[1]}`) : undefined;
    const u0 = lookupUnit(tokens[0]);
    if (two !== undefined && /^fl|^fluid/.test(tokens[0])) { unit = two; take(2); }
    else if (SIZE_RE.test(tokens[0]) && tokens.length > 1 && CONTAINER_UNITS.has(lookupUnit(tokens[1]) ?? '#')) {
      prep.push(tokens[0]); unit = lookupUnit(tokens[1]); take(2);
    } else if (u0 !== undefined && (qty !== null || ['pinch', 'dash', 'handful'].includes(u0))) {
      unit = u0; take(1);
      if (qty === null) qty = 1;
    }
  }
  head = head.replace(/^of\s+/, '');

  if (unit === 'rack') { qty = qty === null ? null : qty * APPROX_UNITS.rack.factor; unit = APPROX_UNITS.rack.toUnit; }

  // name cleanup
  let name = head;
  for (const re of BRAND_RES) name = name.replace(re, ' ');
  for (const [p, re] of PREP) name = name.replace(re, () => { prep.push(p); return ' '; });
  for (const re of NOISE) name = name.replace(re, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  let toks = name.split(' ').filter(Boolean);
  while (toks.length && PACKAGING.includes(toks[0]) && toks.length > 1) toks.shift();   // leading packaging noise
  name = cleanName(toks.join(' '));
  if (Object.hasOwn(SYNONYMS, name)) name = SYNONYMS[name];
  if (!name) name = cleanName(head) || (qty === null ? text.toLowerCase() : '');

  const seen = new Set();
  const preps = prep.map(p => p.replace(/\s+/g, ' ').trim()).filter(p => p && !seen.has(p) && seen.add(p));
  return { raw, name, qty, unit, prep: preps.join(', ') };
}

/** @returns {{raw:string,name:string,qty:number|null,unit:string,prep:string}} */
export function parseIngredient(text) {
  try { return parseCore(text); }
  catch { const raw = typeof text === 'string' ? text : ''; return { raw, name: raw.trim().toLowerCase(), qty: null, unit: '', prep: '' }; }
}

// ---- display -------------------------------------------------------------------------------------------------

const FRACS = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 6], [5, 6], [1, 8], [3, 8], [5, 8], [7, 8]];

/** 1.5 -> "1 1/2", 0.75 -> "3/4", 0.3333 -> "1/3", 2 -> "2"; anything not near a nice fraction -> up to 2 decimals. '' for null/NaN/negative. */
export function formatQty(q) {
  if (q === null || q === undefined || q === '' || !Number.isFinite(+q) || +q < 0) return '';
  q = +q;
  let whole = Math.floor(q + 1e-9), f = q - whole;
  if (f < 0.02) return String(whole);
  if (f > 0.98) return String(whole + 1);
  let best = null, bd = 0.02;
  for (const [n, d] of FRACS) { const diff = Math.abs(f - n / d); if (diff < bd) { bd = diff; best = `${n}/${d}`; } }
  if (best) return whole ? `${whole} ${best}` : best;
  return String(Math.round(q * 100) / 100);
}
