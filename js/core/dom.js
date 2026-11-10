// Small DOM helpers shared by the UI layer. The only core module (besides store.js) that touches the browser.
// `domain/` must never import this.
export const $ = s => document.querySelector(s);

/** Brief message pill at the bottom of the screen. */
export function toast(m) {
  const t = $('#toast');
  t.textContent = m; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}

/** The modal bottom-sheet used for adding foods, editing entries and restoring backups. */
export const dialog = () => $('#dlg');

// Screens holding unsaved work register a guard; every way of closing the dialog (✕, backdrop tap, Esc) asks it first.
let closeGuard = null;
export const setCloseGuard = fn => { closeGuard = fn; };
export const canClose = () => !closeGuard || closeGuard() !== false;

/** Set the dialog title and whether the ‹ back button shows. Every screen shown in the dialog calls this first, so it also drops
 *  any close guard left by the previous screen (the dialog's 'close' event is not a reliable place to do that). */
export function head(title, back) { closeGuard = null; $('#dTitle').textContent = title; $('#dBack').hidden = !back; }
