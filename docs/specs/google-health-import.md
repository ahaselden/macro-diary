# Spec: import steps, sleep and workouts from a Google Takeout zip (backlog item 18)

## Purpose
The owner uploads the Google Takeout zip of their Google Health data in Settings; the app reads it in the browser (nothing is uploaded, the file is not kept), takes only steps, sleep and workouts, and stores one small record per day next to the diary. The Diary then shows a read-only "From Google Health" line for a day that has data, and the day details list that day's workouts. Facts about the export come from `docs/research/google-health-sample.md` (structure only); the owner's decisions of 2026-11-13 are in section 5b of that file.

## Owner decisions this spec follows
Zip upload (about 200 MB, about 11,000 entries, about 3 GB unzipped: never read whole, never unzipped whole). Last year by default, "All years" as an option. The device's current timezone defines days. Per local day the step total is the source with the LARGER total (the watch), kept in ONE small function.

## Contract

| Piece | Layer / file (new unless stated) | Shape |
|---|---|---|
| `parseCsv(text)` | `js/domain/health-import.js` (pure) | `string[][]`: records of cells. Never throws; non-string gives `[]` |
| `parseCsvTable(text)` | same | `{ columns: string[], rows: object[] }`; header names normalised (below) |
| `parseInstant(s)` | same | milliseconds since epoch, or `NaN` |
| `stepTotalsBySource(rows, tz)` | same | `{ 'YYYY-MM-DD': { [source]: number } }` |
| `mergeStepTotals(a, b)` | same | NEW object, per day and source the SUM |
| `chooseStepTotal(bySource)` | same | number: THE step-source rule, one function |
| `dailySteps(rows, tz)` | same | `{ 'YYYY-MM-DD': number }` = `stepTotalsBySource` then `chooseStepTotal` per day |
| `sleepByDay(rows, tz)` | same | `{ 'YYYY-MM-DD': { sleepMinutes, sleepStart, sleepEnd } }` |
| `workoutsByDay(rows, tz)` | same | `{ 'YYYY-MM-DD': Workout[] }` |
| `cutoffDay(today, scope)` | same | `'YYYY-MM-DD'` or `null` |
| `combineActivity({steps, sleep, workouts}, since)` | same | `{ days: { 'YYYY-MM-DD': partialRecord }, left: number }` |
| `countActivity(days)` | same | `{ stepDays, sleepDays, workouts }` |
| `importSummaryText({stepDays, sleepDays, workouts, left})` | same | the one-sentence result text |
| `applyActivityImport(state, days, now)` | `js/domain/activity.js` (pure, mutates `state` like `entries.js`) | `{ added, updated, unchanged }` |
| `activityForDay(state, day)` | same | the stored record or `null` |
| `activityLine(record)` | same | `'Steps 9,431 · Sleep 7 h 45 min · 2 workouts'` or `''` |
| `sanitizeActivityDay(d)` | `js/core/schema.js` | a NEW clean record or `null` |
| `SCHEMA_VERSION` | `js/core/schema.js` | `10`; `defaults().activity` is `{}`; `migrate` v9 to v10 |
| `activity:YYYY-MM-DD` record | `js/domain/sync-records.js`, `merge.js` | `{ key, value: { activity: record }, updatedAt: record.updatedAt }` |
| `listEntries(blob, opts)`, `readEntryText(blob, entry, opts)`, `ZipError` | `js/services/zip.js` | random-access zip reader over a Blob (below) |
| `readTakeout(blob, opts)` | `js/services/google-health.js` | the whole read: finds the wanted entries, reads them one at a time (below) |
| `initHealthImport()` | `js/ui/health-import-view.js` | the Settings card; called from `js/main.js` |

`tz` is `utcMs => minutesToAdd`: the minutes to ADD to a UTC instant to get local wall-clock time (UTC-6 is `-360`, India is `+330`). It is injected so Node tests can use fixed and daylight-saving offsets; the browser passes `ms => -new Date(ms).getTimezoneOffset()`. A day is `YYYY-MM-DD` of `new Date(ms + tz(ms) * 60000)` read in UTC fields.

### CSV reading (`parseCsv`, `parseCsvTable`)
Tolerant: a leading UTF-8 BOM is dropped; records end at `\r\n`, `\n` or a lone `\r`; a quoted cell may contain commas, line breaks and doubled quotes (`""` is one quote); a missing final line break is fine; completely empty lines are skipped; an unterminated quote takes the rest of the text as that cell (never hangs, never throws). `parseCsvTable` takes the first record as the header. Header names are normalised: trimmed, lower-cased, runs of whitespace replaced by `_` (so `data source` becomes `data_source`); a duplicate name keeps its FIRST column; the names `__proto__`, `constructor` and `prototype` are ignored. Each row is a plain object with every kept column as an own key; a missing cell is `''`; extra cells beyond the header are ignored; a row whose cells are all empty is skipped. No header at all (empty text) gives `{ columns: [], rows: [] }`.

### Times (`parseInstant`)
Accepts `YYYY-MM-DDTHH:MM:SS` or with a space instead of the `T`, optional fraction (`.123`), then `Z`, `+hh:mm`/`-hh:mm` (or nothing = UTC). Returns `NaN` for anything else, for impossible dates (month 13, 30 February, hour 24) and for years before 1990 or after 2099. All stored times are written as UTC ISO text without milliseconds: `2026-11-04T05:00:00Z`.

