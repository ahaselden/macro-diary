// Cooking view: a read-only, large-text view of a recipe to leave open while cooking (docs/specs/cooking-mode.md).
// Tick-offs, the marked step and the servings scaler live only in this view; nothing is saved and the recipe is never changed.
import { $, dialog, head, toast } from '../core/dom.js';
import { state } from '../core/store.js';
import { esc } from '../core/format.js';
import { clampServings, halveServings, doubleServings, stepServings, cookingIngredients, cookingSteps, toggleTick, setCurrentStep, safeSourceLink } from '../domain/cooking.js';
import { createWakeLock } from '../services/wakelock.js';

export function openCookView(recipeId, servings) {
  const r = state.recipes && Object.hasOwn(state.recipes, recipeId) ? state.recipes[recipeId] : null;
  if (!r) { toast('That recipe was deleted'); return; }
  const dlg = dialog();
  const yieldN = Object.hasOwn(r, 'servings') && Number.isFinite(r.servings) && r.servings > 0 ? r.servings : 1;
  let wanted = clampServings(typeof servings === 'number' && servings > 0 ? servings : yieldN);
  let ticks = [], current = null;
  const steps = cookingSteps(r);
  const link = safeSourceLink(Object.hasOwn(r, 'source') ? r.source : '');
  const wl = createWakeLock(typeof navigator !== 'undefined' ? navigator : undefined, typeof document !== 'undefined' ? document : undefined);
  const supported = wl.isSupported();

  if (!dlg.open) dlg.showModal();
  head(typeof r.name === 'string' && r.name ? r.name : 'Recipe', false);
  dlg.addEventListener('close', () => { wl.disable(); }, { once: true });   // any way of closing releases the wake lock

  const render = () => {
    const ings = cookingIngredients(r, wanted);
    const n = Math.round(wanted * 100) / 100;
    $('#ckIngs').innerHTML = ings.length
      ? ings.map((x, i) => `<li><label class="ck-ing"><input type="checkbox" data-ing="${i}"${ticks.includes(i) ? ' checked' : ''}> <span>${esc(x)}</span></label></li>`).join('')
      : '<li class="muted">No ingredients.</li>';
    $('#ckServ').textContent = `${n} serving${n === 1 ? '' : 's'}`;
  };
  const renderSteps = () => {
    $('#ckSteps').innerHTML = steps.length
      ? steps.map((x, i) => `<li data-step="${i}"${current === i ? ' aria-current="true" class="on"' : ''}>${esc(x)}</li>`).join('')
      : '<li class="muted">No steps.</li>';
  };
  const renderNote = () => {
    $('#ckNote').textContent = !supported ? 'Keep screen on is not supported on this device.'
      : wl.status() === 'failed' ? 'Could not keep the screen on (the browser refused). Your screen may still sleep.' : '';
  };

  $('#dBody').innerHTML = `<div class="rv ck" id="ckRoot">
    <div class="ck-serv"><button type="button" data-sv="minus" aria-label="One serving fewer">−</button><b id="ckServ"></b><button type="button" data-sv="plus" aria-label="One serving more">+</button>
      <button type="button" data-sv="half">½</button><button type="button" data-sv="double">2×</button></div>
    <p class="muted">Scaling here is just for this view; the saved recipe is not changed.</p>
    <h3>Ingredients</h3><ul class="ck-list" id="ckIngs"></ul>
    <h3>Steps</h3><ol class="ck-steps" id="ckSteps"></ol>
    ${link ? `<p class="muted">Source: <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)}</a></p>` : ''}
    <label class="ck-keep"><input type="checkbox" id="ckKeep"${supported ? '' : ' disabled'}> Keep screen on</label>
    <div class="muted" id="ckNote"></div>
    <div class="row" style="margin-top:12px"><button type="button" class="primary" id="ckClose">Close</button></div>
  </div>`;
  render(); renderSteps(); renderNote();

  $('#ckRoot').onclick = ev => {
    const t = ev.target;
    const sv = t.closest('[data-sv]');
    if (sv) {
      const k = sv.dataset.sv;
      wanted = k === 'minus' ? stepServings(wanted, -1) : k === 'plus' ? stepServings(wanted, 1) : k === 'half' ? halveServings(wanted) : doubleServings(wanted);
      render(); return;
    }
    const st = t.closest('[data-step]');
    if (st) { current = setCurrentStep(current, Number(st.dataset.step), steps.length); renderSteps(); return; }
    if (t.closest('#ckClose')) dialog().close();
  };
  $('#ckRoot').onchange = async ev => {
    const t = ev.target;
    if (t.matches('[data-ing]')) { ticks = toggleTick(ticks, Number(t.dataset.ing), cookingIngredients(r, wanted).length); return; }
    if (t.id === 'ckKeep') {
      if (t.checked) { await wl.enable(); if (wl.status() !== 'on') t.checked = false; } else await wl.disable();
      renderNote();
    }
  };
}
