// Settings -> "Google Health sync" and the Diary's "Sync Google Health" button (backlog item 20; specs docs/specs/google-health-sync.md and google-health-seamless.md, D62, D64).
// The app has a built-in (public) Client ID; one saved on THIS device wins over it (services/google-health-api.js). A tap signs in with Google, reads the last
// 7 days of steps and sleep and merges them into state.activity. When the app opens (or comes back to the front) and the last sync is over 3 hours old, ONE quiet
// attempt is made (Google must not show a screen); if it does not work nothing is shown and the button stays. The very first sync is always a tap.
// Everything shown from Google, from storage or from an error is written with textContent only.
import { state, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { createClientIdStore, createHealthSync, createSyncPrefs, preloadGoogle, DEFAULT_CLIENT_ID } from '../services/google-health-api.js';
import { applyHealthSync, healthSyncText, shouldAutoSync, syncAgoText } from '../domain/google-health-api.js';

const deviceStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const AUTO_RETRY_MS = 3 * 3600000;

export function initHealthSync() {
  const input = $('#ghSyncClientId'), saveBtn = $('#ghSyncSave'), removeBtn = $('#ghSyncRemove'), syncBtn = $('#ghSyncBtn'), status = $('#ghSyncStatus'), diaryBtn = $('#ghSyncDiary');
  const using = $('#ghSyncUsing'), autoBox = $('#ghSyncAuto'), lastLine = $('#ghSyncLast');
  if (!input || !saveBtn || !removeBtn || !syncBtn || !status || !diaryBtn || !using || !autoBox || !lastLine) return;
  const storage = deviceStorage();
  const store = createClientIdStore(storage, DEFAULT_CLIENT_ID);
  const prefs = createSyncPrefs(storage);
  const sync = createHealthSync();
  let running = false, lastAuto = 0;

  const show = () => {
    const id = store.get();
    input.value = store.usingDefault() ? '' : id;                    // the box shows only this device's own ID, never the built-in one
    diaryBtn.hidden = !id;
    using.textContent = !id ? '' : store.usingDefault() ? 'Using the built-in Client ID.' : 'Using the Client ID saved on this device.';
    autoBox.checked = prefs.getAuto();
    lastLine.textContent = syncAgoText(prefs.getLastSyncAt(), Date.now());
  };
  const busy = on => { running = on; syncBtn.disabled = on; diaryBtn.disabled = on; };

  saveBtn.onclick = () => {
    const r = store.set(input.value);
    if (r.ok) { status.textContent = 'Client ID saved on this device.'; show(); return; }
    status.textContent = r.message;
    if (/client secret/.test(r.message)) input.value = '';           // a pasted secret is never left on the screen
  };
  removeBtn.onclick = () => { store.clear(); show(); status.textContent = store.usingDefault() ? 'Client ID removed. Using the built-in Client ID.' : 'Client ID removed.'; };
  autoBox.onchange = () => { prefs.setAuto(autoBox.checked); };

  // mode: 'settings' (the card's button), 'diary' (the Diary button, also toasts) or 'auto' (the quiet attempt on opening)
  async function run(mode) {
    if (running) return;
    const quiet = mode === 'auto';
    const id = store.get();                                           // the SAVED ID (or the built-in one), not the unsaved text in the box
    if (!id) { if (!quiet) { status.textContent = 'Enter a Client ID first.'; if (mode === 'diary') toast(status.textContent); } return; }
    busy(true);
    if (!quiet) status.textContent = 'Syncing with Google Health…';
    let message = '';
    try {
      const res = quiet ? await sync.run(id, { silent: true }) : await sync.run(id);
      if (res.ok) {
        const r = applyHealthSync(state, res.days, Date.now());       // an identical second sync changes nothing (updatedAt is not bumped)
        if (r.added || r.updated) {
          save();
          emit('diary:changed');                                      // the dials, the activity line and the water card redraw without a reload
        }
        prefs.setLastSyncAt(Date.now());                              // a no-change sync counts too
        message = healthSyncText(res.days, res.workoutsError);        // a failed workouts request adds one fixed sentence; steps and sleep are still applied
      } else if (!res.silent) message = res.message;                  // a quiet attempt that could not sign in says nothing; anything after the token is shown
    } catch { message = quiet ? '' : 'Google Health sync failed.'; }
    if (message) { status.textContent = message; if (mode !== 'settings') toast(message); }
    busy(false);
    show();
  }
  // The first touch of a sync button (with an ID available) starts loading Google's script, so the sign-in popup is not blocked for opening after a wait.
  const warm = () => { if (store.get()) preloadGoogle(); };
  for (const b of [syncBtn, diaryBtn]) { b.addEventListener('pointerdown', warm, { once: true }); b.addEventListener('focus', warm, { once: true }); }
  syncBtn.onclick = () => run('settings');
  diaryBtn.onclick = () => run('diary');

  // One quiet attempt per page load per 3 hours of page time, whether it worked or not (a failed attempt leaves the last sync old, so without this every
  // tab switch would try again).
  const maybeAuto = () => {
    if (running) return;
    const now = Date.now();
    if (lastAuto && now - lastAuto < AUTO_RETRY_MS) return;
    if (!shouldAutoSync({ enabled: prefs.getAuto(), hasClientId: !!store.get(), lastSyncAt: prefs.getLastSyncAt(), now })) return;
    lastAuto = now;
    run('auto');
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { show(); maybeAuto(); } });
  const settingsTab = $('[data-tab="settings"]');
  if (settingsTab) settingsTab.addEventListener('click', show);
  show();
  maybeAuto();
}
