// Diary screen: day summary, meal lists, date navigation, share-day button.
import { state, save } from '../core/store.js';
import { $, toast, dialog, head } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { MEALS } from '../core/constants.js';
import { esc, rd, amtLabel } from '../core/format.js';
import { fmt, addDays, pretty } from '../core/dates.js';
import { entryMacros, totals } from '../domain/nutrition.js';
import { dayDetails, formatNut } from '../domain/details.js';
import { removeEntry, copyEntries } from '../domain/entries.js';
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
  $('#summary').setAttribute('aria-label', `Nutrition details for this day: ${rd(t.k)} of ${Number(g.k) || 0} kcal eaten. Press to open.`);
  $('#summary').innerHTML =
    `<div class="row" style="align-items:flex-end"><div><div class="big">${rd(t.k)}</div><div class="muted">of ${Number(g.k) || 0} kcal eaten</div></div>
     <div style="text-align:right"><div class="big" style="font-size:24px;${left < 0 ? 'color:var(--over)' : ''}">${rd(Math.abs(left))}</div><div class="muted">${left < 0 ? 'over' : 'remaining'}</div></div></div>
     ${bar(t.k, g.k)}
     <div class="macros">${mac('Protein', 'p', 'var(--p)')}${mac('Carbs', 'c', 'var(--c)')}${mac('Fat', 'f', 'var(--f)')}</div>`;
  $('#meals').innerHTML = MEALS.map(m => {
    const es = list.filter(e => e.meal === m), mk = es.reduce((a, e) => a + entryMacros(e).k, 0);
    return `<div class="card"><div class="meal-h"><div><h2>${m}</h2><span class="muted">${rd(mk)} kcal</span></div>
      <div class="row" style="gap:6px;flex:0 0 auto">${es.length ? `<button class="fit" data-copy-meal="${esc(m)}">Copy meal</button>` : ''}<button class="primary fit" data-add="${esc(m)}">+ Add</button></div></div>` +
      es.map(e => `<div class="entry" data-edit="${esc(e.id)}"><div class="nm"><div>${esc(e.name)}</div>
        <div class="muted">${esc(e.brand ? e.brand + ' · ' : '')}${esc(amtLabel(e, state.weightUnit))} · P${rd(entryMacros(e).p)} C${rd(entryMacros(e).c)} F${rd(entryMacros(e).f)}</div></div>
        <div class="k">${rd(entryMacros(e).k)}</div><button class="x cp" data-copy="${esc(e.id)}" aria-label="Copy" title="Copy to another meal or day">Copy</button><button class="x" data-del="${esc(e.id)}" aria-label="Delete">✕</button></div>`).join('') + `</div>`;
  }).join('');
}

const NUT_ROWS = [['fiber', 'Fiber', 'g'], ['sugars', 'Sugars', 'g'], ['satFat', 'Saturated fat', 'g'], ['sodium', 'Sodium', 'mg'], ['cholesterol', 'Cholesterol', 'mg']];

/** The day's nutrition details: calories and macros against the goals, then the extra label facts that were recorded. */
function openDetails() {
  const dlg = dialog(), day = view.day, g = state.goals, d = dayDetails(state.days[day] || [], g);
  head('Nutrition details', false);
  const row = (name, val, goal, unit, pct) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span>${name}</span><span><b>${rd(val)}${unit}</b> of ${Number(goal) || 0}${unit}${pct == null ? '' : ` (${pct}%)`}</span></div>`;
  const facts = NUT_ROWS.map(([key, label, unit]) => {
    const n = d.nutrients[key];
    const right = n.total == null ? '<span class="muted">Not recorded</span>' : `<b>${esc(formatNut(n.total, unit))}</b> <span class="muted">from ${n.recorded} of ${d.items} ${d.items === 1 ? 'item' : 'items'}</span>`;
    return `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)"><span>${label}</span><span>${right}</span></div>`;
  }).join('');
  $('#dBody').innerHTML = `<div class="muted">${esc(day === fmt(new Date()) ? 'Today' : pretty(day))} · ${d.items} ${d.items === 1 ? 'item' : 'items'}</div>
    ${row('Calories', d.macros.k, g.k, ' kcal', d.pct.k)}${row('Protein', d.macros.p, g.p, ' g', d.pct.p)}${row('Carbs', d.macros.c, g.c, ' g', d.pct.c)}${row('Fat', d.macros.f, g.f, ' g', d.pct.f)}
    <h2 style="margin:14px 0 4px">Nutrition facts</h2>${facts}
    <p class="muted">Only foods found in a food database record these extras. Older entries and foods you typed in yourself have none, so the totals count just the items that do.</p>`;
  if (!dlg.open) dlg.showModal();
}

/** Small dialog: pick a meal and a day, then copy the given entries there (the originals stay). */
function openCopy(fromDay, ids, meal) {
  const dlg = dialog();
  head('Copy to', false);
  $('#dBody').innerHTML = `<label>Meal</label><select id="copyMeal">${MEALS.map(m => `<option${m === meal ? ' selected' : ''}>${m}</option>`).join('')}</select>
    <label>Day</label><input type="date" id="copyDate" value="${esc(fromDay)}">
    <button class="primary" style="width:100%;margin-top:12px" id="copyGo">Copy</button>`;
  if (!dlg.open) dlg.showModal();
  $('#copyGo').onclick = () => {
    const toDay = $('#copyDate').value, toMeal = $('#copyMeal').value;
    if (!toDay) { toast('Pick a day'); return; }
    const made = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const out = copyEntries(state, fromDay, ids, toDay, toMeal, Date.now(), made);
    if (!out.length) { toast('Nothing to copy'); return; }
    save(); dlg.close(); emit('diary:changed');
    toast(`Copied ${out.length} ${out.length === 1 ? 'item' : 'items'} to ${toMeal}`);
  };
}

export function initDiary() {
  $('#prev').onclick = () => { view.day = addDays(view.day, -1); renderDiary(); };
  $('#next').onclick = () => { view.day = addDays(view.day, 1); renderDiary(); };
  $('#todayBtn').onclick = () => { view.day = fmt(new Date()); renderDiary(); };
  const sm = $('#summary');
  sm.onclick = openDetails;
  sm.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetails(); } };
  $('#meals').onclick = ev => {
    const cp = ev.target.closest('[data-copy]'), cpm = ev.target.closest('[data-copy-meal]'), del = ev.target.closest('[data-del]'), addBtn = ev.target.closest('[data-add]'), ed = ev.target.closest('[data-edit]');
    const cur = view.day;
    if (cp) { ev.stopPropagation(); openCopy(cur, [cp.dataset.copy], (state.days[cur] || []).find(x => x.id === cp.dataset.copy)?.meal); }
    else if (cpm) openCopy(cur, (state.days[cur] || []).filter(e => e.meal === cpm.dataset.copyMeal).map(e => e.id), cpm.dataset.copyMeal);
    else if (del) {
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
