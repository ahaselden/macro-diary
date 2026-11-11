// Barcodes read from a photo: validation and picking the product to offer. Pure: no DOM, storage or network; never throws.
import { sameBarcode } from './food.js';
const plain = v => { if (!v || typeof v !== 'object' || Array.isArray(v)) return false; const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };

/** The code as digits when it is a real retail code (EAN-8, UPC-A, EAN-13, GTIN-14) with a correct check digit, else ''. Leading zeros are kept. */
export function normalizeBarcode(text) {
  try {
    if (typeof text !== 'string') return '';
    const s = text.trim();
    if (!/^(?:\d{8}|\d{12,14})$/.test(s)) return '';
    let sum = 0;
    for (let i = s.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += +s[i] * w;      // weights 3,1,3,1... counted from the digit next to the check digit
    return (10 - (sum % 10)) % 10 === +s[s.length - 1] ? s : '';
  } catch { return ''; }
}

/** The first valid code in a list (junk entries are skipped), or ''. */
export function pickBarcode(list) {
  try {
    if (!Array.isArray(list)) return '';
    for (let i = 0; i < list.length; i++) { const c = normalizeBarcode(list[i]); if (c) return c; }
    return '';
  } catch { return ''; }
}

/** The first search result that can be shown as the product for a scanned code (a name and calories per 100 g), else null. Returns the result itself. */
export function barcodeOffer(code, results) {
  try {
    if (!Array.isArray(results)) return null;
    for (let i = 0; i < results.length; i++) {
      try {
        const r = results[i];
        if (!plain(r) || !Object.hasOwn(r, 'name') || !Object.hasOwn(r, 'per100')) continue;
        const per = r.per100;
        if (typeof r.name !== 'string' || !r.name.trim() || !plain(per) || !Object.hasOwn(per, 'k')) continue;
        if (typeof per.k === 'number' && Number.isFinite(per.k) && per.k >= 0) return r;
      } catch { /* a hostile entry: skip it */ }
    }
    return null;
  } catch { return null; }
}

/** What to search USDA for: the digits with leading zeros stripped while longer than 12 (USDA stores UPC-A as 12 digits), then the code as given. [] unless 8-14 digits. */
export function usdaBarcodeQueries(code) {
  try {
    if (typeof code !== 'string') return [];
    const s = code.trim();
    if (!/^\d{8,14}$/.test(s)) return [];
    let t = s;
    while (t.length > 12 && t[0] === '0') t = t.slice(1);
    return t === s ? [s] : [t, s];
  } catch { return []; }
}

/** The first RAW USDA food whose own gtinUpc is the same product as code, else null. Returns the record itself. */
export function usdaBarcodeMatch(code, foods) {
  try {
    if (typeof code !== 'string' || !Array.isArray(foods)) return null;
    for (let i = 0; i < foods.length; i++) {
      try {
        const f = foods[i];
        if (!plain(f) || !Object.hasOwn(f, 'gtinUpc')) continue;
        const g = f.gtinUpc;
        if (typeof g === 'string' && g.length <= 40 && sameBarcode(g.trim(), code.trim())) return f;
      } catch { /* a hostile record: skip it */ }
    }
    return null;
  } catch { return null; }
}