### Steps (`steps_YYYY-MM-01.csv`: `timestamp,steps,data source`)
- A row counts when its `timestamp` parses, `steps` is a plain decimal number (`/^\d+(\.\d+)?$/` after trimming; no exponent, no sign, no `NaN`) and `0 <= steps <= 100000` for that one row. Any other row is ignored (not clamped).
- `data_source` is trimmed and cut to 60 characters; empty, missing, `__proto__`, `constructor` and `prototype` become `unknown`.
- `stepTotalsBySource` adds the rows into `day -> source -> total` (a day with only ignored rows does not appear). `mergeStepTotals` adds two such objects source by source (needed because a LOCAL day can span two monthly UTC files); neither input is changed.
- **The source rule (`chooseStepTotal`)**: the LARGEST total among the sources of that day; sources are never added together (the phone and watch both record the same walking). No valid total gives `0`. This is the only place that knows the rule; changing it must not touch any other function.
- `dailySteps` rounds the chosen total to a whole number, omits a day whose rounded total is `0`, and caps a day at `200000`.

### Sleep (`UserSleeps_*.csv`)
Columns read by name: `sleep_id`, `minutes_asleep`, `sleep_start`, `sleep_end` (the rest, including `start_utc_offset`/`end_utc_offset`, are ignored: days follow the injected `tz`, as the owner decided for the whole import).
- A row counts when `sleep_start` and `sleep_end` parse, `end > start`, the span is at most 24 hours, and `minutes_asleep` is a plain decimal `>= 0` (rounded to a whole number, then capped at 1440). Others are ignored.
- A sleep belongs to the local day it ENDS (`tz` at the end instant).
- A `sleep_id` that is not empty counts once (the first row wins), so overlapping yearly files do not double count. Rows with an empty id are all counted.
- Per day: `sleepMinutes` is the SUM of the day's sleeps (naps included, capped at 1440); `sleepStart` and `sleepEnd` are the start and end of the MAIN sleep, the one with the most `minutes_asleep` (tie: the one that ends later). A day whose sum is `0` is omitted.

### Workouts (`UserExercises_*.csv`)
Columns read by name (the real header is longer; unknown and missing columns are fine, empty cells mean "not recorded"): `exercise_id`, `exercise_start`, `exercise_end`, `activity_name`, `tracker_total_calories`, `tracker_total_steps`, `tracker_total_distance_mm`, `tracker_avg_heart_rate`, `tracker_peak_heart_rate`.
- A row counts when `exercise_id` is not empty after trimming (cut to 80 characters; a repeated id counts once, first wins) and `exercise_start` parses. A workout belongs to the local day it STARTS.
- Workout object: `{ id, name, start, minutes, kcal?, steps?, distanceM?, avgHr?, peakHr? }`. `start` is UTC ISO text. `minutes` is `round((end - start) / 60000)` capped at 1440, and `0` when the end is missing, invalid or before the start. `name` is `activity_name` with control characters removed, trimmed and cut to 60 characters, or `Workout` when empty. Text is otherwise kept AS IS (HTML and formulas stay plain text; the UI escapes).
- Optional numbers are present only when the cell is a plain decimal inside the range; otherwise the key is absent (a reported `0` is kept): `kcal` 0 to 20000, `steps` 0 to 200000, `distanceM` = `tracker_total_distance_mm / 1000` 0 to 1,000,000, `avgHr` and `peakHr` 20 to 300. Every number is rounded to a whole number (`Math.round`).
- Per day: sorted by `start` ascending then `id`, at most 20 kept (the earliest).

### Which days (`cutoffDay`, `combineActivity`)
`cutoffDay(today, 'year')` is the date 365 days before `today` (a local `YYYY-MM-DD`): `2026-11-13` gives `2025-11-13`, `2024-03-01` gives `2023-03-02`, `2024-02-29` gives `2023-03-01`. `'all'` gives `null`. Any other scope is treated as `'year'`. An invalid `today` gives `null`. `combineActivity` keeps a day when `since` is `null` or the day is `>= since` (text comparison), builds `partialRecord` from `steps`, `sleepMinutes`, `sleepStart`, `sleepEnd`, `workouts` (keys only when present), omits days with nothing, and returns in `left` how many DISTINCT days that had data were before `since` (data in steps files that `readTakeout` skips without reading is not counted). Keys that are not real `YYYY-MM-DD` dates are ignored.

