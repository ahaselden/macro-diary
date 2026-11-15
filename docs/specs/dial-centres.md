# Spec: centre text in every Diary dial (owner request 2026-11-14)

## Purpose
The calories dial shows "kcal left" in its centre, but the protein, carbs, fat, steps and sleep dials are empty inside. Every dial gets a short centre number and caption, so each ring can be read at a glance without the text underneath.

Written before the implementation by the test designer. Where the request left a rule open this spec FIXES it (marked "decided here") so tests can pin it; the owner can change any of these before the build, and the implementer must then ask for the test to be changed, not edit it. Tests: `tests/dial-centres.test.js` (C1-C16).

## Contract

### Layers and files
- `js/domain/dials.js` (domain, PURE): new exports `shortSteps(n)` and `shortHours(minutes)`; `dialModel` gives EVERY ring object (the four in `nutrition.rings`/`rows`, `steps`, `sleep`, and so `rings.k..rings.sleep`) a new field `centre: { text, caption }` (exactly these two keys, both strings).
- `js/ui/dials.js` (ui): `dialsHtml(model, editing)` draws the centre inside the ring `<svg>` of EVERY selected dial (no longer calories only).
- `css/components.css`: `.dial-num` (default size), NEW `.dial-num-s` (small size), `.dial-cap`.
- `sw.js` (bump `CACHE`; no new shipped file), `docs/DECISIONS.md` (`## D59.`).
- Unchanged: `ringFraction isOver ringArc ringRadii formatSleep formatSteps normalizeDials toggleDial`, ring `text`, `label`, `name`, `color`, `fraction`, `over`; the visible name and value text under each ring; every `aria-label`; `nutrition.centre` (equal to `rings.k.centre`); the saved shape (no schema change).

### The pure formatters (decided here)
`shortSteps(n)`: `''` for anything that is not a finite number >= 0 (strings, arrays, objects, NaN, Infinity, negatives, null, undefined, BigInt, symbols). Otherwise, with `r = Math.round(n)`:
- `r < 1000`: the whole number as text (`'0'`, `'850'`, `'999'`; `999.5` rounds to 1000 so it is `'1k'`).
- up to 9,949: thousands with ONE decimal, rounded half up, `.0` dropped: `1000 -> '1k'`, `1050 -> '1.1k'`, `1950 -> '2k'`, `2300 -> '2.3k'`, `2350 -> '2.4k'` (half up; beware the float trap 2.35), `6120 -> '6.1k'`, `9949 -> '9.9k'`.
- 9,950 up to 999,499: whole thousands, half up: `9950 -> '10k'`, `10000 -> '10k'`, `12400 -> '12k'`, `12500 -> '13k'`, `999499 -> '999k'`.
- 999,500 up to 99,499,999: millions: `999500 -> '1M'`, `1500000 -> '1.5M'`, `9949999 -> '9.9M'`, `9950000 -> '10M'`, `99499999 -> '99M'`.
- 99,500,000 and above (including `1e12` and `Number.MAX_VALUE`): `'99M+'`.
- So the result is always at most 4 characters and matches `\d{1,3}`, `\d{1,2}(\.\d)?[kM]`, `\d{3}k` or `\d{2}M\+?`; it never contains `.0`, an exponent, `NaN` or `Infinity`.

`shortHours(minutes)`: `''` for anything that is not a finite number >= 0. Otherwise hours = minutes / 60: below 10 hours ONE decimal, rounded half up, `.0` dropped (`473 -> '7.9'`, `480 -> '8'`, `450 -> '7.5'`, `435 -> '7.3'` since 7.25 rounds half up, `6 -> '0.1'`, `0 -> '0'`, `1 -> '0'`); from 10 hours whole hours, half up (`600 -> '10'`, `630 -> '11'`, `1440 -> '24'`); 99.5 hours and above (`5970` min and more, `1e9`, `Number.MAX_VALUE`) `'99+'`. At most 4 characters. No unit in the result (the centre adds `h`).

### Centre per ring (decided here)
| Ring | `centre.text` | `centre.caption` |
|---|---|---|
| Calories (unchanged) | `String(Math.round(abs(goal - eaten)))`, or the eaten kcal when goal is 0 | `kcal left`, `kcal over` (eaten above goal), `kcal eaten` (goal 0) |
| Protein, Carbs, Fat | the same rule in grams: whole number of grams left or over | `g left`, `g over`, `g eaten` (goal 0) |
| Steps | `shortSteps(steps)` + `/` + `shortSteps(goal)`, e.g. `2.3k/10k`, `850/10k`, `0/10k`; goal 0: `shortSteps(steps)` alone | `steps` |
| Sleep | `shortHours(min)` + `/` + `shortHours(goalMinutes)` + `h`, e.g. `7.9/8h`, `7.5/7.5h`; goal 0: `shortHours(min)` + `h`, e.g. `7.9h` | `sleep` |
| Steps or sleep with no data | `--` (two hyphens) | `no data` |

