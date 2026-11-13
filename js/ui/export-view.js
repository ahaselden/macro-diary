// Export tab: period stats/table, CSV/JSON downloads, share summary.
import { state } from '../core/store.js';
import { $, toast } from '../core/dom.js';
import { esc, rd } from '../core/format.js';
import { pretty } from '../core/dates.js';
import { xData, rollup, exportFiles } from '../domain/reports.js';
import { download } from '../services/files.js';
import { view } from './ctx.js';
import { shareResult } from './share-result.js';

const curX = () => xData(state, $('#xKind').value, $('#xDate').value || view.day);

export function renderExport() {
  if (!$('#xDate').value) $('#xDate').value = view.day;
  const x = curX(); $('#xRange').textContent = x.a === x.b ? pretty(x.a) : `${pretty(x.a)} → ${pretty(x.b)}`;
  const tot = x.rows.reduce((t, r) => (t.k += r.k, t.p += r.p, t.c += r.c, t.f += r.f, t), { k: 0, p: 0, c: 0, f: 0 }), n = x.rows.length || 1;
  $('#xStats').innerHTML = `<div class="stats"><div><span class="muted">Days logged</span><b>${x.rows.length}</b></div><div><span class="muted">Total calories</span><b>${rd(tot.k).toLocaleString()}</b></div>
    <div><span class="muted">Avg calories / day</span><b>${rd(tot.k / n)}</b></div><div><span class="muted">Avg P / C / F</span><b>${rd(tot.p / n)} / ${rd(tot.c / n)} / ${rd(tot.f / n)}</b></div></div>`;
  const rows = rollup(x), unit = x.kind === 'year' ? 'Month (avg/day)' : 'Day';
  $('#xTable').innerHTML = rows.length ? `<table><tr><th>${unit}</th><th>kcal</th><th>P</th><th>C</th><th>F</th><th></th></tr>` + rows.map(r => {
    const d = r.days || 1; return `<tr><td>${esc(r.label)}</td><td>${rd(r.k / d)}</td><td>${rd(r.p / d)}</td><td>${rd(r.c / d)}</td><td>${rd(r.f / d)}</td>
    <td><div class="mini"><i style="width:${Number(Math.min(100, r.k / d / state.goals.k * 100)) || 0}%"></i></div></td></tr>`; }).join('') + '</table>'
    : '<p class="muted" style="margin:0">Nothing logged in this period.</p>';
}

const doExport = which => {
  const f = exportFiles(state, curX(), new Date().toISOString()).find(f => f.name.includes(`-${which}-`));
  f ? download(f.name, f.text, f.type) : toast('Nothing to export');
};

export function initExport() {
  ['#xKind', '#xDate'].forEach(s => $(s).onchange = renderExport);
  $('#xEntries').onclick = () => doExport('entries');
  $('#xSummary').onclick = () => doExport('summary');
  $('#xJson').onclick = () => doExport('data');
  $('#xShare').onclick = () => {
    const x = curX(); if (!x.rows.length) return toast('Nothing logged');
    const n = x.rows.length, t = x.rows.reduce((t, r) => (t.k += r.k, t.p += r.p, t.c += r.c, t.f += r.f, t), { k: 0, p: 0, c: 0, f: 0 });
    shareResult(`My ${x.kind}ly summary (${x.a}${x.a === x.b ? '' : ' → ' + x.b})\n${n} days logged · avg ${rd(t.k / n)} kcal/day\nAvg P ${rd(t.p / n)}g · C ${rd(t.c / n)}g · F ${rd(t.f / n)}g`, 'Macro Diary summary');
  };
}
