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

/** The filter for exercise sessions that START on or after the first of those days, or ''. */
export function buildExerciseFilter(now, days) {
  if (!validNow(now)) return '';
  const n = normDays(days), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  return `exercise.interval.civil_start_time >= "${ymd(new Date(y, m, d - (n - 1)))}"`;
}

/** The request URL of the exercise sessions (25 per page), percent-encoded, with an optional page token; '' for an invalid `now`. */
export function buildExerciseUrl(now, days, pageToken) {
  const filter = buildExerciseFilter(now, days);
  if (!filter) return '';
  const url = `${BASE}/users/me/dataTypes/exercise/dataPoints?page_size=25&filter=${encodeURIComponent(filter)}`;
  return typeof pageToken === 'string' && pageToken ? `${url}&pageToken=${encodeURIComponent(pageToken)}` : url;
}

// ---- parsing the answers ---------------------------------------------------------------------------------------------------------------------
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

// ---- workouts (backlog item 24; spec docs/specs/google-health-workouts.md, D67) -------------------------------------------------------------------
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_WORKOUTS_PER_DAY = 20;
/** A number from a JSON number or a plain decimal text ("312", "312.4"); anything else (objects, '', ' 12', '1e2', NaN, Infinity) is null. */
const looseNum = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
const ownGet = (o, k) => (OBJ(o) && own(o, k) ? o[k] : undefined);
/** round(n) when n >= 0 and the rounded value is within [lo, hi], else undefined (out of range is dropped, never clamped). */
const rangeRound = (n, lo, hi) => { if (n === null || n < 0) return undefined; const r = Math.round(n); return r >= lo && r <= hi ? r : undefined; };
const typeLabel = t => {
  if (typeof t !== 'string' || !/^[A-Z][A-Z0-9_]{0,40}$/.test(t)) return 'Workout';
  const s = t.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const workoutId = (name, startMs) => {
  const last = typeof name === 'string' ? name.slice(name.lastIndexOf('/') + 1) : '';
  return /^[A-Za-z0-9._=~+-]{1,80}$/.test(last) ? last : 'gh-' + startMs.toString(36);   // no usable resource name: derived from the start, stable and valid
};

/** One data point -> { day, w } or null. */
function oneWorkout(item) {
  if (!OBJ(item)) return null;
  const ex = ownGet(item, 'exercise'), iv = ownGet(ex, 'interval');
  if (!OBJ(ex) || !OBJ(iv)) return null;
  const startMs = utcMs(iv.startTime), off = offsetSec(iv.startUtcOffset);
  if (startMs === null || off === null) return null;
  let minutes = 0;
  const dur = ownGet(ex, 'activeDuration'), secs = typeof dur === 'string' && /^\d+(\.\d+)?s$/.test(dur) ? Number(dur.slice(0, -1)) : null;
  const fromDur = secs === null ? undefined : rangeRound(secs / 60, 0, 1440);
  if (fromDur !== undefined) minutes = fromDur;
  else { const endMs = utcMs(iv.endTime), m = endMs !== null && endMs >= startMs ? rangeRound((endMs - startMs) / 60000, 0, 1440) : undefined; if (m !== undefined) minutes = m; }
  const shown = ownGet(ex, 'displayName');
  const cleaned = typeof shown === 'string' ? shown.replace(CONTROL, '').trim().slice(0, 60) : '';
  const w = { id: workoutId(ownGet(item, 'name'), startMs), name: cleaned || typeLabel(ownGet(ex, 'exerciseType')), start: utcText(startMs), minutes };
  const ms = ownGet(ex, 'metricsSummary');
  if (OBJ(ms)) {
    const kcal = rangeRound(looseNum(ownGet(ms, 'caloriesKcal')), 0, 20000); if (kcal !== undefined) w.kcal = kcal;
    const mm = looseNum(ownGet(ms, 'distanceMillimeters')), dist = mm === null ? undefined : rangeRound(mm / 1000, 0, 1000000); if (dist !== undefined) w.distanceM = dist;
    const st = ownGet(ms, 'steps'), steps = typeof st === 'number' || (typeof st === 'string' && /^\d+$/.test(st)) ? rangeRound(looseNum(st), 0, MAX_STEPS) : undefined; if (steps !== undefined) w.steps = steps;
    const hr = rangeRound(looseNum(ownGet(ms, 'averageHeartRateBeatsPerMinute')), 20, 300); if (hr !== undefined) w.avgHr = hr;
  }
  return { day: new Date(startMs + off * 1000).toISOString().slice(0, 10), w };
}

/**
 * The exercise answer as { 'YYYY-MM-DD': Workout[] } by the LOCAL day each session STARTS on: sorted by start then id, one workout per id, at most 20 a day
 * (the earliest). Workout = the saved shape ({ id, name, start, minutes, kcal?, steps?, distanceM?, avgHr? }); absent metrics are absent keys. Never throws.
 */
export function parseExerciseAnswer(json) {
  const found = [];
  for (const item of list(json, 'dataPoints')) { try { const r = oneWorkout(item); if (r) found.push(r); } catch { /* an item with a throwing getter is skipped */ } }
  found.sort((x, y) => (x.w.start < y.w.start ? -1 : x.w.start > y.w.start ? 1 : x.w.id < y.w.id ? -1 : x.w.id > y.w.id ? 1 : 0));
  const seen = new Set(), out = {};
  for (const { day, w } of found) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    const l = own(out, day) ? out[day] : (out[day] = []);
    if (l.length < MAX_WORKOUTS_PER_DAY) l.push(w);
  }
  return out;
}

