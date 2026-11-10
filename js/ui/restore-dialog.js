// The Merge / Replace / Cancel dialog shown after choosing a backup file.
import { state, save, replace } from '../core/store.js';
import { $, toast, dialog, head } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { validEntry, newEntries, mergeRestore } from '../domain/backup.js';

export function restoreFlow(d) {
  const dlg = dialog();
  const fresh = newEntries(state, d), nNew = Object.values(fresh).reduce((a, l) => a + l.length, 0), nDays = Object.keys(fresh).length;
  const total = Object.values(d.days).reduce((a, l) => a + (Array.isArray(l) ? l.filter(validEntry).length : 0), 0);
  const nBackupDays = Object.values(d.days).filter(l => Array.isArray(l) && l.some(validEntry)).length;
  head('Restore backup', false);
  $('#dBody').innerHTML = `<p style="margin-top:0">This backup has <b>${Number(total)}</b> entries across <b>${Number(nBackupDays)}</b> days.
      <b>${Number(nNew)}</b> ${nNew === 1 ? 'entry is' : 'entries are'} new to this device${nNew ? ` (across ${Number(nDays)} ${nDays === 1 ? 'day' : 'days'})` : ''}.</p>
    <button class="primary" style="width:100%" id="rMerge">Merge – keep both</button>
    <p class="muted" style="margin:6px 0 14px">Adds what's missing and keeps everything already here. Your goals, theme and settings stay as they are.</p>
    <button class="danger" style="width:100%" id="rReplace">Replace everything</button>
    <p class="muted" style="margin:6px 0 14px">Makes this device an exact copy of the backup. Anything logged here that isn't in the file is lost.</p>
    <button style="width:100%" id="rCancel">Cancel</button>`;
  if (!dlg.open) dlg.showModal();
  $('#rCancel').onclick = () => dlg.close();
  $('#rMerge').onclick = () => {
    replace(mergeRestore(state, d)); save(); dlg.close();
    emit('settings:changed'); emit('diary:changed');
    toast(nNew ? `Merged – ${nNew} new ${nNew === 1 ? 'entry' : 'entries'}` : 'Merged – nothing new to add');
  };
  $('#rReplace').onclick = () => {
    if (!confirm('Replace ALL data on this device with the backup? This cannot be undone.')) return;
    replace(d); save(); dlg.close();
    emit('settings:changed'); emit('diary:changed');
    toast('Backup restored');
  };
}