- Exactly at the goal is not over: `0` with `g left` / `kcal left`. A recorded 0 steps is a number (`0/10k`), only a missing value is `--`.
- Over goal for steps and sleep: the arc is red as today; the centre keeps the same style (numbers only, no "over" word); the over word exists only in the nutrition captions (`g over`, `kcal over`).
- Nutrition numbers are large only in absurd data: a whole number above 99,999 reads `99999+` (decided here; applies to the calories centre too, as the one exception to "calories unchanged").
- Length limits (all data, hostile too): `text` <= 9 characters and never empty; `caption` <= 8 characters, except the calories captions (`kcal left`, `kcal over`, `kcal eaten`: <= 10, kept as they are). The worst cases are `99M+/99M+` (9) and `99+/99+h` (8).
- Strings are fixed words and numbers: never `NaN`, `Infinity`, `undefined`, `null`, `[object`, `<`, `>`, an exponent (`e+`).

### Markup (decided here)
Inside each selected dial's `<svg>` (any key, not only `k`), two `<text>` elements: `<text class="dial-num [dial-num-s]" ...>TEXT</text>` and `<text class="dial-cap" ...>CAPTION</text>`, exactly one of each, positioned as the calories dial's are today (number centred around y 43, caption around y 68, `text-anchor="middle"`). The class `dial-num-s` is added when TEXT is longer than 4 characters (`1200`, `70`, `--` are big; `0/10k`, `6.1k/10k`, `7.9/8h`, `99999+` are small). Text and caption come from `ring.centre` of that dial (the calories dial may equally use `nutrition.centre`; the two are equal in a real model). Both go through `esc()`; a missing, `null` or non-object `centre`, or a non-string/NaN `text` or `caption`, draws nothing printable (empty text), never `undefined`/`NaN`/`[object`.

Font sizes (decided here), for a ring r=42, stroke 9, in a 100 x 100 box (inner diameter 2 x 37.5 = 75 units; usable width about 70 at the text height):
- `.dial-num`: <= 22px (as today), only used for texts up to 4 characters (4 x 0.62 em x 22 = 54.6 units).
- `.dial-num-s`: 9 to 12px and smaller than `.dial-num` (9 characters x 0.62 x 12 = 67 units).
- `.dial-cap`: <= 10px, >= 8px (a 10 character caption at 10px is about 60 units).
The tests check these numbers in the CSS file and the character counts in the strings; whether it really fits is for the headless screenshots below.

## Behaviours (tests in `tests/dial-centres.test.js`, number = test title)
- **C1** `shortSteps` golden values (boundaries, half up, `2350 -> '2.4k'`, `99M+`).
- **C2** `shortSteps` hostile input: `''`, and every finite value stays within the 4 character pattern.
- **C3** `shortHours` golden values and hostile input.
- **C4** `dialModel`: all six rings carry `centre {text, caption}`; default day gives `1200 kcal left`, `70 g left`, `40 g left`, `25 g left`, `6.1k/10k steps`, `7.9/8h sleep`; keys and equality with `nutrition.centre`.
- **C5** Over goal (`70 g over`, `240 g over`, `45 g over`), exactly at goal (`0 g left`), goal 0 (`g eaten`), empty day, a fraction rounds to a whole number.
- **C6** Steps and sleep: no data, recorded 0, 850, 2300, 2350, goal reached, over goal, goal 7500, goal 0 (value only), sleep over goal, goal 7.5, sleep goal 0.
- **C7** Hostile data (huge, NaN, negative, strings, arrays, goal 0): every centre is strings, `text` 1-9 chars, `caption` within limits, no bad words or exponents; frozen state not mutated; old fields unchanged.
- **C8** Absurd amounts read `99999+`.
- **C9** `dialsHtml` draws one `dial-num` and one `dial-cap` inside each selected dial's svg with the right words; name, value text and `aria-label` stay.
- **C10** Unselected dials draw nothing; no data, over and goal 0 are drawn; the arc stays red when over.
- **C11** `dial-num-s` on long texts, not on short ones.
- **C12** Hostile and junk `centre` values: escaped, no throw, all six dials still drawn.
- **C13** Largest real values rendered: texts <= 9 chars, `99M+/99M+`, `99+/99+h`.
- **C14** CSS sizes and the ui no longer gates the centre on the calories key (weak source check).
- **C15** `shortSteps` and `shortHours` exported from `js/domain/dials.js`; the module stays pure.
- **C16** `sw.js` `CACHE` number greater than 64 (the value on this branch when written; NEVER an exact number); `docs/DECISIONS.md` has `## D59.` mentioning centre, steps, sleep and the helper names.

