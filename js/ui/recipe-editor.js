// Recipe editor inside the shared bottom-sheet dialog. Works on a deep copy until Save.
// All handlers live on a root div created inside #dBody, so they vanish when add-food/amount-picker replace the body.
import { state, save } from '../core/store.js';
import { $, toast, dialog, head, setCloseGuard, canClose } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { esc, rd, r1 } from '../core/format.js';
import { foodKey } from '../domain/food.js';
import { parseIngredient, formatQty } from '../domain/ingredient-parse.js';
import { newRecipe, newIngredient, resolveGrams, recipeNutrition, saveRecipe, deleteRecipe, scaleIngredientText, setFavorite, ingredientStatus } from '../domain/recipes.js';
import { shouldSuggest, suggestionFood } from '../domain/food-match.js';
import { searchAll } from '../services/foods.js';
import { loadPortions } from '../services/usda.js';
import { suggestMatches } from '../services/food-suggest.js';

let draft = null, isNew = true, importNotes = [];
// Suggested food matches for this editing session: IN MEMORY only (never saved or synced), cleared whenever the editor opens. A suggestion is only ever
// linked when the user taps Accept (or "Accept all likely"); 'check' suggestions are never included in Accept all.
let suggestions = {}, sugMsg = '', sugRunning = false, sugCancel = false, sugToken = 0;

const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** recipe: a saved recipe to edit, null for a blank new one, or an UNSAVED draft (id not in the store, e.g. an import) shown as new.
 *  notes: optional list of strings shown above the form ("check before saving"). */
export function openRecipeEditor(recipe, notes) {
  isNew = !recipe || !(state.recipes && Object.hasOwn(state.recipes, recipe.id));
  importNotes = Array.isArray(notes) ? notes.filter(n => typeof n === 'string' && n).slice(0, 10) : [];
  suggestions = {}; sugMsg = ''; sugRunning = false; sugCancel = true; sugToken++;          // a lookup still running for an earlier editor must not touch this one
  draft = recipe ? structuredClone(recipe) : newRecipe(newId('r_'), Date.now());
  if (!Array.isArray(draft.ingredients)) draft.ingredients = [];
  const dlg = dialog();
  if (!dlg.open) dlg.showModal();
  renderForm();
  readFields();                                        // normalise defaults (servings, time…) BEFORE the snapshot, or an untouched form looks "changed"
  initialSnapshot = recipe && isNew ? '' : JSON.stringify(draft);       // an imported draft is unsaved work: closing it asks first
  armGuard();
}

// Esc / backdrop / ✕ ask before discarding unsaved edits. head() clears the guard on every render, so each editor view re-arms it.
let initialSnapshot = '';
function armGuard() {
  setCloseGuard(() => { readFields(); return JSON.stringify(draft) === initialSnapshot || confirm('Discard your changes to this recipe?'); });
}

// Small link icon next to the ingredient (grey when no food is linked, accent colour when one is).
const linkIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>';

/** ONE small line under the ingredient: how it was read, and (when a food is linked) which food and how many kcal; a compact grams box when grams are unknown. */
function ingInfo(i) {
  const s = ingredientStatus(i);
  const qty = esc(s.qty), name = esc(s.name), prep = esc(s.prep), food = esc(s.foodName);
  const linked = s.linked ? ` · ${food}${s.kcal !== null ? ` · ${rd(s.kcal)} kcal (${rd(s.grams)} g)` : ''}` : '';
  const grams = s.needsGrams ? ' · enter grams <input class="grams" type="number" inputmode="decimal" step="any" min="0" placeholder="grams" aria-label="Grams" value="">' : '';
  return `${qty} <b>${name}</b>${prep ? ', ' + prep : ''}${linked}${grams}`;
}

/** The small "Suggested: <food> (likely)" note with Accept / Dismiss, shown after the ingredient's info line. Built here, not in ingInfo (which has no buttons). */
function sugHtml(i) {
  const s = Object.hasOwn(suggestions, i.id) ? suggestions[i.id] : null;
  if (!s || !s.food || i.food) return '';
  return ` · <span class="sug${s.confidence === 'check' ? ' sug-check' : ''}">Suggested: ${esc(s.food.name)} (${esc(s.confidence)}, ${rd(s.food.per100.k)} kcal /100g)</span> <button type="button" class="sug-btn" data-accept>Accept</button> <button type="button" class="sug-btn" data-dismiss>Dismiss</button>`;
}

const likelyIds = () => draft.ingredients.filter(i => !i.food && Object.hasOwn(suggestions, i.id) && suggestions[i.id].confidence === 'likely').map(i => i.id);

