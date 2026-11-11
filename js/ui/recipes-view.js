// Recipes screen: search, list of recipe cards, '+ New recipe'. Editing happens in ui/recipe-editor.js.
import { state, save } from '../core/store.js';
import { $ } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { esc, rd } from '../core/format.js';
import { searchRecipes, setFavorite } from '../domain/recipes.js';
import { recipeNutrition } from '../domain/recipes.js';
import { registerTab } from './tabs.js';
import { openRecipeEditor } from './recipe-editor.js';

let favOnly = false;

export function renderRecipes() {
  const q = $('#rcQ').value.trim();
  const list = searchRecipes(state, q, { favoritesOnly: favOnly });
  const fb = $('#rcFav');
  fb.setAttribute('aria-pressed', String(favOnly)); fb.classList.toggle('primary', favOnly); fb.textContent = favOnly ? '★ Favourites' : '☆ Favourites';
  $('#rcList').innerHTML = list.length ? list.map(r => {
    const n = recipeNutrition(r, state.measures), t = Number(r.totalTime) || 0, sv = Number(r.servings) || 0;
    return `<div class="card rc-card" data-id="${esc(r.id)}"><div class="rc-head"><h2>${esc(r.name)}</h2><button type="button" class="ghost fit rc-star${r.favorite === true ? ' on' : ''}" data-fav aria-pressed="${r.favorite === true}" aria-label="Favourite: ${esc(r.name)}">${r.favorite === true ? '★' : '☆'}</button></div>
      <div class="rc-meta muted"><span>${sv} serving${sv === 1 ? '' : 's'}</span>${t > 0 ? `<span>${t} min</span>` : ''}
      <span>≈ ${rd(n.perServing.k)} kcal / serving</span>${n.source === 'stated' ? '<span class="badge">from page</span>' : n.complete ? '' : '<span class="badge warn">incomplete</span>'}</div></div>`;
  }).join('') : `<p class="muted">${q ? 'No recipes match.' : favOnly && Object.keys(state.recipes || {}).length ? 'No favourites yet. Tap the star on a recipe to add one.' : 'No recipes yet. Tap “+ New recipe” to add one.'}</p>`;
}

export function initRecipes() {
  registerTab('recipes', renderRecipes);
  $('#rcQ').oninput = renderRecipes;
  $('#rcNew').onclick = () => openRecipeEditor(null);
  $('#rcFav').onclick = () => { favOnly = !favOnly; renderRecipes(); };
  $('#rcList').onclick = ev => {
    const c = ev.target.closest('[data-id]'); if (!c) return;
    if (ev.target.closest('[data-fav]')) {
      const r = state.recipes[c.dataset.id];
      if (r && setFavorite(state, r.id, r.favorite !== true, Date.now())) { save(); emit('recipes:changed'); }
      return;
    }
    const r = state.recipes[c.dataset.id]; if (r) openRecipeEditor(r);
  };
  on('recipes:changed', renderRecipes);
}
