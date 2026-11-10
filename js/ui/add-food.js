// Add/edit-food dialog: tabs (Search / Custom), local + database search, barcode scan.
import { state } from '../core/store.js';
import { $, toast, dialog, head } from '../core/dom.js';
import { esc, rd, r1 } from '../core/format.js';
import { foodKey } from '../domain/food.js';
import { searchAll } from '../services/foods.js';
import { canScan, startScan, stopScan } from '../services/barcode.js';
import { add } from './ctx.js';
import { renderCustom } from './custom-food.js';
import { showFood } from './amount-picker.js';

export function initAddFood() {
  const dlg = dialog();
  $('#dClose').onclick = () => { stopScan(); dlg.close(); };
  dlg.addEventListener('close', stopScan);
  dlg.addEventListener('click', e => { if (e.target === dlg) { stopScan(); dlg.close(); } });
  $('#dBack').onclick = () => { stopScan(); renderSearchTab(); };
}

export function openAdd(meal, edit) {
  Object.assign(add, { meal, edit: edit || null, tab: 'search', results: [], q: '' });
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
  q = q.toLowerCase();
  const all = [...state.custom.map(f => ({ ...f, tag: 'My food' })), ...state.recent.map(f => ({ ...f, tag: 'Recent' }))];
  const seen = new Set();
  return all.filter(f => (!q || (f.name + ' ' + (f.brand || '')).toLowerCase().includes(q)) && !seen.has(foodKey(f)) && seen.add(foodKey(f))).slice(0, 15);
}

function resHTML(list, from) {
  return list.map((f, i) => `<div class="res" data-i="${i}" data-from="${esc(from)}"><div class="nm"><div>${esc(f.name)}</div>
    <div class="muted">${esc(f.brand ? f.brand + ' · ' : '')}${rd(f.per100.k)} kcal /100g · P${r1(f.per100.p)} C${r1(f.per100.c)} F${r1(f.per100.f)}</div></div>
    <span class="badge">${esc(f.tag || f.source)}</span></div>`).join('');
}

let localList = [];
function renderResults(msg) {
  const el = $('#results'); if (!el) return;
  localList = localMatches(add.q);
  el.innerHTML = (localList.length ? `<div class="muted" style="margin-top:12px">Your foods</div>` + resHTML(localList, 'l') : '')
    + (msg ? `<p class="muted" style="margin-top:12px">${esc(msg)}</p>` : '')
    + (add.results.length ? `<div class="muted" style="margin-top:12px">Database results</div>` + resHTML(add.results, 'r') : '');
  el.onclick = ev => { const r = ev.target.closest('.res'); if (!r) return;
    showFood((r.dataset.from === 'l' ? localList : add.results)[+r.dataset.i]); };
}

async function doSearch() {
  const q = $('#q').value.trim(); add.q = q; if (!q) return;
  if (!state.useUSDA && !state.useOFF) { renderResults('Enable a food database in Settings.'); return; }
  renderResults('Searching…'); add.results = [];
  const { results, errors } = await searchAll(q, { useUSDA: state.useUSDA, useOFF: state.useOFF, apiKey: state.apiKey });
  if ($('#q')?.value.trim() !== q) return;   // a newer search superseded this one
  add.results = results;
  renderResults(!results.length ? (errors.join(' · ') || 'No results found.') : errors.join(' · '));
}

/* camera logic lives in services/barcode.js */
async function scan() {
  $('#results').innerHTML = '<video id="vid" playsinline muted></video><p class="muted">Point at a barcode…</p>';
  try { await startScan($('#vid'), code => { $('#q').value = code; add.q = code; doSearch(); }); }
  catch { toast('Camera unavailable (needs HTTPS and permission)'); renderResults(); }
}
