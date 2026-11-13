// Add/edit-food dialog: tabs (Search / Custom), local + database search, barcode scan.
import { state } from '../core/store.js';
import { $, toast, dialog, head, canClose, setCloseGuard } from '../core/dom.js';
import { esc, rd, r1 } from '../core/format.js';
import { foodKey, isBarcode, sameBarcode, servingSummary } from '../domain/food.js';
import { pickFoodBarcode } from '../domain/barcode.js';
import { searchAll } from '../services/foods.js';
import { canScan, startScan, stopScan } from '../services/barcode.js';
import { add } from './ctx.js';
import { renderCustom, editCustomFood } from './custom-food.js';
import { showFood } from './amount-picker.js';

export function initAddFood() {
  const dlg = dialog();
  $('#dClose').onclick = () => { if (canClose()) { stopScan(); dlg.close(); } };
  dlg.addEventListener('close', () => { stopScan(); if (!dlg.open) setCloseGuard(null); });
  dlg.addEventListener('cancel', e => { if (!canClose()) e.preventDefault(); });          // Esc key
  dlg.addEventListener('click', e => { if (e.target === dlg && canClose()) { stopScan(); dlg.close(); } });
  $('#dBack').onclick = () => { stopScan(); renderSearchTab(); };
  add.onFoodEdited = () => renderAddTabs();                  // back to the search list after a saved food was edited
  add.searchCode = code => { add.q = code; add.tab = 'search'; renderAddTabs(); doSearch(); };       // used by "Use this product" after a barcode was read from a photo
}

export function openAdd(meal, edit) {
  Object.assign(add, { meal, edit: edit || null, tab: 'search', results: [], q: '', barcode: '', offer: '' });
  const dlg = dialog();
  if (!dlg.open) dlg.showModal();
  if (edit) showFood(edit, edit);
  else renderAddTabs();
}

function renderAddTabs() {
  head('Add to ' + add.meal, false);
  $('#dBody').innerHTML = `<div class="seg"><button data-t="search">Search</button><button data-t="custom">Custom</button></div><div id="tabBody"></div>`;
  $('#dBody').querySelectorAll('.seg button').forEach(b => b.onclick = () => { add.tab = b.dataset.t; renderAddTabs(); });
  $('#dBody').querySelector(`.seg [data-t=${add.tab}]`).classList.add('on');
  add.tab === 'search' ? renderSearchTab(true) : renderCustom();
}

function renderSearchTab(fromTabs) {
  if (!fromTabs) { renderAddTabs(); return; }
  head('Add to ' + add.meal, false);
  $('#tabBody').innerHTML = `<div class="row"><input id="q" type="search" placeholder="Search foods or enter barcode" enterkeyhint="search" autocomplete="off" value="${esc(add.q)}">
    <button class="fit" id="goSearch">Search</button>${canScan() ? '<button class="fit" id="scan" aria-label="Scan barcode">📷</button>' : ''}</div>
    <div id="results"></div>`;
  $('#goSearch').onclick = doSearch;
  $('#q').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } };
  $('#q').oninput = () => { add.q = $('#q').value; renderResults(); };
  if ($('#scan')) $('#scan').onclick = scan;
  renderResults();
}

function localMatches(q) {
  if (isBarcode(q)) return state.custom.filter(f => sameBarcode(f.barcode, q)).map(f => ({ ...f, tag: 'My food' }));   // a scan finds foods you saved with that code
  q = q.toLowerCase();
  const all = [...state.custom.map(f => ({ ...f, tag: 'My food' })), ...state.recent.map(f => ({ ...f, tag: 'Recent' }))];
  const seen = new Set();
  return all.filter(f => (!q || (f.name + ' ' + (f.brand || '')).toLowerCase().includes(q)) && !seen.has(foodKey(f)) && seen.add(foodKey(f))).slice(0, 15);
}

function resHTML(list, from) {
  return list.map((f, i) => { const ss = esc(servingSummary(f));
    return `<div class="res" data-i="${i}" data-from="${esc(from)}"><div class="nm"><div>${esc(f.name)}</div>
    <div class="muted">${esc(f.brand ? f.brand + ' · ' : '')}${ss ? ss + ' · ' : ''}${rd(f.per100.k)} kcal /100g · P${r1(f.per100.p)} C${r1(f.per100.c)} F${r1(f.per100.f)}</div></div>
    <span class="badge">${esc(f.tag || f.source)}</span>${f.tag === 'My food' ? `<button class="fit" data-edit-food="${i}" aria-label="Edit ${esc(f.name)}">Edit</button>` : ''}</div>`; }).join('');
}

let localList = [];
function renderResults(msg) {
  const el = $('#results'); if (!el) return;
  localList = localMatches(add.q);
  const tried = [state.useOFF && 'Open Food Facts', state.useUSDA && 'USDA'].filter(Boolean).join(' and ') || 'any database';   // the sources a barcode was looked up in
  el.innerHTML = (localList.length ? `<div class="muted" style="margin-top:12px">Your foods</div>` + resHTML(localList, 'l') : '')
    + (msg ? `<p class="muted" style="margin-top:12px">${esc(msg)}</p>` : '')
    + (add.offer && add.offer === add.q && !add.results.length && !localList.length
        ? `<button class="primary" style="width:100%;margin-top:8px" id="mkBarcode">Not found in ${esc(tried)}. Create a custom food for ${esc(add.q)}</button>` : '')
    + (add.results.length ? `<div class="muted" style="margin-top:12px">Database results</div>` + resHTML(add.results, 'r') : '');
  if ($('#mkBarcode')) $('#mkBarcode').onclick = () => { add.barcode = add.q; add.tab = 'custom'; renderAddTabs(); };
  el.onclick = ev => { const r = ev.target.closest('.res'); if (!r) return;
    const eb = ev.target.closest('[data-edit-food]');
    if (eb) { const f = localList[+eb.dataset.editFood]; if (f) editCustomFood(f); return; }   // "Edit" on a saved food opens the form, not the amount screen
    const f = (r.dataset.from === 'l' ? localList : add.results)[+r.dataset.i];
    const bc = f && pickFoodBarcode(add.q, f.barcode);   // a code the user scanned or typed is kept on the food
    showFood(f && bc ? { ...f, barcode: bc } : f); };
}

async function doSearch() {
  const q = $('#q').value.trim(); add.q = q; if (!q) return;
  if (!state.useUSDA && !state.useOFF) { renderResults('Enable a food database in Settings.'); return; }
  add.offer = ''; add.results = []; renderResults('Searching…');
  const { results, errors } = await searchAll(q, { useUSDA: state.useUSDA, useOFF: state.useOFF, apiKey: state.apiKey });
  if ($('#q')?.value.trim() !== q) return;   // a newer search superseded this one
  add.results = results; add.offer = isBarcode(q) && !results.length && !errors.length ? q : '';   // only a REAL "not found": a failed lookup (offline, rate limit) is not
  renderResults(!results.length ? (errors.join(' · ') || 'No results found.') : errors.join(' · '));
}

/* camera logic lives in services/barcode.js */
async function scan() {
  $('#results').innerHTML = '<video id="vid" playsinline muted></video><p class="muted">Starting camera… then point at a barcode.</p>';
  try { await startScan($('#vid'), code => { $('#q').value = code; add.q = code; doSearch(); }); }
  catch (err) { toast(err && err.decoder ? err.message : 'Camera unavailable (needs HTTPS and permission)'); renderResults(); }
}
