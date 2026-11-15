// Water tracker maths (backlog item 23, D58). PURE: no DOM, no storage. A day's water is a whole number of HALF cups (0..80); a cup is 8 fl oz or 240 ml.
import { isDateKey, sanitizeWaterCups, sanitizeWaterDay } from '../core/schema.js';

const MAX_HALVES = 80, MAX_CUPS = 40;
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const num = n => String(Number(n));

/** The day's total after tapping cup `cup` (1-based). The cups before it are filled, so a row of glasses reads left to right.
 *  'half' mode: empty -> half -> full -> empty; 'whole' mode: empty or half -> full -> empty. Tapping a full cup empties it and every cup after it.
 *  A bad `cup` leaves the total as it is; a bad `current` counts as 0; any mode but 'whole' is 'half'. */
export function nextHalves(current, cup, mode) {
  const cur = typeof current === 'number' && Number.isInteger(current) && current >= 0 && current <= MAX_HALVES ? current : 0;
  if (typeof cup !== 'number' || !Number.isInteger(cup) || cup < 1 || cup > MAX_CUPS) return cur;
  const before = 2 * (cup - 1), mine = Math.min(2, Math.max(0, cur - before));
  const next = mine === 2 ? 0 : mode === 'whole' ? 2 : mine + 1;
  return Math.min(MAX_HALVES, before + next);
}

/** What the card shows for a day: { halves, goalCups, unit, cups: [{ state, over, label }], text, goalText, over }. Never throws, never changes `state`. */
export function waterModel(state, day) {
  const st = isPlain(state) ? state : {}, goals = isPlain(st.goals) ? st.goals : {};
  const goalCups = sanitizeWaterCups(goals.waterCups), unit = st.weightUnit === 'g' ? 'ml' : 'oz', perHalf = unit === 'ml' ? 120 : 4;
  let halves = 0;
  if (isDateKey(day) && isPlain(st.water) && own(st.water, day)) { const w = sanitizeWaterDay(st.water[day]); if (w) halves = w.halves; }
  const shown = Math.min(MAX_CUPS, Math.max(goalCups, Math.ceil(halves / 2))), over = halves > 2 * goalCups, cups = [];
  for (let i = 0; i < shown; i++) {
    const left = halves - 2 * i, fill = left >= 2 ? 'full' : left === 1 ? 'half' : 'empty', isOver = i + 1 > goalCups && fill !== 'empty';
    cups.push({ state: fill, over: isOver, label: `Cup ${i + 1} of ${shown}, ${fill === 'half' ? 'half full' : fill}${isOver ? ', over goal' : ''}` });
  }
  const cupWord = n => (n === 1 ? 'cup' : 'cups');
  return { halves, goalCups, unit, cups, over,
    text: `${num(halves / 2)} of ${goalCups} ${cupWord(goalCups)}, ${num(halves * perHalf)} ${unit}${over ? ', over goal' : ''}`,
    goalText: `${goalCups} ${cupWord(goalCups)}, ${num(goalCups * 2 * perHalf)} ${unit}` };
}
