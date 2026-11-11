// docs/specs/cooking-mode.md behaviours 26-35. WEAK static checks: they read source text only. They prove markup and calls exist, NOT that taps
// work, that ticks survive a re-render, that escaping holds at runtime, or that the wake lock works. See the manual checklist in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const cook = () => read('../js/ui/cook-view.js');

test('26 cook-view exports openCookView and imports the domain and wakelock modules', () => {
  const s = cook();
  assert.match(s, /export\s+(async\s+)?function\s+openCookView\b/);
  assert.match(s, /from\s*['"]\.\.\/domain\/cooking\.js['"]/);
  assert.match(s, /from\s*['"]\.\.\/services\/wakelock\.js['"]/);
});

test('27 text is escaped, the link only via safeSourceLink, target=_blank has rel noopener, no javascript:', () => {
  const s = cook();
  assert.match(s, /\besc\(/); assert.match(s, /\bsafeSourceLink\s*\(/);
  for (const m of s.matchAll(/target=["']_blank["'][^>]*/g)) assert.match(m[0], /rel=["']noopener noreferrer["']/);
  assert.ok(!/javascript:/i.test(s));
  assert.match(s, /esc\([^)]*\)/);
  assert.ok(!/href="\$\{(?!esc\()/.test(s), 'href must be escaped');
  assert.ok(!/\$\{\s*(?:r|recipe)\.(name|source|steps)\b/.test(s), 'raw recipe fields interpolated');
});

test('28 read-only: no save/saveRecipe/localStorage, no assignment into state', () => {
  const s = cook();
  assert.ok(!/import\s*\{[^}]*\bsave\b[^}]*\}\s*from/.test(s)); assert.ok(!/saveRecipe|updateEntry|addEntry|removeEntry|setFavorite/.test(s));
  assert.ok(!/localStorage|sessionStorage|\bfetch\(/.test(s)); assert.ok(!/\bstate\s*(\.|\[)[^=;\n]*=(?!=)/.test(s), 'assigns into state');
  assert.ok(!/\bupdatedAt\b/.test(s));
});

test('29 ingredient tick boxes are checkboxes; steps carry aria-current; toggleTick and setCurrentStep used', () => {
  const s = cook();
  assert.match(s, /type=["']checkbox["']/); assert.match(s, /aria-current/);
  assert.match(s, /\btoggleTick\s*\(/); assert.match(s, /\bsetCurrentStep\s*\(/);
  assert.match(s, /<ol[\s>]/);
});

test('30 servings scaler uses the domain helpers', () => {
  const s = cook();
  for (const f of ['clampServings', 'halveServings', 'doubleServings', 'stepServings', 'cookingIngredients']) assert.match(s, new RegExp(`\\b${f}\\b`), f);
  assert.match(s, /<button[^>]*>[^<]*(½|1\/2|Halve)[^<]*<\/button>/i); assert.match(s, /<button[^>]*>[^<]*(2×|2x|Double)[^<]*<\/button>/i);
});

test('31 Keep screen on switch, unsupported text, createWakeLock, enable/disable, close listener disables', () => {
  const s = cook();
  assert.match(s, /Keep screen on/); assert.match(s, /not supported on this device/);
  assert.match(s, /\bcreateWakeLock\s*\(/); assert.match(s, /\.enable\s*\(/); assert.match(s, /\.disable\s*\(/);
  assert.match(s, /addEventListener\(\s*['"]close['"]|\.onclose\s*=/);
  assert.match(s, /isSupported\s*\(/);
});

test('32 recipes-view has a real Cook button with data-cook per card and handles it', () => {
  const s = read('../js/ui/recipes-view.js');
  assert.match(s, /<button[^>]*\bdata-cook\b[^>]*>[^<]*Cook[^<]*<\/button>/);
  assert.match(s, /import\s*\{[^}]*\bopenCookView\b[^}]*\}\s*from\s*['"]\.\/cook-view\.js['"]/);
  const handler = s.slice(s.indexOf('initRecipes'));
  const iCook = handler.search(/\[data-cook\]/), iEdit = handler.search(/openRecipeEditor\(r\)/);
  assert.ok(iCook > -1 && iEdit > -1 && iCook < iEdit, 'data-cook must be handled before the editor opens');
});

test('33 recipe-view popup has a Cook button wired to openCookView', () => {
  const s = read('../js/ui/recipe-view.js');
  assert.match(s, /<button[^>]*>[^<]*Cook[^<]*<\/button>/);
  assert.match(s, /import\s*\{[^}]*\bopenCookView\b[^}]*\}\s*from\s*['"]\.\/cook-view\.js['"]/);
  assert.match(s, /openCookView\s*\(/);
});

test('34 sw.js precaches the three new files and CACHE is at least v33', () => {
  const sw = read('../sw.js');
  for (const f of ['js/domain/cooking.js', 'js/services/wakelock.js', 'js/ui/cook-view.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.ok(Number(sw.match(/const CACHE = 'macro-diary-v(\d+)'/)[1]) >= 33);
});

test('35 no role="button" in the new or changed UI', () => {
  for (const p of ['../js/ui/cook-view.js', '../js/ui/recipes-view.js', '../js/ui/recipe-view.js']) assert.ok(!/role=["']button["']/.test(read(p)), p);
});