/**
 * The answers as per-day fields keyed by LOCAL date: { 'YYYY-MM-DD': { steps?, sleepMinutes?, sleepStart?, sleepEnd?, workouts? } }. Sleep of a day = the sum of
 * the records ending that day (capped at 1440); start and end are those of the main record (as the zip import does). Workouts come from the optional third
 * answer. Never throws, never mutates.
 */
export function parseHealthAnswers(stepsJson, sleepJson, exerciseJson) {
  const out = {};
  const steps = stepsByDay(stepsJson), sleep = sleepByDay(sleepJson);
  for (const [day, n] of steps) out[day] = { steps: n };
  for (const [day, s] of sleep) out[day] = { ...(out[day] || {}), sleepMinutes: Math.min(1440, s.total), sleepStart: utcText(s.main.a), sleepEnd: utcText(s.main.b) };
  const workouts = parseExerciseAnswer(exerciseJson);
  for (const day of Object.keys(workouts)) out[day] = { ...(out[day] || {}), workouts: workouts[day] };
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
    const cand = sanitizeActivityDay({ source: 'google-health', updatedAt: now, steps, sleepMinutes: minutes, sleepStart: f.sleepStart, sleepEnd: f.sleepEnd, workouts: f.workouts });
    if (!cand || (cand.steps === undefined && cand.sleepMinutes === undefined && cand.workouts === undefined)) continue;
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
    const keptWorkouts = cand.workouts !== undefined ? cand.workouts : old && old.workouts;   // the API's workouts REPLACE the day's stored ones; no workouts from the API keeps them
    if (keptWorkouts) next.workouts = keptWorkouts.map(w => ({ ...w }));
    const rec = sanitizeActivityDay(next);
    if (!rec) continue;
    if (old && withoutStamp(old) === withoutStamp(rec)) { res.unchanged++; continue; }
    if (!OBJ(state.activity)) state.activity = {};
    state.activity[day] = rec;
    if (had) res.updated++; else res.added++;
  }
  return res;
}

export const WORKOUTS_FAILED_TEXT = 'Workouts could not be read from Google Health.';

/**
 * The status line after a sync: 'Synced 3 days: steps for 3, sleep for 3' (+ ', workouts for 2' counting DAYS with workouts), or the nothing-to-sync
 * sentence; a truthy `workoutsError` is a flag (its text is never shown) that appends the fixed sentence WORKOUTS_FAILED_TEXT.
 */
export function healthSyncText(days, workoutsError) {
  let n = 0, s = 0, l = 0, w = 0;
  if (OBJ(days)) for (const v of Object.values(days)) {
    if (!OBJ(v)) continue;
    const hasS = typeof v.steps === 'number', hasL = typeof v.sleepMinutes === 'number', hasW = Array.isArray(v.workouts) && v.workouts.length > 0;
    if (hasS || hasL || hasW) n++;
    if (hasS) s++;
    if (hasL) l++;
    if (hasW) w++;
  }
  const base = n > 0 ? `Synced ${n} ${n === 1 ? 'day' : 'days'}: steps for ${s}, sleep for ${l}${w > 0 ? `, workouts for ${w}` : ''}`
    : `Nothing to sync: Google Health has no steps or sleep for the last ${SYNC_DAYS} days.`;
  return workoutsError ? `${base}${n > 0 ? '.' : ''} ${WORKOUTS_FAILED_TEXT}` : base;
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
