// Bottom tab bar. Views register an onShow callback for their tab (e.g. export -> renderExport).
import { $ } from '../core/dom.js';

const onShow = {};

export const registerTab = (name, fn) => { onShow[name] = fn; };

export function showTab(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + name));
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  $('#datebar').style.display = name === 'diary' ? '' : 'none';
  if (onShow[name]) onShow[name](name);
  window.scrollTo(0, 0);
}

export function initTabs() {
  document.querySelectorAll('nav.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
}
