// Plan screen: one card per day Mon-Sun, four meals each, items are recipes (servings) or foods (grams).
// Picker for adding items lives in the shared bottom-sheet dialog; all its handlers are on a root div created inside #dBody.
import { state, save } from '../core/store.js';
import { $, toast, dialog, head } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { MEALS } from '../core/constants.js';
import { esc, rd } from '../core/format.js';
import { fmt, addDays, parse } from '../core/dates.js';
import { foodKey } from '../domain/food.js';
import { searchRecipes, recipeNutrition } from '../domain/recipes.js';
import { weekStart, weekDates, monthGrid, monthSummary, addMonths, monthStart, autofillDates, getDay, recipeItem, foodItem, addPlanItem, updatePlanItem, removePlanItem, clearDay, copyDay, copyWeek, itemNutrition, dayNutrition, logItem, logDay } from '../domain/plan.js';
import { proposePlan, applyProposal } from '../domain/autoplan.js';
import { searchAll } from '../services/foods.js';
import { registerTab } from './tabs.js';
import { openRecipeView } from './recipe-view.js';

let weekStartDate = weekStart(fmt(new Date()));
let view = 'week', monthDate = monthStart(fmt(new Date()));   // which Plan view is showing, and which month the month view shows

let idSeq = 0;   // a counter on the end keeps ids unique when many are made within one millisecond
const newId = () => 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (idSeq++).toString(36);
const changed = diary => { save(); emit('plan:changed'); if (diary) emit('diary:changed'); };
// A quantity box saves on blur, i.e. just before the tap the user is making on another button. Re-rendering immediately would
// replace that button and swallow the tap, so the refresh waits a moment.
const changedSoon = () => { save(); setTimeout(() => emit('plan:changed'), 250); };
const typing = root => { const a = document.activeElement; return !!a && root.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox'; };
const isLogged = (date, it) => !!it.entryId && (state.days[date] || []).some(e => e.id === it.entryId);
const dayLabel = d => parse(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

function bar(val, goal) {
  const pct = goal ? Math.min(100, val / goal * 100) : 0;
  return `<div class="bar ${goal && val > goal ? 'over' : ''}"><i style="width:${pct}%"></i></div>`;
}

function itemHtml(date, meal, it) {
  const n = itemNutrition(state, it), isR = it.type === 'recipe';
  const name = isR ? n.name : (it.name || (it.food && it.food.name) || '');
  const qty = isR ? Number(it.servings) || 0 : Number(it.grams) || 0;
  const logged = isLogged(date, it);
  const nm = isR
    ? `<button type="button" class="pl-nm link" data-open aria-label="Open recipe ${esc(name)}">${esc(name)}</button>${n.complete ? '' : '<span class="badge warn fit">incomplete</span>'}`
    : `<div class="pl-nm">${esc(name)}${n.complete ? '' : ' <span class="badge warn">incomplete</span>'}</div>`;
  return `<div class="pl-item" data-meal="${esc(meal)}" data-id="${esc(it.id)}">
    <div class="row">${nm}
      <button class="x fit" data-rm aria-label="Remove">✕</button></div>
    <div class="row pl-ctl"><input class="pl-qty" type="number" inputmode="decimal" step="any" min="0" value="${qty}" aria-label="${isR ? 'Servings' : 'Grams'}">
      <span class="muted pl-unit">${isR ? 'serving' + (qty === 1 ? '' : 's') : 'g'}</span>
      <span class="pl-k">${rd(n.k)} kcal</span>
      <button class="fit pl-log ${logged ? 'done' : ''}" data-log>${logged ? '✓ Logged' : 'Log'}</button></div>
  </div>`;
}

function dayHtml(date, today) {
  const day = getDay(state, date), dn = dayNutrition(state, date), t = dn.total, g = state.goals;
  return `<div class="card pl-day ${date === today ? 'today' : ''}" data-date="${esc(date)}">
    <div class="meal-h"><h2>${esc(dayLabel(date))}${date === today ? ' · Today' : ''}</h2>${dn.items > 0 && !dn.complete ? '<span class="badge warn">incomplete</span>' : ''}</div>
    <div class="muted">${rd(t.k)} / ${Number(g.k) || 0} kcal · P${rd(t.p)} C${rd(t.c)} F${rd(t.f)}</div>
    ${bar(t.k, g.k)}
    ${MEALS.map(m => `<div class="pl-meal"><div class="meal-h"><div><b>${esc(m)}</b> <span class="muted">${rd(dn.byMeal[m].k)} kcal</span></div>
      <button class="fit" data-add="${esc(m)}">+ Add</button></div>
      ${(day.slots[m] || []).map(it => itemHtml(date, m, it)).join('')}</div>`).join('')}
    <details class="pl-more"><summary>Day options</summary>
      <div class="row"><button data-logday>Log whole day</button><button class="danger" data-clearday>Clear day</button></div>
      <div class="row pl-copy"><input type="date" class="pl-copyto" aria-label="Copy day to date" value="${esc(addDays(date, 1))}"><button class="fit" data-copyday>Copy day to…</button></div>
    </details>
  </div>`;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthHtml(today) {
  const grid = monthGrid(monthDate), sum = monthSummary(state, monthDate), goal = Number(state.goals.k) || 0;
  const lbl = parse(monthDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const cell = c => {
    if (!c.inMonth) return '<div class="pm-cell pad"></div>';
    const x = sum[c.date], n = x.items, k = Math.round(x.k);
    const cls = ['pm-cell', c.date === today ? 'today' : '', n && goal && x.k > goal ? 'over' : '', n ? 'has' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-day="${esc(c.date)}" aria-label="${esc(dayLabel(c.date))}: ${n ? `${k} kcal, ${n} item${n === 1 ? '' : 's'}${x.complete ? '' : ', incomplete'}` : 'nothing planned'}">
      <span class="pm-d">${Number(c.date.slice(8))}</span>${n ? `<span class="pm-k">${k}</span><span class="pm-n">${n} item${n === 1 ? '' : 's'}${x.complete ? '' : ' !'}</span>` : ''}</button>`;
  };
  return `<div class="datebar pl-week"><button data-mm="-1" aria-label="Previous month">‹</button><div class="lbl">${esc(lbl)}</div><button data-mm="1" aria-label="Next month">›</button></div>
    <div class="pm-grid"><div class="pm-head">${WEEKDAYS.map(d => `<span>${d}</span>`).join('')}</div>${grid.map(row => `<div class="pm-row">${row.map(cell).join('')}</div>`).join('')}</div>
    <p class="muted">Tap a day to open its week. Numbers are planned kcal; “!” means some items have incomplete nutrition.</p>`;
}

export function renderPlan() {
  const root = $('#v-plan'); if (!root) return;
  const dates = weekDates(weekStartDate), today = fmt(new Date());
  const lbl = parse(weekStartDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const toggle = `<div class="row pl-weekbtns pl-views"><button data-view="week" aria-pressed="${view === 'week'}" class="${view === 'week' ? 'primary' : ''}">Week</button><button data-view="month" aria-pressed="${view === 'month'}" class="${view === 'month' ? 'primary' : ''}">Month</button></div>`;
  const fill = '<div class="row pl-weekbtns"><button data-autofill>Auto-fill week</button></div>';
  if (view === 'month') { root.innerHTML = toggle + fill + monthHtml(today); return; }
  root.innerHTML = toggle + `<div class="datebar pl-week"><button data-wk="-1" aria-label="Previous week">‹</button><div class="lbl">Week of ${esc(lbl)}</div><button data-wk="1" aria-label="Next week">›</button></div>
    <div class="row pl-weekbtns"><button data-thisweek>This week</button><button data-copyweek>Copy week to next week</button></div>
    ${fill}
    ${dates.map(d => dayHtml(d, today)).join('')}`;
}

function onClick(ev) {
  const t = ev.target;
  const vw = t.closest('[data-view]');
  if (vw) { view = vw.dataset.view === 'month' ? 'month' : 'week'; if (view === 'month') monthDate = monthStart(weekStartDate); renderPlan(); return; }
  const mm = t.closest('[data-mm]');
  if (mm) { monthDate = addMonths(monthDate, Number(mm.dataset.mm)) || monthDate; renderPlan(); return; }
  const dayBtn = t.closest('[data-day]');
  if (dayBtn) { view = 'week'; weekStartDate = weekStart(dayBtn.dataset.day); renderPlan(); return; }
  const wk = t.closest('[data-wk]');
  if (wk) { weekStartDate = addDays(weekStartDate, 7 * Number(wk.dataset.wk)); renderPlan(); return; }
  if (t.closest('[data-thisweek]')) { weekStartDate = weekStart(fmt(new Date())); renderPlan(); return; }
  if (t.closest('[data-copyweek]')) {
    const next = addDays(weekStartDate, 7);
    if (!confirm("Copy this week's plan to next week? This replaces everything planned next week.")) return;
    copyWeek(state, weekStartDate, next, Date.now(), newId); changed(false); toast('Week copied'); return;
  }
  if (t.closest('[data-autofill]')) { openAutofill(); return; }
  const dayEl = t.closest('.pl-day'); if (!dayEl) return;
  const date = dayEl.dataset.date;
  const addBtn = t.closest('[data-add]');
  if (addBtn) { openPicker(date, addBtn.dataset.add); return; }
  const row = t.closest('.pl-item');
  if (row && t.closest('[data-open]')) {                                           // the recipe's name: open a read-only view of it
    const it = (getDay(state, date).slots[row.dataset.meal] || []).find(i => i.id === row.dataset.id);
    if (it && it.type === 'recipe') openRecipeView(it.recipeId, it.servings);
    return;
  }
  if (row && t.closest('[data-rm]')) {
    removePlanItem(state, date, row.dataset.meal, row.dataset.id, Date.now()); changed(false); return;
  }
  if (row && t.closest('[data-log]')) {
    const meal = row.dataset.meal, it = getDay(state, date).slots[meal].find(i => i.id === row.dataset.id); if (!it) return;
    if (isLogged(date, it)) { toast('Already logged'); return; }
    if (logItem(state, date, meal, it.id, Date.now(), newId)) { changed(true); toast('Logged to diary'); return; }
    if (it.type === 'recipe') {
      const r = state.recipes[it.recipeId];
      toast(!r ? 'That recipe was deleted' : recipeNutrition(r, state.measures).source === 'none' ? "Link foods to this recipe's ingredients first" : 'Already logged');
    } else toast(!(Number(it.grams) > 0) ? 'Enter grams first' : 'Already logged');
    return;
  }
  if (t.closest('[data-logday]')) {
    const n = logDay(state, date, Date.now(), newId);
    if (n) { changed(true); toast(`${n} entr${n === 1 ? 'y' : 'ies'} logged`); } else toast('Nothing to log');
    return;
  }
  if (t.closest('[data-clearday]')) {
    if (!confirm('Clear everything planned for this day?')) return;
    clearDay(state, date, Date.now()); changed(false); return;
  }
  if (t.closest('[data-copyday]')) {
    const to = dayEl.querySelector('.pl-copyto').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) { toast('Pick a date'); return; }
    if (to === date) { toast('Pick a different day'); return; }
    if (dayNutrition(state, to).items > 0 && !confirm('That day already has planned items. Replace them?')) return;
    copyDay(state, date, to, Date.now(), newId); changed(false); toast('Day copied');
  }
}

function onChange(ev) {
  const t = ev.target; if (!t.classList.contains('pl-qty')) return;
  const row = t.closest('.pl-item'), date = t.closest('.pl-day').dataset.date, meal = row.dataset.meal;
  const it = getDay(state, date).slots[meal].find(i => i.id === row.dataset.id); if (!it) return;
  const v = Number(t.value);
  if (!(v > 0) || v > 100000) { toast('Enter a number above 0 (and at most 100000)'); renderPlan(); return; }
  updatePlanItem(state, date, meal, it.id, it.type === 'recipe' ? { servings: v } : { grams: v }, Date.now());
  changedSoon();
}

export function initPlan() {
  registerTab('plan', renderPlan);
  const root = $('#v-plan');
  root.onclick = onClick;
  root.onchange = onChange;
  // a background sync must not wipe what the user is typing: wait until the field loses focus
  const again = () => { if (!root.classList.contains('on')) return; if (typing(root)) { root.addEventListener('focusout', () => setTimeout(renderPlan, 0), { once: true }); return; } renderPlan(); };
  on('plan:changed', again); on('recipes:changed', again); on('settings:changed', again);
}

/* ---------- auto-fill preview (shared dialog): nothing is saved until Accept ---------- */
function openAutofill() {
  head('Auto-fill week', false);
  const dlg = dialog(); if (!dlg.open) dlg.showModal();
  const today = fmt(new Date());
  const viewDate = view === 'month' ? (monthStart(today) === monthDate ? today : monthDate) : weekStartDate;
  let seed = 1, range = view;
  $('#dBody').innerHTML = `<div class="rc-ed" id="apRoot">
    <p class="muted">Fills only empty meals with one serving of your recipes, choosing ones close to your calorie goal for each meal, avoiding repeats and preferring favourites. Change the amounts afterwards. Nothing changes until you press Accept.</p>
    <div class="row ap-range"><button type="button" data-range="week" aria-pressed="${range === 'week'}">Week</button><button type="button" data-range="month" aria-pressed="${range === 'month'}">Month</button></div>
    <p class="muted" id="apSkipped"></p>
    <div class="row ap-slots">${MEALS.map(m => `<label class="ap-slot"><input type="checkbox" data-slot="${esc(m)}"${m === 'Lunch' || m === 'Dinner' ? ' checked' : ''}> ${esc(m)}</label>`).join('')}</div>
    <div id="apList"></div>
    <div class="rc-actions"><button class="primary" id="apAccept">Accept</button><button id="apReroll">Reroll</button><button id="apCancel">Cancel</button></div>
  </div>`;
  const root = $('#apRoot');
  let proposal = { days: {}, notes: [] };
  const draw = () => {
    const slots = [...root.querySelectorAll('[data-slot]')].filter(c => c.checked).map(c => c.dataset.slot);
    const { dates, skippedPast } = autofillDates(range, viewDate, today);
    root.querySelectorAll('[data-range]').forEach(b => { const on = b.dataset.range === range; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('primary', on); });
    $('#apSkipped').textContent = skippedPast ? `${skippedPast} past day${skippedPast === 1 ? '' : 's'} skipped (only today and later are filled).` : '';
    proposal = proposePlan(state, { dates, slots, seed });
    const days = Object.keys(proposal.days).sort();
    $('#apList').innerHTML = (days.length ? days.map(d => `<div class="card"><h3>${esc(dayLabel(d))}</h3>${MEALS.filter(m => proposal.days[d][m]).map(m => proposal.days[d][m].map(p => {
      const r = state.recipes[p.recipeId];
      return `<div class="ap-pick"><b>${esc(m)}</b>: ${esc(r ? r.name : '')} · ${rd(p.servings * 100) / 100} serving${p.servings === 1 ? '' : 's'}${p.complete ? '' : ' <span class="badge warn">incomplete</span>'}<div class="muted">${esc(p.why)}</div></div>`;
    }).join('')).join('')}</div>`).join('') : '<p class="muted">Nothing to fill: every chosen meal is already planned, or there are no recipes with known nutrition.</p>')
      + proposal.notes.map(n => `<p class="muted">${esc(n)}</p>`).join('');
    $('#apAccept').disabled = !days.length;
  };
  root.onchange = ev => { if (ev.target.closest('[data-slot]')) draw(); };
  root.onclick = ev => {
    const id = ev.target.id, rb = ev.target.closest('[data-range]');
    if (rb) { range = rb.dataset.range === 'month' ? 'month' : 'week'; seed = 1; draw(); return; }
    if (id === 'apReroll') { seed++; draw(); }
    else if (id === 'apCancel') dialog().close();
    else if (id === 'apAccept') {
      const n = applyProposal(state, proposal, Date.now(), newId);
      changed(false); dialog().close(); toast(n ? `${n} meal${n === 1 ? '' : 's'} added to the plan` : 'Nothing added');
    }
  };
  draw();
}

/* ---------- add-item picker (shared dialog) ---------- */
function localMatches(q) {
  q = q.toLowerCase();
  const all = [...state.custom.map(f => ({ ...f, tag: 'My food' })), ...state.recent.map(f => ({ ...f, tag: 'Recent' }))];
  const seen = new Set();
  return all.filter(f => (!q || (f.name + ' ' + (f.brand || '')).toLowerCase().includes(q)) && !seen.has(foodKey(f)) && seen.add(foodKey(f))).slice(0, 15);
}

function openPicker(date, meal) {
  head(`Add to ${meal}`, false);
  const dlg = dialog(); if (!dlg.open) dlg.showModal();
  let local = [], remote = [], msg = '';
  $('#dBody').innerHTML = `<div class="rc-ed" id="plPick"><div class="seg"><button data-tab="recipe" class="on">Recipe</button><button data-tab="food">Food</button></div><div id="plPane"></div></div>`;
  const rootEl = $('#plPick'), pane = () => $('#plPane');

  const finish = item => { addPlanItem(state, date, meal, item, Date.now()); changed(false); dialog().close(); toast('Added to plan'); };

  const qtyStep = (title, sub, unitLbl, def, back, onAdd) => {
    pane().innerHTML = `<button class="ghost" id="plBack" style="min-height:44px">‹ Back</button>
      <h3>${esc(title)}</h3><p class="muted">${esc(sub)}</p>
      <label for="plQty">${esc(unitLbl)}</label><input id="plQty" type="number" inputmode="decimal" step="any" min="0" value="${Number(def)}">
      <div class="rc-actions"><button class="primary" id="plOk">Add to ${esc(meal)}</button></div>`;
    $('#plBack').onclick = back;
    $('#plOk').onclick = () => { const v = Number($('#plQty').value); if (!(v > 0)) { toast('Enter a number above 0'); return; } onAdd(v); };
  };

  const recipePane = () => {
    pane().innerHTML = `<input id="plRq" type="search" placeholder="Search recipes" autocomplete="off" aria-label="Search recipes"><div id="plRres"></div>`;
    const draw = () => {
      const list = searchRecipes(state, $('#plRq').value.trim());
      $('#plRres').innerHTML = list.length ? list.map(r => `<div class="res" data-rid="${esc(r.id)}"><div class="nm"><div>${esc(r.name)}</div>
        <div class="muted">${Number(r.servings) || 1} serving${Number(r.servings) === 1 ? '' : 's'}</div></div></div>`).join('')
        : `<p class="muted">${Object.keys(state.recipes).length ? 'No recipes match.' : 'No recipes yet. Create one in the Recipes tab.'}</p>`;
    };
    $('#plRq').oninput = draw; draw();
  };

  const foodPane = () => {
    pane().innerHTML = `<div class="row"><input id="plFq" type="search" placeholder="Search foods" enterkeyhint="search" autocomplete="off" aria-label="Search foods"><button class="fit" id="plFgo">Search</button></div><div id="plFres"></div>`;
    const item = (f, i, from) => `<div class="res" data-i="${i}" data-from="${from}"><div class="nm"><div>${esc(f.name)}</div>
      <div class="muted">${esc(f.brand ? f.brand + ' · ' : '')}${rd(f.per100.k)} kcal /100g</div></div><span class="badge">${esc(f.tag || f.source)}</span></div>`;
    const draw = () => {
      local = localMatches($('#plFq').value.trim());
      $('#plFres').innerHTML = (local.length ? `<div class="muted" style="margin-top:10px">Your foods</div>` + local.map((f, i) => item(f, i, 'l')).join('') : '')
        + (msg ? `<p class="muted">${esc(msg)}</p>` : '')
        + (remote.length ? `<div class="muted" style="margin-top:10px">Database results</div>` + remote.map((f, i) => item(f, i, 'r')).join('') : '');
    };
    const go = async () => {
      const q = $('#plFq').value.trim(); if (!q) return;
      if (!state.useUSDA && !state.useOFF) { msg = 'Enable a food database in Settings.'; draw(); return; }
      msg = 'Searching…'; remote = []; draw();
      const { results, errors } = await searchAll(q, { useUSDA: state.useUSDA, useOFF: state.useOFF, apiKey: state.apiKey });
      if (!$('#plFq') || $('#plFq').value.trim() !== q) return;
      remote = results; msg = !results.length ? (errors.join(' · ') || 'No results found.') : errors.join(' · '); draw();
    };
    $('#plFq').oninput = draw;
    $('#plFq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    $('#plFgo').onclick = go;
    draw();
  };

  const show = name => {
    local = []; remote = []; msg = '';
    rootEl.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    (name === 'recipe' ? recipePane : foodPane)();
  };

  rootEl.addEventListener('click', ev => {
    const t = ev.target;
    const sb = t.closest('.seg button'); if (sb) { show(sb.dataset.tab); return; }
    const res = t.closest('.res'); if (!res) return;
    if (res.dataset.rid) {
      const r = state.recipes[res.dataset.rid]; if (!r) return;
      qtyStep(r.name, 'How many servings?', 'Servings', 1, () => show('recipe'), v => finish(recipeItem(newId(), r.id, v)));
    } else {
      const f = (res.dataset.from === 'l' ? local : remote)[+res.dataset.i]; if (!f) return;
      const food = { name: f.name, brand: f.brand || '', source: f.source || '', per100: f.per100, servingG: f.servingG || 0, servingLabel: f.servingLabel || '' };
      if (f.fdcId) food.fdcId = f.fdcId;
      if (f.portions) food.portions = f.portions;
      qtyStep(f.name, `${rd(f.per100.k)} kcal /100g`, 'Grams', Number(f.servingG) > 0 ? Number(f.servingG) : 100, () => show('food'), v => finish(foodItem(newId(), food, v)));
    }
  });
  show('recipe');
}
