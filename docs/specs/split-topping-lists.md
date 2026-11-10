# Spec: split a list of items under a group label into separate ingredients

Follow-up to docs/specs/recipe-import.md and docs/specs/import-dev-tools.md (part C), DECISIONS D29/D30, KNOWN-ISSUES 44.
Some pages end the ingredient list with a group label ("Garnish Ideas:") followed by ONE line listing many items
("sour cream, salsa, olives, pickled radish, shredded lettuce"). That imported as a single ingredient, so the user could not link
foods to the items. After a label, such a line must become one ingredient per item.

## Contract

No new exports. Changed behaviour only, in `js/domain/recipe-import.js` (domain layer, pure, never throws):
- `importFromJsonLd(node)`: `recipeIngredient` as a string (split into lines) and as an array (each element is one line).
- `importFromText(text)`: the Ingredients section.
Return shapes are unchanged (`ingredients` is an array of strings).

Definitions:
- **Label**: a line that ends with `:` and contains no digit. (Already dropped from the result today.)
- **Part count**: the number of comma-separated parts of a line, counting only commas outside parentheses `()` and brackets `[]`.
- **Splittable line**: contains no digit and has at least 3 parts.

## Behaviours (tests carry the same numbers)

1. After a label, a splittable line becomes one ingredient per part ("sour cream, salsa, olives, pickled radish, shredded lettuce" gives 5). Array form.
2. Same for the string form (lines separated by `\n` or `\r\n`).
3. After a label, a line with fewer than 3 parts ("salt, pepper", "salt, plus more to taste") or with any digit is NOT split.
4. A line that does not follow a label is never split, including a plain list at the top of the ingredients or after an ordinary ingredient.
5. A digit line ends the rule: a later no-digit comma line is not split until a new label appears.
6. The rule lasts from a label until the next line that contains a digit or the next label. It continues over no-digit lines that are not splittable (they stay as they are), so a later splittable line in the same run is also split.
7. Commas inside parentheses or brackets are not counted and not split on: "a (b, c), d" is 2 parts (unchanged); "a (b, c), d, e" gives "a (b, c)", "d", "e". Nesting is handled; mixed bracket kinds both count.
8. Two labels in a row: the next ingredient line is still subject to the rule. A label inside a run restarts it.
9. Parts are trimmed; empty parts are dropped ("a, b, c," gives a, b, c).
10. Order is preserved; duplicates are kept (no de-duplication).
11. Unbalanced parentheses/brackets never throw or hang. An opened-and-never-closed bracket swallows the later commas, so "(a, b, c, d" has one part and is unchanged.
12. The text route: after a label line in the Ingredients section, a splittable line (after the usual bullet/number stripping) is split.
13. The text route has the same exclusions as 3, 4, 5, 7.
14. The 200-ingredient cap applies to the split result (a 250-part line gives exactly 200 ingredients; items before it count).
15. Each part gets the normal 300-character per-line cap.
16. Hostile/huge input (200,000 parts, 100,000 open parentheses, thousands of lines alternating label and list) finishes quickly and never exceeds 200 ingredients.
17. A lone label gives no ingredient; prototype-style names ("__proto__:", "constructor") are just text.
18. The invented corpus fixture `tests/fixtures/site-corpus/synthetic-taco-bowl.json` with golden `.expected.json` reproduces exactly (also exercised by `tests/site-corpus.test.js` test 30 through `runCorpus`).

## Edge cases and hostile input

Empty strings and empty arrays (no change); non-string array elements (ignored as today); HTML in strings (cleaned by the existing
`toLines`/`clean` before the rule runs); NaN/objects as `recipeIngredient` (empty list as today); very long lines; deeply nested or
unbalanced brackets (counted with a simple depth counter, linear time); synced/imported recipes are untouched because only the
importer changes.

## Existing tests

`tests/recipe-import*.test.js`, `import-dev-tools-parser.test.js` and `site-corpus.test.js` are expected to pass unchanged. The existing
fixture `synthetic-lentil-soup` still holds: its labels are followed by digit lines or single-part lines, and "Dressing, 2 parts:" has a digit so it is not a label.
If an existing test fails, that is a regression to explain, not a test to edit.

## Not testable automatically

Manual check (UI and network):
1. Start the local stand-in (`npm start`) or open the live app. Import a real page whose ingredient list has a label such as
   "Garnish Ideas:" followed by one comma-separated line.
2. Confirm the items appear as separate ingredient lines in the editor, in page order, and the label itself does not appear.
3. Confirm a normal line with a digit and commas ("1 cup rice, rinsed, drained") is still one line, and that notes like
   "salt, plus more to taste" stay together.
4. Link foods to two of the split items and save; confirm the recipe totals update.

## Open questions (not tested; implementer may choose, then note in DECISIONS)

- Part count before or after dropping empty parts ("a, , b": 3 raw parts, 2 non-empty). Only "a, b, c," (3 non-empty either way) is tested.
- Stray closing bracket with no opener (")a, b, c"): depth clamped at 0 or not. Only "no throw, no hang" is tested.
- Text route: a line ending in `:` WITH a digit is dropped today (existing behaviour); whether it starts the rule is untested. Suggested: it does not (it is not a label by the definition above).
- Whether a split part that itself ends with `:` is dropped as a label (not tested).

## Verification log (implementer, Windows)
- `npm test`: 618 pass. The local corpus (`npm run test:sites`) caught the change on a real page (the saved snapshot's expected result no longer matched); the new result was reviewed (19 ingredient lines; the five toppings are separate lines, nothing else changed) and the snapshot regenerated with `--force`.
- Not done: the live app and linking foods to split items (manual check 4), a phone. Open questions resolved as: empty parts are dropped before counting; a stray closing bracket is ignored; on the text route a colon line WITH a digit is still dropped and does not start the rule; a split part that ends in a colon is kept as text.
