# Macro Diary

A calorie and macro tracker that works as an installable web app on your phone and PC: food lookup from USDA FoodData Central and Open Food Facts, cups/ounces/household measures, sharing and CSV/JSON export, themes, optional device sync, recipes, a weekly meal plan and shopping lists.

Plain HTML/CSS/JavaScript (native ES modules): **no build step, no dependencies**. Your data lives in your browser; sync is optional and goes to *your own* Supabase project.

## Run it
```bash
npm start        # http://localhost:8080  (ES modules need http, not file://)
npm test         # runs the whole suite in under a second, no installs
npm run mock     # optional: a fake Supabase on :54321 for trying sync locally (dev only)
```
Deploys as static files (GitHub Pages). After changing a shipped file, bump `CACHE` in `sw.js` (a test fails if the file list there is out of date).

## The app
| Tab | What it does |
|-----|--------------|
| Diary | Log foods by meal, edit/delete, day totals vs goals, share the day |
| Plan | Week view of planned recipes/foods with calories vs goal; "Log" turns a plan item into a diary entry |
| Recipes | Paste/type ingredients, link them to real foods, see nutrition per serving |
| Shop | Shopping list derived from the plan (aisles, tick off, extras, share/CSV) |
| More | Export (daily/weekly/monthly/yearly CSV, JSON) and Settings (goals, units, themes, API key, **Sync**, backup/restore) |

## Documentation (read in this order)
1. [docs/ROADMAP.md](docs/ROADMAP.md) — what was asked, what was built, **what you need to do next**.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, file map, data shape, how to add things.
3. [docs/DECISIONS.md](docs/DECISIONS.md) — every non-obvious choice and why; items marked *made without the owner* are the ones to challenge.
4. [docs/SYNC.md](docs/SYNC.md) and [docs/SYNC-SETUP.md](docs/SYNC-SETUP.md) — how sync works; step-by-step Supabase setup (the SQL there has not yet run on a real database).
5. [docs/PLANNER.md](docs/PLANNER.md) — recipes, plan, shopping list behaviour.
6. [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) — honest list of open problems and unverified areas.

## Reviewing the history
The work is on branch `refactor/modules`, one commit (or small group) per step — read it with:
```bash
git log --oneline --reverse main..refactor/modules
```
Phases: 0 safety net (golden outputs captured from the original app) → 1-5 refactor into layers → Stage 1 sync-ready data → Stage 2 sync engine → Stage 3a planner data model → Stage 3 recipes → Stage 4 plan → Stage 5 shopping → UI. Pure logic commits come first for each stage; the planner UI is one combined commit because the three screens share the navigation, `index.html` and stylesheet.

## Working with Claude Code in this repo
`CLAUDE.md` holds the rules; `.claude/agents/` has two project agents (`module-extractor`, `regression-reviewer`). Nothing is pushed or deployed by an agent.
