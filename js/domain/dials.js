// Ring dials for the Diary (backlog item 21, D56). PURE: no DOM, no storage. Takes the state and a day, returns plain data the UI draws.
// Four concentric nutrition rings (calories, protein, carbs, fat) and one ring each for the imported steps and sleep of that day. Every ring also
// has its numbers as text, so colour is never the only signal; a ring without data says 'no data' (never a silent 0).
import { rd } from '../core/format.js';
import { totals } from './nutrition.js';
import { activityForDay } from './activity.js';
import { DIAL_KEYS, sanitizeDials } from '../core/schema.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Share of the goal reached, 0..1 (capped). Anything unusable, or a goal of 0 or less, is 0: no division by zero. */
export function ringFraction(value, goal) {
  if (!isNum(value) || !isNum(goal) || goal <= 0 || value < 0) return 0;
  return Math.min(1, value / goal);
}

/** Strictly over a real goal. */
export function isOver(value, goal) { return isNum(value) && isNum(goal) && goal > 0 && value > goal; }

/** SVG dash numbers for a ring that starts at 12 o'clock and runs clockwise (the UI rotates the circle by -90 degrees; no offset needed). */
export function ringArc(fraction, radius) {
  if (!isNum(radius) || radius <= 0 || !Number.isFinite(2 * Math.PI * radius)) return { circumference: 0, filled: 0, gap: 0, dasharray: '0 0' };
  const f = typeof fraction === 'number' && !Number.isNaN(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;   // +Infinity is a full ring
  const circumference = 2 * Math.PI * radius, filled = f * circumference, gap = Math.max(0, circumference - filled);
  return { circumference, filled, gap, dasharray: filled + ' ' + gap };
}

/** Radii of `count` concentric rings, outermost first; [] when they do not fit or the arguments are not sensible. */
export function ringRadii(size, stroke, gap, count) {
  if (!isNum(size) || size <= 0 || !isNum(stroke) || stroke <= 0 || !isNum(gap) || gap < 0 || !Number.isInteger(count) || count < 1 || count > 8) return [];
  const out = [];
  for (let i = 0; i < count; i++) out.push(size / 2 - stroke / 2 - i * (stroke + gap));
  return out.every(r => r - stroke / 2 > 0) ? out : [];
}

/** '7 h 53 min', '8 h', '45 min'; '' for anything that is not a number of minutes. */
export function formatSleep(minutes) {
  if (!isNum(minutes) || minutes < 0) return '';
  const m = Math.round(minutes), h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h} h ${r} min` : h ? `${h} h` : `${r} min`;
}

/** '9,431'; '' for anything that is not a number of steps. */
export function formatSteps(n) {
  if (!isNum(n) || n < 0) return '';
  return Math.round(n).toLocaleString('en-US');
}

/** Steps in at most 4 characters: '850', '2.3k', '10k', '13k', '1.5M', '99M+'. '' for anything that is not a number of 0 or more. */
export function shortSteps(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '';
  if (n < 999.5) return String(Math.round(n));
  if (n < 9950) return String(Math.floor(n / 100 + 0.5) / 10) + 'k';
  if (n < 999500) return String(Math.floor(n / 1000 + 0.5)) + 'k';
  if (n < 9950000) return String(Math.floor(n / 1e5 + 0.5) / 10) + 'M';
  if (n < 99500000) return String(Math.floor(n / 1e6 + 0.5)) + 'M';
  return '99M+';
}

/** Minutes as hours without a unit, in at most 4 characters: '7.9', '8', '11', '99+'. '' for anything that is not a number of 0 or more. */
export function shortHours(minutes) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return '';
  const h = minutes / 60;
  if (h >= 99.5) return '99+';
  return h < 10 ? String(Math.floor(h * 10 + 0.5) / 10) : String(Math.floor(h + 0.5));
}

const capNum = n => (n > 99999 ? '99999+' : String(n));   // so the centre text always fits the ring
/** Centre text of a nutrition ring: the amount left or over; with no goal, what was eaten. */
function nutCentre(eaten, goal, unit) {
  if (!goal) return { text: capNum(Math.round(eaten)), caption: unit + ' eaten' };
  return { text: capNum(Math.abs(Math.round(goal - eaten))), caption: goal - eaten < 0 ? unit + ' over' : unit + ' left' };
}

const goalOf = v => (isNum(v) && v > 0 ? v : 0);   // text, null and the like are not goals (sanitize makes goals numbers)

/** One ring: `value` null means no data. `fmt(v)` formats value and goal; `unit` follows the numbers. */
function makeRing(key, name, color, value, goal, fmt, unit, fmtGoal = fmt) {
  const has = value !== null;
  if (!has) return { key, name, value: null, goal: goalOf(goal), fraction: 0, over: false, hasData: false, text: 'no data', label: name + ': no data', color };
  const g = goalOf(goal), vt = fmt(value) + unit;
  if (!g) return { key, name, value, goal: 0, fraction: 0, over: false, hasData: true, text: vt, label: name + ': ' + vt + ', no goal set', color };
  const text = fmt(value) + ' / ' + fmtGoal(g) + unit, over = isOver(value, g);
  return { key, name, value, goal: g, fraction: ringFraction(value, g), over, hasData: true, text, label: name + ': ' + text.replace(' / ', ' of ') + (over ? ', over goal' : ''), color };
}

const plain = n => String(Number(n));

/** The chosen dials as a clean list (known keys, once each, fixed order; [] allowed; not a list gives ['k']). Always a new array. */
export const normalizeDials = list => sanitizeDials(list);

/** Add (`on` true), remove (`on` false) or flip (anything else) one dial. A new array in the fixed order; an unknown key changes nothing. */
export function toggleDial(list, key, on) {
  const base = normalizeDials(list);
  if (typeof key !== 'string' || !DIAL_KEYS.includes(key)) return base;
  const has = base.includes(key), want = on === true ? true : on === false ? false : !has;
  return DIAL_KEYS.filter(k => (k === key ? want : base.includes(k)));
}

/** The whole dial for a day as plain data (see docs/specs/dials.md). Never throws, never changes `state`. */
export function dialModel(state, day) {
  const st = isPlain(state) ? state : {}, g = isPlain(st.goals) ? st.goals : {};
  const list = isPlain(st.days) && typeof day === 'string' && own(st.days, day) && Array.isArray(st.days[day]) ? st.days[day] : [];
  let t = { k: 0, p: 0, c: 0, f: 0 };
  try { const x = totals(list); if (isPlain(x)) t = { k: Number(x.k) || 0, p: Number(x.p) || 0, c: Number(x.c) || 0, f: Number(x.f) || 0 }; } catch { /* a malformed entry shows as nothing eaten */ }
  const kg = goalOf(g.k);
  const rings = [
    makeRing('k', 'Calories', 'var(--kcal)', t.k, kg, v => plain(rd(v)), ' kcal', plain),
    makeRing('p', 'Protein', 'var(--p)', t.p, g.p, v => plain(rd(v)), ' g', plain),
    makeRing('c', 'Carbs', 'var(--c)', t.c, g.c, v => plain(rd(v)), ' g', plain),
    makeRing('f', 'Fat', 'var(--f)', t.f, g.f, v => plain(rd(v)), ' g', plain),
  ];
  // the calories ring prints the goal as a plain number (2000), not the rounded eaten value
  const centre = nutCentre(t.k, kg, 'kcal');
  rings[0].centre = centre;
  rings[1].centre = nutCentre(t.p, goalOf(g.p), 'g'); rings[2].centre = nutCentre(t.c, goalOf(g.c), 'g'); rings[3].centre = nutCentre(t.f, goalOf(g.f), 'g');
  const act = activityForDay(st, day);
  const stepsV = act && isNum(act.steps) && act.steps >= 0 ? act.steps : null;
  const sleepV = act && isNum(act.sleepMinutes) && act.sleepMinutes > 0 ? act.sleepMinutes : null;
  const sleepGoal = isNum(g.sleepH) ? g.sleepH * 60 : 0;
  const steps = makeRing('steps', 'Steps', 'var(--ring-steps)', stepsV, g.steps, formatSteps, '');
  const sleep = makeRing('sleep', 'Sleep', 'var(--ring-sleep)', sleepV, sleepGoal, formatSleep, '');
  const stepsGoal = goalOf(g.steps);
  steps.centre = stepsV === null ? { text: '--', caption: 'no data' } : { text: stepsGoal ? shortSteps(stepsV) + '/' + shortSteps(stepsGoal) : shortSteps(stepsV), caption: 'steps' };
  sleep.centre = sleepV === null ? { text: '--', caption: 'no data' } : { text: sleepGoal > 0 ? shortHours(sleepV) + '/' + shortHours(sleepGoal) + 'h' : shortHours(sleepV) + 'h', caption: 'sleep' };
  const label = `Nutrition: ${rings[0].text.replace(' / ', ' of ')} eaten, ${rings[1].label}, ${rings[2].label}, ${rings[3].label}`;
  return { nutrition: { label, centre, rings }, steps, sleep, selected: normalizeDials(st.dials), rings: { k: rings[0], p: rings[1], c: rings[2], f: rings[3], steps, sleep }, rows: rings };
}