function acceptSuggestion(i) {
  const s = Object.hasOwn(suggestions, i.id) ? suggestions[i.id] : null; if (!s) return false;
  const food = suggestionFood(s.food); if (!food) return false;
  i.food = food; i.grams = resolveGrams(i, state.measures);        // exactly what picking the food in the picker does
  delete suggestions[i.id];
  return true;
}

const setSugMsg = t => { const el = $('#reSugMsg'); if (el) el.textContent = t; };

async function runSuggest() {
  if (sugRunning) return;
  const tok = ++sugToken;
  sugRunning = true; sugCancel = false; sugMsg = 'Looking up…'; renderForm();
  const res = await suggestMatches(draft.ingredients, {
    search: q => searchAll(q, { useUSDA: state.useUSDA, useOFF: state.useOFF, apiKey: state.apiKey }),
    loadPortions: f => loadPortions(f, state.apiKey),
    isCancelled: () => sugCancel || tok !== sugToken || !dialog().open || (!$('#rcRoot') && !$('#rcPick')),   // also stop when the editor was closed (no more requests)
    onProgress: p => { if (tok === sugToken) setSugMsg(`Looking up ${p.done} of ${p.total}…`); },
  });
  if (tok !== sugToken) return;                                   // the editor was reopened meanwhile: this run belongs to an old session
  sugRunning = false;
  for (const id of Object.keys(res.suggestions)) Object.defineProperty(suggestions, id, { value: res.suggestions[id], enumerable: true, writable: true, configurable: true });
  const found = Object.keys(res.suggestions).length;
  sugMsg = res.reason === 'rate-limit' ? `The food database's request limit was reached, so lookups stopped (${found} found so far). Add your own USDA key in Settings for more lookups (the shared demo key is limited).`
    : res.reason === 'cancelled' ? `Stopped (${found} found).`
    : found ? `Found ${found} suggestion${found === 1 ? '' : 's'}. Nothing is linked until you tap Accept.` : (res.errors[0] || 'No matches found.');
  if ($('#rcRoot')) renderForm();                                 // not while the food picker (or another dialog) is showing; going back redraws with the results
}

