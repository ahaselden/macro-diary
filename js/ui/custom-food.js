// "Custom" tab of the add-food dialog: enter a food by hand.
import { state, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { foodKey, isBarcode } from '../domain/food.js';
import { esc } from '../core/format.js';
import { add } from './ctx.js';
import { parseLabel } from '../domain/label-parse.js';
import { readImageText } from '../services/ocr.js';
import { showFood } from './amount-picker.js';

export function renderCustom() {
  $('#tabBody').innerHTML = `
    <button class="fit" id="cLabel" style="width:100%">📷 Read a nutrition label from a photo</button>
    <input type="file" id="cFile" accept="image/*" hidden>
    <div class="muted" id="cLabelMsg" style="margin:6px 0 10px" aria-live="polite"></div>
    <label>Name</label><input id="cName" placeholder="e.g. Homemade chili" autocomplete="off">
    <label>Barcode (optional)</label><input id="cBar" inputmode="numeric" placeholder="scan or type the digits" autocomplete="off" value="${esc(add.barcode)}">
    <label>Serving size (g)</label><input id="cSize" type="number" inputmode="decimal" value="100">
    <div class="row"><div><label>Calories</label><input id="cK" type="number" inputmode="decimal"></div><div><label>Protein (g)</label><input id="cP" type="number" inputmode="decimal"></div></div>
    <div class="row"><div><label>Carbs (g)</label><input id="cC" type="number" inputmode="decimal"></div><div><label>Fat (g)</label><input id="cF" type="number" inputmode="decimal"></div></div>
    <p class="muted">Values are per serving above.</p>
    <div class="chk"><input type="checkbox" id="cSave" checked><label style="margin:0;color:inherit" for="cSave">Save to My foods</label></div>
    <button class="primary" style="width:100%" id="cGo">Continue</button>`;
  $('#cLabel').onclick = () => $('#cFile').click();
  $('#cFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) readLabel(f); };
  $('#cGo').onclick = () => {
    const name = $('#cName').value.trim() || 'Quick add', size = +$('#cSize').value || 100, k = +$('#cK').value;
    if (!(k >= 0) || $('#cK').value === '') { toast('Enter calories'); return; }
    const s = 100 / size, food = { name, brand: '', source: 'Custom', servingG: size,
      per100: { k: k * s, p: (+$('#cP').value || 0) * s, c: (+$('#cC').value || 0) * s, f: (+$('#cF').value || 0) * s } };
    food.updatedAt = Date.now();
    const bar = $('#cBar').value.replace(/\s/g, ''); if (isBarcode(bar)) food.barcode = bar; else if (bar) { toast('Barcode must be 8 to 14 digits'); return; }
    add.barcode = '';
    if ($('#cSave').checked) { state.custom = [food, ...state.custom.filter(f => foodKey(f) !== foodKey(food))].slice(0, 100); save(); }
    showFood(food);
  };
}

/** Photo -> OCR text -> parsed numbers -> PREFILL the form. Nothing is saved or accepted automatically. */
async function readLabel(file) {
  const msg = t => { const el = $('#cLabelMsg'); if (el) el.innerHTML = t; };
  if (file.size > 25e6) { msg('That photo is too large (max 25 MB).'); return; }
  try {
    const text = await readImageText(file, p => msg(`${esc(p.status)}… ${p.progress ? Math.round(p.progress * 100) + '%' : ''}${p.status.startsWith('load') ? ' (first use downloads about 7 MB)' : ''}`));
    if (!$('#cK')) return;                                      // the dialog was closed while reading
    const r = parseLabel(text);
    const put = (id, v) => { const el = $(id); if (v != null) { el.value = String(Math.round(v * 100) / 100); el.setAttribute('data-ocr', ''); el.addEventListener('input', () => el.removeAttribute('data-ocr'), { once: true }); } };
    put('#cSize', r.servingG); put('#cK', r.k); put('#cP', r.p); put('#cC', r.c); put('#cF', r.f);
    if (r.servingLabel && !$('#cName').value) $('#cName').placeholder = r.servingLabel;
    const lines = [r.found.length ? `Filled in: ${esc(r.found.join(', '))}. <b>Check every number against the label before continuing.</b>` : '',
      r.missing.length ? `Not found, please type: ${esc(r.missing.join(', '))}.` : '', ...r.warnings.map(w => '⚠ ' + esc(w))].filter(Boolean);
    msg(lines.join('<br>'));
  } catch (err) { msg('Could not read the photo: ' + esc(err.message || err) + '. You can still type the numbers.'); }
}
