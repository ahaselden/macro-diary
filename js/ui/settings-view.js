// Settings tab: goals, units, API key, source toggles, backup/restore, wipe. (Appearance lives in theme.js.)
import { state, save, replace, defaults } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { fmt } from '../core/dates.js';
import { touchSettings } from '../domain/entries.js';
import { apiKeySummary } from '../domain/api-key.js';
import { download } from '../services/files.js';
import { registerTab } from './tabs.js';
import { setThemePanel } from './theme.js';
import { restoreFlow } from './restore-dialog.js';

export function loadSettings() {
  $('#gK').value = state.goals.k; $('#gP').value = state.goals.p; $('#gC').value = state.goals.c; $('#gF').value = state.goals.f;
  $('#wUnit').value = state.weightUnit; $('#srcUSDA').checked = state.useUSDA; $('#srcOFF').checked = state.useOFF;
  $('#keyLine').textContent = apiKeySummary(state.apiKey);
  if ($('#keyEditor').hidden) resetKeyEditor();               // a sync refresh must not overwrite text being typed in an open editor
}

/** Inputs back to the saved values (the key and its sync switch are only changed through Edit + Save). */
function resetKeyEditor() { $('#apiKey').value = typeof state.apiKey === 'string' ? state.apiKey : ''; $('#syncApiKey').checked = state.syncApiKey === true; }
function setKeyEditor(open) {
  $('#keyEditor').hidden = !open; $('#keyEdit').hidden = open; $('#keyEdit').setAttribute('aria-expanded', String(open));
}

const num = (s, d) => { const v = parseFloat($(s).value); return v >= 0 ? v : d; };

export function initSettings() {
  ['#gK', '#gP', '#gC', '#gF', '#wUnit', '#srcUSDA', '#srcOFF'].forEach(s => $(s).addEventListener('change', () => {
    const synced = () => JSON.stringify([state.goals, state.weightUnit, state.useUSDA, state.useOFF, state.syncApiKey, state.syncApiKey ? state.apiKey : '']), before = synced();
    state.goals = { k: num('#gK', state.goals.k), p: num('#gP', state.goals.p), c: num('#gC', state.goals.c), f: num('#gF', state.goals.f) };
    state.weightUnit = $('#wUnit').value; state.useUSDA = $('#srcUSDA').checked; state.useOFF = $('#srcOFF').checked;
    if (synced() !== before) touchSettings(state, Date.now());   // only synced settings bump the sync timestamp (the key only counts while its sync switch is on; theme is per-device)
    save(); emit('diary:changed'); toast('Saved');
  }));
  $('#keyEdit').onclick = () => { resetKeyEditor(); setKeyEditor(true); $('#apiKey').focus(); };
  $('#keyCancel').onclick = () => { resetKeyEditor(); setKeyEditor(false); $('#keyEdit').focus(); };
  $('#keySave').onclick = () => {
    const synced = () => JSON.stringify([state.syncApiKey, state.syncApiKey ? state.apiKey : '']), before = synced();
    state.apiKey = $('#apiKey').value.trim(); state.syncApiKey = $('#syncApiKey').checked;
    if (synced() !== before) touchSettings(state, Date.now());   // the key only counts for sync while its switch is on
    save(); emit('diary:changed'); toast('Saved');
    $('#keyLine').textContent = apiKeySummary(state.apiKey); setKeyEditor(false); $('#keyEdit').focus();
  };
  $('#bkExport').onclick = () => download(`macro-diary-backup-${fmt(new Date())}.json`, JSON.stringify(state), 'application/json');
  $('#bkImport').onclick = () => $('#bkFile').click();
  $('#bkFile').onchange = async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text()); if (!d || typeof d.days !== 'object' || Array.isArray(d.days) || !d.goals) throw 0;
      restoreFlow(d);
    } catch { toast('Not a valid backup file'); }
  };
  $('#wipe').onclick = () => {
    if (confirm('Delete ALL diary data on this device? This cannot be undone.')) {
      replace(defaults()); save(); emit('settings:changed'); emit('diary:changed'); toast('All data deleted');
    }
  };
  registerTab('settings', () => { setThemePanel(false); setKeyEditor(false); resetKeyEditor(); loadSettings(); });   // opening Settings always shows the collapsed key line
  on('settings:changed', loadSettings);
}
