// Reading a Google Takeout export (steps, sleep, workouts) into small per-day records. PURE: strings and plain objects in, plain objects out; no DOM,
// storage, clock or network. The zip itself is read by services/zip.js and services/google-health.js; this file only knows the CSV text and the rules.
// Spec: docs/specs/google-health-import.md. Rules the owner decided (D54): days follow the device timezone (`tz` is injected), and per day the step
// total is the source with the LARGER total (see chooseStepTotal, the only place that knows that rule).
//
// `tz` is utcMs => minutes to ADD to a UTC instant to get local wall-clock time (UTC-6 is -360). A bad or throwing `tz` counts as 0.
import { isDateKey, isSafeKey } from '../core/schema.js';

const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---- CSV ----------------------------------------------------------------------------------------------------------------------------------------
/**
 * Tolerant CSV reader: string[][]. A leading BOM is dropped, records end at CRLF, LF or a lone CR, quoted cells may hold commas, line breaks and
 * doubled quotes, completely empty lines are skipped, an unterminated quote takes the rest of the text. Never throws; a non-string gives [].
 */
export function parseCsv(text) {
  if (typeof text !== 'string') return [];
  const n = text.length, out = [];
  let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  while (i < n) {
    const row = [];
    for (;;) {
      let cell;
      if (text.charCodeAt(i) === 34) {                       // a quoted cell
        i++;
        let buf = '';
        for (;;) {
          const j = text.indexOf('"', i);
          if (j < 0) { buf += text.slice(i); i = n; break; }  // unterminated: the rest of the text
          buf += text.slice(i, j);
          if (text.charCodeAt(j + 1) === 34) { buf += '"'; i = j + 2; } else { i = j + 1; break; }
        }
        let k = i;                                           // stray text after the closing quote is kept
        while (k < n) { const c = text.charCodeAt(k); if (c === 44 || c === 10 || c === 13) break; k++; }
        cell = buf + text.slice(i, k); i = k;
      } else {
        let k = i;
        while (k < n) { const c = text.charCodeAt(k); if (c === 44 || c === 10 || c === 13) break; k++; }
        cell = text.slice(i, k); i = k;
      }
      row.push(cell);
      if (i >= n) break;
      const c = text.charCodeAt(i);
      if (c === 44) { i++; if (i >= n) { row.push(''); break; } continue; }
      i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;   // end of the record
      break;
    }
    if (!(row.length === 1 && row[0] === '')) out.push(row);
  }
  return out;
}

const HEADER_BAD = new Set(['', '__proto__', 'constructor', 'prototype']);
/** First record = header (names trimmed, lower-cased, whitespace runs become "_"; a duplicate keeps its first column). Rows are plain objects. */
export function parseCsvTable(text) {
  const recs = parseCsv(text);
  if (!recs.length) return { columns: [], rows: [] };
  const columns = [], idx = [];
  recs[0].forEach((h, i) => {
    const name = String(h).trim().toLowerCase().replace(/\s+/g, '_');
    if (HEADER_BAD.has(name) || columns.includes(name)) return;
    columns.push(name); idx.push(i);
  });
  const rows = [];
  for (let r = 1; r < recs.length; r++) {
    const cells = recs[r], row = {};
    let any = false;
    for (let c = 0; c < columns.length; c++) {
      const v = cells[idx[c]] === undefined ? '' : cells[idx[c]];
      if (v !== '') any = true;
      row[columns[c]] = v;
    }
    if (any) rows.push(row);
  }
  return { columns, rows };
}

