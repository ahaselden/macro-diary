// Auto-fill: propose recipes for the EMPTY slots of some days, and apply an accepted proposal. Pure (no DOM, storage or network, and no random-number calls:
// variety comes from a seeded generator, so the same state + options + seed always gives the same proposal).
// Rules, in priority order (docs/specs/autofill-week.md): fit the day's calorie budget, avoid repeats, prefer favourites.
// proposePlan never changes `state`; applyProposal changes it only through plan.js addPlanItem and never overwrites a filled slot.
import { MEALS } from '../core/constants.js';
import { fmt, parse } from '../core/dates.js';
import { recipeNutrition } from './recipes.js';
import { addPlanItem, recipeItem, dayNutrition } from './plan.js';

const WEIGHTS = { Breakfast: 0.25, Lunch: 0.30, Dinner: 0.35, Snacks: 0.10 };
const DEFAULT_SLOTS = ['Lunch', 'Dinner'];
const NEAR = 0.10;                       // a favourite within this share of the target of the best fit still wins
const EPS = 1e-9;
const DAY_MS = 864e5;

const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => plain(o) && Object.hasOwn(o, k);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const validDate = s => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; try { return fmt(parse(s)) === s; } catch { return false; } };
const dayIndex = s => Math.round(parse(s).getTime() / DAY_MS);

function rng(seed) {                     // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function options(state, opts) {
  const o = plain(opts) ? opts : {};
  const dates = [...new Set((own(o, 'dates') && Array.isArray(o.dates) ? o.dates : []).filter(validDate))].sort();
  let slots = DEFAULT_SLOTS;
  if (own(o, 'slots') && Array.isArray(o.slots)) slots = MEALS.filter(m => o.slots.includes(m));
  const fallbackGoal = plain(state) && plain(state.goals) && finite(state.goals.k) && state.goals.k > 0 ? state.goals.k : 2000;
  const goalK = own(o, 'goalK') && finite(o.goalK) && o.goalK > 0 ? o.goalK : fallbackGoal;
  const seed = own(o, 'seed') && Number.isInteger(o.seed) ? o.seed : 1;
  const noRepeatDays = own(o, 'noRepeatDays') && finite(o.noRepeatDays) && o.noRepeatDays >= 0 ? o.noRepeatDays : 3;
  return { dates, slots, goalK, seed, noRepeatDays, preferFavorites: !(own(o, 'preferFavorites') && o.preferFavorites === false), includeIncomplete: own(o, 'includeIncomplete') && o.includeIncomplete === true };
}