### Stored shape (schema 9 to 10)
`state.activity = { 'YYYY-MM-DD': record }`, separate from `days`:
```
record = { updatedAt, source: 'google-health', steps?, sleepMinutes?, sleepStart?, sleepEnd?, workouts?: [ Workout ] }
```
`sanitizeActivityDay(d)` returns a fresh object holding only these keys, or `null`:
- `d` must be a plain object whose `source` is a string matching `/^[a-z][a-z0-9-]{0,39}$/` (others, and a missing source, give `null`); `updatedAt` is a finite number 0 to 8.64e15, else `0`.
- Only JS numbers count (numeric strings, booleans, `null` are dropped), non-integers are rounded. `steps` 0 to 200000 (a stored `0` is kept); `sleepMinutes` 1 to 1440; out of range: the key is dropped, not clamped.
- `sleepStart` and `sleepEnd` are kept only together, only with a valid `sleepMinutes`, both in the exact form `YYYY-MM-DDTHH:MM:SSZ`, parseable and `end > start`; else both are dropped.
- `workouts`: an array (anything else is dropped), at most 20 entries kept in the order given; each must be a plain object with a string `id` of 1 to 80 characters and a `start` in the form above, else it is dropped; a repeated `id` in one day keeps the first. `name` is cleaned as above (non-string gives `Workout`); `minutes` 0 to 1440 (invalid gives `0`); `kcal` 0 to 20000, `steps` 0 to 200000, `distanceM` 0 to 1,000,000, `avgHr` and `peakHr` 20 to 300 are dropped when not valid; unknown keys are dropped. An empty list is dropped.
- A record with none of `steps`, `sleepMinutes`, `workouts` left gives `null`.
`sanitize(d)` rebuilds `d.activity` from the entries whose KEY is a real calendar date (`2026-02-30` and `__proto__` are dropped) and whose value `sanitizeActivityDay` accepts; a non-object `activity` becomes `{}`. It never touches `days`, `plan`, `recipes` or anything else. `migrate` v9 to v10 adds nothing but the empty `activity`; `STORAGE_KEY` stays `macrodiary.v1`.

### Importing into the state (`applyActivityImport(state, days, now)`)
For each day of `days` (the `days` of `combineActivity`): the new record is `sanitizeActivityDay({ updatedAt: now, source: 'google-health', ...fields })`; days that are not real dates or give `null` are skipped. The stored record REPLACES the same day's record as a whole (the export is the truth for the days it contains; days not in the import are not touched). **`updatedAt` policy: if the new record, ignoring `updatedAt`, equals the stored one, nothing is written and `updatedAt` is NOT bumped** (importing the same zip twice changes nothing, and sync pushes nothing). Otherwise the record is stored with `updatedAt: now`. Returns the number of days `added`, `updated` and `unchanged`. A `now` that is not a finite number above 0 applies nothing. The stored records are copies (changing them never changes `days` passed in). It does not touch `state.days`, `tombstones`, `settingsUpdatedAt` or anything else.

### Sync, merge, backup
- Key `activity:YYYY-MM-DD` (regex `^activity:\d{4}-\d{2}-\d{2}$`, part of `isSyncKey`); `toRecords` writes one record per stored day, sorted by date, after the `plan:` records; none when there is no activity. `updatedAt` of the record is the day's `updatedAt`.
- `applyRecords`: a remote record is sanitised with `sanitizeActivityDay` and merged; anything malformed (value not an object, no `activity`, `null` result, key date not real) is ignored without throwing. Records with a key sync does not know are ignored too.
- `mergeStates`: per day LAST WRITER WINS by `updatedAt` (missing 0), tie broken by the larger JSON text (order independent), or `preferLocal` as for plans. The result always has an `activity` object (maybe empty). Commutative, associative, idempotent like everything else. `tombstones` do not apply to activity (there is no delete action; a tombstone with the same text as a day never hides it).
- **Old devices**: an app version without this feature gets `activity:` records from the server. `isSyncKey` is false for them, so `toPartial` returns `null` (ignored), and the engine's pull loop does not store a revision or hash for unknown keys and never pushes them. Result: the old device neither shows, keeps nor deletes the data, and nothing breaks. If an old app loads saved data that already has `activity` it keeps the extra property untouched (neither `sanitize` nor `migrate` removes unknown keys; `mergeStates` spreads the local state).
- Backup: `JSON.stringify(state)` already contains `activity`. `mergeRestore` migrates and sanitises the file first, then merges per day (this device wins a tie). A v9 backup without `activity` restores as before.
- Reports, CSV and JSON export do not include activity in this round (open question 4).

### The zip reader (`services/zip.js`)
- `listEntries(blob, { signal })` resolves to `[{ name, size, compressedSize, method, offset, ... }]` (every central directory record, names decoded as UTF-8, `method` 0 = stored, 8 = deflate). It finds the end-of-central-directory record with `blob.slice` on the last `22 + 65535` bytes at most, scanning backwards for the signature `PK\x05\x06` and accepting a candidate only when `position + 22 + commentLength === blob.size` (a comment may contain the signature), then slices exactly the central directory. It never reads the whole blob.
- `readEntryText(blob, entry, { signal, maxBytes })` resolves to the decoded UTF-8 text of ONE entry: slices the 30-byte local header, then the name and extra field whose lengths come from the LOCAL header (they may differ from the central ones), then exactly `entry.compressedSize` bytes (sizes and CRC always come from the central directory, because streaming zip writers put zeros in the local header and a data descriptor after the data). Stored entries are used as is; deflate goes through `new DecompressionStream('deflate-raw')` with the blob slice piped in as a stream. The CRC-32 and the uncompressed size are checked; inflating more bytes than the declared size aborts at once (a lying entry cannot fill memory). `maxBytes` (default 268435456) refuses an entry whose declared size is larger BEFORE reading any of its data.
- `DecompressionStream` is looked up each time it is needed (not once at import), so a browser without it still lists and reads stored entries.
- Both read only what they need: the memory held is one entry at a time. A reader that calls `arrayBuffer()`, `text()`, `stream()` or `bytes()` on the whole blob fails the tests.
- Errors are `ZipError` (an `Error` with a string `code` and a plain-English `message`), never a hang:

