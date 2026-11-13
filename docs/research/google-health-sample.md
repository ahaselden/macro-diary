# Google Health export: what the owner's real sample contains (research, no code)

*Backlog item 18. Written 2026-11-13 from the owner's own Google Takeout export (two zip files). Only the **structure** (file names, column names, counts and data sources) is recorded here. No personal values, dates of individual days or health readings are copied into the repository; the zips stay on the owner's machine. Read together with [google-health.md](google-health.md).*

## 1. The two files
- **`takeout-...200136Z-001.zip` (137 KB):** only `Takeout/archive_browser.html`, an index of what the export contains. **It holds no health data.** (The owner expected this one to be enough; it is not.)
- **`takeout-...200137Z-1-001.zip` (172 MB, about 2.9 GB unzipped, 11,129 entries):** the real data. Most of it is not needed: `Fit/All Data` alone is about 1.6 GB, plus heart rate, calories-in-zone, location, temperature and similar series.

## 2. Where the three wanted things are
The export has two generations of data: the old **Google Fit** folders (`Takeout/Fit/...`, from 2017) and the newer **`Takeout/Google Health/...`** folders. The newer folders are the better source.

| Wanted | File(s) | Shape |
|---|---|---|
| **Steps** | `Google Health/Physical Activity_GoogleData/Steps/steps_YYYY-MM-01.csv` (one file per month, about 98 files) and a `steps_readme.txt` | `timestamp,steps,data source`: one row per recorded interval (about a minute), UTC timestamps, tens of thousands of rows per year |
| **Sleep** | `Google Health/Health Fitness Data_GoogleData/UserSleeps_*.csv` (one file per year, about 1,080 sleeps in total, 2017 to 2026) and `UserSleepStages_*.csv` | `UserSleeps`: `sleep_id, sleep_type (CLASSIC or STAGES), minutes_in_sleep_period, minutes_after_wake_up, minutes_to_fall_asleep, minutes_asleep, minutes_awake, minutes_longest_awakening, minutes_to_persistent_sleep, start_utc_offset, sleep_start, end_utc_offset, sleep_end, data_source, ...` (UTC times plus an offset such as `-05:00`). `UserSleepStages`: one row per stage (`AWAKE`, and presumably light, deep, REM) with start and end |
| **Workouts** | `Google Health/Health Fitness Data_GoogleData/UserExercises_*.csv` (one file per year) | `exercise_id, exercise_start, exercise_end, utc_offset, activity_name, log_type, ...` and `tracker_total_calories, tracker_total_steps, tracker_total_distance_mm, tracker_avg_heart_rate, tracker_peak_heart_rate, ...` (the header continues past what was read; not every column was checked). A year had a few hundred rows (walks, sport, weightlifting, "Workout", bikes, runs) |
| Older workouts | `Fit/Activities/*.tcx` (about 1,467 files) and `Fit/All Sessions/*.json` (about 1,970) | the Google Fit era, 2017 to 2018 onward; not needed if `UserExercises` covers the same period (not checked) |
| Daily totals (old) | `Fit/Daily activity metrics/*.csv` (about 2,741 daily files) | the Fit-era daily summary; not examined |

