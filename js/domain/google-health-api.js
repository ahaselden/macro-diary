// Google Health API sync, the pure part (backlog item 20, step 2; spec docs/specs/google-health-sync.md, D62).
// No DOM, no network, no storage, no clock: request builders, a parser for the two answers (steps and sleep), the merge into state.activity and the
// texts. The service (services/google-health-api.js) does the sign-in and the calls; the ui hands the answers here.
import { sanitizeActivityDay, isDateKey } from '../core/schema.js';

export const SYNC_DAYS = 7;
const BASE = 'https://health.googleapis.com/v4';
const OBJ = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const validNow = n => n instanceof Date && !Number.isNaN(n.getTime());
const normDays = d => (typeof d === 'number' && Number.isFinite(d) ? Math.min(31, Math.max(1, Math.floor(d))) : SYNC_DAYS);
const realDate = (y, m, d) => Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) && y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1
  && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d && new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1;
const cdt = date => ({ date: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } });
const ymd = date => `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The last `days` local calendar days up to and including today as Google's CivilDateTime objects; the end is exclusive (tomorrow 00:00:00). */
export function civilRange(now, days) {
  if (!validNow(now)) return null;
  const n = normDays(days), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return { start: cdt(new Date(y, m, d - (n - 1))), end: cdt(new Date(y, m, d + 1)) };
}

/** The request body of steps dataPoints:dailyRollUp, or null. */
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

/** The request URL of the reconciled sleep records (25 per page), percent-encoded, with an optional page token; '' for an invalid `now`. */
export function buildSleepUrl(now, days, pageToken) {
  const filter = buildSleepFilter(now, days);
  if (!filter) return '';
  const url = `${BASE}/users/me/dataTypes/sleep/dataPoints:reconcile?page_size=25&filter=${encodeURIComponent(filter)}`;
  return typeof pageToken === 'string' && pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url;
}

// ---- parsing the two answers -----------------------------------------------------------------------------------------------------------------
const MAX_STEPS = 200000, MAX_ITEMS = 1000;
const digits = v => (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const list = (json, key) => { try { return OBJ(json) && own(json, key) && Array.isArray(json[key]) ? json[key].slice(0, MAX_ITEMS) : []; } catch { return []; } };   // a throwing getter is "no data"

function stepsByDay(json) {
  const out = new Map();
  for (const item of list(json, 'rollupDataPoints')) {
    try {
      if (!OBJ(item) || !OBJ(item.civilStartTime) || !OBJ(item.civilStartTime.date) || !OBJ(item.steps)) continue;
      const c = item.civilStartTime.date;
      if (!realDate(c.year, c.month, c.day)) continue;
      const n = digits(item.steps.countSum);
      if (n === null || n > MAX_STEPS) continue;
      const day = `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}`;
      if (!out.has(day) || n > out.get(day)) out.set(day, n);            // the larger count, whatever the order
    } catch { /* an item with a throwing getter is skipped */ }
  }
  return out;
}

const UTC_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;
/** Milliseconds of a UTC time written YYYY-MM-DDTHH:MM:SS[.fraction]Z (the fraction is dropped, never rounded), or null. */
const utcMs = s => {
  const m = typeof s === 'string' ? UTC_TIME.exec(s) : null;
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  return realDate(y, mo, d) && h <= 23 && mi <= 59 && se <= 59 ? Date.UTC(y, mo - 1, d, h, mi, se) : null;
};
const utcText = ms => new Date(ms).toISOString().slice(0, 19) + 'Z';
const offsetSec = s => { const m = typeof s === 'string' ? /^(-?\d{1,5})s$/.exec(s) : null; const n = m ? Number(m[1]) : NaN; return Number.isInteger(n) && Math.abs(n) <= 86400 ? n : null; };

function sleepByDay(json) {
  const byDay = new Map();
  for (const item of list(json, 'dataPoints')) {
    try {
      if (!OBJ(item) || !OBJ(item.sleep) || !OBJ(item.sleep.interval)) continue;
      const iv = item.sleep.interval, sum = OBJ(item.sleep.summary) ? item.sleep.summary : {};
      const a = utcMs(iv.startTime), b = utcMs(iv.endTime), off = offsetSec(iv.endUtcOffset), min = digits(sum.minutesAsleep);
      if (a === null || b === null || off === null || min === null || min < 1 || min > 1440 || b <= a || b - a > 86400000) continue;
      const day = new Date(b + off * 1000).toISOString().slice(0, 10);   // the LOCAL day the sleep ENDS on, in UTC arithmetic (the machine timezone never matters)
      const rec = { min, a, b }, cur = byDay.get(day) || { total: 0, main: null };
      cur.total += min;
      const m = cur.main;
      if (!m || min > m.min || (min === m.min && (b > m.b || (b === m.b && b - a > m.b - m.a)))) cur.main = rec;   // most minutes, tie: ends later, then longer
      byDay.set(day, cur);
    } catch { /* skipped */ }
  }
  return byDay;
}

/**
 * The two answers as per-day fields keyed by LOCAL date: { 'YYYY-MM-DD': { steps?, sleepMinutes?, sleepStart?, sleepEnd? } }. Sleep of a day = the sum of the
 * records ending that day (capped at 1440); start and end are those of the main record (as the zip import does). Never throws, never mutates.
 */
export function parseHealthAnswers(stepsJson, sleepJson) {
  const out = {};
  const steps = stepsByDay(stepsJson), sleep = sleepByDay(sleepJson);
  for (const [day, n] of steps) out[day] = { steps: n };
  for (const [day, s] of sleep) out[day] = { ...(out[day] || {}), sleepMinutes: Math.min(1440, s.total), sleepStart: utcText(s.main.a), sleepEnd: utcText(s.main.b) };
  return out;
}

// ---- applying them ---------------------------------------------------------------------------------------------------------------------------
const sortedJson = v => JSON.stringify(v, (k, x) => (OBJ(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const withoutStamp = r => { const { updatedAt, ...rest } = r; return sortedJson(rest); };   // eslint-disable-line no-unused-vars

/**
 * Merge the API's steps and sleep into state.activity: steps and the sleep trio (minutes, start, end) are replaced by the API's when it has them (a day
 * without steps data keeps its steps; the API replaces a stored total even when lower, see the spec), the stored workouts are ALWAYS kept, and a record that
 * is equal to the stored one ignoring `updatedAt` writes nothing so sync pushes nothing. Returns { added, updated, unchanged }.
 */
export function applyHealthSync(state, days, now) {
  const res = { added: 0, updated: 0, unchanged: 0 };
  if (!OBJ(state) || !OBJ(days) || typeof now !== 'number' || !Number.isFinite(now) || now <= 0) return res;
  for (const day of Object.keys(days)) {
    if (!isDateKey(day) || !OBJ(days[day])) continue;
    const f = days[day];
    const steps = typeof f.steps === 'number' && Number.isInteger(f.steps) && f.steps >= 0 && f.steps <= MAX_STEPS ? f.steps : undefined;
    const minutes = typeof f.sleepMinutes === 'number' && Number.isInteger(f.sleepMinutes) && f.sleepMinutes >= 1 && f.sleepMinutes <= 1440 ? f.sleepMinutes : undefined;
    const cand = sanitizeActivityDay({ source: 'google-health', updatedAt: now, steps, sleepMinutes: minutes, sleepStart: f.sleepStart, sleepEnd: f.sleepEnd });
    if (!cand || (cand.steps === undefined && cand.sleepMinutes === undefined)) continue;
    const had = OBJ(state.activity) && own(state.activity, day);
    const old = had ? sanitizeActivityDay(state.activity[day]) : null;
    const next = { source: 'google-health', updatedAt: now };
    const st = cand.steps !== undefined ? cand.steps : old && old.steps;
    if (st !== undefined && st !== null) next.steps = st;
    const trio = cand.sleepMinutes !== undefined ? cand : old;
    if (trio && trio.sleepMinutes !== undefined) {
      next.sleepMinutes = trio.sleepMinutes;
      if (trio.sleepStart !== undefined) { next.sleepStart = trio.sleepStart; next.sleepEnd = trio.sleepEnd; }
    }
    if (old && old.workouts) next.workouts = old.workouts.map(w => ({ ...w }));
    const rec = sanitizeActivityDay(next);
    if (!rec) continue;
    if (old && withoutStamp(old) === withoutStamp(rec)) { res.unchanged++; continue; }
    if (!OBJ(state.activity)) state.activity = {};
    state.activity[day] = rec;
    if (had) res.updated++; else res.added++;
  }
  return res;
}

/** The status line after a sync: 'Synced 3 days: steps for 3, sleep for 3', or the nothing-to-sync sentence. */
export function healthSyncText(days) {
  let n = 0, s = 0, l = 0;
  if (OBJ(days)) for (const v of Object.values(days)) {
    if (!OBJ(v)) continue;
    const hasS = typeof v.steps === 'number', hasL = typeof v.sleepMinutes === 'number';
    if (hasS || hasL) n++;
    if (hasS) s++;
    if (hasL) l++;
  }
  return n > 0 ? `Synced ${n} ${n === 1 ? 'day' : 'days'}: steps for ${s}, sleep for ${l}` : `Nothing to sync: Google Health has no steps or sleep for the last ${SYNC_DAYS} days.`;
}

// ---- the Client ID ---------------------------------------------------------------------------------------------------------------------------
const MSG = {
  empty: 'Enter a Client ID first.',
  secret: 'That looks like a client secret, which must never be pasted here. Use the Client ID, which ends in .apps.googleusercontent.com.',
  shape: 'That does not look like a Client ID. It should end in .apps.googleusercontent.com.',
};

/** { ok: true, id } for a Client ID of the usual shape (the trimmed text), else { ok: false, message }. A client SECRET is refused and never echoed. */
export function checkClientId(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { ok: false, message: MSG.empty };
  if (/GOCSPX-/i.test(t)) return { ok: false, message: MSG.secret };
  if (!/^[A-Za-z0-9_-]{10,100}\.apps\.googleusercontent\.com$/.test(t)) return { ok: false, message: MSG.shape };
  return { ok: true, id: t };
}

// ---- when to sync by itself, and how to say how long ago -----------------------------------------------------------------------------------
const HOUR_MS = 3600000;
const posNum = v => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Should the app try a quiet sync now? Only when the switch is on, a Client ID is available, a PREVIOUS sync succeeded on this device (the first sync is
 * always an explicit tap, because Google asks for consent then), and at least `minHours` (default 3) have passed. Pure: `now` is an argument. Never throws.
 */
export function shouldAutoSync(o) {
  try {
    if (!OBJ(o)) return false;
    const { enabled, hasClientId, lastSyncAt, now } = o, mh = o.minHours;
    if (!enabled || !hasClientId || !posNum(lastSyncAt) || !posNum(now)) return false;
    const hours = posNum(mh) ? mh : 3;
    return now - lastSyncAt >= hours * HOUR_MS;
  } catch { return false; }
}

/** 'Last synced just now' / 'a minute' / '5 minutes' / 'an hour' / '3 hours' / 'a day' / '2 days' ago (units floored), or '' when unknown, in the future or junk. Plain text. */
export function syncAgoText(lastSyncAt, now) {
  try {
    if (!posNum(lastSyncAt) || !posNum(now) || lastSyncAt > now) return '';
    const ms = now - lastSyncAt, min = Math.floor(ms / 60000), hr = Math.floor(ms / HOUR_MS), day = Math.floor(ms / (24 * HOUR_MS));
    const unit = (n, one, many) => `Last synced ${n === 1 ? one : n + ' ' + many} ago`;
    if (min < 1) return 'Last synced just now';
    if (hr < 1) return unit(min, 'a minute', 'minutes');
    if (day < 1) return unit(hr, 'an hour', 'hours');
    return unit(day, 'a day', 'days');
  } catch { return ''; }
}