| `code` | when | message (shown to the owner as is) |
|---|---|---|
| `not-zip` | no end record found, empty or tiny blob, a text file | exactly `This file is not a zip file.` |
| `zip64` | EOCD fields hold the 0xFFFF / 0xFFFFFFFF markers, a zip64 locator is present, or a central record claims size or offset 0xFFFFFFFF | mentions `zip64` |
| `encrypted` | an entry has flag bit 0 (raised by `readEntryText` of that entry, not by listing) | mentions `password` or `encrypted` |
| `unsupported-method` | method other than 0 or 8 (raised by `readEntryText`) | mentions `compression` |
| `corrupt` | wrong local header signature, data outside the file, CRC or size mismatch, more data than declared, central directory outside the file | mentions `damaged` |
| `too-big` | declared size above `maxBytes` | mentions `too large` |
| `unsupported-browser` | a deflated entry and `DecompressionStream` is not available (stored entries still work) | mentions `browser` |
| `no-data` | raised by `readTakeout` only (below) | begins `No steps, sleep or workout files were found in this zip.` |
| `aborted` | the `signal` was aborted (the error also has `name === 'AbortError'`) | `Cancelled.` |

### The Takeout read (`services/google-health.js`)
`readTakeout(blob, { scope, today, tz, onProgress, signal })` (`scope` `'year'` default or `'all'`; `today` a local `YYYY-MM-DD`; `tz` as above) resolves to `{ days, counts, left, files }`: `days` and `left` from `combineActivity`, `counts` from `countActivity(days)`, `files` the number of entries read.
- Entry names are matched after any leading folders (the real ones start with `Takeout/`): `Google Health/Physical Activity_GoogleData/Steps/steps_YYYY-MM-DD.csv`, `Google Health/Health Fitness Data_GoogleData/UserSleeps_<anything>.csv`, `Google Health/Health Fitness Data_GoogleData/UserExercises_<anything>.csv`. EVERYTHING else is neither read nor listed in the result: `steps_readme.txt`, `UserSleepStages_*.csv`, `Fit/...`, `archive_browser.html`, and any name starting with `__MACOSX/`.
- A steps file whose month cannot reach `since` is not read at all: skipped when the day after the last day of the file's month is before `since` (so `steps_2025-10-01.csv` is skipped for since `2025-11-13`, `steps_2025-11-01.csv` is read). With scope `all` every wanted file is read.
- Files are read ONE AT A TIME in listing order; each steps file is reduced with `stepTotalsBySource` and merged with `mergeStepTotals` straight away, so the minute rows are not kept; sleep and exercise rows (small) are kept and processed together. `chooseStepTotal` runs once at the end, on the merged totals.
- `onProgress({ done, total })` is called once before the first file with `done: 0`, then once after each file; `total` is the number of files to read; `done` ends equal to `total`. `signal` is checked before each file; an aborted import rejects with `code: 'aborted'` and reads no further file.
- No wanted entry at all: rejects `ZipError` code `no-data`, message beginning `No steps, sleep or workout files were found in this zip.`
- Other errors from `zip.js` pass through unchanged.

### The text of the result
`importSummaryText({ stepDays, sleepDays, workouts, left })`:
- `Imported 12 days of steps, 11 days of sleep, 7 workouts.` (singular: `1 day of steps`, `1 day of sleep`, `1 workout`), then, when `left > 0`, ` 30 days older than a year were left out.` (`1 day older than a year was left out.`).
- All three zero: `Nothing to import: no steps, sleep or workouts found for that period.` plus the same `left` sentence.
The counts are the days and workouts the import CONTAINED (inside the period), whether or not they changed anything.

### The screens
**Settings card** between "Food databases" and "Sync between devices": heading `Import from Google Health`; a short text containing `Nothing is uploaded` and telling how to get the zip (Google Takeout); `<input type="file" id="ghFile" accept=".zip,application/zip">` (visible); `<select id="ghScope">` with `<option value="year" selected>Last year</option>` and `<option value="all">All years</option>` and a label; `<button id="ghStart">Start import</button>` (disabled until a file is chosen and while an import runs); `<button id="ghCancel">Cancel</button>` (hidden unless running); `<p id="ghStatus" aria-live="polite">`. The status line shows `Reading N of M files…` while running, then the `importSummaryText`, or the error's `message` (an error that is not a `ZipError` shows `Could not read this file.`). It is written with `textContent`. After a finished or failed run the file input is cleared. The file is never saved anywhere (not in the state, `localStorage`, IndexedDB). A successful import calls `save()` and emits `diary:changed`, so the Diary refreshes.
**Diary**: `<div class="muted" id="activityLine" hidden></div>` between `#summary` and `#meals`. For the shown day, when `state.activity[day]` exists and `activityLine(record)` is not empty, it is visible and reads `From Google Health: ` + the line (`textContent`); otherwise `hidden` and empty. The numbers in `#summary` are unchanged by activity.
**Day details** (the dialog that `#summary` opens): when the day has workouts, a heading `Workouts` and one row per workout `name · N min` plus ` · K kcal` when `kcal` is present (the name goes through `esc()`).

