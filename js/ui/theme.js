// Theme picker + applying the theme. Re-applies when settings/state change or the OS scheme flips.
import { state, save } from '../core/store.js';
import { $ } from '../core/dom.js';
import { on } from '../core/bus.js';
import { esc } from '../core/format.js';

export const THEMES = [['auto','Auto'],['light','Light'],['dark','Dark'],['black','Black (OLED)'],['midnight','Midnight'],['forest','Forest'],['nord','Nord'],
  ['dracula','Dracula'],['ember','Ember'],['ocean','Ocean'],['rose','Rose'],['solarized','Solarized'],['paper','Paper'],['contrast','High contrast']];
const darkMQ = matchMedia('(prefers-color-scheme:dark)');
export const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function effTheme() {
  let t = typeof state.theme === 'string' ? state.theme : 'auto';
  if (t === 'auto') t = darkMQ.matches ? 'dark' : 'light';
  return THEMES.some(x => x[0] === t) ? t : 'light';
}

export function applyTheme() {
  document.documentElement.dataset.theme = effTheme();
  document.querySelector('meta[name=theme-color]').content = cssVar('--bg') || '#16a34a';
  const sel = typeof state.theme === 'string' ? state.theme : 'auto';
  document.querySelectorAll('#themes [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === sel));
}

const pv = t => `<span class="pv" data-theme="${esc(t)}"><i></i><b></b></span>`;

export function initTheme() {
  darkMQ.addEventListener?.('change', applyTheme);
  $('#themes').innerHTML = THEMES.map(([k, n]) =>
    `<button class="th" data-t="${esc(k)}" aria-label="${esc(n)} theme"><span class="pvs">${k === 'auto' ? pv('light') + pv('dark') : pv(k)}</span>${esc(n)}</button>`).join('');
  $('#themes').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { state.theme = b.dataset.t; save(); applyTheme(); } };
  on('settings:changed', applyTheme);
}
