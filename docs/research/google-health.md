# Google Health (the app that replaced Fitbit): steps, workouts and sleep (research, no code)

*Backlog item 18. Written 2026-11-13. Research only: nothing here is built, no Google Cloud project or account was created, nothing was added to the app. Facts come from web searches (listed at the end). Many are from third-party blogs and vendor pages; a few come from Google's own pages as shown in search results, and I could not open those pages directly. **Re-read Google's own documentation before building anything**, especially the dates and the app-verification rules. Anything marked "estimate" or "not verified" is exactly that.*

## 1. What is going on at Google (as of the sources below)
- **The app.** Google announced on 2026-05-07 that the Fitbit app becomes the **Google Health app** (switch from 2026-05-19, per a Google help page and most news coverage; one Wikipedia line says June). Fitbit Premium became Google Health Premium. Standalone Fitbit accounts had to move to a Google account. The app can collect data from Fitbit devices, Pixel Watches, **Health Connect**, Apple Health and some third-party apps. Google Fit is to be merged in later.
- **The old developer API is ending.** The **legacy Fitbit Web API** is the route most older guides describe. Google's developer pages say support ends **2026-09-30** and that it is turned **off on 2026-10-30**; one analysis says the date moved again to about 2026-11-02. **Today is 2026-11-13, so the Fitbit Web API is probably already off.** Do not build on it.
- **The successor is the Google Health API** (`developers.google.com/health`). It is a new API, not a rename: old tokens do not carry over, users must consent again, and the OAuth libraries differ.
- **Google Fit's APIs** (REST and others) are said to be supported only until the end of 2026, with no exact date published. Not a route to build on.

## 2. The routes, for a web app with no server of its own
**A. Google Health API (the official successor).** Has the data we want: **steps** (per-minute and daily roll-ups), **exercise sessions** (workouts with type, duration, laps, summary metrics such as active energy and distance) and **sleep** (classic and stages logs). Scopes look like `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly` and `...googlehealth.sleep.readonly`. A third-party listing counts about 44 data types; the official data-types page is the authority.
- **Sign-in.** Google's own codelabs create a *Web application* OAuth client and send a **client secret** with the token exchange. A pure in-browser sign-in (Google Identity Services' token flow) gives short-lived access tokens with no refresh token (that is how Google describes the client-side flow, from older documentation); whether the Health API accepts that flow and its health scopes in a browser app is **not verified**. A secret must never sit in this repo or in the page, so the realistic design is a **small backend function** (the project already uses one optional serverless function for recipe import, D29) that holds the secret and the refresh token.
- **Verification.** Most Health API scopes are **restricted**. An unverified app is **capped at 100 users** and, per Google's pages, in testing mode refresh tokens last **7 days**, so a personal app would need you to sign in again weekly unless the app is verified. Verification for restricted scopes involves Google's review and, above 100 users, an annual third-party security assessment (CASA). Whether a single-user personal app can avoid verification is **not clear from what I found**. This is the biggest open risk.
- **Rate limits** are generous (about 300 requests per user per minute, far more than a diary needs).
- **CORS / browser calls:** not found in my sources. **Not verified.**

**B. Health Connect (Android).** The on-device store that the Google Health app, Pixel Watch and many apps write to. It is **Android-only** and read through a **native Android API**, per app and per data type with user permission; there is no web API. A web page cannot read it. It would need a **native Android app or a helper app** that reads Health Connect and sends the numbers to the backend. The project has no native code and native apps are marked "not planned" (VISION question 4), so this is a large step.

