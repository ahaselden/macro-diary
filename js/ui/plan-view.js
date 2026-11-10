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
import { weekStart, weekDates, getDay, recipeItem, foodItem, addPlanItem, updatePlanItem, removePlanItem, clearDay, copyDay, copyWeek, itemNutrition, dayNutrition, logItem, logDay } from '../domain/plan.js';
import { searchAll } from '../services/foods.js';
import { registerTab } from './tabs.js';

let weekStartDate = weekStart(fmt(new Date()));

const newId = () => 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
  return `<div class="pl-item" data-meal="${esc(meal)}" data-id="${esc(it.id)}">
    <div class="row"><div class="pl-nm">${esc(name)}${n.complete ? '' : ' <span class="badge warn">incomplete</span>'}</div>
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

export function renderPlan() {
  const root = $('#v-plan'); if (!root) return;
  const dates = weekDates(weekStartDate), today = fmt(new Date());
  const lbl = parse(weekStartDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  root.innerHTML = `<div class="datebar pl-week"><button data-wk="-1" aria-label="Previous week">‹</button><div class="lbl">Week of ${esc(lbl)}</div><button data-wk="1" aria-label="Next week">›</button></div>
    <div class="row pl-weekbtns"><button data-thisweek>This week</button><button data-copyweek>Copy week to next week</button></div>
    ${dates.map(d => dayHtml(d, today)).join('')}`;
}

function onClick(ev) {
  const t = ev.target;
  const wk = t.closest('[data-wk]');
  if (wk) { weekStartDate = addDays(weekStartDate, 7 * Number(wk.dataset.wk)); renderPlan(); return; }
  if (t.closest('[data-thisweek]')) { weekStartDate = weekStart(fmt(new Date())); renderPlan(); return; }
  if (t.closest('[data-copyweek]')) {
    const next = addDays(weekStartDate, 7);
    if (!confirm("Copy this week's plan to next week? This replaces everything planned next week.")) return;
    copyWeek(state, weekStartDate, next, Date.now(), newId); changed(false); toast('Week copied'); return;
  }
  const dayEl = t.closest('.pl-day'); if (!dayEl) return;
  const date = dayEl.dataset.date;
  const addBtn = t.closest('[data-add]');
  if (addBtn) { openPicker(date, addBtn.dataset.add); return; }
  const row = t.closest('.pl-item');
  if (row && t.closest('[data-rm]')) {
    removePlanItem(state, date, row.dataset.meal, row.dataset.id, Date.now()); changed(false); return;
  }
  if (row && t.closest('[data-log]')) {
    const meal = row.dataset.meal, it = getDay(state, date).slots[meal].find(i => i.id === row.dataset.id); if (!it) return;
    if (isLogged(date, it)) { toast('Already logged'); return; }
    if (logItem(state, date, meal, it.id, Date.now(), newId)) { changed(true); toast('Logged to diary'); return; }
    if (it.type === 'recipe') {
      const r = state.recipes[it.recipeId];
      toast(!r ? 'That recipe was deleted' : recipeNutrition(r, state.measures).linked === 0 ? "Link foods to this recipe's ingredients first" : 'Already logged');
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
      qtyStep(r.name, 'How many servings?', 'Servings', Number(r.servings) > 0 ? Number(r.servings) : 1, () => show('recipe'), v => finish(recipeItem(newId(), r.id, v)));
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
