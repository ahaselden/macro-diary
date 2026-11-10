# Known issues

Collected from extraction agents and the regression reviewer during the refactor. Per [D8](DECISIONS.md#d8-bugs-found-during-a-refactor-are-logged-not-fixed) these were **not** fixed while behaviour had to stay identical. Each says whether it has since been fixed.

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Imported backup strings reached HTML unescaped (`data-edit="${e.id}"`, `value="${amount}"`, goals) and `goals` was not validated, so a crafted backup file could inject markup. | Medium (security) | Fixed in refactor phase 4 (see commit log) |
| 2 | Service worker precache list omitted `css/` and `js/`; offline before first fetch would break. | Medium | Fixed in phase 5 |
| 3 | Share summary text says "dayly summary" for the day range (built from `x.kind + 'ly'`). | Low (cosmetic) | Open |
| 4 | `volOf('cups of tea')` is read as one cup (the unit only needs a word boundary after it). Harmless for real measure text. | Low | Open |
| 5 | `frac(null)` throws; only ever called with regex-matched text so unreachable today. | Low | Open |
| 6 | `validEntry` accepts `grams` given as a numeric string; the measures filter does not check `g` is a number. | Low | Open |
| 7 | `newEntries` doesn't dedupe repeated ids *inside one backup file*. | Low | Open (superseded by the Stage 1 merge rewrite) |
| 8 | Foods with empty name/brand/source share the `foodKey` `"||"` (and so share saved measures). | Low | Open |
| 9 | Export: a range containing only empty days exports summary+JSON but no entries CSV (each file has its own "nothing to export" test). | Low | Open (arguably correct) |
| 10 | Barcode: if `BarcodeDetector` were missing after the camera was granted the stream was left running. The scan button is only shown when it exists, and the new `barcode.js` is DOM-free. | Low | Mitigated |
| 11 | The embedded preview browser doesn't register service workers, so offline behaviour can only be verified in a real browser. | Info | Open — owner to check on phone |
