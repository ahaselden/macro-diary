// "Custom" tab of the add-food dialog: enter a food by hand, or prefill it from a photo of a nutrition label.
import { state, save } from '../core/store.js';
import { $, toast, head } from '../core/dom.js';
import { isBarcode, replacesCustom, servingSummary, cleanFoodName, updateCustomFood, addCustomFood, makeFoodId } from '../domain/food.js';
import { normalizeBarcode, barcodeOffer } from '../domain/barcode.js';
import { esc, rd } from '../core/format.js';
import { add } from './ctx.js';
import { parseLabel } from '../domain/label-parse.js';
import { readImageText } from '../services/ocr.js';
import { decodeImageBarcode } from '../services/barcode.js';
import { searchAll } from '../services/foods.js';
import { showFood } from './amount-picker.js';

const NUMBER_FIELDS = ['#cSize', '#cK', '#cP', '#cC', '#cF'];
let ocrRun = 0;   // bumped on every render and every photo: a result from an older run is ignored

/** Open the custom-food form prefilled with a saved food, to edit it in place (past diary entries are not touched). */
export function editCustomFood(food) {
  renderCustom(food);
  head('Edit food', true);
  const seg = document.querySelector('#dBody .seg'), photo = $('#cCam') && $('#cCam').parentElement;   // editing is not adding: no Search/Custom switch, no label photo
  for (const el of [seg, photo, photo && photo.previousElementSibling]) if (el) el.style.display = 'none';
}

export function renderCustom(editing) {
  ocrRun++;
  $('#tabBody').innerHTML = `
    <div class="muted">Fill this in from a nutrition label:</div>
    <div class="row" style="margin-top:6px"><button id="cCam"><span aria-hidden="true">📷</span> Take a photo</button><button id="cPick"><span aria-hidden="true">🖼</span> Choose an image</button></div>
    <input type="file" id="cFileCam" accept="image/*" capture="environment" hidden>
    <input type="file" id="cFile" accept="image/*" hidden>
    <div class="muted" id="cLabelMsg" style="margin:6px 0 10px" aria-live="polite"></div>
    <div id="cCodeMsg" class="muted" style="margin:0 0 10px" aria-live="polite"></div>
    <label>Name</label><input id="cName" placeholder="e.g. Homemade chili" autocomplete="off">
    <label>Barcode (optional)</label><input id="cBar" inputmode="numeric" placeholder="scan or type the digits" autocomplete="off" value="${esc(add.barcode)}">
    <label>Serving size (g)</label><input id="cSize" type="number" inputmode="decimal" value="100">
    <div class="row"><div><label>Calories</label><input id="cK" type="number" inputmode="decimal"></div><div><label>Protein (g)</label><input id="cP" type="number" inputmode="decimal"></div></div>
    <div class="row"><div><label>Carbs (g)</label><input id="cC" type="number" inputmode="decimal"></div><div><label>Fat (g)</label><input id="cF" type="number" inputmode="decimal"></div></div>
    <p class="muted">Values are per serving above.</p>
    ${editing ? '<p class="muted">Past diary entries keep the name and numbers they were logged with.</p>' : '<div class="chk"><input type="checkbox" id="cSave" checked><label style="margin:0;color:inherit" for="cSave">Save to My foods</label></div>'}
    <button class="primary" style="width:100%" id="cGo">${editing ? 'Save changes' : 'Continue'}</button>`;
  if (editing) {
    const size = Number(editing.servingG) > 0 ? Number(editing.servingG) : 100, per = n => String(Math.round((Number(editing.per100 && editing.per100[n]) || 0) * size) / 100);
    $('#cName').value = editing.name || ''; $('#cBar').value = editing.barcode || ''; $('#cSize').value = String(size);
    $('#cK').value = per('k'); $('#cP').value = per('p'); $('#cC').value = per('c'); $('#cF').value = per('f');
  }
  const was = editing ? { name: $('#cName').value, bar: $('#cBar').value, size: $('#cSize').value, k: $('#cK').value, p: $('#cP').value, c: $('#cC').value, f: $('#cF').value } : null;
  // anything the user types is theirs: a later photo must not overwrite it, and it is no longer "from the photo"
  for (const id of NUMBER_FIELDS) $(id).addEventListener('input', e => { e.target.removeAttribute('data-ocr'); e.target.dataset.user = '1'; });
  $('#cBar').addEventListener('input', e => { e.target.dataset.user = '1'; });         // a barcode the user typed is theirs: a photo must not replace it
  // "Take a photo" opens the camera on phones/tablets (capture); on a PC browser it falls back to the normal file picker.
  $('#cCam').onclick = () => $('#cFileCam').click();
  $('#cPick').onclick = () => $('#cFile').click();
  for (const id of ['#cFile', '#cFileCam']) $(id).onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) readLabel(f); };
  $('#cGo').onclick = () => {
    const bar = $('#cBar').value.replace(/\s/g, '');
    if (bar && !isBarcode(bar)) { toast('Barcode must be 8 to 14 digits'); return; }
    const name = cleanFoodName($('#cName').value);
    if (!name) { toast('Enter a name'); return; }
    const size = +$('#cSize').value || 100, k = +$('#cK').value;
    if (!(k >= 0) || $('#cK').value === '') { toast('Enter calories'); return; }
    if (editing) {
      const patch = {};                                          // only what the user changed, so untouched numbers are not re-rounded
      if ($('#cName').value !== was.name) patch.name = name;
      if ($('#cBar').value !== was.bar) patch.barcode = bar;
      if ($('#cSize').value !== was.size) patch.servingG = size;
      for (const [id, n, v] of [['#cK', 'k', k], ['#cP', 'p', +$('#cP').value || 0], ['#cC', 'c', +$('#cC').value || 0], ['#cF', 'f', +$('#cF').value || 0]]) if ($(id).value !== was[n]) patch[n] = v;
      const clash = state.custom.some(f => f.id !== editing.id && replacesCustom(f, { name, brand: editing.brand || '', source: editing.source, barcode: bar || undefined }));
      const done = updateCustomFood(state, editing.id, patch, Date.now());
      if (!done) { toast(clash ? 'You already have a food with that name' : "Couldn't save the changes"); return; }
      save(); toast('Food updated'); add.tab = 'search'; add.onFoodEdited && add.onFoodEdited();
      return;
    }
    const s = 100 / size, food = { name, brand: '', source: 'Custom', servingG: size,
      per100: { k: k * s, p: (+$('#cP').value || 0) * s, c: (+$('#cC').value || 0) * s, f: (+$('#cF').value || 0) * s } };
    if (bar) food.barcode = bar;
    add.barcode = '';
    let shown = food;
    if ($('#cSave').checked) {
      const made = addCustomFood(state, food, Date.now(), () => makeFoodId(Date.now(), Math.random));   // replaces the same product, keeping its id and so its measures
      if (made) { save(); shown = made; } else toast("Couldn't save this food to My foods");   // practically unreachable (an id clash); say so instead of staying silent
    }
    showFood(shown);
  };
}

