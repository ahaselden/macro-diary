# Macro Diary

Calorie/macro tracker, installable PWA, vanilla JS (ES modules, **no build step, no dependencies**).
Live on GitHub Pages (`ahaselden/macro-diary`). Data lives in the browser (`localStorage` key `macrodiary.v1`) — **never change that key or break the saved shape without a migration in `js/core/store.js`**.

## Commands
- `npm start` — local dev server on http://localhost:8080 (ES modules do not load from `file://`)
- `npm test` — `node --test tests/` (no deps)

## Architecture (layers; imports only point downward)
`ui → services, domain, core` · `services → domain, core` · `domain → core/{constants,format,dates,schema} + domain only` · `core → nothing`
- `js/core/` state store, dates, formatting, DOM helpers, constants
- `js/domain/` **pure** logic (no DOM, no storage, no globals; functions take state/args): nutrition, units, backup/merge, reports/CSV
- `js/services/` talks to the outside world: USDA, Open Food Facts, barcode, share, file download
- `js/ui/` one module per screen/dialog; builds HTML (always `esc()` anything from a database or file) and handles events
- `js/main.js` boot + wiring only
- `tests/golden/*.json` outputs captured from the **original single-file app**; `tests/fixtures/` their inputs. Modules must reproduce them exactly.

## Rules
- Refactors are behaviour-preserving. A bug found mid-refactor is logged, not silently fixed.
- Keep domain functions pure so they stay testable; put anything touching `document`, `localStorage`, `fetch` in `core/`, `services/` or `ui/`.
- Escape all external text before inserting into HTML (`esc`); CSV cells starting with `= + - @` are neutralised (`csvCell`).
- Service worker (`sw.js`): after changing any shipped file, bump `CACHE` so phones pick up the update, and keep the precache list in sync.
- Do not commit secrets. The USDA key is entered by the user in Settings and stays in their browser.

## Status
Mid-refactor from a single `index.html` into modules (branch `refactor/modules`). See the approved plan in the session history; meal planner is deferred.