### Docs the implementer must update (same commit)
`docs/DECISIONS.md` new `D54` (zip read in the browser with `DecompressionStream`, no vendored library; larger-source step rule; local days from the device timezone; storage and merge shape; the `updatedAt` policy); `docs/KNOWN-ISSUES.md` new row 67; `docs/SYNC.md` (record table gains `activity:`, plus the old-device note above); `docs/ARCHITECTURE.md` (new files in the map); `docs/ROADMAP.md`/`docs/BACKLOG.md` as usual; `sw.js`: every new file in `SHELL` and `CACHE` raised above `v58` (tests never pin the exact number).

## Behaviours (tests in the files named after each)
`tests/google-health-import.test.js` (domain):
1. `parseCsv` handles BOM, CRLF/LF/CR, quotes, doubled quotes, embedded commas and line breaks, blank lines, a missing final newline, an unterminated quote; non-strings give `[]`.
2. `parseCsvTable` normalises headers, keeps first duplicate, ignores prototype names, fills short rows, ignores extra cells, skips empty rows, handles header-only and empty text.
3. `parseInstant` golden values for every accepted form and `NaN` for the rejected ones.
4. `stepTotalsBySource` with fixed offsets (negative and positive): hand-computed day assignment and totals per source.
5. A daylight-saving offset function puts the same wall-clock hours on the right days across the change (and a fixed offset would not).
6. `chooseStepTotal` and `dailySteps`: larger source, never the sum, ties, zero days omitted, unknown source, day cap.
7. `mergeStepTotals` sums per source across two files, equals one pass over both, changes neither input.
8. Hostile step rows are ignored or contained (strings, negatives, exponent, huge, NaN, impossible and out of range dates, prototype source names).
9. `sleepByDay`: day it ends, naps summed, main sleep chosen, duplicate ids once, offsets columns ignored, hand-computed.
10. Hostile sleep rows.
11. `workoutsByDay`: hand-computed fields, local day of the start, sorted, empty cells absent, unit conversion and rounding.
12. Hostile workouts: HTML and formula names kept as text, control characters removed, name cap, ids, 20 per day, bad numbers dropped, repeated id once.
13. `cutoffDay` goldens (leap years), `all`, unknown scope, invalid today.
14. `combineActivity`: filter by `since` (inclusive), `left` count, partial records, empty days omitted, input not changed.
15. `countActivity` and `importSummaryText` exact wording, singular and plural.
16. Nothing throws or mutates (frozen inputs, garbage arguments); 72,000 rows are processed correctly.

`tests/google-health-activity.test.js` (storage, sync, backup):
17. `applyActivityImport`: added, replaced as a whole, unchanged does not bump `updatedAt`, newer export wins, days not in the import untouched, diary untouched, copies, hostile days, bad `now`.
18. `activityForDay` and `activityLine` exact text.
19. `SCHEMA_VERSION` 10, `defaults().activity`, storage key unchanged.
20. `migrate` from 9 and older: data survives (fixtures), `activity` is `{}`, a store loads a v9 save intact.
21. `sanitizeActivityDay` keeps a valid record exactly.
22. `sanitizeActivityDay` hostile input.
23. `sanitize` rebuilds `d.activity` safely and leaves the diary alone.
24. `isSyncKey` and `toRecords` for `activity:`.
25. `applyRecords`: valid merged, hostile and unknown ignored, never throws.
26. `mergeStates`: last writer wins, tie both orders, `preferLocal`, tombstones irrelevant.
27. Merge laws (commutative, associative, idempotent) on random activity states.
28. Activity does not disturb diary, plan or recipes in a merge; two devices converge through the sync engine and a second sync pushes nothing.
29. `mergeRestore` with activity, with a v9 backup, with hostile activity.

`tests/google-health-zip.test.js` (reader and service, zips built by hand in `tests/zip-builder.js`):
30. `listEntries`: names (also non-ASCII), methods, sizes; 12,000 entries.
31. `readEntryText`: stored, deflated, data descriptor, different local extra field, non-ASCII text.
32. An archive comment of 65,535 bytes, and a comment that contains a fake end record.
33. Not a zip: text, empty, tiny, random bytes.
34. zip64 (end record and entry marker).
35. Encrypted and unsupported-method entries fail on read only; others in the same zip still read.
36. Corrupt: bad CRC, size lie (inflates to more), offset outside the file, wrong local signature, directory outside the file.
37. `maxBytes` refuses before reading the data.
38. Abort.
39. Only the needed byte ranges are read (a spy blob that forbids whole reads, a 3 MB unrelated entry never touched).
40. No `DecompressionStream`: `unsupported-browser` for deflated, stored still fine.
41. `readTakeout` golden result on a built zip; unwanted entries never read.
42. `readTakeout` scope, old steps files skipped (not read), cross-file local day merged before the source rule.
43. `readTakeout` progress and cancel; `no-data`; not-a-zip passes through.

`tests/google-health-ui.test.js` (source text, weak by nature):
44. `index.html`: the card, ids, order, wording, `#activityLine` position.
45. `diary.js` wiring (line, details workouts), `health-import-view.js` wiring (safe text, no storage of the file, no network), `main.js`.
46. Layer rules and no network/storage words in the new modules.
47. `sw.js` SHELL has the new files and `CACHE` is above 58.
48. The docs were updated.

