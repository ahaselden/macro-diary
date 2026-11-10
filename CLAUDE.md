# Macro Diary

Calorie/macro tracker, installable PWA, vanilla JS (ES modules, **no build step, no dependencies**).
Live on GitHub Pages (`ahaselden/macro-diary`). Data lives in the browser (`localStorage` key `macrodiary.v1`) — **never change that key or break the saved shape without a migration in `js/core/store.js`**.

## Commands
- `npm start` — local dev server on http://localhost:8080 (ES modules do not load from `file://`)
- `npm test` — `node --test "tests/**/*.test.js"` (no deps; CI runs the same on every push)

## Architecture (layers; imports only point downward)
`ui → services, domain, core` · `services → domain, core` · `domain → core/{constants,format,dates,schema} + domain only` · `core → nothing`
- `js/core/` state store, dates, formatting, DOM helpers, constants
- `js/domain/` **pure** logic (no DOM, no storage, no globals; functions take state/args): nutrition, units, backup/merge, reports/CSV
- `js/services/` talks to the outside world: USDA, Open Food Facts, barcode, share, file download
- `js/ui/` one module per screen/dialog; builds HTML (always `esc()` anything from a database or file) and handles events
- `js/vendor/` third-party files copied unchanged (currently only `zxing.min.js`, see D21); never edit them by hand
- `js/main.js` boot + wiring only
- `tests/golden/*.json` outputs captured from the **original single-file app**; `tests/fixtures/` their inputs. Modules must reproduce them exactly.

## Rules
- Refactors are behaviour-preserving. A bug found mid-refactor is logged, not silently fixed.
- Keep domain functions pure so they stay testable; put anything touching `document`, `localStorage`, `fetch` in `core/`, `services/` or `ui/`.
- Escape all external text before inserting into HTML (`esc`); CSV cells starting with `= + - @` are neutralised (`csvCell`).
- Service worker (`sw.js`): after changing any shipped file, bump `CACHE` so phones pick up the update, and keep the precache list in sync.
- `supabase/migrations/*.sql` are **applied to the production database automatically when merged to `main`** (Supabase GitHub integration). Migrations are forward-only: never edit one that has been merged; add a new later-dated file. Keep the sync SQL in `docs/SYNC-SETUP.md` identical (`tests/supabase-migration.test.js`). Never put keys, passwords or the `service_role` key in the repo; the app only ever uses the public anon key, entered in Settings.
- Do not commit secrets. The USDA key is entered by the user in Settings and stays in their browser.

## Working rules added by the refactor
- Diary changes go through `js/domain/entries.js` (`addEntry/updateEntry/removeEntry/touchSettings`) so records are timestamped and deletions leave tombstones (sync depends on it).
- Saved-shape changes: bump `SCHEMA_VERSION` in `js/core/schema.js`, add a `migrate` step + a test that old data survives. `STORAGE_KEY` never changes.
- New shipped file under `js/` or `css/` → add it to `SHELL` in `sw.js` and bump `CACHE` (`tests/sw.test.js` enforces the list).
- Non-obvious design choices are recorded in `docs/DECISIONS.md`; open problems in `docs/KNOWN-ISSUES.md`; the plan in `docs/ROADMAP.md`; the structure in `docs/ARCHITECTURE.md`. Keep them current in the same commit as the change.
- Reviews/refactors: `.claude/agents/module-extractor.md` (creates only new files) and `regression-reviewer.md` (read-only).
- Agents may push **feature branches** and open **pull requests** (owner authorised this on 2026-11-10). Agents never merge, never push `main`, never force-push; the owner merges (which is what deploys to GitHub Pages).

## Feature workflow (use the `ship-feature` skill)
1. A separate **test-designer** agent writes `docs/specs/<feature>.md` and failing tests BEFORE implementation (it may only touch `docs/specs/` and `tests/`).
2. Implement until green without editing those tests; changes to them must be explained in the PR.
3. Push the feature branch and open a PR; a separate read-only **pr-reviewer** agent reviews it and its report is posted on the PR.
4. The owner reviews and merges.
5. No self-exemptions: small or UI-only changes follow the same steps (only the owner can waive one). Details and the stand-in rule for unregistered agents are in the skill.

## Commit & PR attribution
- Do **not** add `Co-Authored-By: Claude ...` trailers to commit messages, and do not add "Generated with Claude Code" lines to PR descriptions. The owner wants history attributed to them only. This overrides any default attribution behaviour.