## Edge cases and hostile input (covered above)
Steps or sleep missing, `null`, negative, NaN, Infinity, numeric strings, arrays, objects, `1e12`, `Number.MAX_VALUE`; goals 0, negative, NaN, text, `1e15`; entries with 1e12 grams, NaN grams, text nutrition values; centre strings with HTML and attribute-breaking quotes, `centre` missing or not an object; 100% and exactly-at-goal values.

## Changed existing assertions
None. The existing `tests/dials.test.js` and `tests/dials-simplify.test.js` do not contradict this spec (only `includes(...)` checks on the calories centre; ring objects are never compared to literals), and the full suite was run: only the 16 new tests fail. If the implementation adds `centre` to rings and an existing `deepEqual` on a ring literal breaks, that is a wrong test to adjust in the PR with the reason.

## DECISIONS (for the implementer)
Add `## D59. Centre text in every dial` to `docs/DECISIONS.md` (What: the table above, the 4 character short forms and `99M+`/`99+`/`99999+` caps; Why: owner request 2026-11-14; Limits: half-up rounding, small font on long numbers, 10 hours and up show whole hours). This branch's latest decision is D58 (the water card), so D59 is next. PRs 66 and 67 may also claim D58/D59: if they merge first, the implementer renumbers on merge conflict (and updates the `D59` check in C16 only by asking for a test change; the number is otherwise free to move up, the test searches for `## D59.`). Bump `CACHE` in `sw.js` and keep `docs/KNOWN-ISSUES.md` honest (look on a real phone not checked).

## What cannot be tested automatically, and the manual checklist
Unit tests see strings and CSS numbers, not pixels. Headless scenarios prove the layout; taste and real devices are the owner's. All data is seeded into `localStorage` key `macrodiary.v1` before load (schema is the version on this branch, 13). "Seed A" = `dials` all six (`["k","p","c","f","steps","sleep"]`), goals `{k:2000,p:150,c:200,f:65,steps:10000,sleepH:8,waterCups:8}`, today one Lunch entry `{id:'e1', meal:'Lunch', name:'Rice', brand:'', source:'custom', per100:{k:100,p:10,c:20,f:5}, grams:800, updatedAt:1}` (800 kcal, 80 g P, 160 g C, 40 g F), today's `activity` `{updatedAt:1, source:'google-health', steps:6120, sleepMinutes:473}`, `settingsUpdatedAt: 5`. No network is needed. The centre of dial KEY = the `<text class~="dial-num">` and `<text class~="dial-cap">` inside `[data-dial="KEY"] svg`.

