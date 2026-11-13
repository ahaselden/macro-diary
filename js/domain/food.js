// Identity of a food across sources/recents/custom foods/saved measures. Pure.
export const foodKey = f => [f.name, f.brand, f.source].join('|');

/** A scanned/typed product code: 8-14 digits (EAN-8, UPC-A/E, EAN-13, GTIN-14). */
export const isBarcode = q => /^\d{8,14}$/.test(String(q || '').trim());

/**
 * Two codes name the same product when they differ only by leading zeros
 * (a UPC-A is an EAN-13 with a leading 0, and cameras report either form). Pure.
 */
export const sameBarcode = (a, b) => {
  const x = String(a || '').replace(/^0+/, ''), y = String(b || '').replace(/^0+/, '');
  return x.length >= 6 && x === y;
};

/**
 * Does saving custom food `neu` replace the saved custom food `old`? Same name/brand/source is not enough once barcodes exist:
 * two different products (different barcodes) may share a name, and a food typed without a barcode must not erase one that has it. Pure.
 */
export const replacesCustom = (old, neu) => {
  if (foodKey(old) === foodKey(neu) || (neu.barcode && sameBarcode(old.barcode, neu.barcode))) {
    if (neu.barcode && old.barcode) return sameBarcode(old.barcode, neu.barcode);   // both coded: only the same product
    return !old.barcode;                                                            // old has a code and neu has none -> keep old
  }
  return false;
};

/** "148 kcal per 1 scoop (37 g)": the calories in the food's serving, or '' when it has no usable serving. Plain text (the UI escapes it). */
export function servingSummary(food) {
  try {
    if (!food || typeof food !== 'object' || Array.isArray(food)) return '';
    const g = food.servingG, k = food.per100 && typeof food.per100 === 'object' ? Number(food.per100.k) : NaN;
    if (typeof g !== 'number' || !Number.isFinite(g) || !(g > 0) || !Number.isFinite(k)) return '';
    const raw = typeof food.servingLabel === 'string' ? food.servingLabel.slice(0, 300).replace(/<\/?[a-zA-Z!][^<>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    return `${Math.round(k * g / 100)} kcal per ${raw || Math.round(g) + ' g'}`;
  } catch { return ''; }
}

/** A food or entry name made safe to store: trimmed, whitespace collapsed, capped (default 100), '' for anything that is not a usable string. Plain text (the UI escapes it). */
export function cleanFoodName(raw, max = 100) {
  try {
    if (typeof raw !== 'string') return '';
    return raw.slice(0, 4 * max + 200).replace(/\s+/g, ' ').trim().slice(0, max).trimEnd();
  } catch { return ''; }
}

const isOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const num = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Edit a saved custom food in place (state.custom). `key` is foodKey() of the food; `patch` may hold name, brand, servingG, barcode ('' removes it)
 * and k, p, c, f (per SERVING, stored per 100 g). Stamps updatedAt = now and moves saved measures to the new key on a rename.
 * Returns the food, or null with `state` untouched for: unknown key, empty name, bad numbers or barcode, a collision with a DIFFERENT saved food, unusable input.
 */
export function updateCustomFood(state, key, patch, now) {
  try {
    if (!state || typeof state !== 'object' || !Array.isArray(state.custom) || typeof key !== 'string' || !num(now)) return null;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
    const hits = state.custom.reduce((a, f, j) => (f && typeof f === 'object' && foodKey(f) === key ? [...a, j] : a), []);
    if (hits.length !== 1) return null;                 // unknown key, or two saved foods share it (different barcodes): refuse rather than edit the wrong one
    const i = hits[0];
    const old = state.custom[i], has = k => isOwn(patch, k) && patch[k] !== undefined;
    const next = { name: old.name, brand: old.brand || '', servingG: old.servingG, per100: { ...old.per100 }, barcode: old.barcode };
    if (has('name')) { next.name = cleanFoodName(patch.name); if (!next.name) return null; }
    if (has('brand')) { if (typeof patch.brand !== 'string') return null; next.brand = cleanFoodName(patch.brand); }
    if (has('servingG')) { if (!num(patch.servingG) || !(patch.servingG > 0)) return null; next.servingG = patch.servingG; }
    if (has('barcode')) {
      if (typeof patch.barcode !== 'string') return null;
      if (patch.barcode === '') next.barcode = undefined; else if (isBarcode(patch.barcode) && patch.barcode === patch.barcode.trim()) next.barcode = patch.barcode; else return null;
    }
    const serving = num(next.servingG) && next.servingG > 0 ? next.servingG : 100;
    for (const n of ['k', 'p', 'c', 'f']) if (has(n)) {
      if (!num(patch[n]) || patch[n] < 0) return null;
      next.per100[n] = patch[n] * 100 / serving;
    }
    if (!['k', 'p', 'c', 'f'].every(n => Number.isFinite(next.per100[n]))) return null;
    const cand = { name: next.name, brand: next.brand, source: old.source, barcode: next.barcode };
    if (state.custom.some((f, j) => j !== i && f && typeof f === 'object' && replacesCustom(f, cand))) return null;   // would be the same product as another saved food

    const newKey = foodKey({ name: next.name, brand: next.brand, source: old.source });
    if (newKey !== key && state.measures && typeof state.measures === 'object' && isOwn(state.measures, key)) {
      const moved = Array.isArray(state.measures[key]) ? state.measures[key] : [];
      const there = isOwn(state.measures, newKey) && Array.isArray(state.measures[newKey]) ? state.measures[newKey] : [];
      state.measures[newKey] = [...there, ...moved.filter(m => !there.some(t => t && m && t.label === m.label))];
      delete state.measures[key];
    }
    old.name = next.name; old.brand = next.brand; old.per100 = next.per100; old.updatedAt = now;
    if (has('servingG')) old.servingG = next.servingG;
    if (has('barcode')) { if (next.barcode) old.barcode = next.barcode; else delete old.barcode; }
    return old;
  } catch { return null; }
}