// ---- times and days -------------------------------------------------------------------------------------------------------------------------
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/;
/** Milliseconds since the epoch for YYYY-MM-DDTHH:MM:SS[.fff][Z|+hh:mm] (T or space; no offset = UTC), years 1990 to 2099; NaN for anything else. */
export function parseInstant(s) {
  const m = typeof s === 'string' ? INSTANT.exec(s) : null;
  if (!m) return NaN;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +m[6];
  if (y < 1990 || y > 2099 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || se > 59) return NaN;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return NaN;
  let off = 0;
  if (m[8] && m[8] !== 'Z') {
    const oh = +m[8].slice(1, 3), om = +m[8].slice(4, 6);
    if (oh > 23 || om > 59) return NaN;
    off = (oh * 60 + om) * (m[8][0] === '-' ? -1 : 1);
  }
  const frac = m[7] ? +(m[7] + '00').slice(0, 3) : 0;
  return Date.UTC(y, mo - 1, d, h, mi, se, frac) - off * 60000;
}

const offsetOf = tz => ms => {
  try { const o = typeof tz === 'function' ? tz(ms) : 0; return typeof o === 'number' && Number.isFinite(o) && Math.abs(o) <= 1560 ? o : 0; } catch { return 0; }
};
const dayNames = new Map();                                  // day number since the epoch -> 'YYYY-MM-DD' (at most ~40,000 entries for 1990 to 2099)
function localDay(ms, off) {
  const n = Math.floor((ms + off(ms) * 60000) / 86400000);
  let s = dayNames.get(n);
  if (s === undefined) { s = new Date(n * 86400000).toISOString().slice(0, 10); dayNames.set(n, s); }
  return s;
}
const utcText = ms => new Date(ms).toISOString().slice(0, 19) + 'Z';
const PLAIN_NUM = /^\d+(\.\d+)?$/;
/** A plain decimal cell as a number, or NaN (no sign, no exponent, no text). */
const plainNum = v => { if (typeof v !== 'string') return NaN; const t = v.trim(); return PLAIN_NUM.test(t) ? +t : NaN; };

// ---- steps ----------------------------------------------------------------------------------------------------------------------------------
const SOURCE_BAD = new Set(['', '__proto__', 'constructor', 'prototype']);
/** { day: { source: total } } from rows of a steps file (`timestamp`, `steps`, `data_source`). Rows that do not fit the rules are ignored, not clamped. */
export function stepTotalsBySource(rows, tz) {
  const out = {};
  if (!Array.isArray(rows)) return out;
  const off = offsetOf(tz);
  for (const r of rows) {
    if (!isPlain(r) || typeof r.timestamp !== 'string') continue;
    const n = plainNum(r.steps);
    if (!(n <= 100000)) continue;                            // also drops NaN
    const ms = parseInstant(r.timestamp);
    if (!Number.isFinite(ms)) continue;
    let src = typeof r.data_source === 'string' ? r.data_source.trim().slice(0, 60) : '';
    if (SOURCE_BAD.has(src)) src = 'unknown';
    const day = localDay(ms, off), by = has(out, day) ? out[day] : (out[day] = {});
    by[src] = (has(by, src) ? by[src] : 0) + n;
  }
  return out;
}

/** A NEW object: per day and source the SUM of two stepTotalsBySource results (a local day can span two monthly files). Inputs are not changed. */
export function mergeStepTotals(a, b) {
  const out = {};
  for (const part of [a, b]) {
    if (!isPlain(part)) continue;
    for (const day of Object.keys(part)) {
      if (!isSafeKey(day) || !isPlain(part[day])) continue;
      const by = has(out, day) ? out[day] : (out[day] = {});
      for (const src of Object.keys(part[day])) {
        const v = part[day][src];
        if (isSafeKey(src) && typeof v === 'number' && Number.isFinite(v)) by[src] = (has(by, src) ? by[src] : 0) + v;
      }
    }
  }
  return out;
}

/**
 * THE step-source rule (D54): the day's total is the LARGEST total among its sources (the phone and the watch both record the same walking, so they are
 * never added). No valid total gives 0. Change the rule here and nowhere else.
 */
export function chooseStepTotal(bySource) {
  if (!isPlain(bySource)) return 0;
  let best = 0;
  for (const k of Object.keys(bySource)) { const v = bySource[k]; if (typeof v === 'number' && Number.isFinite(v) && v > best) best = v; }
  return best;
}

