// Pure day-summary text (no DOM, no storage, no globals).
import { MEALS } from '../core/constants.js';
import { rd, amtLabel } from '../core/format.js';
import { pretty } from '../core/dates.js';
import { totals, entryMacros } from './nutrition.js';

/** Shareable plain-text summary of one day. `unit` is 'g' or 'oz'. */
export function dayText(state, day, unit) {
  const list = state.days[day] || [], t = totals(list);
  let s = `My day – ${pretty(day)}\n${rd(t.k)} / ${state.goals.k} kcal\nP ${rd(t.p)}g · C ${rd(t.c)}g · F ${rd(t.f)}g\n`;
  MEALS.forEach(m => { const es = list.filter(e => e.meal === m); if (!es.length) return;
    s += `\n${m} (${rd(es.reduce((a, e) => a + entryMacros(e).k, 0))} kcal)\n` + es.map(e => `• ${e.name} – ${amtLabel(e, unit)}, ${rd(entryMacros(e).k)} kcal`).join('\n') + '\n'; });
  return s.trim();
}
