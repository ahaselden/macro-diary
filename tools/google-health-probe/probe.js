// Pure helpers for the Google Health probe page (backlog item 20, step 1; spec docs/specs/google-health-probe.md).
// No DOM, no network, no storage: these only build request details and turn answers into short safe text, so Node tests can import them.
// Everything shown on the page passes through these functions and is written with textContent.

const BASE = 'https://health.googleapis.com/v4';
const OBJ = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const validNow = n => n instanceof Date && !Number.isNaN(n.getTime());
const normDays = d => (typeof d === 'number' && Number.isFinite(d) ? Math.min(31, Math.max(1, Math.floor(d))) : 3);
const isRealDate = (y, m, d) => Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1
  && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d && new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1;
const cdt = date => ({ date: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } });
const ymd = date => `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const digits = v => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** The last `days` local calendar days up to and including today, as Google's CivilDateTime objects; the end is exclusive (tomorrow 00:00:00). */
export function civilRange(now, days) {
  if (!validNow(now)) return null;
  const n = normDays(days), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return { start: cdt(new Date(y, m, d - (n - 1))), end: cdt(new Date(y, m, d + 1)) };
}

/** The request body of steps dataPoints:dailyRollUp for those days, or null. */
export function buildDailyRollUpBody(now, days) {
  const range = civilRange(now, days);
  return range ? { range, windowSizeDays: 1 } : null;
}

/** The filter for sleep records that end on or after the first of those days, or ''. */
export function buildSleepFilter(now, days) {
  if (!validNow(now)) return '';
  const n = normDays(days), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return `sleep.interval.civil_end_time >= "${ymd(new Date(y, m, d - (n - 1)))}"`;
}

/** The full request URL for the reconciled sleep records (25 per page), percent-encoded, or ''. */
export function buildSleepUrl(now, days) {
  const filter = buildSleepFilter(now, days);
  return filter ? `${BASE}/users/me/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=${encodeURIComponent(filter)}` : '';
}

/** Daily step totals from a dailyRollUp answer: { count, days: [{ date, steps }], text }. A missing steps field is "no data", an unusable count is "?". */
export function summariseDailyRollUp(json) {
  const list = OBJ(json) && own(json, 'rollupDataPoints') && Array.isArray(json.rollupDataPoints) ? json.rollupDataPoints.filter(OBJ).slice(0, 31) : [];
  if (!list.length) return { count: 0, days: [], text: 'no data points' };
  const days = [], parts = [];
  for (const item of list) {
    const c = OBJ(item.civilStartTime) && OBJ(item.civilStartTime.date) ? item.civilStartTime.date : null;
    const date = c && isRealDate(c.year, c.month, c.day) ? `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}` : '?';
    let steps = null, shown = 'no data';
    if (OBJ(item.steps)) { steps = digits(item.steps.countSum); shown = steps === null ? '?' : String(steps); }
    days.push({ date, steps }); parts.push(`${date}: ${shown}`);
  }
  return { count: days.length, days, text: parts.join('; ') };
}

const UTC_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?Z$/;
const utcMs = s => {
  const m = typeof s === 'string' ? UTC_TIME.exec(s) : null; if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  if (!isRealDate(y, mo, d) || h > 23 || mi > 59 || se > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, se) ; // the fraction of a second is dropped, never rounded
};
const offsetSec = s => { const m = typeof s === 'string' ? /^(-?\d{1,5})s$/.exec(s) : null; const n = m ? Number(m[1]) : NaN; return Number.isInteger(n) && Math.abs(n) <= 86400 ? n : null; };
const localOf = (t, off) => { const ms = utcMs(t), o = offsetSec(off); return ms === null || o === null ? '?' : new Date(ms + o * 1000).toISOString().slice(0, 19); };

/** Sleep records from a reconcile answer: UTC times plus UTC offsets turned into local times, and the local day each one ends on. */
export function summariseSleep(json) {
  const list = OBJ(json) && own(json, 'dataPoints') && Array.isArray(json.dataPoints) ? json.dataPoints.filter(OBJ).slice(0, 25) : [];
  if (!list.length) return { count: 0, records: [], text: 'no sleep records' };
  const records = list.map(item => {
    const sleep = OBJ(item.sleep) ? item.sleep : {}, iv = OBJ(sleep.interval) ? sleep.interval : {}, sum = OBJ(sleep.summary) ? sleep.summary : {};
    const start = utcMs(iv.startTime) === null ? '?' : iv.startTime, end = utcMs(iv.endTime) === null ? '?' : iv.endTime;
    const localStart = localOf(iv.startTime, iv.startUtcOffset), localEnd = localOf(iv.endTime, iv.endUtcOffset);
    return { start, end, localStart, localEnd, endDay: localEnd === '?' ? '?' : localEnd.slice(0, 10), minutesAsleep: digits(sum.minutesAsleep) };
  });
  const text = records.map(r => `${r.localStart} -> ${r.localEnd} (ends ${r.endDay}), ${r.minutesAsleep === null ? '?' : r.minutesAsleep} min asleep`).join('; ');
  return { count: records.length, records, text };
}

// ---- workouts (backlog item 24, step 1; spec docs/specs/google-health-workouts-probe.md) ------------------------------------------------------

/** The full request URL for exercise sessions that START on or after the first of those days (25 per page), percent-encoded, or ''. */
export function buildExerciseUrl(now, days) {
  if (!validNow(now)) return '';
  const n = normDays(days), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const filter = `exercise.interval.civil_start_time >= "${ymd(new Date(y, m, d - (n - 1)))}"`;
  return `${BASE}/users/me/dataTypes/exercise/dataPoints?page_size=25&filter=${encodeURIComponent(filter)}`;
}

const ENUM = /^[A-Z][A-Z0-9_]{1,40}$/;                                  // an enum constant such as RUNNING: the only kind of value ever printed
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const safeKey = k => (typeof k === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(k) && !BAD_KEYS.has(k) ? k : '?');
const MAX_KEY_DEPTH = 6, MAX_ARRAY_ITEMS = 10, MAX_BRACKET_DEPTH = 12, MAX_SHAPE_LINES = 200;
const kindOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? typeof v : '');
const getKey = (o, k) => { try { return o[k]; } catch { return undefined; } };

/** The first `limit` objects of `json.dataPoints` (own property only), non-objects skipped first. Never throws. */
function firstObjects(json, limit) {
  const out = [];
  try {
    if (!OBJ(json) || !own(json, 'dataPoints') || !Array.isArray(json.dataPoints)) return out;
    const list = json.dataPoints;
    for (let i = 0; i < list.length && out.length < limit; i++) { const v = getKey(list, i); if (OBJ(v)) out.push(v); }
  } catch { /* nothing usable */ }
  return out;
}

/**
 * The STRUCTURE of the first `opts.records` (default 3, 1..5) records of a data-points answer, never their values: one line per distinct path
 * ("exercise.metricsSummary.steps: string"), sorted, arrays collapsed to [], at most 6 keys deep and 200 lines. Keys outside [A-Za-z0-9_]{1,40}, and
 * __proto__ / constructor / prototype, print as "?". The only value ever printed is an enum constant (RUNNING). 'no data points' when there is nothing.
 */
export function describeShape(json, opts) {
  try {
    let want = 3;
    try { const r = OBJ(opts) ? opts.records : undefined; if (typeof r === 'number' && Number.isFinite(r)) want = Math.min(5, Math.max(1, Math.floor(r))); } catch { want = 3; }
    const records = firstObjects(json, want);
    if (!records.length) return 'no data points';
    const paths = new Map();                                              // path -> { kinds, enums, records }
    const seen = (map, path, kind, value, rec) => {
      let e = map.get(path); if (!e) { e = { kinds: new Set(), enums: new Set(), records: new Set() }; map.set(path, e); }
      e.kinds.add(kind); e.records.add(rec);
      if (kind === 'string' && ENUM.test(value)) e.enums.add(value);
    };
    const walk = (value, path, keyDepth, bracketDepth, rec) => {
      const kind = kindOf(value);
      if (!kind || !path) return;
      seen(paths, path, kind, value, rec);
      if (kind === 'object' && keyDepth < MAX_KEY_DEPTH) {
        let keys = []; try { keys = Object.keys(value); } catch { keys = []; }
        for (const k of keys) walk(getKey(value, k), path + '.' + safeKey(k), keyDepth + 1, bracketDepth, rec);
      } else if (kind === 'array' && bracketDepth < MAX_BRACKET_DEPTH) {
        let n = 0; try { n = Math.min(value.length, MAX_ARRAY_ITEMS); } catch { n = 0; }
        for (let i = 0; i < n; i++) walk(getKey(value, i), path + '[]', keyDepth, bracketDepth + 1, rec);
      }
    };
    records.forEach((r, i) => {
      let keys = []; try { keys = Object.keys(r); } catch { keys = []; }
      for (const k of keys) walk(getKey(r, k), safeKey(k), 1, 0, i);
    });
    const total = records.length;
    const lines = [...paths.keys()].sort().map(path => {
      const e = paths.get(path);
      const enums = [...e.enums].sort();
      return `${path}: ${[...e.kinds].sort().join('|')}${enums.length ? ' = ' + enums.join(', ') : ''}${e.records.size < total ? ` (${e.records.size} of ${total})` : ''}`;
    });
    if (!lines.length) return 'no fields';
    return (lines.length > MAX_SHAPE_LINES ? [...lines.slice(0, MAX_SHAPE_LINES), '... more paths'] : lines).join('\n');
  } catch { return 'no data points'; }
}

/**
 * Exercise sessions from a dataPoints answer, best effort (the exact field names are not known yet): per record the type (the first enum-shaped string in a
 * field of `exercise` whose name contains "type", else ?), the local start and end (UTC time + UTC offset, like sleep) and the local day it starts on.
 */
export function summariseExercise(json) {
  const empty = { count: 0, records: [], text: 'no exercise records' };
  try {
    const list = firstObjects(json, 25);
    if (!list.length) return empty;
    const records = list.map(item => {
      const ex = getKey(item, 'exercise'), exo = OBJ(ex) ? ex : {}, ivRaw = getKey(exo, 'interval'), iv = OBJ(ivRaw) ? ivRaw : {};
      let type = '?';
      try {
        for (const k of Object.keys(exo)) { const v = getKey(exo, k); if (k.toLowerCase().includes('type') && typeof v === 'string' && ENUM.test(v)) { type = v; break; } }
      } catch { type = '?'; }
      const localStart = localOf(getKey(iv, 'startTime'), getKey(iv, 'startUtcOffset')), localEnd = localOf(getKey(iv, 'endTime'), getKey(iv, 'endUtcOffset'));
      return { type, localStart, localEnd, startDay: localStart === '?' ? '?' : localStart.slice(0, 10) };
    });
    return { count: records.length, records, text: records.map(r => `${r.type}: ${r.localStart} -> ${r.localEnd}`).join('; ') };
  } catch { return empty; }
}

/** Make any text safe to show: no control characters, tokens and email addresses removed, whitespace collapsed, clipped to `max` characters. */
function clean(s, max = 200) {
  let t = String(s).replace(/ya29\.[\w.-]*/g, '[token removed]').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email removed]').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max - 1) + '…';
  return t;
}
const str = v => (typeof v === 'string' && v.trim() ? v : '');

/** A short, safe description of whatever went wrong: a Google Identity Services error, a Google HTTP error body, an Error, or junk. Never throws. */
export function describeError(e) {
  try {
    let out = '';
    if (e instanceof Error) out = `${e.name}: ${e.message}`;
    else if (typeof e === 'string') out = e;
    else if (OBJ(e)) {
      const err = e.error;
      if (OBJ(err)) {                                                   // Google's HTTP error body: { error: { code, message, status, details } }
        const status = str(err.status), message = str(err.message), code = typeof err.code === 'number' && Number.isFinite(err.code) ? err.code : null;
        const head = status ? status + (code === null ? '' : ` (${code})`) : '';
        out = head && message ? `${head}: ${message}` : head || message;
        const d = Array.isArray(err.details) ? err.details.find(x => OBJ(x) && str(x.reason)) : null;
        if (out && d) out += `; reason=${d.reason}`;
      } else {                                                          // a Google Identity Services error
        const parts = [];
        if (str(err)) parts.push(`error=${err}`);
        if (str(e.error_description)) parts.push(`error_description=${e.error_description}`);
        if (str(e.type)) parts.push(`type=${e.type}`);
        out = parts.join('; ');
      }
    }
    return clean(out) || 'unknown error';
  } catch { return 'unknown error'; }
}

/** The text the owner copies back: a fixed layout, never the token, never an email, numbers only when `showNumbers` is exactly true. */
export function resultSummary(results, showNumbers) {
  const r = OBJ(results) ? results : {}, token = OBJ(r.token) ? r.token : {}, lines = ['Google Health probe result'];
  const ok = token.ok === true;
  lines.push('Sign-in: ' + (ok ? 'ok' : 'failed'));
  if (ok) {
    lines.push('expires_in: ' + (typeof token.expiresIn === 'number' && Number.isFinite(token.expiresIn) && token.expiresIn >= 0 ? Math.round(token.expiresIn) : 'unknown'));
    lines.push('refresh_token present: ' + (token.hasRefreshToken === true ? 'yes' : 'no'));
    lines.push('scope granted: ' + (str(token.scope) ? clean(token.scope) : 'none'));
  }
  if (r.gisError !== undefined && r.gisError !== null) lines.push('GIS error: ' + describeError(r.gisError));
  const checks = Array.isArray(r.checks) ? r.checks.filter(OBJ) : [], numbers = [];
  for (const c of checks) {
    const name = str(c.name) ? clean(c.name) : '?', status = typeof c.status === 'number' && Number.isInteger(c.status) && c.status >= 100 && c.status <= 599 ? `HTTP ${c.status}` : 'no response';
    let line = `${name}: ${status} - ${c.ok === true ? 'ok' : 'failed'}`;
    if (c.ok !== true && str(c.message)) line += ': ' + describeError(c.message);
    lines.push(line);
    // a check may carry a SHAPE (field names and kinds, no values): always printed, each line indented so it cannot pass for a top-level line
    if (typeof c.shape === 'string' && c.shape.trim()) {
      const shapeLines = c.shape.split(new RegExp('\\r\\n|[\\r\\n' + String.fromCharCode(0x2028, 0x2029) + ']')).slice(0, 300).map(l => clean(l.slice(0, 400))).filter(Boolean);
      if (shapeLines.length) lines.push(`${name} shape:`, ...shapeLines.map(l => '  ' + l));
    }
    if (showNumbers === true && str(c.numbers)) numbers.push(`${name} numbers: ${clean(c.numbers, 1000)}`);
  }
  return [...lines, ...numbers].join('\n');
}
