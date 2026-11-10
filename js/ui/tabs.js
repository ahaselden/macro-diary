// Bottom tab bar. Views register an onShow callback for their tab (e.g. export -> renderExport).
// Bar: Diary | Plan | Recipes | Shop | More. 'export' and 'settings' are sub-pages of 'More' (they highlight the More button).
import { $ } from '../core/dom.js';

const onShow = {};
// tabs without their own nav button -> the nav button that stays highlighted
const NAV_PARENT = { export: 'more', settings: 'more' };

export const registerTab = (name, fn) => { onShow[name] = fn; };

export function showTab(name) {
  const navName = NAV_PARENT[name] || name;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + name));
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === navName));
  $('#datebar').style.display = name === 'diary' ? '' : 'none';
  if (onShow[name]) onShow[name](name);
  window.scrollTo(0, 0);
}

export function initTabs() {
  document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('#moreExport').onclick = () => showTab('export');
  $('#moreSettings').onclick = () => showTab('settings');
  document.querySelectorAll('[data-more]').forEach(b => b.onclick = () => showTab('more'));
}
