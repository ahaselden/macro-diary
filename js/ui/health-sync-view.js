// Settings -> "Google Health sync" and the Diary's "Sync Google Health" button (backlog item 20, step 2; spec docs/specs/google-health-sync.md, D62).
// The Client ID is kept on THIS device only (services/google-health-api.js). A tap signs in with Google, reads the last 7 days of steps and sleep and merges
// them into state.activity. Manual only: nothing runs when the app or the Diary opens, and Google's script is not even loaded until the first tap.
// Everything shown from Google or from an error is written with textContent only.
import { state, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { createClientIdStore, createHealthSync } from '../services/google-health-api.js';
import { applyHealthSync, healthSyncText } from '../domain/google-health-api.js';

const deviceStorage = () => { try { return globalThis.localStorage; } catch { return null; } };

export function initHealthSync() {
  const input = $('#ghSyncClientId'), saveBtn = $('#ghSyncSave'), removeBtn = $('#ghSyncRemove'), syncBtn = $('#ghSyncBtn'), status = $('#ghSyncStatus'), diaryBtn = $('#ghSyncDiary');
  if (!input || !saveBtn || !removeBtn || !syncBtn || !status || !diaryBtn) return;
  const store = createClientIdStore(deviceStorage());
  const sync = createHealthSync();
  let running = false;

  const show = () => { input.value = store.get(); diaryBtn.hidden = !store.get(); };
  const busy = on => { running = on; syncBtn.disabled = on; diaryBtn.disabled = on; };

  saveBtn.onclick = () => {
    const r = store.set(input.value);
    if (r.ok) { status.textContent = 'Client ID saved on this device.'; diaryBtn.hidden = false; return; }
    status.textContent = r.message;
    if (/client secret/.test(r.message)) input.value = '';           // a pasted secret is never left on the screen
  };
  removeBtn.onclick = () => { store.clear(); input.value = ''; diaryBtn.hidden = true; status.textContent = 'Client ID removed.'; };

  async function run(fromDiary) {
    if (running) return;
    const id = store.get();                                           // the SAVED ID, not the unsaved text in the box
    if (!id) { status.textContent = 'Enter a Client ID first.'; if (fromDiary) toast(status.textContent); return; }
    busy(true);
    status.textContent = 'Syncing with Google Health…';
    let message;
    try {
      const res = await sync.run(id);
      if (res.ok) {
        applyHealthSync(state, res.days, Date.now());                 // an identical second sync changes nothing (updatedAt is not bumped)
        save();
        emit('diary:changed');                                        // the dials, the activity line and the water card redraw without a reload
        message = healthSyncText(res.days);
      } else message = res.message;
    } catch { message = 'Google Health sync failed.'; }
    status.textContent = message;
    if (fromDiary) toast(message);
    busy(false);
  }
  syncBtn.onclick = () => run(false);
  diaryBtn.onclick = () => run(true);
  show();
}