## 3. Things that will make the import harder than it looks
1. **Steps come from several sources at once and would be counted twice.** The `data source` column holds, across all months: `Charge 2` and `Versa 2` (old Fitbit watches), `Fit Health Connect`, `Phone Health Connect` and `Google Health App`. In one recent month two sources (`Fit Health Connect` and `Phone Health Connect`) both have rows, and on at least one day only one of them has data. Adding every row would over-count. The import needs a rule, for example "per day, use the source with the largest total" or "prefer the watch over the phone", decided by the owner after seeing real days. **Not decided.**
2. **Steps have no timezone.** Timestamps are UTC with no offset column, while sleep and exercise carry an offset. A "day" boundary needs the owner's timezone (the device's) and will be slightly wrong around travel or daylight saving.
3. **Volume.** Steps are about 75,000 to 145,000 rows per source over the years, minute by minute; the diary needs a daily total, so the import should add up per day in memory and store only the daily number, never the minute rows.
4. **Sleep: which night does a sleep belong to?** A sleep that starts at 23:00 and ends at 07:00 spans two calendar days. The usual rule is to assign it to the day it **ends**. Naps and several sleeps in one night are possible (`sleep_type` CLASSIC versus STAGES also differ in detail).
5. **Workouts overlap with steps and calories.** Calories burned in an exercise are part of the day's calories burned; the import should not add them twice (the export also has daily calorie series that are very large and not needed).
6. **Data generations overlap.** The same period can appear in both `Fit/...` and `Google Health/...`; pick one source per data type (the newer `Google Health` files look complete from 2017 for sleep).
7. **The export is large and clumsy** (as the owner said). The import should read the zip or the individual CSVs straight in the browser, take only the three data types, and never upload anything.

## 4. A first design for the import (a proposal, not a decision)
- A new **"Import from Google Health"** action in Settings that accepts the Takeout zip (read in the browser, for example with a small unzip step; the project has no dependencies, so the zip reading is itself a decision: the browser has no built-in zip reader, so either the owner picks the individual CSV files, or a small vendored unzip is added like `zxing.min.js`, D21) or the individual files `steps_*.csv`, `UserSleeps_*.csv`, `UserExercises_*.csv`.
- Daily records stored per date: `steps`, `sleepMinutes` (and maybe bed and wake times), and a list of workouts (`activity`, start, minutes, calories, steps, average heart rate). Saved shape change (a schema bump, a record type in `sync-records`, merge rules), designed in a spec.
- Re-importing a newer export must be safe (idempotent: same day replaced by the newer import, by import time).
- Display: steps and sleep on the day summary, workouts as a list, all clearly labelled as imported.

## 5. Decisions needed from the owner
1. **The step-source rule** (item 3.1): after the first import, show you a few days with the totals per source so you can say which one matches the Google Health app.
2. **Zip or CSV files:** is choosing three kinds of CSV file acceptable, or should the app read the zip itself (adds a small unzip library to the project)?
3. **How far back to import:** all years (2017 onwards) or only the last year or two?
4. **Where your timezone comes from:** the phone's current timezone is fine for most days; acceptable?
5. After the import works, the **automatic route** (the Google Health API with a small backend, see google-health.md) is the next, separate step.

## 5b. The owner's answers (2026-11-13)

1. **Step-source rule:** the owner agreed to pick it after seeing real days. In the last 12 days of the sample only two sources have data, the **phone** (`Phone Health Connect`, low and often small) and the **watch** (`Versa 2`, higher almost every day). Proposed default: per day, use the source with the larger total (almost always the watch), with the rule kept in one small function so it is easy to change. **Confirmed (2026-11-13):** the owner gave the numbers the Google Health app shows for five days; with the export's UTC times converted to local time (US Central, UTC-6 in November) the **watch** matches the app exactly on two of the five days and within 3 to 125 steps on the other three (small differences from a day boundary or a later sync), while the phone alone and the phone-plus-watch sum do not match. So the rule is: **per local day, use the source with the larger total (the watch)**, and the day boundary must be **local time**, not UTC (a UTC day was off by thousands of steps).
2. **Upload the zip.** The app reads the Takeout zip itself in the browser (a small vendored unzip, like `zxing.min.js`, D21), takes only the three data types and never uploads anything. A **CSV import for other apps** that export CSV is wanted later and goes further down the backlog.
3. **Import the last year by default**, with an option to import all years.
4. **Timezone: the device's current timezone** is fine.

## 6. Not verified
Only file names, a few headers and aggregate counts were read; the full `UserExercises` header, the sleep stage names, the calorie fields and the Fit-era daily files were not examined. How the step sources overlap day by day was seen on one month only. No import code was written and none of the owner's values were copied.
