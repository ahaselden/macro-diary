// Diary screen: day summary, meal lists, date navigation, share-day button.
import { state, save } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { MEALS } from '../core/constants.js';
import { esc, rd, amtLabel } from '../core/format.js';
import { fmt, addDays, pretty } from '../core/dates.js';
import { entryMacros, totals } from '../domain/nutrition.js';
import { removeEntry } from '../domain/entries.js';
import { dayText } from '../domain/summary.js';
import { dayImage } from '../services/share.js';
import { view } from './ctx.js';
import { openAdd } from './add-food.js';
import { shareResult } from './share-result.js';
import { cssVar } from './theme.js';

function bar(val, goal, color) {
  const pct = goal ? Math.min(100, val / goal * 100) : 0;
  return `<div class="bar ${goal && val > goal ? 'over' : ''}"><i style="width:${pct}%;${color && !(goal && val > goal) ? `background:${color}` : ''}"></i></div>`;
}

export function renderDiary() {
  const cur = view.day;
  $('#dateLbl').textContent = cur === fmt(new Date()) ? 'Today' : pretty(cur);
  const list = state.days[cur] || [], t = totals(list), g = state.goals, left = g.k - t.k;
  const mac = (n, k, col) => `<div><span class="muted">${n}</span><b>${rd(t[k])} / ${Number(g[k]) || 0}g</b>${bar(t[k], g[k], col)}</div>`;
  $('#summary').innerHTML =
    `<div class="row" style="align-items:flex-end"><div><div class="big">${rd(t.k)}</div><div class="muted">of ${Number(g.k) || 0} kcal eaten</div></div>
     <div style="text-align:right"><div class="big" style="font-size:24px;${left < 0 ? 'color:var(--over)' : ''}">${rd(Math.abs(left))}</div><div class="muted">${left < 0 ? 'over' : 'remaining'}</div></div></div>
     ${bar(t.k, g.k)}
     <div class="macros">${mac('Protein', 'p', 'var(--p)')}${mac('Carbs', 'c', 'var(--c)')}${mac('Fat', 'f', 'var(--f)')}</div>`;
  $('#meals').innerHTML = MEALS.map(m => {
    const es = list.filter(e => e.meal === m), mk = es.reduce((a, e) => a + entryMacros(e).k, 0);
    return `<div class="card"><div class="meal-h"><div><h2>${m}</h2><span class="muted">${rd(mk)} kcal</span></div>
      <button class="primary fit" data-add="${esc(m)}">+ Add</button></div>` +
      es.map(e => `<div class="entry" data-edit="${esc(e.id)}"><div class="nm"><div>${esc(e.name)}</div>
        <div class="muted">${esc(e.brand ? e.brand + ' · ' : '')}${esc(amtLabel(e, state.weightUnit))} · P${rd(entryMacros(e).p)} C${rd(entryMacros(e).c)} F${rd(entryMacros(e).f)}</div></div>
        <div class="k">${rd(entryMacros(e).k)}</div><button class="x" data-del="${esc(e.id)}" aria-label="Delete">✕</button></div>`).join('') + `</div>`;
  }).join('');
}

export function initDiary() {
  $('#prev').onclick = () => { view.day = addDays(view.day, -1); renderDiary(); };
  $('#next').onclick = () => { view.day = addDays(view.day, 1); renderDiary(); };
  $('#todayBtn').onclick = () => { view.day = fmt(new Date()); renderDiary(); };
  $('#meals').onclick = ev => {
    const del = ev.target.closest('[data-del]'), addBtn = ev.target.closest('[data-add]'), ed = ev.target.closest('[data-edit]');
    const cur = view.day;
    if (del) {
      ev.stopPropagation();
      removeEntry(state, cur, del.dataset.del, Date.now());   // leaves a tombstone so the deletion syncs
      save(); emit('diary:changed');
    }
    else if (addBtn) openAdd(addBtn.dataset.add);
    else if (ed) { const e = (state.days[cur] || []).find(x => x.id === ed.dataset.edit); if (e) openAdd(e.meal, e); }
  };
  $('#shareBtn').onclick = async () => {
    const cur = view.day;
    if (!(state.days[cur] || []).length) return toast('Nothing logged this day');
    const text = dayText(state, cur, state.weightUnit);
    try {
      const blob = await dayImage(state, cur, { bg: cssVar('--bg'), fg: cssVar('--text'), mu: cssVar('--muted'), ln: cssVar('--line') });
      const file = new File([blob], `macro-diary-${cur}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], text, title: 'My day' }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    shareResult(text, 'My day');
  };
  on('diary:changed', renderDiary);
}