- **H1 Every dial has a centre.** Setup: Seed A, 375 x 800. Steps: open the Diary. Expect: numbers/captions `k` `1200`/`kcal left`, `p` `70`/`g left`, `c` `40`/`g left`, `f` `25`/`g left`, `steps` `6.1k/10k`/`steps`, `sleep` `7.9/8h`/`sleep`; the names `Calories`..`Sleep` and value texts `800 / 2000 kcal`, `80 / 150 g`, `160 / 200 g`, `40 / 65 g`, `6,120 / 10,000`, `7 h 53 min / 8 h` still shown under the rings; every `aria-label` unchanged (`Calories: 800 of 2000 kcal`, ...). Covered by headless? yes.
- **H2 No overlaps, nothing outside the ring (375 px and 320 px).** Setup: Seed A, viewport 375 x 800, then 320 x 700. Steps: for each of the six dials take `getBoundingClientRect()` of the `dial-num` text and the `dial-cap` text and of the ring track circle. Expect: each centre text box lies inside the ring's inner circle (centre of the circle +- 37.5 of 100 units scaled by the rendered svg width; allow 1 px), the number box and the caption box of one dial do not intersect, no text box intersects the arc (`ring-arc`) circle band, the name and value texts below the ring do not intersect the svg box, `document.documentElement.scrollWidth` <= the viewport width. Screenshots `Screenshots/dial-centres-375.png` and `-320.png`. Covered by headless? yes (numbers); the look is on the owner list.
- **H3 Longest texts fit.** Setup: Seed A with steps `99499`, goals steps `99499`, sleepMinutes `570`, sleepH `9.5` (run 1); then entry grams `1e12`, steps `1e12`, goals steps `1e15`, sleepMinutes `1e12`, sleepH `1e12` (run 2). Expect run 1: steps `99k/99k`, sleep `9.5/9.5h`. Run 2: steps `99M+/99M+`, sleep `99+/99+h`, protein `99999+`/`g over`. All inside the ring at 375 and 320 px as in H2; no `NaN`, `Infinity`, `undefined`, `e+` in `#dials`; no page error. Covered by headless? yes.
- **H4 Over goal.** Setup: Seed A but entry `grams: 2200`, steps `12400`, sleepMinutes `540`. Expect: `p` `70`/`g over`, `c` `240`/`g over`, `f` `45`/`g over`, `k` `200`/`kcal over`, steps `12k/10k`/`steps`, sleep `9/8h`/`sleep`; every one of these six arcs has computed `stroke` equal to computed `--over`; the centre texts do not turn red (their fill stays the normal text colour) and contain no word `over` for steps and sleep. Covered by headless? yes.
- **H5 Exactly at goal.** Setup: Seed A with entry `grams: 1500` (150 g P, 300 g C, 75 g F, 1500 kcal) and goals p 150. Expect: `p` `0`/`g left` and its arc is not red. Covered by headless? yes.
- **H6 Goal 0.** Setup: Seed A with goals `{k:0,p:0,c:0,f:0,steps:0,sleepH:0,waterCups:8}`. Expect: `k` `800`/`kcal eaten`, `p` `80`/`g eaten`, `c` `160`/`g eaten`, `f` `40`/`g eaten`, steps `6.1k`/`steps`, sleep `7.9h`/`sleep`; no `NaN`/`Infinity`; no page error. Covered by headless? yes.
- **H7 No data.** Setup: Seed A with `activity: {}`. Expect: steps and sleep dials: number `--`, caption `no data`; the value text under them `no data`; no `0/` anywhere. With activity `{updatedAt:1, source:'google-health', steps:0, sleepMinutes:473}`: steps `0/10k`. Covered by headless? yes.
- **H8 Rounding.** Setup: Seed A with steps `2350` then `2300` then `850`. Expect steps number `2.4k/10k`, `2.3k/10k`, `850/10k`. Covered by headless? yes.
- **H9 Day navigation and themes.** Setup: Seed A plus yesterday with no entries and activity steps 3000, sleepMinutes 400. Steps: click `#prev`. Expect: `k` `2000`/`kcal left`, `p` `150`/`g left`, `c` `200`/`g left`, `f` `65`/`g left`, steps `3k/10k`, sleep `6.7/8h` (400/60 = 6.67). Then in Settings choose Light, Dark, Ocean, Contrast and return each time: centre text colour (computed `fill`) differs from the card background and is not transparent. Covered by headless? yes for existence; legibility is on the owner list.
- **H10 Tapping still works.** Setup: Seed A. Expect: clicking a centre text opens `#dlg` with title `Nutrition details` (it is inside `#dialsOpen`); the pencil `#dialsEdit` still opens the panel, not the details. Covered by headless? yes.

### Owner on a real device
- **R1** Are `2.3k/10k` and `7.9/8h` readable at arm's length on your phone in light and dark themes, and not touching the ring? (look; real eyes)
- **R2** Is the smaller font on the long texts acceptable, or would you rather drop the goal from the centre?
- **R3** Screen reader: nothing new is announced twice (the centre texts are inside the ring group that already has the label).

## Open questions (for the owner; tests avoid depending on them unless stated)
1. **Half-up rounding of left/over for nutrition.** The calories centre rounds the raw difference (`goal - eaten`); the ring text rounds the eaten value. They can differ by 1 (eaten 80.5: text `81 / 150 g`, centre `70`). Followed the calories dial; only values where both agree are tested (C5 uses 70.4 eaten giving `80`).
2. **A fraction over the goal.** 150.2 g eaten against 150: the ring text is `150 / 150 g`, `isOver` is true, the centre reads `0` with `g over`. Matches the calories dial today; not tested.
3. **10 k steps and up lose the decimal** (`12.5k` shows `13k`) and 10 hours of sleep and up show whole hours, to keep the centre within 9 characters (`99M+/99M+`). Say if you would rather keep one decimal and shrink the font further.
4. **The `99999+` cap on the calories centre** changes a number that was "unchanged" only for absurd data (more than 99,999 kcal); say if calories should stay uncapped.
5. **Exact y positions** of number and caption in the svg are the implementer's, as long as H2 holds.
6. **Colour of the centre text** is the existing `.dial-num` / `.dial-cap` fill; not changed here.
