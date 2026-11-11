// Pure helpers for the cooking view (docs/specs/cooking-mode.md): display-only scaling, tick and step state, safe source link.
// Nothing here reads or writes saved data; the cooking view never changes a recipe.
import { recipeSummary } from './recipes.js';

export const MIN_SERVINGS = 0.25;
export const MAX_SERVINGS = 100;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPos = v => isNum(v) && v > 0;
const isIdx = (v, n) => Number.isInteger(v) && v >= 0 && v < n;

/** wanted / recipe servings; 1 when either is not a finite number > 0 (strings are not coerced). */
export function scaleFactor(recipeServings, wantedServings) {
  return isPos(recipeServings) && isPos(wantedServings) ? wantedServings / recipeServings : 1;
}

/** Clamp to [MIN_SERVINGS, MAX_SERVINGS]; anything that is not a finite number gives 1. */
export function clampServings(value) {
  return isNum(value) ? Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, value)) : 1;
}
export const halveServings = v => clampServings(clampServings(v) / 2);
export const doubleServings = v => clampServings(clampServings(v) * 2);
export const stepServings = (v, delta) => clampServings(clampServings(v) + (isNum(delta) ? delta : 0));

/** Ingredient lines scaled to `wantedServings` (clamped); an invalid amount uses the recipe's own yield. Strings verbatim (the UI escapes). */
export function cookingIngredients(recipe, wantedServings) {
  const w = isPos(wantedServings) ? clampServings(wantedServings) : undefined;
  return recipeSummary(recipe, w, {}).ingredients;
}

/** Non-blank string steps, verbatim, in order. */
export function cookingSteps(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || !Object.hasOwn(recipe, 'steps') || !Array.isArray(recipe.steps)) return [];
  return recipe.steps.filter(x => typeof x === 'string' && x.trim() !== '');
}

/** Ticked ingredient indexes as a new sorted array of unique integers in [0, count); toggles `index`. Never mutates `ticks`. */
export function toggleTick(ticks, index, count) {
  if (!Number.isInteger(count) || count <= 0) return [];
  const set = new Set((Array.isArray(ticks) ? ticks : []).filter(i => isIdx(i, count)));
  if (isIdx(index, count)) { if (set.has(index)) set.delete(index); else set.add(index); }
  return [...set].sort((a, b) => a - b);
}

/** The marked step: tap selects, tapping the marked step again clears it; invalid taps are ignored. Result is null or a valid index. */
export function setCurrentStep(current, index, stepCount) {
  if (!Number.isInteger(stepCount) || stepCount <= 0) return null;
  const cur = isIdx(current, stepCount) ? current : null;
  if (!isIdx(index, stepCount)) return cur;
  return cur === index ? null : index;
}

/** The URL unchanged when it is a plain http(s) link (same rule as the recipe popup); otherwise ''. */
export function safeSourceLink(url) {
  if (typeof url !== 'string' || url.length > 500 || url !== url.trim()) return '';
  try { const u = new URL(url); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password ? url : ''; } catch { return ''; }
}
