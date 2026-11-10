# Architecture

Macro Diary is a static, installable web app (PWA): plain HTML + CSS + native ES modules. There is **no build step and no runtime dependency**; GitHub Pages serves the files as they are. All user data lives in the browser (`localStorage`, key `macrodiary.v1`).

Run it locally with `npm start` (http://localhost:8080) and test it with `npm test`. ES modules cannot load from `file://`, so double-clicking `index.html` does not work — see [D1](DECISIONS.md#d1-vanilla-es-modules-no-framework-no-bundler).

## Layers

```
          ┌────────────┐
          │    ui/     │  builds HTML, binds events. The ONLY layer that touches the DOM.
          └─────┬──────┘
        ┌───────┴───────┐
        ▼               ▼
┌────────────┐   ┌────────────┐
│ services/  │──▶│  domain/   │   services: network, camera, share sheet, file download
└─────┬──────┘   └─────┬──────┘   domain:   pure logic — no DOM, no storage, no fetch, no globals
      │                │
      ▼                ▼
┌─────────────────────────────┐
│            core/            │   constants, formatting, dates, the state store, the event bus, DOM helpers
└─────────────────────────────┘
```
**Import rule:** arrows only point down. `domain/` may import only `core/constants`, `core/format`, `core/dates`, `core/schema` and other `domain/` files (never `core/dom` or `core/store`). `core/` modules import nothing from the layers above. Why: pure `domain/` code runs in Node, so it is testable without a browser, and features that don't exist yet (recipes, shopping lists) can reuse it. See [D2](DECISIONS.md#d2-strict-layers-ui--services--domain--core).

## Map

| Path | What it does |
|------|--------------|
| `index.html` | Markup only (all screens + the dialog). Loads `css/*` and `js/main.js`. A tiny inline script sets the saved theme before first paint to avoid a flash. |
| `css/base.css` `themes.css` `components.css` | Reset/controls; the 14 colour palettes as `[data-theme=…]` blocks of CSS variables; widgets/layout. |
| `js/main.js` | Boot and wiring only. |
| `js/core/schema.js` | Pure: `defaults`, `migrate` (version steps), `sanitize` (forces untrusted fields to safe types), `SCHEMA_VERSION`. |
| `js/core/store.js` | The single `state` object, load/save, `replace()`. The only place that touches `localStorage`; uses `schema.js`. |
| `js/core/constants.js` `format.js` `dates.js` | Shared constants; `esc`, rounding, `fmtW`, `amtLabel`; local-date helpers. Pure. |
| `js/core/dom.js` `bus.js` | `$`, `toast`, dialog helpers; tiny pub/sub (`on`/`emit`) so screens can react to each other without importing each other. |
| `js/domain/nutrition.js` | Calories/macros of an entry and of a list. |
| `js/domain/units.js` | Which units a food can be entered in (g/oz/lb, servings, household measures, volume units derived from a known density). |
| `js/domain/entries.js` | The only sanctioned way to add/edit/remove diary entries (`addEntry/updateEntry/removeEntry/touchSettings`): stamps `updatedAt`, leaves tombstones on delete; also `validEntry`. |
| `js/domain/merge.js` | `mergeStates(a, b)`: conflict-free last-writer-wins merge of two states (see [D9](DECISIONS.md)). Used by restore now and by sync later. |
| `js/domain/backup.js` | Restore: `validEntry`, `newEntries` (preview count), `mergeRestore` (sanitise the file, then `mergeStates` preferring this device on ties). |
| `js/domain/reports.js` | Daily/weekly/monthly/yearly ranges, roll-ups, CSV/JSON export contents. |
| `js/domain/summary.js` | The "share my day" text. |
| `js/domain/recipes.js` `ingredient-parse.js` `ingredient-tokens.js` | Recipes: text → ingredient parsing, grams resolution, nutrition per serving, save/delete/search/scale ([PLANNER.md](PLANNER.md)). |
| `js/domain/plan.js` | The weekly plan: add/copy/clear, per-day nutrition, idempotent log-to-diary. |
| `js/domain/shopping.js` | Shopping list derived from plan + recipes; aisles; ticks/extras; text/CSV. |
| `js/domain/sync-records.js` | State ⇄ sync records (`day:…`, `recipe:…`, `plan:…`, `settings`, …) and record hashing ([SYNC.md](SYNC.md)). |
| `js/domain/food.js` | `foodKey` — identity of a food across sources. |
| `js/services/http.js` | `getJSON` with timeout and friendly errors. |
| `js/services/usda.js` `off.js` `foods.js` | USDA FoodData Central and Open Food Facts lookups, mapping their responses to our food shape, and `searchAll` which queries both and interleaves results. |
| `js/services/sync/*.js` | Sync: `engine.js` (pull→merge→push), `index.js` (service: config, sign-in, debounce), `config.js`, adapters `supabase-adapter.js` / `memory-adapter.js`. |
| `js/services/share.js` `files.js` `barcode.js` | Share sheet/clipboard and the day image; file download; camera barcode scanning. |
| `js/ui/*.js` | One module per screen/dialog (incl. `recipes-view`, `recipe-editor`, `plan-view`, `shop-view`, `sync-view`): `diary`, `add-food`, `custom-food`, `amount-picker`, `export-view`, `settings-view`, `restore-dialog`, `theme`, `tabs`, `share-result`; `ctx.js` holds unsaved UI state. |
| `sw.js` `manifest.webmanifest` | Offline cache and installability. |
| `tests/` | `node:test` suites. `tests/golden/` + `tests/fixtures/` are outputs/inputs captured from the original single-file app; the modules must reproduce them exactly ([D3](DECISIONS.md#d3-golden-file-tests-captured-from-the-original-app)). |

## How data flows

1. A user action in a `ui/` module changes `state` (e.g. the amount picker pushes an entry) and calls `save()`.
2. The module then `emit('diary:changed')`. `ui/diary.js` is subscribed and re-renders. Nothing imports the diary to do this, so there are no circular imports.
3. Replacing everything (restore/wipe) goes through `replace()`, which keeps the same `state` object so every module's reference stays valid ([D4](DECISIONS.md#d4-application-state-is-one-mutable-object-state-replaced-via-replace)), then emits `settings:changed` and `diary:changed`.
4. `save()` writes JSON to `localStorage`; if that fails (storage full/blocked) `store.onSaveError` shows a toast.

## Data shape (schema v5)

```
state = {
  schemaVersion: 5,
  theme: 'auto' | 'dark' | …,   weightUnit: 'g' | 'oz',            // theme, apiKey, recent: per-device, never synced (D10)
  goals: { k, p, c, f },        apiKey, useUSDA, useOFF,
  settingsUpdatedAt: ms,                                             // stamps the synced settings as ONE record
  days: { 'YYYY-MM-DD': [ entry, … ] },
  tombstones: { entryId: deletedAtMs },                              // so deletions propagate between devices
  recent: [ food, … ],  custom: [ food (+updatedAt), … ],
  measures: { foodKey: [ { label, g, updatedAt } ] },
  recipes: { id: recipe },                                           // see recipe / ingredient below
  plan: { 'YYYY-MM-DD': { updatedAt, slots: { Breakfast|Lunch|Dinner|Snacks: [ item ] } } },
  shopping: { checks: { itemKey: { on, updatedAt } }, extras: { id: { id, text, on, updatedAt } } }
}
entry = { id, updatedAt, meal, name, brand, source, per100: {k,p,c,f}, servingG, servingLabel, fdcId, portions,
          grams, unitKey, amount, disp }
```
History: v1 = original app, v2 = added `schemaVersion`, v3 = tombstones/`settingsUpdatedAt` and `updatedAt` on edited records, v4 = recipes/plan/shopping ([D13](DECISIONS.md)), v5 = `recipe.favorite` boolean ([D26](DECISIONS.md)). Planner shapes: `recipe = {id, name, description, source, servings, totalTime, tags[], steps[], ingredients[], favorite, updatedAt}`; `ingredient = {id, raw, name, qty, unit, prep, food|null, grams|null}`; plan `item = {id, type: "recipe"|"food", recipeId, servings, name, food, grams}`. Missing `updatedAt` means 0 ("older than any real edit"), so upgrading rewrites nothing. Changes to entries must go through `domain/entries.js` so they are stamped and deletions leave tombstones.

Nutrition is stored **per 100 g** and an entry stores the grams eaten, so changing units never changes the calories. `disp` ("1.5 cup") remembers how the user entered it.

## Security notes
- Everything that came from a database, a file or the user is escaped with `esc()` before it goes into HTML; numbers are coerced.
- A restored backup is passed through `sanitize()` (goals must be finite non-negative numbers, units/theme must be known values) so a crafted file can't smuggle markup via fields that are rendered ([KNOWN-ISSUES #1](KNOWN-ISSUES.md)).
- CSV cells starting with `= + - @` are neutralised against spreadsheet formula injection.
- The USDA key is typed by the user and stays in their browser; nothing secret is in the repo.

## Recipes

**Add a food database:** write `services/<name>.js` exporting `search<Name>(q, …)` and a `map<Name>` that returns our food shape (`{name, brand, source, per100:{k,p,c,f}, servingG, servingLabel}`); add a golden-style mapper test with a recorded sample; add it to `services/foods.js#searchAll` and a toggle in Settings.

**Add a screen/tab:** add its markup section + a `nav.tabs` button in `index.html`; create `ui/<screen>.js` exporting `render…` and `init…`; in `init…` call `registerTab('<name>', onShow)` (from `ui/tabs.js`); call `init…` from `main.js`. Put any calculation in `domain/` with tests.

**Change the saved shape:** bump `SCHEMA_VERSION`, add a step to `migrate()` in `core/store.js`, add a test that loads the previous version's fixture and checks nothing is lost. Never change `STORAGE_KEY`.

**Release:** `npm test`; bump `CACHE` in `sw.js` (and add any new files to its precache list); commit; push; GitHub Pages redeploys.