function renderForm() {
  head(isNew ? 'New recipe' : 'Edit recipe', false);
  armGuard();
  const d = draft;
  const canSuggest = (state.useUSDA || state.useOFF) && d.ingredients.some(i => shouldSuggest(i)), likely = likelyIds().length;
  const sugBar = `<div class="rc-sug" id="reSugBar">${sugRunning ? '<button type="button" id="reSugCancel" class="sug-btn">Cancel</button>' : canSuggest ? '<button type="button" id="reSuggest" style="min-height:44px">Suggest matches</button>' : ''}${likely ? `<button type="button" id="reAcceptAll" class="sug-btn">Accept all likely (${likely})</button>` : ''}<span id="reSugMsg" class="muted" aria-live="polite">${esc(sugMsg)}</span></div>`;
  $('#dBody').innerHTML = `<div class="rc-ed" id="rcRoot">
    ${importNotes.length ? '<div class="rc-notes" role="note"><b>Check before saving</b><ul>' + importNotes.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul></div>' : ''}
    <label for="reName">Name</label><input id="reName" value="${esc(d.name)}" autocomplete="off">
    <button type="button" id="reFav" class="fav-btn${d.favorite === true ? ' on' : ''}" aria-pressed="${d.favorite === true}" aria-label="Favourite recipe">${d.favorite === true ? '★ Favourite' : '☆ Add to favourites'}</button>
    <div class="row"><div><label for="reServ">Servings</label><input id="reServ" type="number" inputmode="decimal" step="any" min="0" value="${Number(d.servings) || 1}"></div>
    <div><label for="reTime">Total time (min)</label><input id="reTime" type="number" inputmode="numeric" min="0" value="${Number(d.totalTime) > 0 ? Number(d.totalTime) : ''}"></div></div>
    <label for="reDesc">Description</label><textarea id="reDesc">${esc(d.description)}</textarea>
    <label for="reTags">Tags (comma separated)</label><input id="reTags" value="${esc((d.tags || []).join(', '))}" autocomplete="off">
    <label for="reSource">Source (text or URL)</label><input id="reSource" value="${esc(d.source)}" autocomplete="off">
    <h3>Nutrition per serving (from the page)</h3>
    <div class="muted">Used until every ingredient is linked to a food; leave calories blank for none.${d.stated && d.stated.per ? ' Serving on the page: ' + esc(d.stated.per) : ''}</div>
    <div class="row"><div><label for="reKcal">kcal</label><input id="reKcal" type="number" inputmode="decimal" step="any" min="0" value="${d.stated ? Number(d.stated.k) : ''}"></div>
    <div><label for="reProt">Protein (g)</label><input id="reProt" type="number" inputmode="decimal" step="any" min="0" value="${d.stated ? Number(d.stated.p) : ''}"></div></div>
    <div class="row"><div><label for="reCarb">Carbs (g)</label><input id="reCarb" type="number" inputmode="decimal" step="any" min="0" value="${d.stated ? Number(d.stated.c) : ''}"></div>
    <div><label for="reFat">Fat (g)</label><input id="reFat" type="number" inputmode="decimal" step="any" min="0" value="${d.stated ? Number(d.stated.f) : ''}"></div></div>
    <h3>Ingredients</h3>
    <label for="rePaste">Paste ingredients (one per line)</label><textarea id="rePaste" placeholder="2 cups flour&#10;1 tbsp olive oil"></textarea>
    <button id="reAddIng" style="margin-top:6px;min-height:44px">Add</button>
    ${sugBar}
    <div id="reIngs">${d.ingredients.map(i => `<div class="ing" data-id="${esc(i.id)}"><div class="row"><input class="ing-raw" value="${esc(i.raw)}" aria-label="Ingredient"><button type="button" class="lnk ${i.food ? 'linked' : ''}" data-link aria-label="${i.food ? 'Change food for ' : 'Link food for '}${esc(i.name)}" title="${i.food ? 'Change food' : 'Link food'}">${linkIcon}</button><button class="x" data-rm aria-label="Remove">✕</button></div><div class="ing-info muted">${ingInfo(i)}${sugHtml(i)}</div></div>`).join('')}</div>
    <div class="rc-scale" id="reScale"></div>
    <div class="card rc-sum" id="reSum"></div>
    <h3>Steps (one per line)</h3><textarea id="reSteps">${esc((d.steps || []).join('\n'))}</textarea>
    <div class="rc-actions"><button class="primary" id="reSave">Save</button><button id="reCancel">Cancel</button>${isNew ? '' : '<button class="danger" id="reDel">Delete</button>'}</div>
  </div>`;
  const root = $('#rcRoot');
  const find = el => { const row = el.closest('.ing'); return row && draft.ingredients.find(i => i.id === row.dataset.id); };

  root.oninput = ev => {
    const t = ev.target;
    if (t.id === 'reName') d.name = t.value;
    else if (t.id === 'reServ') { const v = +t.value; d.servings = v > 0 ? v : 1; summary(); scaleView(); }
    else if (t.id === 'reTime') d.totalTime = Math.max(0, +t.value || 0);
    else if (t.id === 'reDesc') d.description = t.value;
    else if (t.id === 'reTags') d.tags = t.value.split(',').map(x => x.trim()).filter(Boolean);
    else if (t.id === 'reSource') d.source = t.value;
    else if (t.id === 'reKcal' || t.id === 'reProt' || t.id === 'reCarb' || t.id === 'reFat') { readFields(); summary(); }
    else if (t.id === 'reSteps') d.steps = t.value.split('\n').map(x => x.trim()).filter(Boolean);
    else if (t.classList.contains('grams')) { const i = find(t); if (i) { i.grams = +t.value > 0 ? +t.value : null; summary(); } }
    else if (t.id === 'reScaleN') scaleView();
  };
  // re-parse a raw line when the edit is committed (change fires on blur; only the info block is redrawn so clicks aren't lost)
  root.onchange = ev => {
    const t = ev.target; if (!t.classList.contains('ing-raw')) return;
    const i = find(t); if (!i) return;
    const oldName = i.name;
    Object.assign(i, parseIngredient(t.value));
    if (i.name !== oldName) delete suggestions[i.id];                  // the suggestion was for the old wording
    i.grams = i.food ? resolveGrams(i, state.measures) : null;
    t.closest('.ing').querySelector('.ing-info').innerHTML = ingInfo(i) + sugHtml(i);
    summary(); scaleView();
  };
  root.onclick = ev => {
    const t = ev.target;
    if (t.id === 'reAddIng') {
      const lines = $('#rePaste').value.split('\n').map(x => x.trim()).filter(Boolean);
      if (!lines.length) return;
      lines.forEach(l => draft.ingredients.push(newIngredient(l, newId('i_'))));
      renderForm();
    } else if (t.closest('[data-rm]')) {
      const i = find(t); if (i) { draft.ingredients = draft.ingredients.filter(x => x !== i); renderForm(); }
    } else if (t.closest('[data-accept]')) {
      const i = find(t); if (i && acceptSuggestion(i)) renderForm();
    } else if (t.closest('[data-dismiss]')) {
      const i = find(t); if (i) { delete suggestions[i.id]; renderForm(); }
    } else if (t.id === 'reSuggest') runSuggest();
    else if (t.id === 'reSugCancel') { sugCancel = true; setSugMsg('Stopping…'); }
    else if (t.id === 'reAcceptAll') {
      let n = 0; for (const i of draft.ingredients) if (likelyIds().includes(i.id) && acceptSuggestion(i)) n++;
      sugMsg = n ? `Linked ${n} ingredient${n === 1 ? '' : 's'}. Check the numbers below.` : ''; renderForm();
    } else if (t.closest('[data-link]')) {
      const i = find(t); if (i) renderPicker(i);
    } else if (t.closest('#reFav')) toggleFav();
    else if (t.id === 'reSave') doSave();
    else if (t.id === 'reCancel') { if (canClose()) dialog().close(); }
    else if (t.id === 'reDel') {
      if (!confirm('Delete this recipe?')) return;
      deleteRecipe(state, draft.id, Date.now()); save(); emit('recipes:changed'); dialog().close(); toast('Recipe deleted');
    }
  };
  summary(); scaleView();
}

