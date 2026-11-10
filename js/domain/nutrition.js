// Calories/macros for logged entries. Pure. An entry stores per-100g values + grams eaten.
export const entryMacros = e => { const f = e.grams / 100; return { k: e.per100.k * f, p: e.per100.p * f, c: e.per100.c * f, f: e.per100.f * f }; };
export const totals = list => list.reduce((t, e) => { const m = entryMacros(e); t.k += m.k; t.p += m.p; t.c += m.c; t.f += m.f; return t; }, { k: 0, p: 0, c: 0, f: 0 });
