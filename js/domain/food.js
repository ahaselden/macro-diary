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
