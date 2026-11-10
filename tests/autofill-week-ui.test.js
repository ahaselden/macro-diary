// Weak static checks for the Auto-fill week UI (docs/specs/autofill-week.md, U1-U6). They read source text only:
// they prove the markup and calls exist, NOT that the dialog works. See the manual checklist in the spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/ui/plan-view.js', import.meta.url), 'utf8');

test('U1 plan-view imports proposePlan and applyProposal from ../domain/autoplan.js', () => {
  assert.match(src, /import\s*\{[^}]*\bproposePlan\b[^}]*\}\s*from\s*['"]\.\.\/domain\/autoplan\.js['"]/);
  assert.match(src, /import\s*\{[^}]*\bapplyProposal\b[^}]*\}\s*from\s*['"]\.\.\/domain\/autoplan\.js['"]/);
});

test('U2 an "Auto-fill week" control exists as a real <button>, never role="button"', () => {
  assert.match(src, /<button[^>]*>[^<]*Auto-?fill week[^<]*<\/button>/i);
  assert.ok(!/role=["']button["']/.test(src));
});

test('U3 the preview dialog has Accept, Reroll and Cancel buttons', () => {
  for (const w of ['Accept', 'Reroll', 'Cancel']) assert.match(src, new RegExp(`<button[^>]*>[^<]*${w}[^<]*</button>`), w);
});

test('U4 the why text is escaped with esc() before it reaches HTML', () => {
  assert.match(src, /esc\([^)]*\bwhy\b[^)]*\)/);
  assert.ok(!/\$\{[^}]*\.why\s*\}/.test(src.replace(/esc\([^)]*\)/g, '')), 'why must not be interpolated raw');
});

test('U5 Accept path uses applyProposal then save(); reroll changes a seed; slot toggles mention Lunch and Dinner', () => {
  assert.match(src, /applyProposal\s*\(/); assert.match(src, /\bsave\s*\(\s*\)/);
  assert.match(src, /\bseed\b/i); assert.match(src, /checkbox|aria-pressed/);
  assert.match(src, /proposePlan\s*\(/);
});

test('U6 the UI never writes plan items itself while previewing (proposePlan result is not applied by assignment)', () => {
  assert.ok(!/state\.plan\[[^\]]*\]\s*=/.test(src.split('proposePlan')[1] || ''));
});
