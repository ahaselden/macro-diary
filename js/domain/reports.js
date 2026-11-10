// Export / report logic (pure). Extracted from the legacy inline script.
import { OZ } from '../core/constants.js';
import { rd, r1 } from '../core/format.js';
import { fmt, parse } from '../core/dates.js';
import { entryMacros, totals } from './nutrition.js';

/** [from, to] date strings for a 'day' | 'week' (Mon-Sun) | 'month' | 'year' containing dateStr. */
export function rangeOf(kind, s) {
  const d = parse(s); let a, b;
  if (kind === 'day') a = b = d;
  else if (kind === 'week') { a = new Date(d); a.setDate(d.getDate() - ((d.getDay() + 6) % 7)); b = new Date(a); b.setDate(a.getDate() + 6); }
  else if (kind === 'month') { a = new Date(d.getFullYear(), d.getMonth(), 1); b = new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  else { a = new Date(d.getFullYear(), 0, 1); b = new Date(d.getFullYear(), 11, 31); }
  return [fmt(a), fmt(b)];
}

/** Report data for the range around dateStr. */
export function xData(state, kind, dateStr) {
  const [a, b] = rangeOf(kind, dateStr);
  const days = Object.keys(state.days).filter(d => d >= a && d <= b).sort();
  const rows = days.map(d => ({ date: d, ...totals(state.days[d]), n: state.days[d].length }));
  return { kind, a, b, days, rows };
}

/** Per-day rows, or per-month totals (with day counts) for a yearly report. */
export function rollup(x) {
  if (x.kind !== 'year') return x.rows.map(r => ({ label: r.date, ...r, days: 1 }));
  const m = {};
  x.rows.forEach(r => { const key = r.date.slice(0, 7); const o = m[key] ||= { label: key, k: 0, p: 0, c: 0, f: 0, days: 0 }; o.k += r.k; o.p += r.p; o.c += r.c; o.f += r.f; o.days++; });
  return Object.values(m);
}

export const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');

export const exportName = (x, what, ext) => `macro-diary-${what}-${x.kind}-${x.a}${x.a === x.b ? '' : '_to_' + x.b}.${ext}`;

/** Files the three export buttons would download, in order; ones that would say 'Nothing to export' are omitted. */
export function exportFiles(state, x, exportedAt) {
  const files = [];
  const entries = [['Date', 'Meal', 'Food', 'Brand', 'Amount (g)', 'Amount (oz)', 'Logged as', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Source']];
  x.days.forEach(d => state.days[d].forEach(e => { const m = entryMacros(e); entries.push([d, e.meal, e.name, e.brand, r1(e.grams), r1(e.grams / OZ), e.disp || '', rd(m.k), r1(m.p), r1(m.c), r1(m.f), e.source]); }));
  if (entries.length > 1) files.push({ name: exportName(x, 'entries', 'csv'), type: 'text/csv', text: toCSV(entries) });

  if (x.rows.length) {
    const yr = x.kind === 'year', rows = [[yr ? 'Month' : 'Date', 'Days logged', yr ? 'Avg calories/day' : 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Calorie goal']];
    rollup(x).forEach(r => { const d = yr ? r.days : 1; rows.push([r.label, r.days, rd(r.k / d), r1(r.p / d), r1(r.c / d), r1(r.f / d), state.goals.k]); });
    files.push({ name: exportName(x, 'summary', 'csv'), type: 'text/csv', text: toCSV(rows) });
  }

  if (x.days.length) {
    const days = {}; x.days.forEach(d => days[d] = state.days[d]);
    files.push({ name: exportName(x, 'data', 'json'), type: 'application/json', text: JSON.stringify({ exported: exportedAt, from: x.a, to: x.b, goals: state.goals, days }, null, 2) });
  }
  return files;
}
