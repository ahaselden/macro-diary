// The water card on the Diary (item 23, D58): a row of cup buttons that fill when tapped. All maths is in domain/water.js; this file only draws and wires it.
import { state, save } from '../core/store.js';
import { $ } from '../core/dom.js';
import { esc } from '../core/format.js';
import { waterModel, nextHalves } from '../domain/water.js';
import { setWater } from '../domain/entries.js';
import { view } from './ctx.js';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const txt = v => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '');
const MAX_BUTTONS = 40;
const edge = y => 4 + (y - 4) * 4 / 34;   // the left edge of the tumbler at height y (it narrows towards the bottom)

/** One tumbler as an svg: an outline, and the water inside for a half or full cup. */
function cupSvg(level) {
  const top = level === 'full' ? 9 : 22, fill = level === 'empty' ? ''
    : `<polygon class="cup-fill" fill="var(--water)" points="${edge(top).toFixed(2)},${top} ${(32 - edge(top)).toFixed(2)},${top} ${(32 - edge(36)).toFixed(2)},36 ${edge(36).toFixed(2)},36"/>`;
  return `<svg viewBox="0 0 32 40" aria-hidden="true" focusable="false">${fill}<path class="cup-glass" d="M4 4h24l-4 34H8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

/** The card's inner HTML for a model from waterModel(). Never throws, whatever it is given; at most 40 cup buttons. */
export function waterHtml(model) {
  const m = isObj(model) ? model : {}, cups = Array.isArray(m.cups) ? m.cups.slice(0, MAX_BUTTONS) : [];
  const buttons = cups.map((c, i) => {
    const x = isObj(c) ? c : {}, level = x.state === 'full' || x.state === 'half' ? x.state : 'empty';
    return `<button type="button" class="cup cup-${level}${x.over === true ? ' over' : ''}" data-cup="${i + 1}" aria-label="${esc(txt(x.label))}">${cupSvg(level)}</button>`;
  }).join('');
  return `<div class="water-head"><h2>Water</h2><b id="waterText">${esc(txt(m.text))}</b></div>`
    + `<div id="waterCups" class="cups" role="group" aria-label="Water cups">${buttons}</div>`
    + `<div id="waterGoal" class="muted">Goal: ${esc(txt(m.goalText))}</div>`;
}

/** Draw the card for the day on screen into #water. `focusCup` keeps keyboard focus on the cup that was just tapped. */
export function renderWater(focusCup) {
  const el = $('#water'); if (!el) return;
  el.innerHTML = waterHtml(waterModel(state, view.day));
  if (focusCup) el.querySelector(`[data-cup="${Number(focusCup)}"]`)?.focus();
}

/** Wire the card once: a tap on a cup changes that day's total through setWater. */
export function initWater() {
  $('#water').addEventListener('click', ev => {
    const b = ev.target.closest('[data-cup]'); if (!b) return;
    const n = Number(b.dataset.cup), now = waterModel(state, view.day).halves;
    if (setWater(state, view.day, nextHalves(now, n, state.waterTap), Date.now())) save();
    renderWater(n);
  });
}
