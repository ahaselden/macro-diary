// "Custom" tab of the add-food dialog: enter a food by hand, or prefill it from a photo of a nutrition label.
import { state, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { isBarcode, replacesCustom } from '../domain/food.js';
import { esc } from '../core/format.js';
import { add } from './ctx.js';
import { parseLabel } from '../domain/label-parse.js';
import { readImageText } from '../services/ocr.js';
import { showFood } from './amount-picker.js';

const NUMBER_FIELDS = ['#cSize', '#cK', '#cP', '#cC', '#cF'];
let ocrRun = 0;   // bumped on every render and every photo: a result from an older run is ignored

export function renderCustom() {
  ocrRun++;
  $('#tabBody').innerHTML = `
    <div class="muted">Fill this in from a nutrition label:</div>
    <div class="row" style="margin-top:6px"><button id="cCam">📷 Take a photo</button><button id="cPick">🖼 Choose an image</button></div>
    <input type="file" id="cFileCam" accept="image/*" capture="environment" hidden>
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
  // anything the user types is theirs: a later photo must not overwrite it, and it is no longer "from the photo"
  for (const id of NUMBER_FIELDS) $(id).addEventListener('input', e => { e.target.removeAttribute('data-ocr'); e.target.dataset.user = '1'; });
  // "Take a photo" opens the camera on phones/tablets (capture); on a PC browser it falls back to the normal file picker.
  $('#cCam').onclick = () => $('#cFileCam').click();
  $('#cPick').onclick = () => $('#cFile').click();
  for (const id of ['#cFile', '#cFileCam']) $(id).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) readLabel(f); };
  $('#cGo').onclick = () => {
    const bar = $('#cBar').value.replace(/\s/g, '');
    if (bar && !isBarcode(bar)) { toast('Barcode must be 8 to 14 digits'); return; }
    const typed = $('#cName').value.trim();
    if (bar && !typed) { toast('Give this product a name so it can be found by its barcode'); return; }
    const name = typed || 'Quick add', size = +$('#cSize').value || 100, k = +$('#cK').value;
    if (!(k >= 0) || $('#cK').value === '') { toast('Enter calories'); return; }
    const s = 100 / size, food = { name, brand: '', source: 'Custom', servingG: size,
      per100: { k: k * s, p: (+$('#cP').value || 0) * s, c: (+$('#cC').value || 0) * s, f: (+$('#cF').value || 0) * s } };
    food.updatedAt = Date.now();
    if (bar) food.barcode = bar;
    add.barcode = '';
    if ($('#cSave').checked) { state.custom = [food, ...state.custom.filter(f => !replacesCustom(f, food))].slice(0, 100); save(); }
    showFood(food);
  };
}

/** Photo -> OCR text -> parsed numbers -> PREFILL the form. Nothing is saved or accepted automatically. */
async function readLabel(file) {
  const run = ++ocrRun, setBusy = on => { for (const id of ['#cCam', '#cPick']) { const b = $(id); if (b) b.disabled = on; } };
  const msg = t => { const el = $('#cLabelMsg'); if (el && run === ocrRun) el.innerHTML = t; };
  if (file.size > 25e6) { msg('That photo is too large (max 25 MB).'); return; }
  setBusy(true);
  try {
    const text = await readImageText(file, p => {
      const status = String(p.status || '');
      msg(`${esc(status)}… ${p.progress ? Math.round(p.progress * 100) + '%' : ''}${status.startsWith('load') ? ' (first use downloads about 7 MB)' : ''}`);
    });
    if (run !== ocrRun || !$('#cK')) return;                    // the tab was re-rendered or the dialog closed while reading
    const r = parseLabel(text), kept = [];
    for (const id of NUMBER_FIELDS) { const el = $(id); if (el.dataset.user !== '1') { el.removeAttribute('data-ocr'); if (el.hasAttribute('data-ocr-set')) el.value = id === '#cSize' ? '100' : ''; el.removeAttribute('data-ocr-set'); } }
    const put = (id, v, label) => {
      const el = $(id); if (v == null) return;
      if (el.dataset.user === '1') { kept.push(label); return; }  // never overwrite what the user typed
      el.value = String(Math.round(v * 100) / 100); el.setAttribute('data-ocr', ''); el.setAttribute('data-ocr-set', '');
    };
    put('#cSize', r.servingG, 'serving size'); put('#cK', r.k, 'calories'); put('#cP', r.p, 'protein'); put('#cC', r.c, 'carbs'); put('#cF', r.f, 'fat');
    if (r.servingLabel && !$('#cName').value) $('#cName').placeholder = r.servingLabel;
    const lines = [r.found.length ? `Filled in: ${esc(r.found.join(', '))}. <b>Check every number against the label before continuing.</b>` : '',
      kept.length ? `Kept what you typed for: ${esc(kept.join(', '))}.` : '',
      r.missing.length ? `Not found, please type: ${esc(r.missing.join(', '))}.` : '', ...r.warnings.map(w => '⚠ ' + esc(w))].filter(Boolean);
    msg(lines.join('<br>'));
  } catch (err) { msg('Could not read the photo: ' + esc(err.message || err) + '. You can still type the numbers.'); }
  finally { setBusy(false); }
}