**C. Export file import (Google Takeout or the app's own export).** No developer account, no secret, nothing to run: the owner exports data from Google and imports the file into the app. Sources disagree on the formats: Takeout is reported to contain **JSON for sleep and resting heart rate and CSV for steps** in a physical-activity folder, with no date filter, while the app's own export is limited to short date ranges (one guide says 31 days) and can give CSV or JSON. Where **workout** data sits in Takeout is **not confirmed** (one forum post could not find any). It is manual and always out of date, but it is the lowest-risk first step and suits the app's offline, no-server design.

**D. A third-party aggregator** (companies such as Terra, Junction, Sahha and Validic sell one API over many wearables). They solve sign-in and verification for you but cost money, add a company that sees your health data, and change the privacy position. Not recommended for a private diary.

**E. Google Fit.** Ending in 2026. Skip.

## 3. Privacy and the app's principles
Health data is sensitive (VISION principles: the user's data stays theirs). Anything fetched through an API passes through a backend or Google's servers by definition. Option C keeps everything on the device unless the user turns on sync. Whatever is stored should be opt-in, and if it syncs it goes only into the user's own Supabase project like the diary (readable only by them). Never put tokens, secrets or the Google client secret in the repo or the saved diary.

## 4. What would change in the app (any route)
- **Saved shape:** new per-day data (steps, active calories, workouts, sleep minutes) that must sync and merge like the diary: a schema bump with a migration, a record type in `sync-records`, merge rules, and backup and export handling. It needs its own spec.
- **UI:** the Diary summary could show steps and active calories, a small sleep line, and a workout list. Whether the calorie goal should account for activity is a separate decision and touches the "Medical or dietary advice" non-goal (VISION section 7).
- **Meaning of numbers:** estimated calories burned differ between devices; show them as reported, never as advice.

## 5. Recommendation
1. **Start with C, a file import** (steps, sleep and workouts as far as the export provides them): no accounts, no secrets, no verification, works offline. The first task is to look at a **real export from the owner's own Google Health app** to see which files and fields exist; the spec should be written from that real sample.
2. **Only if the owner wants it automatic,** consider A (the Google Health API) with a small backend function, after settling the verification question (can a personal app be used for long without verification, and are 7-day refresh tokens acceptable). Do not start with Health Connect: it needs a native Android app.
3. Skip D and E.

## 6. Decisions needed from the owner
1. **Is a manual import (export a file from the Google Health app, import it here) good enough to start with?** (My recommendation: yes.)
2. **Would you accept signing in again about every week** if the automatic route stays unverified, or is verification with Google something you are willing to go through?
3. **Which data first:** steps, workouts, sleep, or all three? Should steps and calories burned show next to the calorie goal, or only as information?
4. **Which phone** do you use (Android or iPhone)? That decides whether Health Connect is even possible later.
5. Can you export your data from the Google Health app and put a **sample file** where I can read it, with dates and names removed if you like?

## 6b. The owner's answers (2026-11-13)

1. **A manual import is acceptable as a first step**, but the owner notes that exporting is not simple: it means going to Google Takeout and selecting the data each time. So the import is a stepping stone to learn the data shape, not the end goal.
2. **A weekly sign-in is acceptable**, so the automatic route (the Google Health API in an unverified, testing-mode Google Cloud project, with the owner as the one test user, plus a small backend function holding the secret) is a real option, not ruled out by the verification rules. It is still **not verified** that the API can be used this way (see section 7).
3. **All three data types** (steps, workouts, sleep). Once the data can be read, adding the others is expected to be easy; the spec should still be written from real samples.
4. **Android phone.** Health Connect exists there (native-only), but it is not needed if the Google Health API route works.
5. **The owner is waiting for Google to send the Takeout export** (sample file for the spec).

**Plan this implies.** (a) When the Takeout file arrives, read it to see the real file layout and fields for steps, workouts and sleep. (b) Write the spec from that sample and build the import first (it is the cheapest way to prove the data shape and the per-day storage, sync and display). (c) Then research and try the automatic route in a small, separate step: a Google Cloud project in testing mode with the owner as the test user, one backend function for the token exchange and refresh, and a check that a browser app can call the API at all. The item stays research-only until the sample arrives.

## 7. Not verified
Google's own current pages were not opened; every date above comes from search snippets and third-party posts (the Fitbit Web API shutdown date moved at least twice). Whether the Health API works from a browser (CORS, token flow), whether a single-user app can stay unverified and what the refresh-token lifetime would be, the exact Takeout file layout for workouts, and the exact steps in the Google Health app's export menu.

## Sources
- Google Health replaces Fitbit: [9to5Google, 2026-05-07](https://9to5google.com/2026/05/07/google-health-app-fitbit/), [Google Health Help: redesigned app](https://support.google.com/googlehealth/answer/17068213?hl=en), [Thurrott](https://www.thurrott.com/google/336407/google-health-starts-replacing-fitbit-app-on-ios-and-android)
- Fitbit Web API shutdown and migration: [Google: migration guide](https://developers.google.com/health/migration), [Google: API specifications](https://developers.google.com/health/migration/api-specifications), [Sahha: Fitbit API sunset](https://sahha.ai/blog/fitbit-api-sunset-migration/), [Thryve](https://www.thryve.health/blog/fitbit-api-deprecation), [Validic](https://help.validic.com/space/VCS/5513478151/Fitbit+to+Google+Health+API+Developer+Transition+Guide)
- Google Health API: [data types](https://developers.google.com/health/data-types), [workouts](https://developers.google.com/health/data-types/workouts), [scopes](https://developers.google.com/health/scopes), [set up Google Cloud and OAuth](https://developers.google.com/health/setup), [app verification](https://developers.google.com/health/app-verification), [rate limits](https://developers.google.com/health/rate-limits), [first API call codelab](https://developers.google.com/health/codelabs/make-your-first-api-call)
- Health Connect: [Google help](https://support.google.com/android/answer/13770320?hl=en), [Android developers blog](https://android-developers.googleblog.com/2022/05/introducing-health-connect.html?hl=en)
- Export formats: [Takeout guide for Fitbit data](https://takeoutday.org/guides/fitbit-data-export), [FME tutorial](https://support.safe.com/hc/en-us/articles/43859714941197), [export Fitbit data after Google](https://www.fitmesh.fit/en/blog/export-fitbit-data-after-google)
- Google Fit end of life: [Sahha: Google Fit API sunset](https://sahha.ai/blog/google-fit-api-sunset-migration/), [Wikipedia](https://en.wikipedia.org/wiki/Google_Fit)
- OAuth in browsers: [OAuth 2.0 for client-side web applications](https://developers.google.com/accounts/docs/OAuth2UserAgent), [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/how-user-authz-works)

## 8. Update 2026-11-14: Google's own pages read, and a CORS check (item 20)

*Written after reading Google's developer pages directly (setup, scopes, app-verification, data-types, workouts, codelab, rate-limits, migration, aggregate-data, endpoints, data-management) and sending one unauthenticated CORS preflight request from this computer. No Google Cloud project, account or token was created; no health data was read.*

### What is now confirmed
- **The API.** Base `https://health.googleapis.com/v4`, always `users/me`, `Authorization: Bearer <access token>`. The legacy Fitbit Web API and its OAuth endpoints were turned off on 2026-11-02 (Google's overview), so it is not an option.
- **Scopes (prefix `https://www.googleapis.com/auth/googlehealth.`).** Steps and exercise: `activity_and_fitness.readonly`. Sleep: `sleep.readonly`. GPS routes (the TCX of a run): `location.readonly`. Google says most scopes are *restricted* and need verification for more than 100 users.
- **Steps per day.** `POST .../users/me/dataTypes/steps/dataPoints:dailyRollUp` with a civil (local-clock) date range, end exclusive, `windowSizeDays: 1`; the result is `steps.countSum` as text. Daily roll-ups follow the user's local clock and handle 23 and 25 hour days, which matches the local-time days the app uses. A day with no data omits the field; a worn day with no steps returns "0" (so "no data" and 0 stay different, like the dials).
- **Sleep.** `GET .../dataTypes/sleep/dataPoints` (every stored record, overlaps included) or `:reconcile` (overlapping records merged into one "main" record, which is what Google's own app shows). A record has start and end with UTC offsets, `summary.minutesAsleep`, `minutesAwake`, stages, `createTime`, `updateTime` and `metadata.main`. Sleep has no daily roll-up, so the app would assign a sleep to the local day it ends, as the zip import does (D55). Page size is at most 25.
- **Workouts.** `GET .../dataTypes/exercise/dataPoints` (filter on `exercise.interval.civil_start_time`): type (for example RUNNING), start and end with offsets, `activeDuration`, `metricsSummary` (calories, distance in millimetres, steps, average heart rate, pace), `hasGps`. `GET .../exercise/dataPoints/{id}:exportExerciseTcx?alt=media` returns the TCX file of a run (needs the location scope), the same kind of file the owner exported by hand on 2026-11-14 (a 30-minute run with GPS, heart rate, distance and calories).
- **Limits.** 300 requests per user per minute; roll-up spans up to 90 days per request for steps; no charge or API key mentioned (OAuth only).
- **Unverified apps.** Capped at 100 users. In Testing mode refresh tokens last **7 days** (the owner already accepts a weekly sign-in). Google's pages mention no personal-use exemption. The consent screen shows an "app is not verified" warning that the owner clicks through.
- **Before the first sign-in** the user must have the Google Health mobile app installed and signed in; a call to `users/me/identity` returns `ACCOUNT_NOT_LINKED` otherwise.
- **No sandbox.** Everything is production data.

### Can the browser call it? Yes for the API; sign-in is the open point
- **CORS works.** An unauthenticated `OPTIONS` preflight from the origin `https://ahaselden.github.io` to the daily roll-up URL and to `https://oauth2.googleapis.com/token` both returned `200` with `Access-Control-Allow-Origin` for that origin, methods including POST, and `authorization,content-type` allowed. So a page on GitHub Pages can call both the data API and the token endpoint without a proxy (this proves the headers, not that every real request succeeds).
- **Sign-in without a secret is not shown.** Every flow Google documents for this API (setup, codelab) uses a *Web Server* OAuth client and sends the **client secret** when exchanging the code and when refreshing. Google's pages say nothing about PKCE, the implicit or token flow, or secretless clients for this API. A secret must never be in the repository or the page.

### Three designs
1. **A small backend holds the secret (recommended for a first try).** One function in the owner's own Supabase project (the recipe import function, D29, is the model) does only two jobs: exchange the sign-in code and refresh tokens, keeping the refresh token in a Supabase table only the owner can read. The page asks the function for a fresh access token, then calls `health.googleapis.com` directly from the browser (CORS works), so health data never passes through the function. Costs: the owner deploys a function and a table, creates a Google Cloud project in Testing mode (the owner as the only test user), and signs in again every 7 days.
2. **Browser-only with Google Identity Services.** No backend and no secret, but only 1-hour access tokens and no refresh token, so a Google popup on every visit. **Whether Google lets the Health API's scopes be used this way is not documented**; the only way to find out is to try it with a real project. A 30-minute experiment once the project exists, because if it works it is much simpler (nothing to deploy).
3. **Health Connect (Android native).** Not needed now that the API route is documented; skip.

### What would be built (each part needs its own spec, tests and review, per the workflow)
1. **Set-up the owner does once (not code):** a Google Cloud project, enable the Google Health API, a Web Server OAuth client, the read-only scopes, the owner's email as the test user, and the Google Health app linked. A walk-through in a setup doc, like `docs/SYNC-SETUP.md`.
2. **Backend function and table** (token exchange and refresh only; the client secret in the function's secrets). Supabase migrations are forward-only files that deploy to the real database when merged, so these need extra care.
3. **App sign-in and refresh:** a "Connect Google Health" card in Settings (opt-in, shows the connection state and when the sign-in lapses), a pure mapper from API responses to the existing per-day `activity` records (steps, sleepMinutes, sleepStart, sleepEnd, workouts) so the dials, the activity line and sync keep working unchanged, a "refresh now" action and an automatic refresh when the Diary opens.
4. **Workouts:** show a run's duration, distance, calories and heart rate in the Diary. Optional later: a route from `exportExerciseTcx`.
5. **Check against the zip import** on the owner's real data (Takeout numbers 7h34 / 8h11 / 7h22 for Nov 11 to 13). The API's `reconcile` sleep should match Google's app directly, which would make the D55 overlap rules unnecessary on this route.

### Decisions needed from the owner
1. **OK to create a Google Cloud project** in the owner's own Google account (Testing mode, the owner as the only user) and to deploy a small function to the owner's Supabase project? Both are done by the owner, not by the assistant.
2. **Try the browser-only sign-in first?** It would remove the backend if Google allows it, but needs the same Google Cloud project to test.
3. **Which data first:** steps and sleep (small, matches the dials) before workouts, or all three together?
4. **Weekly re-sign-in confirmed?** (7-day refresh tokens in Testing mode; the owner has said this is acceptable.)

### Still not verified
Whether a browser-only token flow is allowed for these scopes; the exact `:reconcile` response on the owner's real data; whether a personal unverified app keeps the 7-day rule and how long the "not verified" warning keeps appearing. All of these need a real Google Cloud project.

### Sources for this section
[setup](https://developers.google.com/health/setup), [scopes](https://developers.google.com/health/scopes), [app verification](https://developers.google.com/health/app-verification), [data types](https://developers.google.com/health/data-types), [workouts](https://developers.google.com/health/data-types/workouts), [aggregate data](https://developers.google.com/health/aggregate-data), [endpoints](https://developers.google.com/health/endpoints), [data management](https://developers.google.com/health/data-management), [rate limits](https://developers.google.com/health/rate-limits), [first API call codelab](https://developers.google.com/health/codelabs/make-your-first-api-call), [migration](https://developers.google.com/health/migration). CORS check: an `OPTIONS` request from this computer on 2026-11-14.
