// The one Diary card (D57, item 21 follow-up): optional single-ring dials, four rows with a filling bar each, and a pencil that opens the choice of dials.
// All maths is in domain/dials.js; this file only turns its model into SVG and text. Every string goes through esc(), every length through ringArc().
import { state, save } from '../core/store.js';
import { $ } from '../core/dom.js';
import { esc } from '../core/format.js';
import { DIAL_KEYS } from '../core/schema.js';
import { ringArc, dialModel, toggleDial } from '../domain/dials.js';
import { touchSettings } from '../domain/entries.js';
import { view } from './ctx.js';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const txt = v => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '');
const NAMES = { k: 'Calories', p: 'Protein', c: 'Carbs', f: 'Fat', steps: 'Steps', sleep: 'Sleep' };
const ROW_KEYS = ['k', 'p', 'c', 'f'];
const R = 42, STROKE = 9;   // one ring in a 100 x 100 box

const PENCIL = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.5 6.5l4 4" stroke="currentColor" stroke-width="2"/></svg>';

const colorOf = ring => (isObj(ring) && ring.over === true ? 'var(--over)' : isObj(ring) && txt(ring.color) ? txt(ring.color) : 'var(--accent)');

/** One ring as a grey track plus the coloured arc, starting at 12 o'clock and running clockwise. Red when over the goal. */
function ringSvg(ring) {
  const x = isObj(ring) ? ring : {}, a = ringArc(x.fraction, R), c = 50;
  return `<g role="img" aria-label="${esc(txt(x.label))}">`
    + `<circle class="ring-track" cx="${c}" cy="${c}" r="${R}" fill="none" stroke-width="${STROKE}"/>`
    + (a.filled > 0 ? `<circle class="ring-arc" cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${esc(colorOf(x))}" stroke-width="${STROKE}" stroke-linecap="round" stroke-dasharray="${a.dasharray}" transform="rotate(-90 ${c} ${c})"/>` : '') + `</g>`;
}

/** One selected dial: a ring, its name and its text; the calories dial also shows kcal left or over in the middle. */
function dialHtml(key, ring, centre) {
  const x = isObj(ring) ? ring : {}, c = isObj(centre) ? centre : {};
  const mid = key === 'k' ? `<text class="dial-num" x="50" y="48" text-anchor="middle" dominant-baseline="central">${esc(txt(c.text))}</text><text class="dial-cap" x="50" y="66" text-anchor="middle">${esc(txt(c.caption))}</text>` : '';
  return `<div class="dial" data-dial="${key}"><svg viewBox="0 0 100 100" focusable="false">${ringSvg(x)}${mid}</svg>`
    + `<div class="dial-name muted">${esc(NAMES[key])}</div><b class="${x.hasData === false ? 'muted' : ''}">${esc(txt(x.text))}</b></div>`;
}

/** One row: name, "value / goal unit", and a bar that fills. Over the goal the bar turns red AND the row says so in words. */
function rowHtml(key, ring) {
  const x = isObj(ring) ? ring : {}, f = typeof x.fraction === 'number' && !Number.isNaN(x.fraction) ? Math.min(1, Math.max(0, x.fraction)) : 0, over = x.over === true;
  const style = `width:${+(f * 100).toFixed(2)}%;` + (over ? '' : `background:${esc(txt(x.color) || 'var(--accent)')}`);
  return `<div class="mrow" data-row="${key}"><div class="mrow-top"><span class="muted">${esc(NAMES[key])}</span><b>${esc(txt(x.text))}</b>${over ? '<span class="over-word">over goal</span>' : ''}</div>`
    + `<div class="bar${over ? ' over' : ''}"><i style="${style}"></i></div></div>`;
}

function panelHtml(selected) {
  return `<div id="dialsPanel" class="dials-panel"><div class="dials-picks">` + DIAL_KEYS.map(k =>
    `<span class="pick"><input type="checkbox" id="dialPick-${k}"${selected.includes(k) ? ' checked' : ''}><label for="dialPick-${k}">${NAMES[k]}</label></span>`).join('')
    + `</div><button type="button" id="dialsDone" class="fit">Done</button></div>`;
}

/** The card's inner HTML for a model from dialModel(). Never throws, whatever it is given. `editing` must be exactly true to show the panel. */
export function dialsHtml(model, editing = false) {
  const m = isObj(model) ? model : {}, nut = isObj(m.nutrition) ? m.nutrition : {}, rings = isObj(m.rings) ? m.rings : {};
  const rows = Array.isArray(m.rows) ? m.rows : Array.isArray(nut.rings) ? nut.rings : [];
  const rowOf = key => (isObj(rings[key]) ? rings[key] : rows.find(r => isObj(r) && r.key === key));
  const selected = Array.isArray(m.selected) ? DIAL_KEYS.filter(k => m.selected.includes(k)) : [];
  const shown = selected.filter(k => isObj(rowOf(k)));
  const k = rowOf('k'), kText = isObj(k) ? txt(k.text).replace(' / ', ' of ') : '';
  const more = [...ROW_KEYS.slice(1), ...selected.filter(k => k === 'steps' || k === 'sleep')].map(rowOf).filter(isObj).map(r => txt(r.label)).filter(Boolean);   // the button hides its children from a screen reader, so its name carries them
  const label = `Nutrition details for this day: ${kText ? kText + ' eaten' : 'no calories yet'}.${more.length ? ' ' + more.join('. ') + '.' : ''} Press to open.`;
  return `<button type="button" id="dialsEdit" class="dials-edit" aria-label="Choose dials" aria-expanded="${editing === true ? 'true' : 'false'}">${PENCIL}</button>`
    + `<div id="dialsOpen" role="button" tabindex="0" aria-label="${esc(label)}">`
    + (shown.length ? `<div class="dial-area">${shown.map(key => dialHtml(key, rowOf(key), nut.centre)).join('')}</div>` : '')
    + `<div class="mrows">${ROW_KEYS.map(key => rowHtml(key, rowOf(key))).join('')}</div></div>`
    + (editing === true ? panelHtml(selected) : '');
}

let editing = false;

/** Draw the card for the day on screen into #dials. */
export function renderDials(focusId) {
  const el = $('#dials'); if (!el) return;
  el.innerHTML = dialsHtml(dialModel(state, view.day), editing);
  if (focusId) document.getElementById(focusId)?.focus();
}

/** Wire the card once: the pencil, the checkboxes, Done, and tapping the card (calls `openDetails`). */
export function initDials(openDetails) {
  const el = $('#dials');
  el.addEventListener('click', ev => {
    const t = ev.target;
    if (t.closest('#dialsEdit')) { editing = !editing; renderDials('dialsEdit'); }
    else if (t.closest('#dialsDone')) { editing = false; renderDials('dialsEdit'); }
    else if (t.closest('#dialsOpen')) openDetails();
  });
  el.addEventListener('change', ev => {
    const t = ev.target, m = t && typeof t.id === 'string' ? /^dialPick-(.+)$/.exec(t.id) : null;
    if (!m) return;
    state.dials = toggleDial(state.dials, m[1], t.checked);
    touchSettings(state, Date.now()); save();
    renderDials(t.id);
  });
  el.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && editing) { editing = false; renderDials('dialsEdit'); return; }
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.id === 'dialsOpen') { ev.preventDefault(); openDetails(); }
  });
}