function summary() {
  const el = $('#reSum'); if (!el) return;
  const n = recipeNutrition(draft, state.measures), p = n.perServing;
  el.innerHTML = `<div class="big">${rd(p.k)} <span class="muted" style="font-size:14px;font-weight:400">kcal / serving</span></div>
    <div class="macros"><div><span class="muted">Protein</span><b>${r1(p.p)} g</b></div><div><span class="muted">Carbs</span><b>${r1(p.c)} g</b></div><div><span class="muted">Fat</span><b>${r1(p.f)} g</b></div></div>
    <div class="muted" style="margin-top:8px">${n.source === 'stated' ? 'Numbers are from the page (estimate): link all ingredients to use your own foods.' : n.source === 'foods' ? 'Numbers are from linked foods.' : 'No numbers yet: link foods or enter nutrition above.'}</div>
    <div class="muted" style="margin-top:4px">${Number(n.linked) || 0} of ${Number(n.count) || 0} ingredients linked${(Number(n.linked) || 0) >= (Number(n.count) || 0) ? '' : ' · missing: ' + esc((n.missing || []).join(', '))}</div>`;
}

function scaleView() {
  const el = $('#reScale'); if (!el) return;
  if (!draft.ingredients.length) { el.innerHTML = ''; return; }
  if (!$('#reScaleN')) el.innerHTML = `<label for="reScaleN">Scale to N servings (display only)</label><input id="reScaleN" type="number" inputmode="decimal" step="any" min="0" placeholder="e.g. 8"><ul id="reScaleOut"></ul>`;
  const n = +$('#reScaleN').value;
  $('#reScaleOut').innerHTML = n > 0 ? draft.ingredients.map(i => `<li>${esc(scaleIngredientText(i, n / (Number(draft.servings) || 1)))}</li>`).join('') : '';
}

/** Read the fields as they are RIGHT NOW (autofill / IME can change a field without a usable input event). */
function readFields() {
  const val = id => { const el = $('#' + id); return el ? el.value : null; };
  if (val('reName') !== null) draft.name = val('reName');
  if (val('reServ') !== null) { const v = +val('reServ'); draft.servings = v > 0 ? v : 1; }
  if (val('reTime') !== null) draft.totalTime = Math.max(0, +val('reTime') || 0);
  if (val('reDesc') !== null) draft.description = val('reDesc');
  if (val('reTags') !== null) draft.tags = val('reTags').split(',').map(x => x.trim()).filter(Boolean);
  if (val('reSource') !== null) draft.source = val('reSource');
  const kcal = val('reKcal');                                    // stated nutrition: blank or zero kcal = none; the page's serving text is kept
  if (kcal !== null) {
    const grams = id => { const v = +val(id); return Number.isFinite(v) && v > 0 ? Math.min(5000, v) : 0; };
    if (kcal.trim() === '' || !(+kcal >= 0) || +kcal > 20000) draft.stated = null;
    else draft.stated = { k: +kcal, p: grams('reProt'), c: grams('reCarb'), f: grams('reFat'), per: draft.stated && typeof draft.stated.per === 'string' ? draft.stated.per : '' };
  }
  if (val('reSteps') !== null) draft.steps = val('reSteps').split('\n').map(x => x.trim()).filter(Boolean);
}

