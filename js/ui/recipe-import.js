// "Import" on the Recipes screen: paste a web address (needs the import service on the user's sync project) or paste the recipe text /
// page source. Whatever is read opens in the normal recipe editor as a NEW, UNSAVED recipe for review; nothing is saved here.
import { $, dialog, head } from '../core/dom.js';
import { esc } from '../core/format.js';
import { importFromHtml, importFromText, toRecipe } from '../domain/recipe-import.js';
import { recipeImportAvailable, fetchRecipePage } from '../services/recipe-fetch.js';
import { effectiveConnection } from '../services/sync/config.js';
import { readSyncConfig } from '../services/sync/connection.js';
import { DEFAULT_SYNC } from '../services/sync/defaults.js';
import { openRecipeEditor } from './recipe-editor.js';

const newId = () => 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const looksLikePage = s => /<\s*(?:!doctype|html|head|body|script)\b/i.test(s);

function openImport() {
  const conn = effectiveConnection(readSyncConfig(), DEFAULT_SYNC);
  const available = recipeImportAvailable(conn);
  const dlg = dialog();
  if (!dlg.open) dlg.showModal();
  head('Import a recipe', false);
  const fromWeb = available
    ? '<label for="riUrl">Web address</label><input id="riUrl" type="url" inputmode="url" placeholder="https://…" autocomplete="off" autocapitalize="off">'
    : '<p class="muted">Importing from a web address needs the import service on your sync project (see docs/SYNC-SETUP.md). You can still paste the text below.</p>';
  $('#dBody').innerHTML = `<div class="ri" id="riRoot">
    <p class="muted" style="margin-top:0">What is read opens in the editor so you can check it before saving. Calories are never taken from the page: link foods to the ingredients yourself.</p>
    ${fromWeb}
    <label for="riText">Or paste the text, or the page source</label>
    <textarea id="riText" rows="8" placeholder="Title, Ingredients, Method…" autocomplete="off"></textarea>
    <p id="riMsg" class="ri-msg" role="alert" aria-live="polite"></p>
    <button type="button" class="primary" id="riGo" style="width:100%">Import</button>
  </div>`;
  const msg = $('#riMsg'), go = $('#riGo');
  const say = t => { msg.innerHTML = esc(t); };

  go.onclick = async () => {
    say('');
    const addr = available && $('#riUrl') ? $('#riUrl').value.trim() : '';
    const pasted = $('#riText').value.trim();
    if (!addr && !pasted) { say('Enter a web address or paste a recipe.'); return; }
    go.disabled = true; go.textContent = 'Importing…'; go.setAttribute('aria-busy', 'true');
    try {
      let res = null, src = '';
      if (addr) {
        const page = await fetchRecipePage(conn, addr);
        res = importFromHtml(page.html); src = page.finalUrl;
        if (!res) { say('No recipe data was found on that page. Paste the recipe text instead.'); return; }
      } else if (looksLikePage(pasted)) {
        res = importFromHtml(pasted);
        if (!res) { say('No recipe data was found in that page source. Paste just the recipe text instead.'); return; }
      } else res = importFromText(pasted);
      const id = newId(), now = Date.now();
      const rec = toRecipe(res, id, now, src);
      const notes = res.warnings;
      openRecipeEditor(rec, notes);
    } catch (e) {
      say(e && e.message ? e.message : 'Something went wrong. Try again, or paste the recipe instead.');
    } finally {
      if (go.isConnected) { go.disabled = false; go.textContent = 'Import'; go.removeAttribute('aria-busy'); }
    }
  };
}

export function initRecipeImport() {
  const b = $('#rcImport');
  if (b) b.onclick = openImport;
}
