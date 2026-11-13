// Export / report logic (pure). Extracted from the legacy inline script.
import { OZ } from '../core/constants.js';
import { rd, r1 } from '../core/format.js';
import { fmt, parse } from '../core/dates.js';
import { entryMacros, totals } from './nutrition.js';
import { NUT_KEYS } from '../core/schema.js';

// The extra nutrients in the exports (D43, D48): [key, column name, unit]. An entry that did not record one gives an EMPTY cell, never 0.
const NUT_COLS = [['fiber', 'Fiber', 'g'], ['sugars', 'Sugars', 'g'], ['satFat', 'Saturated fat', 'g'], ['sodium', 'Sodium', 'mg'], ['cholesterol', 'Cholesterol', 'mg']];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const r1n = v => Math.round(v * 10) / 10;
/** This entry's amount of one nutrient (per100 value x grams / 100), or null when it was not recorded or is not a usable number. */
function nutOf(e, key) {
  const n = e && typeof e === 'object' ? e.nut : null;
  if (!n || typeof n !== 'object' || Array.isArray(n) || !own(n, key)) return null;
  const v = n[key], g = e.grams;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || typeof g !== 'number' || !Number.isFinite(g)) return null;
  const out = v * g / 100;
  return Number.isFinite(out) ? out : null;
}
/** Totals and coverage over a list of entries: { tot: {key: sum|null}, cnt: {key: entries that recorded it}, items }. */
function nutSum(entries) {
  const tot = {}, cnt = {};
  for (const key of NUT_KEYS) { let t = 0, c = 0; for (const e of entries) { const v = nutOf(e, key); if (v !== null) { t += v; c++; } } tot[key] = c ? t : null; cnt[key] = c; }
  return { tot, cnt, items: entries.length };
}

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
  const entries = [['Date', 'Meal', 'Food', 'Brand', 'Amount (g)', 'Amount (oz)', 'Logged as', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Source', ...NUT_COLS.map(([, n, u]) => `${n} (${u})`)]];
  x.days.forEach(d => state.days[d].forEach(e => { const m = entryMacros(e); entries.push([d, e.meal, e.name, e.brand, r1(e.grams), r1(e.grams / OZ), e.disp || '', rd(m.k), r1(m.p), r1(m.c), r1(m.f), e.source, ...NUT_COLS.map(([k]) => { const v = nutOf(e, k); return v === null ? '' : r1n(v); })]); }));
  if (entries.length > 1) files.push({ name: exportName(x, 'entries', 'csv'), type: 'text/csv', text: toCSV(entries) });

  if (x.rows.length) {
    const yr = x.kind === 'year', rows = [[yr ? 'Month' : 'Date', 'Days logged', yr ? 'Avg calories/day' : 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Calorie goal',
      ...NUT_COLS.map(([, n, u]) => `${n} (${u})`), 'Items logged', ...NUT_COLS.map(([, n]) => `${n} items`)]];
    rollup(x).forEach(r => {
      const d = yr ? r.days : 1;
      const ents = (yr ? x.days.filter(day => day.slice(0, 7) === r.label) : [r.label]).flatMap(day => Array.isArray(state.days[day]) ? state.days[day] : []);
      const ns = nutSum(ents);
      rows.push([r.label, r.days, rd(r.k / d), r1(r.p / d), r1(r.c / d), r1(r.f / d), state.goals.k,
        ...NUT_KEYS.map(k => (ns.tot[k] === null ? '' : r1n(ns.tot[k] / d))), ns.items, ...NUT_KEYS.map(k => ns.cnt[k])]);
    });
    files.push({ name: exportName(x, 'summary', 'csv'), type: 'text/csv', text: toCSV(rows) });
  }

  if (x.days.length) {
    const days = {};
    x.days.forEach(d => days[d] = state.days[d].map(e => {   // an entry with recorded extras also carries their scaled totals (the stored per-100 g `nut` is kept as is)
      const t = {}; for (const k of NUT_KEYS) { const v = nutOf(e, k); if (v !== null) t[k] = r1n(v); }
      return Object.keys(t).length ? { ...e, nutTotal: t } : e;
    }));
    files.push({ name: exportName(x, 'data', 'json'), type: 'application/json', text: JSON.stringify({ exported: exportedAt, from: x.a, to: x.b, goals: state.goals, days }, null, 2) });
  }
  return files;
}
