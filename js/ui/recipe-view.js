// Read-only view of a recipe in the shared dialog, opened from a planned meal: the ingredients scaled to the planned servings, the steps,
// the nutrition for the planned amount (and where those numbers come from), the source link. An Edit button opens the normal editor.
import { $, dialog, head, toast } from '../core/dom.js';
import { state } from '../core/store.js';
import { esc, rd, r1 } from '../core/format.js';
import { recipeSummary } from '../domain/recipes.js';
import { openRecipeEditor } from './recipe-editor.js';

export function openRecipeView(recipeId, servings) {
  const r = state.recipes && Object.hasOwn(state.recipes, recipeId) ? state.recipes[recipeId] : null;
  if (!r) { toast('That recipe was deleted'); return; }
  const s = recipeSummary(r, servings, state.measures);
  const dlg = dialog();
  if (!dlg.open) dlg.showModal();
  head(s.name || 'Recipe', false);
  const amount = Math.round(s.planned * 100) / 100;
  const label = s.source === 'stated' ? 'from the page (estimate)' : s.source === 'foods' ? 'from linked foods' : 'no nutrition yet: link foods in the editor';
  const sourceLine = s.link ? `<p class="muted">Source: <a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${esc(s.link)}</a></p>` : '';   // only a plain http(s) link is clickable
  const meta = [s.time ? `${rd(s.time)} min` : '', ...s.tags].filter(Boolean);
  $('#dBody').innerHTML = `<div class="rv" id="rvRoot">
    <p><b>${amount} serving${amount === 1 ? '' : 's'} planned</b> · ${rd(s.total.k)} kcal
      <span class="muted">(${rd(s.perServing.k)} kcal per serving, ${esc(label)})</span></p>
    <div class="muted">Protein ${r1(s.total.p)} g · Carbs ${r1(s.total.c)} g · Fat ${r1(s.total.f)} g</div>
    ${meta.length ? `<div class="muted" style="margin-top:4px">${meta.map(m => esc(m)).join(' · ')}</div>` : ''}
    <h3>Ingredients${s.factor !== 1 ? ' <span class="muted">(scaled to your servings)</span>' : ''}</h3>
    ${s.ingredients.length ? `<ul>${s.ingredients.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">No ingredients.</p>'}
    <h3>Steps</h3>
    ${s.steps.length ? `<ol>${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="muted">No steps.</p>'}
    ${sourceLine}
    <div class="row" style="margin-top:12px"><button type="button" class="primary" id="rvEdit">Edit</button><button type="button" id="rvClose">Close</button></div>
  </div>`;
  $('#rvRoot').onclick = ev => {
    if (ev.target.closest('#rvClose')) dialog().close();
    else if (ev.target.closest('#rvEdit')) { dialog().close(); openRecipeEditor(r); }
  };
}