// A saved recipe's star applies at once (like the star on the card, Cancel does not undo it); a new recipe keeps it in the draft until Save.
function toggleFav() {
  const want = draft.favorite !== true;
  if (!isNew && setFavorite(state, draft.id, want, Date.now())) {
    save(); emit('recipes:changed');
    try { const snap = JSON.parse(initialSnapshot); snap.favorite = want; initialSnapshot = JSON.stringify(snap); } catch { /* guard just asks once more */ }
  }
  draft.favorite = want;
  const b = $('#reFav');
  if (b) { b.classList.toggle('on', want); b.setAttribute('aria-pressed', String(want)); b.textContent = want ? '★ Favourite' : '☆ Add to favourites'; }
}

function doSave() {
  readFields();
  if (!isNew && state.recipes[draft.id]) draft.favorite = state.recipes[draft.id].favorite === true;   // never overwrite a newer star (e.g. from sync) with a stale draft
  draft.name = String(draft.name || '').trim();
  if (!draft.name) { toast('Enter a recipe name'); return; }
  if (!(Number(draft.servings) > 0)) draft.servings = 1;
  saveRecipe(state, draft, Date.now()); save(); emit('recipes:changed'); dialog().close(); toast('Recipe saved');
}

/* ---------- inline food picker ---------- */
function localMatches(q) {
  q = q.toLowerCase();
  const all = [...state.custom.map(f => ({ ...f, tag: 'My food' })), ...state.recent.map(f => ({ ...f, tag: 'Recent' }))];
  const seen = new Set();
  return all.filter(f => (!q || (f.name + ' ' + (f.brand || '')).toLowerCase().includes(q)) && !seen.has(foodKey(f)) && seen.add(foodKey(f))).slice(0, 15);
}

function renderPicker(ing) {
  head('Link food', false);
  armGuard();
  let local = [], remote = [], msg = '';
  $('#dBody').innerHTML = `<div class="rc-ed" id="rcPick"><button class="ghost" id="pkBack" style="min-height:44px">‹ Back to recipe</button>
    <p class="muted">${esc(ing.raw)}</p>
    <div class="row"><input id="pkQ" type="search" placeholder="Search foods" enterkeyhint="search" autocomplete="off" value="${esc(ing.name)}"><button class="fit" id="pkGo">Search</button></div>
    <div id="pkRes"></div></div>`;
  const item = (f, i, from) => `<div class="res" data-i="${i}" data-from="${from}"><div class="nm"><div>${esc(f.name)}</div>
    <div class="muted">${esc(f.brand ? f.brand + ' · ' : '')}${rd(f.per100.k)} kcal /100g</div></div><span class="badge">${esc(f.tag || f.source)}</span></div>`;
  const draw = () => {
    local = localMatches($('#pkQ').value.trim());
    $('#pkRes').innerHTML = (local.length ? `<div class="muted" style="margin-top:10px">Your foods</div>` + local.map((f, i) => item(f, i, 'l')).join('') : '')
      + (msg ? `<p class="muted">${esc(msg)}</p>` : '')
      + (remote.length ? `<div class="muted" style="margin-top:10px">Database results</div>` + remote.map((f, i) => item(f, i, 'r')).join('') : '');
  };
  const go = async () => {
    const q = $('#pkQ').value.trim(); if (!q) return;
    if (!state.useUSDA && !state.useOFF) { msg = 'Enable a food database in Settings.'; draw(); return; }
    msg = 'Searching…'; remote = []; draw();
    const { results, errors } = await searchAll(q, { useUSDA: state.useUSDA, useOFF: state.useOFF, apiKey: state.apiKey });
    if (!$('#pkQ') || $('#pkQ').value.trim() !== q) return;
    remote = results; msg = !results.length ? (errors.join(' · ') || 'No results found.') : errors.join(' · '); draw();
  };
  $('#rcPick').onclick = ev => {
    const t = ev.target;
    if (t.id === 'pkBack') { renderForm(); return; }
    if (t.id === 'pkGo') { go(); return; }
    const r = t.closest('.res'); if (!r) return;
    const f = (r.dataset.from === 'l' ? local : remote)[+r.dataset.i]; if (!f) return;
    const food = { name: f.name, brand: f.brand || '', source: f.source || '', per100: f.per100, servingG: f.servingG || 0, servingLabel: f.servingLabel || '', ...(f.nut ? { nut: f.nut } : {}) };
    if (f.fdcId) food.fdcId = f.fdcId;
    if (f.portions) food.portions = f.portions;
    ing.food = food; ing.grams = resolveGrams(ing, state.measures); delete suggestions[ing.id];
    renderForm();
  };
  $('#pkQ').oninput = draw;
  $('#pkQ').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  draw();
}