/** { day: steps } : stepTotalsBySource, then chooseStepTotal per day, rounded; a day that rounds to 0 is left out; a day is capped at 200000. */
export function dailySteps(rows, tz) { return chooseDaily(stepTotalsBySource(rows, tz)); }

/** The second half of dailySteps for totals that were merged across files (readTakeout). */
export function chooseDaily(totals) {
  const out = {};
  if (!isPlain(totals)) return out;
  for (const day of Object.keys(totals)) {
    if (!isSafeKey(day)) continue;
    const n = Math.round(chooseStepTotal(totals[day]));
    if (n > 0) out[day] = Math.min(n, 200000);
  }
  return out;
}

// ---- sleep ----------------------------------------------------------------------------------------------------------------------------------
/** { day: { sleepMinutes, sleepStart, sleepEnd } } from UserSleeps rows. A sleep belongs to the local day it ENDS; the main sleep (most minutes, tie: ends later) gives the times. */
export function sleepByDay(rows, tz) {
  const out = {};
  if (!Array.isArray(rows)) return out;
  const off = offsetOf(tz), seen = new Set(), acc = new Map();
  for (const r of rows) {
    if (!isPlain(r)) continue;
    const a = parseInstant(r.sleep_start), b = parseInstant(r.sleep_end), m = plainNum(r.minutes_asleep);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a) || b - a > 86400000 || !Number.isFinite(m)) continue;
    const id = typeof r.sleep_id === 'string' ? r.sleep_id.trim() : '';
    if (id) { if (seen.has(id)) continue; seen.add(id); }
    const mins = Math.min(Math.round(m), 1440), day = localDay(b, off), cur = acc.get(day);
    if (!cur) acc.set(day, { total: mins, main: { mins, a, b } });
    else {
      cur.total += mins;
      if (mins > cur.main.mins || (mins === cur.main.mins && b > cur.main.b)) cur.main = { mins, a, b };
    }
  }
  for (const [day, v] of acc) {
    const total = Math.min(v.total, 1440);
    if (total > 0) out[day] = { sleepMinutes: total, sleepStart: utcText(v.main.a), sleepEnd: utcText(v.main.b) };
  }
  return out;
}

// ---- workouts -------------------------------------------------------------------------------------------------------------------------------
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const optional = (v, lo, hi, scale = 1) => { const n = plainNum(v) / scale; return n >= lo && n <= hi ? Math.round(n) : undefined; };
/** { day: Workout[] } from UserExercises rows. A workout belongs to the local day it STARTS; at most 20 a day (the earliest). Names are kept as plain text. */
export function workoutsByDay(rows, tz) {
  const out = {};
  if (!Array.isArray(rows)) return out;
  const off = offsetOf(tz), seen = new Set(), acc = new Map();
  for (const r of rows) {
    if (!isPlain(r)) continue;
    const id = typeof r.exercise_id === 'string' ? r.exercise_id.trim().slice(0, 80) : '';
    if (!id || seen.has(id)) continue;
    const start = parseInstant(r.exercise_start);
    if (!Number.isFinite(start)) continue;
    seen.add(id);
    const end = parseInstant(r.exercise_end);
    const w = { id, name: (typeof r.activity_name === 'string' ? r.activity_name : '').replace(CONTROL, '').trim().slice(0, 60) || 'Workout', start: utcText(start),
      minutes: Number.isFinite(end) && end >= start ? Math.min(Math.round((end - start) / 60000), 1440) : 0 };
    for (const [k, col, lo, hi, scale] of [['kcal', 'tracker_total_calories', 0, 20000, 1], ['steps', 'tracker_total_steps', 0, 200000, 1], ['distanceM', 'tracker_total_distance_mm', 0, 1000000, 1000],
      ['avgHr', 'tracker_avg_heart_rate', 20, 300, 1], ['peakHr', 'tracker_peak_heart_rate', 20, 300, 1]]) {
      const n = optional(r[col], lo, hi, scale); if (n !== undefined) w[k] = n;
    }
    const day = localDay(start, off);
    if (acc.has(day)) acc.get(day).push(w); else acc.set(day, [w]);
  }
  for (const [day, list] of acc) {
    list.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    out[day] = list.slice(0, 20);
  }
  return out;
}

