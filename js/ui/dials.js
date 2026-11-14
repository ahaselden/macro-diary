// The ring dials at the top of the Diary (item 21, D56): a four-ring nutrition dial and one ring each for steps and sleep. All maths is in
// domain/dials.js; this file only turns its model into SVG and text. Every string goes through esc(), every length through ringArc().
import { state } from '../core/store.js';
import { $ } from '../core/dom.js';
import { esc } from '../core/format.js';
import { ringArc, ringRadii, dialModel } from '../domain/dials.js';
import { view } from './ctx.js';

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const txt = v => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '');

/** One ring as a grey track plus the coloured arc, starting at 12 o'clock and running clockwise. Red when over the goal. */
function ringSvg(ring, cx, cy, r, stroke) {
  const x = isObj(ring) ? ring : {}, a = ringArc(x.fraction, r), color = x.over === true ? 'var(--over)' : txt(x.color) || 'var(--accent)';
  return `<g role="img" aria-label="${esc(txt(x.label))}">`
    + `<circle class="ring-track" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${stroke}"/>`
    + (a.filled > 0 ? `<circle class="ring-arc" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${esc(color)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${a.dasharray}" transform="rotate(-90 ${cx} ${cy})"/>` : '') + `</g>`;
}

const dot = ring => `<i class="dot" style="background:${esc(isObj(ring) && ring.over === true ? 'var(--over)' : isObj(ring) && txt(ring.color) ? txt(ring.color) : 'var(--accent)')}"></i>`;

/** The dial's SVG and text for a model from dialModel(). Never throws, whatever it is given. */
export function dialsHtml(model) {
  const m = isObj(model) ? model : {}, nut = isObj(m.nutrition) ? m.nutrition : {}, rings = Array.isArray(nut.rings) ? nut.rings.slice(0, 4) : [];
  const radii = ringRadii(128, 8, 2, Math.max(1, rings.length)), centre = isObj(nut.centre) ? nut.centre : {};
  const big = radii.length ? rings.map((r, i) => ringSvg(r, 64, 64, radii[i], 8)).join('') : '';
  const small = (ring) => `<svg class="dial-small" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${ringSvg(ring, 32, 32, 28.5, 7)}</svg>`;
  const side = ring => { const x = isObj(ring) ? ring : {}; return `<div class="dial-side">${small(ring)}<div><div class="muted">${esc(txt(x.name))}</div><b class="${x.hasData === false ? 'muted' : ''}">${esc(txt(x.text))}</b></div></div>`; };
  const legend = rings.map(r => { const x = isObj(r) ? r : {}; return `<div>${dot(r)}<span class="muted">${esc(txt(x.name))}</span> <b>${esc(txt(x.text))}</b></div>`; }).join('');
  return `<div class="dials-top">`
    + `<svg class="dial-big" viewBox="0 0 128 128" focusable="false">${big}`
    + `<text class="dial-num" x="64" y="57" text-anchor="middle" dominant-baseline="central">${esc(txt(centre.text))}</text>`
    + `<text class="dial-cap" x="64" y="78" text-anchor="middle">${esc(txt(centre.caption))}</text></svg>`
    + `<div class="dials-side">${side(m.steps)}${side(m.sleep)}</div></div>`
    + `<div class="dials-legend">${legend}</div>`;
}

/** Draw the dials for the day on screen into #dials. */
export function renderDials() {
  const el = $('#dials'); if (!el) return;
  const m = dialModel(state, view.day);
  el.innerHTML = dialsHtml(m);
  el.setAttribute('aria-label', `Daily dials: ${m.nutrition.label}. ${m.steps.label}. ${m.sleep.label}. Press to open the nutrition details.`);
}
