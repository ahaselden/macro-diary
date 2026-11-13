# Spec: export-one-card

## Purpose
The Export section in Settings is currently four separate cards (heading and period row, stats, daily table, download buttons), which looks broken up. It becomes ONE card with the sub-blocks separated by spacing and a thin divider, with no change to export behaviour.

## Contract
No new functions. Changes are markup and CSS only:
- `index.html`, `#v-settings`: replace the four export cards with a single `<div class="card">` between the Sync card (`#syncCard`) and the Backup card. Inside, in this order: `<h2>Export your data</h2>`; the `.row` with `#xKind` and `#xDate`; `#xRange`; `#xStats`; `#xTable`; the buttons group (the three existing `.row` rows with `#xEntries`, `#xSummary`, `#xJson`, `#xShare`).
- `#xStats` and `#xTable` are plain `div`s, NOT class `card`. `#xTable` keeps class `tscroll`. `#xStats`, `#xTable` and one new wrapper `div` around the three button rows each get class `xsec`.
- `css/components.css`: new rule `.xsec{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}` (exact numbers are the implementer's, but it must have a px/rem margin-top and `border-top:1px solid var(--line)`, and no background, border-radius, box-shadow, padding-box or other border; that is what "no nested card look" means).
- `js/ui/export-view.js` needs NO change: it writes `<div class="stats">...` into `#xStats` and `<table>` or the empty `<p class="muted" style="margin:0">` into `#xTable`. Checked: neither markup depends on the container being a card (`.stats` is its own grid, `table` is width 100%, the empty paragraph sets its own margin). The card padding now comes from the outer card; the `.xsec` padding-top plus the divider gives the separation. `.tscroll{overflow-x:auto}` on `#xTable` still scrolls inside the card.
- `sw.js`: `CACHE` bumped from `macro-diary-v56` to `macro-diary-v57`. No new shipped file, so the SHELL list is unchanged. No saved-shape change, no schema bump.

## Behaviours
1. Between the end of the Sync card and the start of the Backup card there is exactly one `.card` element and nothing else.
2. That card contains, in this order, the h2 "Export your data", `#xKind`, `#xDate`, `#xRange`, `#xStats`, `#xTable`, `#xEntries`, `#xSummary`, `#xJson`, `#xShare`; each id appears once in index.html; the card has one h2.
3. `#xStats` and `#xTable` do not have class `card`; `#xTable` keeps `tscroll`.
4. `#xStats`, `#xTable` and a wrapper around the four buttons each have class `xsec`; the wrapper is separate from stats/table.
5. `.xsec` in components.css gives a top margin and a 1px `var(--line)` top divider and no box look.
6. export-view.js markup and texts unchanged and it adds no card class (guard; passes before implementation).
7. Settings card order unchanged: Units, Daily goals, Appearance, Food databases, Sync, Export, Backup (guard; passes before implementation).
8. `sw.js` CACHE is v57 or later.

## Edge cases and hostile input
No data enters this change. Hostile-data escaping in the table is unchanged (`esc` in export-view.js). Empty period: `#xTable` shows "Nothing logged in this period." and the card still shows divider and buttons. Very wide table at 375 px: must scroll inside `#xTable`, not widen the page.

## Existing tests and scenarios that assumed four cards
Tests edited (by me, the designer):
- `tests/settings-tab-with-export.test.js`, test 3: the assertion that `#xTable` is `class="card tscroll"` is replaced by: `#xTable` has `tscroll` and does NOT have class `card`. Order and once-only id checks in that test are unchanged and still hold.
Tests checked and left unchanged: `tests/settings-tidy.test.js` test 5 (checks only h2 order and ids; still valid), `tests/sw.test.js` (list only).
Browser scenarios the browser-tester must update (not touched by me): `tools/browser-test/scenarios/settings-tab-with-export.mjs` (C13 asserts `tscroll` on `#xTable`, still true; the heading-order check is unchanged; any selector expecting `#xStats`/`#xTable` to be a `.card` needs review), `settings-tidy.mjs` (heading order, unchanged), `export-nutrition-facts.mjs` (reads `#xStats`/`#xTable` text only; should pass unchanged). Grep found no scenario using `.card` on these ids, but the tester must run all three.

## Cannot be tested automatically (node)
Visual appearance, scrolling, theming: covered by the browser checklist. Real phone feel: owner list.

## Browser checklist (headless, 375x812 unless stated)
Common setup for all items: fresh profile, app served locally; saved data: entries on today (500 kcal, P 30, C 50, F 10) and on the day before (500 kcal, P 20, C 60, F 20), plus one entry with a very long name "Extra long food name that forces the table wide 0123456789" with kcal 100 on today. Open the Settings tab (gear) and scroll to "Export your data". Weekly period is the default.

- **C1 One card.** Steps: in the page, take the headings `h2` "Sync between devices" and "Backup"; count `.card` elements in `#v-settings` that lie after the Sync card and before the Backup card. Expect: exactly 1, and its first heading text is "Export your data". Covered by headless? yes
- **C2 All controls inside.** Steps: query `#xKind, #xDate, #xRange, #xStats, #xTable, #xEntries, #xSummary, #xJson, #xShare`. Expect: each found exactly once, each is a descendant of that single card; `#xStats` and `#xTable` do not have class `card`; `#xTable` has class `tscroll`. Covered by headless? yes
- **C3 Order.** Steps: read the document order of the nine ids plus the h2. Expect: h2, `#xKind`, `#xDate`, `#xRange`, `#xStats`, `#xTable`, `#xEntries`, `#xSummary`, `#xJson`, `#xShare`. Settings h2 order: Units, Daily goals, Appearance (toggle), Food databases, Sync between devices, Export your data, Backup. Covered by headless? yes
- **C4 Table scrolls inside the card at 375 px.** Steps: with the long-name entry saved, set `#xKind` to Daily and `#xDate` to today (the table has the long name). Measure `#xTable` scrollWidth vs clientWidth and `document.documentElement.scrollWidth` vs `window.innerWidth`. Expect: `#xTable` scrollWidth > clientWidth OR table fits (if it fits, state so), `#xTable` computed overflow-x is `auto`, and document scrollWidth <= innerWidth (no page-level horizontal scroll); `#xTable` right edge <= the card's right edge. Covered by headless? yes
- **C5 Period change updates stats and table.** Steps: select Daily with date = yesterday. Expect: `#xStats` shows "Days logged" 1, "Total calories" 500, "Avg calories / day" 500, "Avg P / C / F" 20 / 60 / 20; `#xTable` has one data row; `#xRange` shows one date. Then select Weekly, date today. Expect: "Days logged" 2, "Total calories" 1,100 (grouping separator may vary: 1100, 1,100 or 1 100), `#xRange` contains " → ". Then Yearly: first table header "Month (avg/day)". Covered by headless? yes
- **C6 Empty period.** Steps: Daily, date set to 2000-01-01. Expect: `#xTable` text "Nothing logged in this period.", "Days logged" 0; the divider and the four buttons are still visible in the same card. Covered by headless? yes
- **C7 Downloads and share still work.** Steps: Weekly with data; click "Download entries (CSV)", "Download summary (CSV)", "Download JSON" (capture each download). Expect: three downloads, file names containing `-entries-`, `-summary-`, `-data-`; entries CSV header includes the D48 columns as before (compare to the pre-change scenario expectation). Click "Share this summary" with `navigator.share` stubbed: expect the share text starts "My weekly summary (". With no entries in the period: click download -> toast "Nothing to export" or equivalent unchanged behaviour. Covered by headless? yes (share via stub only)
- **C8 Visual separation, screenshot, light theme.** Steps: Settings, theme Light, scroll so the whole Export card is visible, take a screenshot (also at 1000 px wide). Expect: one rounded card with border; inside it a thin horizontal line above the stats, above the table and above the buttons (three dividers), a visible gap (about 12 px) above each divider line's content; no inner rounded boxes, no inner backgrounds; heading and Period/date row have no divider above the stats row other than that line. Compare computed style: `#xStats`, `#xTable` and the buttons wrapper have border-top-width 1px, border radius 0, transparent background, margin-top >= 8px. Covered by headless? yes (visual judgement by screenshot review)
- **C9 Dark theme.** Steps: same as C8 with theme Dark. Expect: divider colour equals the card border colour (`--line`), is visible against the card, text readable, still no inner boxes. Covered by headless? yes
- **C10 No regression elsewhere.** Steps: open Backup card and Sync card. Expect: each still a separate card with its own heading; "Backup to file" and "Restore from file" visible. Covered by headless? yes

### Owner on a real device
- O1 On the phone, open Settings > Export: it reads as one card; the table swipes sideways inside the card, the page does not.
- O2 Real download and the real share sheet from the buttons.

## Open questions
- The spec pins the class name `xsec` and divider look as my decision; the owner said "maybe a thin divider line, decide". If the implementer prefers spacing only, the owner must change behaviours 4 and 5.
- Whether the divider should also sit between the Period row and `#xRange` and the stats: pinned as no (only above stats, table, buttons).