// ---- which days, counts, text ---------------------------------------------------------------------------------------------------------------
/** The first day to import: 365 days before `today` (a local YYYY-MM-DD) for 'year' (also any unknown scope), null for 'all' or an invalid `today`. */
export function cutoffDay(today, scope) {
  if (!isDateKey(today)) return null;
  if (scope === 'all') return null;
  return new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) - 365 * 86400000).toISOString().slice(0, 10);
}

/**
 * One partial record per day from { steps, sleep, workouts } (the results of dailySteps, sleepByDay, workoutsByDay): keeps days >= `since` (null: all),
 * leaves out days with nothing, and counts in `left` the DISTINCT days with data that were before `since`. Keys that are not real dates are ignored.
 */
export function combineActivity(parts, since) {
  const p = isPlain(parts) ? parts : {};
  const steps = isPlain(p.steps) ? p.steps : {}, sleep = isPlain(p.sleep) ? p.sleep : {}, workouts = isPlain(p.workouts) ? p.workouts : {};
  const keys = [...new Set([...Object.keys(steps), ...Object.keys(sleep), ...Object.keys(workouts)])].filter(isDateKey).sort();
  const days = {};
  let left = 0;
  for (const day of keys) {
    const rec = {};
    if (has(steps, day) && typeof steps[day] === 'number' && Number.isFinite(steps[day]) && steps[day] > 0) rec.steps = steps[day];
    const s = has(sleep, day) ? sleep[day] : null;
    if (isPlain(s) && typeof s.sleepMinutes === 'number' && Number.isFinite(s.sleepMinutes) && s.sleepMinutes > 0) {
      rec.sleepMinutes = s.sleepMinutes;
      if (typeof s.sleepStart === 'string' && typeof s.sleepEnd === 'string') { rec.sleepStart = s.sleepStart; rec.sleepEnd = s.sleepEnd; }
    }
    const w = has(workouts, day) ? workouts[day] : null;
    if (Array.isArray(w) && w.length) rec.workouts = w.filter(isPlain).map(x => ({ ...x }));
    if (rec.workouts && !rec.workouts.length) delete rec.workouts;
    if (!Object.keys(rec).length) continue;
    if (since === null || since === undefined || day >= since) days[day] = rec; else left++;
  }
  return { days, left };
}

/** How many days of steps, days of sleep and workouts a combineActivity result contains. */
export function countActivity(days) {
  const c = { stepDays: 0, sleepDays: 0, workouts: 0 };
  if (!isPlain(days)) return c;
  for (const d of Object.values(days)) {
    if (!isPlain(d)) continue;
    if (typeof d.steps === 'number') c.stepDays++;
    if (typeof d.sleepMinutes === 'number') c.sleepDays++;
    if (Array.isArray(d.workouts)) c.workouts += d.workouts.length;
  }
  return c;
}

/** The one-sentence result shown after an import. */
export function importSummaryText(v) {
  const o = isPlain(v) ? v : {};
  const n = x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
  const sd = n(o.stepDays), sl = n(o.sleepDays), wo = n(o.workouts), left = n(o.left);
  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const head = sd + sl + wo === 0 ? 'Nothing to import: no steps, sleep or workouts found for that period.'
    : `Imported ${plural(sd, 'day', 'days')} of steps, ${plural(sl, 'day', 'days')} of sleep, ${plural(wo, 'workout', 'workouts')}.`;
  return left > 0 ? `${head} ${left} ${left === 1 ? 'day older than a year was' : 'days older than a year were'} left out.` : head;
}