/** Photo -> OCR text -> parsed numbers -> PREFILL the form. Nothing is saved or accepted automatically. */
async function readLabel(file) {
  const run = ++ocrRun, setBusy = on => { for (const id of ['#cCam', '#cPick']) { const b = $(id); if (b) b.disabled = on; } };
  const msg = t => { const el = $('#cLabelMsg'); if (el && run === ocrRun) el.innerHTML = t; };
  if ($('#cCodeMsg')) $('#cCodeMsg').innerHTML = '';                 // an offer from an earlier photo must not stay next to this photo's result
  if (file.size > 25e6) { msg('That photo is too large (max 25 MB).'); return; }
  setBusy(true);
  decodeImageBarcode(file).then(code => { if (code && run === ocrRun) return barcodeFromPhoto(code, run); }).catch(() => {});   // runs beside the label reading, never in front of it
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
  finally { if (run === ocrRun) setBusy(false); }   // a stale run must not re-enable the buttons while a newer read is in progress
}

/** A barcode was found in the photo: fill the Barcode field if the user has not typed one, look the code up like a scan, and OFFER the product (the user confirms). */
async function barcodeFromPhoto(code, run) {
  const out = t => { const el = $('#cCodeMsg'); if (el && run === ocrRun) el.innerHTML = t; };
  code = normalizeBarcode(code); if (!code || run !== ocrRun || !$('#cBar')) return;
  if (!$('#cBar').dataset.user && !$('#cBar').value) $('#cBar').value = code;           // never replace what the user typed
  if (!state.useOFF && !state.useUSDA) { out(`Barcode ${esc(code)} found in the photo. Turn on a food database in Settings to look it up.`); return; }
  out(`Barcode ${esc(code)} found in the photo. Looking it up…`);
  let res;
  try { res = await searchAll(code, { useUSDA: state.useUSDA, useOFF: state.useOFF, apiKey: state.apiKey }); }
  catch { if (run === ocrRun) out(`Barcode ${esc(code)} found in the photo.`); return; }
  if (run !== ocrRun || !$('#cCodeMsg')) return;                                          // the tab was re-rendered or a newer photo was chosen
  const offer = barcodeOffer(code, res && res.results);
  if (!offer) { const why = res && Array.isArray(res.errors) && res.errors.length ? ' The lookup failed: ' + esc(res.errors.join(' · ')) : ' No product was found for it.'; out(`Barcode ${esc(code)} found in the photo.` + why); return; }
  const sum = servingSummary(offer) || `${rd(offer.per100.k)} kcal /100g`;
  out(`Barcode ${esc(code)} found: <b>${esc(offer.name)}</b>${offer.brand ? ' · ' + esc(offer.brand) : ''} · ${esc(sum)}<br><button type="button" id="cUseBar" style="min-height:44px">Use this product</button>`);
  $('#cUseBar').onclick = () => { if (add.searchCode) add.searchCode(code); };              // the Search tab with this code, exactly like a scan
}