## Existing tests edited by the test designer (they pinned schema 9)
Only the number changed (9 to 10,  to ), nothing else; each passes again once  is 10 (checked against a throw-away reference of the storage and sync half, not against the real code):
-  (line ~127),  (~185),  F1 and F2 (~22, 23, 31),  D1, D2, D16 (~33, 34, 42, 49, 52, 54, 260),  N1, N2 (~34, 35, 45, 52),  U12 (~122),  5, 6, 6b and the migration checks (~99-102, 108, 126, 215),  10 (~119),  13 (~173),  (~94),  B1, B2, B14 (~25, 27, 33, 37, 46, 48, 186).
Not edited:  5 and  3 (the card order checks) still pass with the new card between Food databases and Sync, because they only require the listed headings to be in increasing order.
New helper (not a test):  assembles small zips by hand (own CRC-32), verified with Python's .

## Existing tests edited by the test designer (they pinned schema 9)
Only the number changed (9 to 10, `SCHEMA_VERSION = 9;` to `= 10;`), nothing else. Each passes again once `SCHEMA_VERSION` is 10 (checked against a throw-away reference of the storage and sync half, not against the real code):
- `tests/item-nutrition-facts.test.js` (~127), `tests/export-nutrition-facts.test.js` (~185), `tests/favourite-recipes.test.js` F1, F2 (~22, 23, 31), `tests/nutrition-details.test.js` D1, D2, D16 (~33, 34, 42, 49, 52, 54, 260), `tests/page-nutrition.test.js` N1, N2 (~34, 35, 45, 52), `tests/recipe-import-ui.test.js` U12 (~122), `tests/saved-food-ids.test.js` 5, 6, 6b and the migration checks (~99-102, 108, 126, 215), `tests/settings-tab-with-export.test.js` 10 (~119), `tests/settings-tidy.test.js` 13 (~173), `tests/store.test.js` (~94), `tests/sync-usda-key.test.js` B1, B2, B14 (~25, 27, 33, 37, 46, 48, 186).
- Not edited: the card order checks `tests/settings-tidy.test.js` 5 and `tests/settings-tab-with-export.test.js` 3 still pass with the new card between Food databases and Sync, because they only require the listed headings to be in increasing order.
- New helper (not a test): `tests/zip-builder.js` assembles small zips by hand with its own CRC-32; checked with Python's `zipfile`.

## Edge cases and hostile input
Empty files; a header only; a million-row steps file (the totals only); cells with quotes, commas, line breaks; BOM; CRLF; `__proto__`, `constructor` as source names, activity names, ids and as day keys; HTML (`<img onerror>`) and formulas (`=HYPERLINK(...)`) in activity names; negative, NaN, `1e999`, `9`.repeat(400), `0x10`, numeric text with spaces; times far outside 1990 to 2099, impossible calendar dates, `24:00`; sleeps longer than 24 hours or ending before they start; duplicate ids; 50 workouts in one day; `state.activity` missing, an array, a string; a record whose `source` is missing or `__proto__`; synced records with a key date `2026-02-30`; a zip with a bogus central directory; a zip of 12,000 entries; an entry that inflates to far more than it declares; a zip whose comment contains the end-record signature; the same zip imported twice; a zip imported after a newer one.

## What cannot be tested automatically
The real 172 MB export (private, never in the repository): speed and memory on a phone, `DecompressionStream` in the owner's Safari/Chrome, the system file picker, whether the numbers agree with the Google Health app, travel across timezones. The look of the card and the line (spacing, themes, one thumb use). A real sync between two devices through Supabase. The Node tests build tiny zips with made-up data only.

## Manual / headless checklist
The browser-tester builds ONE small test zip in its scenario with Node (`zlib.deflateRawSync`, entries as below, made-up data) and uploads it with `setInputFiles` on `#ghFile` (`{ name: 'takeout.zip', mimeType: 'application/zip', buffer }`). The browser context uses `timezoneId: 'America/Chicago'` and a phone-size or desktop viewport as stated; every network request is blocked (nothing is stubbed: the import must not need the network). `macrodiary.v1` starts as schema 9 data (goals `{k:2000,p:150,c:200,f:65}`, one entry "Oats" today with per100 `{k:400,p:10,c:60,f:8}`, 50 g = 200 kcal) unless stated, so the migration runs on first load.

**The test zip.** `T` = today's date in America/Chicago; `D(n)` = the date n days before `T`, as `YYYY-MM-DD`. Entry names and rows (CSV, header first, CRLF line ends are fine):
- `Takeout/Google Health/Physical Activity_GoogleData/Steps/steps_<YYYY-MM>-01.csv`, one file per UTC month that the rows fall in, header `timestamp,steps,data source`, rows:
  `D(1)T12:00:00Z,3000,Versa 2` / `D(1)T12:01:00Z,1500,Versa 2` / `D(1)T13:00:00Z,2000,Phone Health Connect` / `D(0)T03:00:00Z,700,Versa 2` / `D(2)T12:00:00Z,800,Phone Health Connect` / `D(2)T12:01:00Z,100,Versa 2` / `D(800)T12:00:00Z,4000,Versa 2`. (`D(0)T03:00:00Z` is 21:00 or 22:00 the evening before in Chicago, so it belongs to `D(1)`.)
