// Turns the TEXT of a nutrition-facts label (from any OCR engine) into numbers for the custom-food form.
// Pure. The result is only ever used to PREFILL a form the user reviews, and `warnings` say what to double-check,
// because OCR misreads digits ("6g" -> "69", "O" for 0) and a wrong calorie count silently corrupts a diary.

const NUM = '(\\d{1,4}(?:[.,]\\d{1,2})?)';

/** Fixes the digit look-alikes OCR produces INSIDE a numeric token (O->0, l/I->1, S->5, B->8). */
function fixDigits(tok) {
  return tok.replace(/[OolI|SsB]/g, ch => ({ O: '0', o: '0', l: '1', I: '1', '|': '1', S: '5', s: '5', B: '8' })[ch]).replace(',', '.');
}
const num = s => { const n = parseFloat(fixDigits(s)); return Number.isFinite(n) ? n : null; };

/** First "<label> <number> g" in the text, label being a RegExp source. Returns number | null. */
function grams(text, label, unit = 'g') {
  const m = text.match(new RegExp(`${label}[^\\n\\d]{0,12}?([\\dOoIlS|]{1,4}(?:[.,][\\dOo]{1,2})?)\\s*${unit}\\b`, 'i'));
  return m ? num(m[1]) : null;
}

/**
 * @param {string} text  raw OCR text
 * @returns {{ servingG:number|null, servingLabel:string, k:number|null, p:number|null, c:number|null, f:number|null,
 *            found:string[], missing:string[], warnings:string[] }}
 *  Values are PER SERVING exactly as printed on the label (the form converts to per-100 g).
 */
export function parseLabel(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const out = { servingG: null, servingLabel: '', k: null, p: null, c: null, f: null, found: [], missing: [], warnings: [] };

  // Serving size: "Serving size 1 bar (50g)" / "Serv. Size: 2 cookies (30 g)" / "Serving Size 100g"
  const ss = t.match(/serv(?:ing|\.)?\s*size\s*[:.]?\s*([^\n]*)/i);
  if (ss) {
    const line = ss[1].trim();
    const g = line.match(/\(?\s*([\dOoIlS|]{1,4}(?:[.,]\d{1,2})?)\s*g\b/i);
    if (g) out.servingG = num(g[1]);
    out.servingLabel = line.replace(/\s*\(?\s*[\dOoIlS|]{1,4}(?:[.,]\d{1,2})?\s*g\)?\s*$/i, '').trim().slice(0, 60);
  }

  // Calories (NOT "Calories from Fat"): "Calories 190", "Calories: 190", "Energy 190 kcal", "190 kcal"
  const cal = t.match(new RegExp(`calories(?!\\s*from)[^\\n\\d]{0,6}?${NUM}`, 'i')) || t.match(new RegExp(`energy[^\\n\\d]{0,6}?${NUM}\\s*kcal`, 'i')) || t.match(new RegExp(`${NUM}\\s*kcal`, 'i'));
  if (cal) out.k = num(cal[1]);
  out.f = grams(t, 'total\\s*fat');
  out.c = grams(t, 'total\\s*carb\\w*');
  out.p = grams(t, 'protein');
  for (const [key, name] of [['k', 'calories'], ['f', 'fat'], ['c', 'carbs'], ['p', 'protein']]) (out[key] == null ? out.missing : out.found).push(name);
  if (out.servingG == null) out.missing.push('serving size (g)');

  // Safety nets: things a correct label can never do, and the energy balance.
  const w = out.servingG;
  // Measured on real OCR runs: "(50g)" is often read as "(509g)" or "(509)". We cannot repair it (249 g is a real serving),
  // so a 3-digit serving weight ending in 9 is flagged, and one with no "g" at all is left empty (see `missing`).
  if (w != null && /^\d{2,}9$/.test(String(w))) out.warnings.push(`Serving size was read as ${w} g. OCR often turns "g" into a 9 (50g becomes 509): please check it.`);
  if (w && out.p != null && out.c != null && out.f != null && out.p + out.c + out.f > w + 0.5) out.warnings.push(`Protein + carbs + fat (${Math.round((out.p + out.c + out.f) * 10) / 10} g) is more than the serving weight (${w} g): check the serving size.`);
  if (w) for (const [key, name] of [['f', 'Fat'], ['c', 'Carbs'], ['p', 'Protein']]) if (out[key] > w + 0.5) out.warnings.push(`${name} (${out[key]} g) is more than the serving weight (${w} g): a digit was probably misread.`);
  if (out.p != null && out.c != null && out.f != null && out.k != null) {
    const est = 4 * out.p + 4 * out.c + 9 * out.f;
    if (out.k > 0 && Math.abs(est - out.k) / out.k > 0.3 && Math.abs(est - out.k) > 40) out.warnings.push(`Calories (${out.k}) don't match the macros (about ${Math.round(est)}): check the numbers (fibre/sugar alcohols can explain some difference).`);
  }
  if (out.k != null && out.k > 2500) out.warnings.push(`Calories ${out.k} per serving looks too high.`);
  if (!out.found.length) out.warnings.push('No nutrition values were recognised. Try a flatter, brighter photo of just the label, or type the numbers.');
  return out;
}
