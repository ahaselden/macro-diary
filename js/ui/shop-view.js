// Shop screen: the shopping list for a date range, derived from the plan. Only ticks and extras are saved.
import { state, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { esc } from '../core/format.js';
import { fmt, addDays, parse } from '../core/dates.js';
import { weekStart } from '../domain/plan.js';
import { buildShoppingList, extrasList, setChecked, addExtra, toggleExtra, removeExtra, clearTicks, shoppingText, shoppingCsv, AISLES } from '../domain/shopping.js';
import { download } from '../services/files.js';
import { registerTab } from './tabs.js';
import { shareResult } from './share-result.js';

let from = weekStart(fmt(new Date())), to = addDays(from, 6), focusExtra = false;

const newId = () => 'x_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const changed = () => { save(); emit('plan:changed'); };
const short = d => parse(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const curList = () => buildShoppingList(state, from, to, state.weightUnit);

export function renderShop() {
  const root = $('#v-shop'); if (!root) return;
  const list = curList(), extras = extrasList(state);
  const total = list.items.length + extras.length, got = list.items.filter(i => i.checked).length + extras.filter(e => e.on).length;
  const groups = AISLES.map(a => ({ a, rows: list.items.filter(i => i.aisle === a) })).filter(g => g.rows.length);
  root.innerHTML = `<div class="datebar pl-week"><button data-sh="-7" aria-label="Previous week">‹</button><div class="lbl">${esc(short(from))} – ${esc(short(to))}</div><button data-sh="7" aria-label="Next week">›</button></div>
    <div class="row pl-weekbtns"><button data-range="this">This week</button><button data-range="next">Next week</button></div>
    <div class="row sh-range"><div><label for="shFrom">From</label><input type="date" id="shFrom" value="${esc(from)}"></div><div><label for="shTo">To</label><input type="date" id="shTo" value="${esc(to)}"></div></div>
    ${list.skipped.length ? `<p class="muted sh-warn">Skipped: ${esc(list.skipped.join('; '))}</p>` : ''}
    ${!list.items.length ? `<div class="card"><p class="muted" style="margin:0">Nothing to buy for these dates. Shopping items come from meals you add in the Plan tab.</p></div>` : ''}
    ${groups.map(g => `<div class="card sh-aisle"><h2>${esc(g.a)}</h2>${g.rows.map(i => `<label class="sh-row ${i.checked ? 'done' : ''}">
      <input type="checkbox" data-key="${esc(i.tick)}" ${i.checked ? 'checked' : ''}>
      <span class="sh-nm"><span>${i.display ? '<b>' + esc(i.display) + '</b> ' : ''}${esc(i.name)}</span>${i.from.length ? `<span class="muted">for: ${esc(i.from.join(', '))}</span>` : ''}</span></label>`).join('')}</div>`).join('')}
    <div class="card sh-aisle"><h2>Extras</h2>
      ${extras.map(e => `<div class="sh-row ${e.on ? 'done' : ''}"><label class="sh-lbl"><input type="checkbox" data-extra="${esc(e.id)}" ${e.on ? 'checked' : ''}><span class="sh-nm"><span>${esc(e.text)}</span></span></label>
        <button class="x" data-rmx="${esc(e.id)}" aria-label="Remove">✕</button></div>`).join('')}
      <div class="row" style="margin-top:8px"><input id="shX" placeholder="Add an item" autocomplete="off" aria-label="Add an extra item"><button class="fit" id="shAdd">Add</button></div>
    </div>
    <p class="muted sh-prog">${got} of ${total} got</p>
    <div class="row sh-actions"><button id="shShare" class="primary">Share / copy list</button><button id="shCsv">Download CSV</button></div>
    <div class="row" style="margin-top:8px"><button id="shClear">Untick all</button></div>`;
  if (focusExtra) { focusExtra = false; const x = $('#shX'); if (x) x.focus(); }
}

function setRange(f, t) { from = f; to = t; renderShop(); }

function addExtraNow() {
  const inp = $('#shX'); if (!inp || !inp.value.trim()) return;
  addExtra(state, inp.value, newId(), Date.now()); focusExtra = true; changed();
}

export function initShop() {
  registerTab('shop', renderShop);
  const root = $('#v-shop');
  root.onclick = ev => {
    const t = ev.target;
    const sh = t.closest('[data-sh]');
    if (sh) { const n = Number(sh.dataset.sh); setRange(addDays(from, n), addDays(to, n)); return; }
    const rg = t.closest('[data-range]');
    if (rg) { const s = weekStart(fmt(new Date())), st = rg.dataset.range === 'next' ? addDays(s, 7) : s; setRange(st, addDays(st, 6)); return; }
    const rx = t.closest('[data-rmx]');
    if (rx) { removeExtra(state, rx.dataset.rmx, Date.now()); changed(); return; }
    if (t.closest('#shAdd')) { addExtraNow(); return; }
    if (t.closest('#shShare')) {
      shareResult(shoppingText(state, curList(), `Shopping list ${short(from)} – ${short(to)}`), 'Shopping list'); return;
    }
    if (t.closest('#shCsv')) { download(`shopping-list-${from}_to_${to}.csv`, shoppingCsv(state, curList()), 'text/csv'); return; }
    if (t.closest('#shClear')) {
      if (!confirm('Untick every item and extra?')) return;
      clearTicks(state, Date.now()); changed();
    }
  };
  root.onchange = ev => {
    const t = ev.target;
    if (t.dataset.key !== undefined && t.type === 'checkbox') { setChecked(state, t.dataset.key, t.checked, Date.now()); changed(); }
    else if (t.dataset.extra !== undefined) { toggleExtra(state, t.dataset.extra, t.checked, Date.now()); changed(); }
    else if (t.id === 'shFrom' || t.id === 'shTo') {
      const f = $('#shFrom').value, e = $('#shTo').value;
      if (!f || !e) { renderShop(); return; }
      if (f > e) { toast('"From" must be on or before "To"'); renderShop(); return; }
      setRange(f, e);
    }
  };
  root.onkeydown = ev => { if (ev.key === 'Enter' && ev.target.id === 'shX') { ev.preventDefault(); addExtraNow(); } };
  // a background sync must not wipe what the user is typing (the 'add item' box): wait until it loses focus
  const typing = () => { const a = document.activeElement; return !!a && root.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'date'; };
  const again = () => { if (!root.classList.contains('on')) return; if (typing()) { root.addEventListener('focusout', () => setTimeout(renderShop, 0), { once: true }); return; } renderShop(); };
  on('plan:changed', again); on('recipes:changed', again); on('settings:changed', again);
}
