# Headless browser tester (dev only)

Runs the app in a headless Edge or Chrome of its own, so it never touches your own browser or the Claude browser pane. It is **not shipped** and the app itself still has no dependencies: this folder has its own `package.json`, and the root `npm test` does not need it.

## Install (once)
```
cd tools/browser-test
npm install
```
This downloads only `playwright-core` (a small library). It does not download a browser: it uses the Microsoft Edge that comes with Windows, or Google Chrome if Edge is not found. If neither starts you get a clear message.

## Run
From the repository root:
```
node tools/browser-test/run.mjs                      # every scenario in scenarios/
node tools/browser-test/run.mjs scenarios/smoke.mjs  # one scenario
node tools/browser-test/run.mjs --device "iPhone 13" # phone-sized screen and touch (still desktop Chromium)
node tools/browser-test/run.mjs --headed             # show the window, to watch
```
The app is served on a free port and stopped at the end. Exit code 1 means something failed; failing scenarios save a screenshot (the path is printed).

## How a scenario works
`scenarios/*.mjs` each `export default async ({ page, url, check, screenshot }) => {...}`. They may also `export const stubs = [{ match, json }]` (see `stubs.mjs`). **Every HTTP(S) request and WebSocket that the page makes to anywhere but the app is blocked unless a stub answers it**, so a scenario cannot reach Open Food Facts, USDA or Supabase; stubs use invented data. (The browser's own background traffic, such as Edge telemetry, is not controlled.) Scenario files are run as code: only run ones you trust. A page error or console error fails the scenario.

## NOT covered (still needs a real phone)
- The real camera, barcode quality in real photos, glare and blur (the browser has a fake camera feed only).
- The screen wake lock, installing the app, the service worker (it is blocked here on purpose) and iPhone Safari (this uses Chromium, not WebKit).
- Real food-database data (USDA, Open Food Facts) and the live sync backend.
- Real performance on a phone.
