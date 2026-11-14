// Settings -> "Import from Google Health": the owner picks the Takeout zip, the app reads it HERE (nothing is uploaded, the file is not kept anywhere)
// and stores one small record per day (steps, sleep, workouts) in state.activity. The Diary shows it read-only. Spec: docs/specs/google-health-import.md.
// Every text shown here may come from the file or an error, so it is written with textContent only.
import { state, save } from '../core/store.js';
import { $ } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { fmt } from '../core/dates.js';
import { readTakeout } from '../services/google-health.js';
import { ZipError } from '../services/zip.js';
import { applyActivityImport } from '../domain/activity.js';
import { importSummaryText } from '../domain/health-import.js';

export function initHealthImport() {
  const file = $('#ghFile'), scope = $('#ghScope'), start = $('#ghStart'), cancel = $('#ghCancel'), status = $('#ghStatus');
  if (!file || !scope || !start || !cancel || !status) return;
  let running = null;                                                  // the AbortController of the import in progress

  const sync = () => { start.disabled = !!running || !(file.files && file.files.length); file.disabled = !!running; scope.disabled = !!running; cancel.hidden = !running; };
  file.onchange = () => { status.textContent = ''; sync(); };
  cancel.onclick = () => { if (running) running.abort(); };

  start.onclick = async () => {
    const zip = file.files && file.files[0];
    if (!zip || running) return;
    running = new AbortController();
    status.textContent = 'Reading the file…';
    sync();
    try {
      const out = await readTakeout(zip, {
        scope: scope.value === 'all' ? 'all' : 'year', today: fmt(new Date()), tz: ms => -new Date(ms).getTimezoneOffset(), signal: running.signal,
        onProgress: ({ done, total }) => { status.textContent = `Reading ${done} of ${total} files…`; },
      });
      if (running && running.signal && running.signal.aborted) throw new ZipError('aborted', 'Cancelled.');   // never save after Cancel
      applyActivityImport(state, out.days, Date.now());                // an identical re-import changes nothing (updatedAt is not bumped)
      save();
      emit('diary:changed');
      status.textContent = importSummaryText({ ...out.counts, left: out.left });
    } catch (e) {
      status.textContent = e instanceof ZipError ? e.message : 'Could not read this file.';
    } finally {
      running = null;
      file.value = '';                                                 // the file is never kept: not in the state, not in storage
      sync();
    }
  };
  sync();
}