- `Takeout/Google Health/Health Fitness Data_GoogleData/UserSleeps_2026.csv`, header `sleep_id,sleep_type,minutes_in_sleep_period,minutes_after_wake_up,minutes_to_fall_asleep,minutes_asleep,minutes_awake,minutes_longest_awakening,minutes_to_persistent_sleep,start_utc_offset,sleep_start,end_utc_offset,sleep_end,data_source`, rows: `s1,STAGES,480,0,10,420,60,15,10,-06:00,D(1)T05:00:00Z,-06:00,D(1)T13:00:00Z,Versa 2` / `s2,CLASSIC,60,0,5,45,15,5,5,-06:00,D(1)T19:00:00Z,-06:00,D(1)T20:00:00Z,Versa 2` / `s3,STAGES,450,0,10,400,50,10,10,-06:00,D(800)T05:00:00Z,-06:00,D(800)T13:00:00Z,Versa 2`.
- `Takeout/Google Health/Health Fitness Data_GoogleData/UserExercises_2026.csv`, header `exercise_id,exercise_start,exercise_end,utc_offset,activity_name,log_type,tracker_total_calories,tracker_total_steps,tracker_total_distance_mm,tracker_avg_heart_rate,tracker_peak_heart_rate,extra_column`, rows: `e1,D(1)T14:00:00Z,D(1)T14:45:00Z,-06:00,Walk,auto,210,5200,3500000,113,150,x` / `e2,D(1)T16:00:00Z,D(1)T16:30:00Z,-06:00,"<img src=x onerror=alert(1)>",manual,,,,,,` / `e3,D(800)T14:00:00Z,D(800)T14:20:00Z,-06:00,Run,auto,150,,,,,`.
- Entries that must be ignored: `Takeout/archive_browser.html` (any text), `Takeout/Google Health/Health Fitness Data_GoogleData/UserSleepStages_2026.csv` (text `not,a,sleep`), `Takeout/Fit/All Data/junk.json` (text `{}`), `Takeout/Google Health/Physical Activity_GoogleData/Steps/steps_readme.txt`.
Expected result of importing it with "Last year": D(1) steps 5200 (the watch: 3000 + 1500 + 700, larger than the phone's 2000), D(2) steps 800 (the phone is larger there: the rule is per day), D(1) sleep 465 minutes (420 + 45, shown 7 h 45 min), D(1) workouts e1 and e2; everything on D(800) is older than a year.

**C1 Last year (default) and the numbers**
Setup: Settings, app freshly loaded with the schema 9 data above. `#ghScope` shows "Last year".
Steps: choose the test zip in `#ghFile`; click `#ghStart`; wait until `#ghStatus` no longer says `Reading`. Go to the Diary and press the previous-day button once (D(1)); then once more (D(2)); then press `Jump to today`.
Expect: `#ghStatus` reads exactly `Imported 2 days of steps, 1 day of sleep, 2 workouts. 1 day older than a year was left out.` Diary D(1): `#activityLine` visible with text `From Google Health: Steps 5,200 · Sleep 7 h 45 min · 2 workouts`. D(2): `From Google Health: Steps 800`. Today: `#activityLine` hidden or empty. On every day the `#summary` numbers are unchanged (today still `200` eaten, `1800` remaining).
Covered by headless? yes.

**C2 Importing the same zip again changes nothing**
Setup: after C1.
Steps: read `JSON.parse(localStorage.getItem('macrodiary.v1')).activity` and note `activity[D(1)].updatedAt`; wait two seconds; choose the same zip again in `#ghFile`; click `#ghStart`; read the activity again.
Expect: `#ghStatus` shows the same sentence as C1; `activity[D(1)].updatedAt` and `activity[D(2)].updatedAt` are identical to before; `Object.keys(activity)` is still exactly `[D(1), D(2)]` (sorted).
Covered by headless? yes.

**C3 All years**
Setup: after C1.
Steps: select `All years` in `#ghScope`; choose the zip; click `#ghStart`; then in the Diary click the previous-day arrow 800 times to reach D(800).
Expect: `#ghStatus` reads exactly `Imported 3 days of steps, 2 days of sleep, 3 workouts.` (no "left out" sentence). `activity[D(800)]` exists with `steps: 4000`, `sleepMinutes: 400` and ONE workout (`e3`). The Diary on D(800) shows `From Google Health: Steps 4,000 · Sleep 6 h 40 min · 1 workout`. D(1) and D(2) lines are as in C1.
Covered by headless? yes.

**C4 A text file renamed .zip**
Setup: Settings, fresh data.
Steps: choose a file `notes.zip` whose bytes are the text `hello world`; click `#ghStart`.
Expect: `#ghStatus` reads exactly `This file is not a zip file.`; `#ghStart` is usable again; `localStorage` `activity` is still `{}`; no uncaught page error.
Covered by headless? yes.

**C5 A zip with no health data (the owner's small first download)**
Setup: Settings, fresh data.
Steps: choose a valid zip that holds only `Takeout/archive_browser.html`; click `#ghStart`.
Expect: `#ghStatus` starts with `No steps, sleep or workout files were found in this zip.`; `activity` is still `{}`.
Covered by headless? yes.

**C6 Hostile activity name stays text**
Setup: after C1.
Steps: Diary on D(1); click `#summary`.
Expect: the details dialog opens, has a heading `Workouts`, a row `Walk · 45 min · 210 kcal`, and a row whose visible text is exactly `<img src=x onerror=alert(1)> · 30 min` (the angle brackets visible as characters). The dialog contains no `img` element; no JavaScript dialog (alert) appeared; no uncaught page error.
Covered by headless? yes.

**C7 Start is disabled until a file is chosen; the card**
Setup: Settings, fresh data.
Steps: look at the page before and after choosing the zip.
Expect: the card headings in order are `Food databases`, `Import from Google Health`, `Sync between devices`; the card text contains `Nothing is uploaded`; `#ghScope` has options `Last year` (selected) and `All years`; `#ghStart` is disabled before a file is chosen and enabled after; `#ghCancel` is not visible; `#ghStatus` is empty.
Covered by headless? yes.

**C8 Phone-width layout**
Setup: viewport 375 x 667; Settings after C1.
Steps: scroll to the card; take a screenshot.
Expect: `document.documentElement.scrollWidth <= 375`; `#ghFile`, `#ghScope`, `#ghStart` and `#ghStatus` all lie inside the viewport width; the status text wraps instead of overflowing; the Diary `#activityLine` for D(1) fits on at most three lines at this width.
Covered by headless? yes (the look itself: Owner O4).

**C9 Survives reload; wipe removes it**
Setup: after C1.
Steps: reload the page; open the Diary on D(1). Then Settings, `Delete all data` (accept the confirm).
Expect: after the reload the D(1) line is unchanged; after the wipe `activity` is `{}` in storage and the D(1) line is hidden or empty.
Covered by headless? yes.

**C10 The file is not kept and nothing is sent**
Setup: after C1, with request logging on.
Steps: after the import read `await indexedDB.databases()` and the keys of `localStorage`; look at the blocked-request log; read the value of `#ghFile`.
Expect: the only `localStorage` key that grew is `macrodiary.v1` and its text is below 20,000 characters (a zip would be larger); `indexedDB.databases()` is empty; no network request was attempted during the import; `#ghFile` has no file selected.
Covered by headless? yes.

**C11 Migration keeps the diary**
Setup: seed schema 9 data with two diary days of entries, a saved food and a recipe (no `activity`).
Steps: load the app and open Settings once; read storage.
Expect: `schemaVersion` is 10, `activity` is `{}`, the diary days, saved food and recipe are identical to the seed.
Covered by headless? yes.

### Owner on a real device
- O1 The real 172 MB export on the owner's phone and on the PC: the import finishes (note the time and whether the page stays responsive), the progress line moves, and the browser does not run out of memory.
- O2 Compare five days of steps, three nights of sleep and three workouts in the Diary with the Google Health app: the watch step rule and local days match as they did in the research (a few steps of difference at a day boundary are expected).
- O3 Safari on iPhone (if used) and Chrome on Android: the file picker accepts the zip, `DecompressionStream('deflate-raw')` exists (otherwise the message mentions the browser).
- O4 The look of the card and the line in two themes at phone width.
- O5 Sync: import on the PC, sync, open the phone: the same lines appear; a second sync pushes nothing.
- O6 Choose `All years` once and watch whether storage and the first sync stay comfortable (open question 3).
- O7 Travel or a phone with another timezone: days near midnight can move by one day (accepted, KNOWN-ISSUES).

## Open questions
1. Days use the injected device timezone for sleep and workouts too; the `start_utc_offset`, `end_utc_offset` and `utc_offset` columns are ignored. The owner decided "device timezone"; if a sleep should follow its own offset it is a one-function change.
2. The column names `data source` (steps), `minutes_asleep`, `sleep_start`, `sleep_end`, `exercise_start`, `exercise_end` and the `tracker_*` names come from the research file, not from reading the real data again; the test files use them. An empty or differently named column makes that field absent, never an error.
3. Size: all years is about 3,000 days; each day is one stored record and one sync record, so the first sync after "All years" pushes thousands of small records and `localStorage` grows by roughly a megabyte. Not measured. A cap, or a bulk record per month, may be wanted later.
4. Activity is not in the CSV/JSON reports or the share text. Not requested.
5. No delete or "remove imported activity" action (not requested), so no tombstones; if one is added later, activity needs tombstones or a deleted flag, otherwise a sync would bring the day back.
6. The day details only list workouts; sleep start and end times are stored but not shown anywhere yet.
7. A re-import replaces the whole day, so a day whose sleep was deleted in the Google app loses the sleep here after a newer export. Chosen as "the newest export is the truth".
8. The summary counts days of sleep, not individual sleeps (naps are folded into the day), contrary to the plan's `M sleeps`.
9. Steps rows above 100,000 per row are ignored, not clamped; days above 200,000 are clamped. These caps are my choice.
10. `parseInstant` accepts years 1990 to 2099 only. A reading from the future is not rejected (the domain has no clock).
11. Exercises from the old Fit era (`Fit/Activities`, `Fit/All Sessions`) are ignored, as asked.
12. If the same device clock is far wrong `updatedAt: now` misorders edits across devices, the same limit as every other record (`docs/SYNC.md`).
