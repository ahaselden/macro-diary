# Spec: compact ingredient rows in the recipe editor

## Purpose
Every ingredient in the recipe editor currently carries a full-width "Link food" button below it, so a recipe's ingredient list is tall and hard to scan. Replace it with an icon-only link button on the same row as the text input and the remove button, and fold the parsed summary, linked food and calories into one small muted line.

## Contract

### Domain: `js/domain/recipes.js` (pure, no DOM)
`export function ingredientStatus(ingredient)` returns a fresh object:

| field | type | value |
|---|---|---|
| `qty` | string | `formatQty(qty)` then the unit, trimmed; `''` when qty is null/undefined/`''` (same as the editor's current `qtyUnit`) |
| `name`, `prep` | string | the ingredient's text, `''` if missing or not a string |
| `linked` | boolean | the ingredient has a food object |
| `foodName` | string | `food.name`, else `''` |
| `grams` | number or null | `Number(ingredient.grams)` when `> 0`, else `null` (independent of linking) |
| `kcal` | number or null | `food.per100.k * grams / 100` when linked and grams is a number; NOT rounded; else `null` |
| `needsGrams` | boolean | `linked && grams === null` |

Never throws (null, `{}`, food without `per100`, NaN grams, non-objects), never mutates its input, returns new values each call. It does not escape: the UI does.

### UI: `js/ui/recipe-editor.js`, `css/components.css`, `sw.js`
1. Each ingredient is `.ing[data-id]` holding ONE `<div class="row">` with, in order: `input.ing-raw`, an icon-only `<button data-link>` (inline `<svg aria-hidden="true">`, `fill`/`stroke` = `currentColor`, no emoji, no visible text), and `button.x[data-rm]`.
2. Link button: `aria-label` and `title` are `Link food for <name>` / `Change food for <name>` (name through `esc()`; wording starting "Link food" / "Change food"), class `linked` (or `data-linked="true"`) when a food is linked, plain/muted otherwise; CSS `min-width:44px; min-height:44px`, fixed width (does not shrink).
3. Under the row, `.ing-info` (muted, 13px, `margin-top:2px`, `overflow-wrap:anywhere`) is a single line: `qty unit **name**, prep`, plus ` · <food name> · N kcal (G g)` when linked with grams. Linked with unknown grams: the line ends with `input.grams` (`type=number`, `aria-label="Grams"`, `placeholder="grams"`, `max-width` about 90px) and the text `enter grams`. No "Linked:" sentence, no "Can't convert" paragraph, no `.row` or `<button>` inside `.ing-info`.
4. The info line is built from `ingredientStatus`; every string is escaped with `esc()`, numbers with `rd()`.
5. CSS: `.ing` padding `6px 0`; the `.ing-info .row` and `.ing-info button` rules are deleted; `.ing .row` stays non-wrapping, `.ing .row>input{min-width:0}` stays, `.ing .x` stays a 44px fixed button.
6. `sw.js` `CACHE` bumped (v30 is on main, so must be v31 or later). No new files, so the SHELL list is unchanged.

Unchanged: handlers for `[data-link]`, `[data-rm]`, the `.ing-raw` change handler (re-parse, redraw only `.ing-info`), the grams `input` handler, the picker flow, `readFields` and the discard guard.

## Behaviours
Behavioural (domain), `tests/compact-ingredients.test.js`:
- S1 Linked with grams: 200 g at 380 kcal/100 g gives kcal 760, grams 200, `needsGrams` false.
- S2 `qty` text: 1.5 cup -> `'1 1/2 cup'`, 0.75 cup -> `'3/4 cup'`, qty 2 with no unit -> `'2'`.
- S3 No quantity gives `''` (no stray space); unit alone is kept (`'pinch'`).
- S4 Linked but grams null/0/negative/NaN/`''`/text: grams null, kcal null, `needsGrams` true.
- S5 Not linked (food null/undefined/false): `linked` false, `foodName` `''`, kcal null, `needsGrams` false; positive grams still reported.
- S6 kcal not rounded: 250 g at 52 = 130; 45 g at 89 = 40.05; 0.5 g at 333 = 1.665; numeric strings accepted; a 0 kcal food gives 0, not null.
- S7 Malformed input (null, undefined, `{}`, strings, numbers, arrays, NaN, food without name/per100, `per100.k` NaN) never throws; full 8-key shape; kcal is null or finite.
- S8 `name`/`prep` are always strings; HTML-looking text and a 100,000-character name come back verbatim (no escaping, no truncation in the helper).
- S9 No mutation (deep-frozen input works); fresh object each call; mutating a result does not affect the input.
- S10 Own `__proto__` keys in imported JSON do not make an ingredient linked or leak kcal; `Object.prototype` is not polluted.
- S11 `parseIngredient` output never has `food` or `grams`, so the `.ing-raw` change handler's `Object.assign(i, parse)` leaves the link intact: the icon state does not depend on the re-parse. (This test already passes before implementation: it guards the property.)

Static, weak (read source text), same file:
- U1 No `class="fit" data-link` button block and no visible text label inside the link button.
- U2 `.ing-raw`, then `data-link`, then `data-rm` inside the same `.row`, with no `</div>` between.
- U3 The editor has an inline `<svg` using `currentColor`, `aria-hidden="true"`, no emoji (the existing ★ ☆ ✕ ‹ are allowed).
- U4 The link button tag has `aria-label` and `title`; "Change food" wording exists; "Link food for / Change food for" is followed by `esc(`; no `role="button"`.
- U5 The button markup carries `linked` driven by the ingredient; the `onchange` handler does not touch the icon and still redraws only `.ing-info`.
- U6 CSS rule for the button's class has `min-width:44px`, `min-height:44px`, fixed width, and a `.linked` rule that changes colour.
- U7 CSS `.ing` padding `6px 0`; `.ing-info` has `margin-top:2px`, `font-size:13px`, `overflow-wrap:anywhere`.
- U8 `.ing-info .row` and `.ing-info button` rules are gone; the `.grams` rule has max-width 80 to 100px.
- U9 `.ing .row` does not wrap, raw input `min-width:0`, `.ing .x` is a 44px fixed button. (Passes before implementation: a regression guard.)
- U10 `ingInfo` imports and uses `ingredientStatus`; every `x.qty|name|prep|foodName` use is inside `esc(`; no `<button>`, no `.row`, at most one block element.
- U11 Grams input markup (`class="grams"`, `aria-label="Grams"`, `placeholder="grams"`, `type="number"`), text "enter grams", shown from `needsGrams`; no "Linked:" and no "Can't convert"; the grams `input` handler remains.
- U12 Hooks kept (`.ing`, `data-id`, `.ing-raw`, `.ing-info`, `.x`, `data-rm`, `data-link` handlers, `renderPicker(i)`, close guard with `readFields`); `CACHE` is greater than v30.

## Edge cases and hostile input
- Very long ingredient text: the raw input shrinks (`min-width:0`); the info line wraps (`overflow-wrap:anywhere`); the helper does not truncate (S8). Visual check manual.
- No quantity (`salt`): summary shows no leading space/number (S3).
- Linked, grams unknown: inline grams input appears; entering a value updates the draft and the summary card (existing handler). Note the existing handler does not redraw the line, so "enter grams" and the input stay until the next redraw: unchanged behaviour, not a regression.
- Linked, food lacking `per100`: must not throw or show NaN (S7); how the line reads is an open question.
- Empty ingredient list: no rows; nothing to render (existing behaviour).
- HTML or quotes in the ingredient name, prep or food name (imported or synced): must be escaped in the line, and in `aria-label`/`title` (an attribute context, so `esc()` must escape quotes; `esc` in `core/format.js` is the existing function). Statically checked only (U4, U10).
- Prototype keys / `__proto__` in imported ingredient JSON (S10).

## Changes to earlier tests
None. I checked `tests/recipe-import-ui.test.js` (U9, U10), `tests/page-nutrition-ui.test.js` (U1 to U3 read `recipe-editor.js`) and `tests/favourite-recipes.test.js` (U4, U5) against the planned markup: they look for the notes/stated/favourite markup, `esc(` on notes, and no `role="button"`, none of which this change touches. `npm test` before implementation shows exactly the 21 new tests failing and nothing else. The implementer must keep it that way; if an earlier test breaks, explain it in the PR.

## What cannot be tested automatically (manual checklist)
Tests read source text; they cannot see the screen. Check by hand on desktop and in a 375px-wide viewport (devtools device mode, ideally a real phone):
- [ ] A recipe with 8+ ingredients is clearly shorter than before; each ingredient is one input row plus at most one small line.
- [ ] The raw input shrinks on a narrow screen; the link and remove buttons stay square and visible; nothing wraps or overflows horizontally.
- [ ] Unlinked icon looks muted; linked icon looks clearly different (accent colour); the difference is obvious without reading.
- [ ] Tapping the icon opens the picker; choosing a food returns to the editor with the icon in the linked state and "<food> · N kcal (G g)" on the line.
- [ ] A linked ingredient with unknown grams shows the compact grams box and "enter grams" on the same line; typing grams updates "kcal / serving".
- [ ] Remove (✕) still removes the right ingredient.
- [ ] Editing the raw text and tapping away re-parses the line but leaves the icon state as it was.
- [ ] Long text (a 200-character ingredient) wraps in the info line without widening the dialog.
- [ ] Screen reader (VoiceOver/TalkBack): the button is announced as "Link food for flour, button" or "Change food for flour, button"; the SVG is not read separately.
- [ ] Tap targets are at least 44px (inspect the element).
- [ ] Dark/light themes if the app has both: the icon is visible in each.
- [ ] After deploying, a phone that had the old app picks up the new layout (CACHE bump).

## Honest limits
The static tests are weak: they check that markup, CSS rules and calls exist in the source, not that the layout is compact, the icon legible, the tap works or escaping holds at runtime. They locate the button via `data-link` and `class="ing-raw"` with string matching, so a heavily restructured implementation (for example moving the row markup to another file) may fail them for the wrong reason: if so, say so in the PR rather than weaken them silently. Only the helper tests (S1 to S10) are real behaviour tests. S11 and U9 pass before implementation (they guard existing properties).

## Open questions
1. Linked food whose `per100` is missing: the plan's formula would give NaN. The tests only require kcal to be `null` or finite, never NaN; I recommend `null` and the line then omits the kcal part.
2. `grams` of `Infinity` or huge values (1e308), which could make `kcal` infinite: untested; a clamp is not specified.
3. Non-object `food` values (a string, `true`): the plan says "has a food object"; untested for those, only null/undefined/false are asserted as unlinked.
4. Non-string `name`/`prep` (numbers, objects): only "is a string" is asserted, not what string.
5. `qty` of 0 renders as `'0 g'` under "exactly like the current `qtyUnit`"; not tested.
6. Icon artwork, the accent colour and the class name of the link button are free (the CSS tests read the class from the markup); the plan says "e.g. `.linked`"; tests accept `linked` as a class or `data-linked`.