function candidates(state, includeIncomplete) {
  const out = [];
  if (!plain(state) || !plain(state.recipes)) return out;
  for (const id of Object.keys(state.recipes)) {
    const r = state.recipes[id];
    if (!plain(r)) continue;
    let n; try { n = recipeNutrition(r, state.measures); } catch { continue; }
    const k = n && n.perServing && n.perServing.k;
    if (n.source === 'none' || !finite(k) || !(k > 0)) continue;
    if (!n.complete && !includeIncomplete) continue;
    out.push({ id, k, complete: n.complete === true, fav: r.favorite === true });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Recipes already planned, as {day, id}. */
function plannedUses(state) {
  const uses = [];
  if (!plain(state) || !plain(state.plan)) return uses;
  for (const date of Object.keys(state.plan)) {
    if (!validDate(date) || !plain(state.plan[date]) || !plain(state.plan[date].slots)) continue;
    for (const m of MEALS) for (const it of Array.isArray(state.plan[date].slots[m]) ? state.plan[date].slots[m] : []) {
      if (plain(it) && it.type === 'recipe' && typeof it.recipeId === 'string') uses.push({ day: dayIndex(date), id: it.recipeId });
    }
  }
  return uses;
}

const slotEmpty = (state, date, m) => {
  const d = plain(state) && plain(state.plan) && Object.hasOwn(state.plan, date) ? state.plan[date] : null;
  const l = plain(d) && plain(d.slots) ? d.slots[m] : null;
  return !(Array.isArray(l) && l.length > 0);
};

export function proposePlan(state, opts) {
  const o = options(state, opts), days = {}, notes = [], note = t => { if (!notes.includes(t)) notes.push(t); };
  const cands = candidates(state, o.includeIncomplete), rand = rng(o.seed), uses = plannedUses(state);
  if (!o.dates.length || !o.slots.length) return { days, notes };
  if (!cands.length) { note('No usable recipes: add recipes with linked ingredients (nutrition known) to auto-fill.'); return { days, notes }; }
  for (const date of o.dates) {
    const fill = o.slots.filter(m => slotEmpty(state, date, m));
    if (!fill.length) continue;
    let planned = 0;
    try { planned = dayNutrition(state, date).total.k; } catch { planned = 0; }
    if (!finite(planned)) planned = 0;
    const budget = o.goalK - planned, wsum = fill.reduce((s, m) => s + WEIGHTS[m], 0), di = dayIndex(date);
    for (const m of fill) {
      const target = budget * WEIGHTS[m] / wsum;
      const blocked = c => o.noRepeatDays > 0 && uses.some(u => u.id === c.id && Math.abs(u.day - di) < o.noRepeatDays);
      let pool = cands.filter(c => !blocked(c));
      if (!pool.length) { pool = cands; if (o.noRepeatDays > 0) note('Some meals repeat a recipe from the last few days because there were not enough different recipes.'); }
      // One serving of each recipe is proposed (the user changes the amount later). The recipe is chosen by how well ONE serving fits the target.
      let pick;
      const servings = 1;
      if (!(budget > 0)) {
        pick = pool.reduce((b, c) => (c.k < b.k - EPS ? c : b), pool[0]);
        note('The daily goal (budget) is already used up by planned meals, so the lowest-calorie recipe is proposed at 1 serving.');
      } else {
        const scored = pool.map(c => ({ c, d: Math.abs(c.k - target) }));
        const best = Math.min(...scored.map(x => x.d));
        let top = scored.filter(x => x.d <= best + EPS);
        if (o.preferFavorites) {
          const near = scored.filter(x => x.c.fav && x.d <= best + NEAR * target);
          if (near.length) { const nb = Math.min(...near.map(x => x.d)); top = near.filter(x => x.d <= nb + EPS); }
        }
        pick = top[Math.floor(rand() * top.length)].c;
      }
      const kcal = Math.round(pick.k);
      const why = !(budget > 0) ? `The day's kcal goal is already used up, so this is the lowest-calorie recipe (about ${kcal} kcal for 1 serving).`
        : `About ${kcal} kcal for 1 serving, close to the ${Math.round(target)} kcal target for this meal${pick.fav ? '; a favourite' : ''}.`;
      if (!pick.complete) note('Some picks are incomplete recipes (nutrition not fully known), so their kcal may be underestimated.');
      (days[date] ||= {})[m] = [{ recipeId: pick.id, servings, why, complete: pick.complete }];
      uses.push({ day: di, id: pick.id });
    }
  }
  return { days, notes };
}

/** Add the proposed recipes to the plan. Skips anything that is no longer valid and any slot that is not empty. Returns how many items were added. */
export function applyProposal(state, proposal, now, idGen) {
  if (!plain(state) || !plain(state.plan) || !plain(state.recipes) || !plain(proposal) || !plain(proposal.days) || typeof idGen !== 'function') return 0;
  let added = 0;
  for (const date of Object.keys(proposal.days)) {
    if (!validDate(date) || !plain(proposal.days[date])) continue;
    for (const m of Object.keys(proposal.days[date])) {
      if (!MEALS.includes(m) || !Array.isArray(proposal.days[date][m]) || !slotEmpty(state, date, m)) continue;
      for (const p of proposal.days[date][m]) {
        if (!plain(p) || typeof p.recipeId !== 'string' || !Object.hasOwn(state.recipes, p.recipeId) || !finite(p.servings) || !(p.servings > 0)) continue;
        addPlanItem(state, date, m, recipeItem(idGen(), p.recipeId, p.servings), now); added++;
      }
    }
  }
  return added;
}
