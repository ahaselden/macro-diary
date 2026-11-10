// Recipes screen: search, list of recipe cards, '+ New recipe'. Editing happens in ui/recipe-editor.js.
import { state } from '../core/store.js';
import { $ } from '../core/dom.js';
import { on } from '../core/bus.js';
import { esc, rd } from '../core/format.js';
import { searchRecipes } from '../domain/recipes.js';
import { recipeNutrition } from '../domain/recipes.js';
import { registerTab } from './tabs.js';
import { openRecipeEditor } from './recipe-editor.js';

export function renderRecipes() {
  const q = $('#rcQ').value.trim();
  const list = searchRecipes(state, q);
  $('#rcList').innerHTML = list.length ? list.map(r => {
    const n = recipeNutrition(r, state.measures), t = Number(r.totalTime) || 0, sv = Number(r.servings) || 0;
    return `<div class="card rc-card" data-id="${esc(r.id)}"><h2>${esc(r.name)}</h2>
      <div class="rc-meta muted"><span>${sv} serving${sv === 1 ? '' : 's'}</span>${t > 0 ? `<span>${t} min</span>` : ''}
      <span>≈ ${rd(n.perServing.k)} kcal / serving</span>${n.complete ? '' : '<span class="badge warn">incomplete</span>'}</div></div>`;
  }).join('') : `<p class="muted">${q ? 'No recipes match.' : 'No recipes yet. Tap “+ New recipe” to add one.'}</p>`;
}

export function initRecipes() {
  registerTab('recipes', renderRecipes);
  $('#rcQ').oninput = renderRecipes;
  $('#rcNew').onclick = () => openRecipeEditor(null);
  $('#rcList').onclick = ev => {
    const c = ev.target.closest('[data-id]'); if (!c) return;
    const r = state.recipes[c.dataset.id]; if (r) openRecipeEditor(r);
  };
  on('recipes:changed', renderRecipes);
}
