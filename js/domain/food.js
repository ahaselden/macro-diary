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
