// Amount picker: choose amount/unit/meal for a food, then add it to the diary or save an edit.
import { state, save } from '../core/store.js';
import { $, toast, dialog, head } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { MEALS } from '../core/constants.js';
import { esc, rd, r1, r2, fmtW } from '../core/format.js';
import { foodKey } from '../domain/food.js';
import { addEntry, updateEntry } from '../domain/entries.js';
import { unitsFor as unitsForM, startingUnit } from '../domain/units.js';
import { loadPortions } from '../services/usda.js';
import { view, add } from './ctx.js';

const unitsFor = food => unitsForM(food, state.measures);

export function showFood(food, existing) {
  head(existing ? 'Edit entry' : 'Amount', !existing);
  let units = unitsFor(food);
  const pref = state.weightUnit === 'oz' ? 'w:oz' : 'w:g', tok = showFood.tok = {};
  let startKey, startAmt;
  if (existing && units.some(x => x.key === existing.unitKey)) { startKey = existing.unitKey; startAmt = existing.amount; }
  else if (existing) { startKey = pref; startAmt = r1(existing.grams / units.find(x => x.key === pref).g); }
  else { const st = startingUnit(food, units, state.measures[foodKey(food)], pref); startKey = st.key; startAmt = st.amount; }   // the user's own measure, else the serving, else a countable household portion, else a weight
  let touched = !!existing;                                        // once the user edits the amount or unit, late-arriving measures must not move it
  const canLoad = food.source === 'USDA' && food.fdcId && !food.portions;
  $('#dBody').innerHTML = `<h2>${esc(food.name)}</h2><div class="muted">${esc(food.brand)} ${food.source ? '· ' + esc(food.source) : ''}</div>
    <div class="row"><div style="flex:0 0 38%"><label for="amt">Amount</label><input id="amt" type="number" inputmode="decimal" step="any" value="${Number(startAmt) || 0}"></div>
    <div><label for="unit">Unit</label><select id="unit"></select></div></div>
    <div class="muted" id="uMsg" style="margin-top:6px">${canLoad ? 'Loading cups, tablespoons and other measures…' : ''}</div>
    <details style="margin-top:8px"><summary class="muted" style="cursor:pointer;min-height:32px">+ Add your own measure (e.g. 1 cup = 240 g)</summary>
      <div class="row"><div><label for="mName">Name</label><input id="mName" placeholder="cup" autocapitalize="off"></div>
      <div><label for="mG">Grams in 1</label><input id="mG" type="number" inputmode="decimal"></div><button class="fit" id="mAdd" style="align-self:flex-end">Save</button></div></details>
    <label>Meal</label><select id="mealSel">${MEALS.map(m => `<option ${m === add.meal ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
    <div class="card" id="prev2" style="margin:14px 0"></div>
    <button class="primary" style="width:100%" id="addGo">${existing ? 'Save changes' : 'Add to diary'}</button>`;
  const unitNow = () => units.find(x => x.key === $('#unit').value) || units[0];
  const fill = key => { $('#unit').innerHTML = units.map(x => `<option value="${esc(x.key)}">${esc(x.label)}</option>`).join('');
    $('#unit').value = units.some(x => x.key === key) ? key : units[0].key; };
  const grams = () => (+$('#amt').value || 0) * unitNow().g;
  let lastG = 0;
  const upd = () => { lastG = grams(); const f = lastG / 100, p = food.per100;
    $('#prev2').innerHTML = `<div class="big">${rd(p.k * f)} <span class="muted" style="font-size:14px;font-weight:400">kcal · ${fmtW(lastG, state.weightUnit)}</span></div>
      <div class="macros"><div><span class="muted">Protein</span><b>${r1(p.p * f)} g</b></div><div><span class="muted">Carbs</span><b>${r1(p.c * f)} g</b></div><div><span class="muted">Fat</span><b>${r1(p.f * f)} g</b></div></div>`; };
  fill(startKey); upd();
  $('#amt').oninput = () => { touched = true; upd(); };
  $('#unit').onchange = () => { touched = true; if (lastG > 0) $('#amt').value = r2(lastG / unitNow().g); upd(); };   // keep the same weight, restate in the new unit
  $('#mAdd').onclick = () => {
    const label = $('#mName').value.trim(), g = +$('#mG').value;
    if (!label || !(g > 0)) { toast('Enter a name and grams'); return; }
    const k = foodKey(food); state.measures[k] = [...(state.measures[k] || []).filter(m => m.label !== label), { label, g, updatedAt: Date.now() }]; save();
    units = unitsFor(food); fill('p:' + label); $('#amt').value = 1; upd(); $('#mName').value = $('#mG').value = ''; toast('Measure saved');
  };
  if (canLoad) loadPortions(food, state.apiKey).then(() => { if (showFood.tok !== tok || !$('#unit')) return;
      const keep = $('#unit').value; units = unitsFor(food);
      if (!touched) { const st = startingUnit(food, units, state.measures[foodKey(food)], pref); fill(st.key); $('#amt').value = st.amount; }   // e.g. an egg now opens as 1 large, not 4 oz
      else fill(keep);
      upd();
      $('#uMsg').textContent = food.portions.length ? '' : 'No household measures listed for this food.'; },
    err => { if (showFood.tok === tok && $('#uMsg')) $('#uMsg').textContent = "Couldn't load household measures (" + err.message + ')'; });
  $('#addGo').onclick = () => {
    const g = grams(); if (!(g > 0)) { toast('Enter an amount'); return; }
    const meal = $('#mealSel').value, un = unitNow(), amount = +$('#amt').value, disp = un.key.startsWith('w:') ? '' : `${r2(amount)} ${un.short}`;
    if (existing) { updateEntry(state, view.day, existing.id, { grams: g, meal, unitKey: un.key, amount, disp }, Date.now()); }
    else {
      const info = { name: food.name, brand: food.brand || '', source: food.source || '', per100: food.per100, servingG: food.servingG || 0,
        servingLabel: food.servingLabel || '', fdcId: food.fdcId, portions: food.portions };
      addEntry(state, view.day, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), meal, ...info, grams: g, unitKey: un.key, amount, disp }, Date.now());
      state.recent = [info, ...state.recent.filter(f => foodKey(f) !== foodKey(info))].slice(0, 30);
    }
    save(); emit('diary:changed'); dialog().close(); toast(existing ? 'Updated' : 'Added to ' + meal);
  };
}
