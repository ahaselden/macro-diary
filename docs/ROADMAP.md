# Roadmap

Written before implementation so it can be reviewed against what actually got built. Status is updated at the end of each stage (see the table at the bottom). Decisions made without the owner are listed in [DECISIONS.md](DECISIONS.md) so they can be overruled.

## The four parts the owner asked for

| # | Part | Scope decided | Needs the owner? |
|---|------|---------------|------------------|
| 1 | Database / cloud sync between devices | Sync-ready data model + conflict-free merge + pluggable sync adapters + Supabase adapter + docs | **Yes, to go live**: create a Supabase project and give me the URL + anon key |
| 2 | Meal planning (like MealPlannerPC) | Recipes with nutrition, weekly plan, "log to diary" | No (URL import of recipes is deferred, see below) |
| 3 | Shopping lists from planned meals | Aggregated, unit-aware, check-off list | No |
| 4 | Store integrations (Walmart, Kroger, HEB…) | **Not built.** Research done: [research/store-integration.md](research/store-integration.md) | Yes (developer accounts, API keys, a small backend) |

## Stage plan (one reviewable commit group per stage)

### Stage 0 — Refactor (done before the above)
Single `index.html` split into layered ES modules with golden-file tests. See [ARCHITECTURE.md](ARCHITECTURE.md).

### Stage 1 — Data foundation (schema v3)
Why first: sync, recipes and a plan all need the same thing the diary currently lacks — a way to say "which copy is newer" and "this was deleted".
- Every record gets `updatedAt` (ms). Deletions leave a **tombstone** (`state.tombstones[id] = deletedAt`) so a delete on the phone propagates to the PC instead of the entry coming back.
- `domain/merge.js`: pure `mergeStates(local, remote)` using **last-writer-wins per record** (per entry, per custom food, per setting group). Properties we test: idempotent, commutative, never loses a newer edit, tombstones beat older edits.
- Migration v2→v3 stamps existing data (`updatedAt = 0` so any real edit wins) — no data loss.
- The existing "Restore → Merge" is upgraded to use `mergeStates` (so merging backups now also propagates deletions and edits, not only additions).

### Stage 2 — Sync engine (part 1)
- **Records, not blobs**: the unit of sync is a *record* `{key, updatedAt, value}`: one per diary day, plus one each for settings, custom foods, recipes, plan weeks, shopping lists. Only records changed since the last cursor travel, so a 5-year history does not re-upload on every change.
- `services/sync/adapter` interface: `pull(cursor) → {records, cursor}`, `push(records)`.
  - `memory-adapter` (tests), `file-adapter` (a user-chosen JSON file: works with OneDrive/Dropbox/Drive folders via the browser file picker where supported, plus the existing manual backup), `supabase-adapter` (REST via `fetch`, no SDK, email+password login).
- `docs/SYNC-SETUP.md`: exact SQL (tables + row-level security so a user can only read/write their own rows), how to turn off email confirmation, where to paste URL/key.
- Settings "Sync" card: status, "Sync now", last synced, auto-sync on load/after changes (debounced), clear error messages. Offline-first: the app never blocks on the network.
- **Limitation, stated up front**: the Supabase adapter can only be verified against mocks until the owner creates a project. Everything else (engine, merge, queue, UI) is tested for real.

### Stage 3 — Recipes (part 2a)
Model (ported in spirit from `MealPlannerPC/Models`): `Recipe{id,name,description,source,servings,totalTime,ingredients[],steps,tags,updatedAt}`, `Ingredient{id,name,rawText,quantity,unit,prep,food?}`.
- Ingredient parsing: `domain/ingredients.js` ports the behaviour of `IngredientParser/IngredientNormalization/IngredientTokens` (quantity fractions, unit aliases, prep notes) with tests, so "1 1/2 cups flour, sifted" becomes `{1.5, cup, flour, "sifted"}`.
- Nutrition: each ingredient can be linked to a food (same USDA/OFF search + units/density logic the diary uses) → recipe calories/macros per serving, shown live while editing. Unlinked ingredients are flagged ("nutrition incomplete") instead of silently counting as zero.
- UI: Recipes tab (list/search/add/edit/delete), recipe detail with scaled servings.
- **Stated nutrition** (D31, schema v6): imports keep the page's per-serving calories and macros (labelled "from the page") until ingredients are linked; servings are worked out from the serving size. In PR.
- **Recipe import** (D29): reads schema.org data from a page fetched by one small Supabase Edge Function (browsers can't fetch other sites: CORS), or from pasted text/page source. In PR; the function needs deploying (KNOWN-ISSUES 42).

### Stage 4 — Weekly meal plan (part 2b)
- Plan = `PlanWeek{weekStart, slots:{[date]:{Breakfast..Snacks: [{recipeId|food, servings}]}}}`.
- Week view: planned calories/macros per day vs the goals set for the diary; copy a day/week; swap/remove.
- **"Log to diary"** one-tap per slot/day — creates normal diary entries (so everything already built — totals, export, share — just works).

### Stage 5 — Shopping lists (part 3)
- `domain/shopping.js`: aggregate ingredients across a date range of the plan; same item merged across recipes (name normalisation + unit conversion via the existing units/density module; incompatible units are kept as separate lines rather than guessed); scale by planned servings.
- Pantry/"already have" toggle per item, check-off, manual extra items, grouped by simple aisle categories.
- Share/copy as text, and export as CSV (reuses the existing share/files services). Syncs like everything else.

### Part 4 — store integrations (research only, not built)
- **Update 2026-11-10:** the facts below were checked and written up in [research/store-integration.md](research/store-integration.md); read that first (the older bullets are kept for history).
- Facts to verify before any work: Kroger publishes a developer API (OAuth2; product search, store locations, add-to-cart) — the most realistic starting point. Walmart's public APIs are mostly affiliate/marketplace oriented, not shopper carts. H-E-B has no public shopper API that I know of (verify).
- Whatever is chosen **requires a backend**: client secrets cannot live in a static page, and these APIs generally block browser CORS. Cheapest path: a Cloudflare Worker / Supabase Edge Function proxy.
- Likely first deliverable: "send this list to Kroger cart" and/or generating store-search links per item as a no-integration fallback.

## Cross-cutting rules for every stage
- Pure logic goes in `domain/` with `node:test` tests; every stage ends with `npm test` green and a browser smoke test.
- One commit group per stage; docs updated in the same group (ARCHITECTURE for structure, DECISIONS for each non-obvious choice, with the reasoning).
- Storage key `macrodiary.v1` never changes; every shape change gets a migration and a test that old data survives it.
- Nothing is pushed to GitHub or deployed by the agent; the owner reviews the branch first.

## Status
(Updated as stages land; `git log` shows one commit group per stage.)

| Stage | State | Notes |
|-------|-------|-------|
| 0 Refactor | **done** | Layered ES modules, golden tests, CI, SW drift test. |
| 1 Data foundation | **done** | Schema v3, LWW merge with tombstones (D9-D12). |
| 2 Sync engine | **done; schema applied to the real project, no real sync yet** | Engine verified against a local mock server (two browser origins). The SQL is in `supabase/migrations/` and was merged to `main` on 2026-11-10 and the owner confirmed the table and `push_record` exist in Supabase. No device has synced through the real project yet; test steps are in SYNC-SETUP.md section 6b (KNOWN-ISSUES #12). |
| 3a Planner data model | **done** | Schema v4 (D13). |
| 3 Recipes | **done** | Parser port, nutrition, editor, ingredient→food linking. Import from a page address or pasted text is in PR (D29); the fetch function is not deployed yet. |
| 4 Meal plan | **done** | Week view, per-day nutrition vs goals, log to diary (idempotent). |
| 5 Shopping lists | **done** | Derived list, aisles, ticks/extras, share/CSV. |
| Barcode scan + label OCR | **done, merged (PRs 2, 5)** | Native detector with ZXing fallback; Tesseract.js label reader; separate Take a photo / Choose an image buttons (D24). Unverified on real phones and real packaging (KNOWN-ISSUES #29, #31, #33, #36). |
| Sync setup defaults + setup link | **done, merged (PR #8)** | Built-in default project (set to the owner's project, D25) and an "Add another device" link. QR code not built. |
| Favourite recipes | **done, merged (PR #10)** | `favorite` flag on recipes (schema v5, D26), star on cards and in the editor, Favourites filter. Auto-fill (next) can read the flag. |
| Auto-fill week | **done, merged (PR #12)** | `domain/autoplan.js`, preview/Accept/Reroll dialog on the Plan tab (D27). Month range not built. |
| Plan month view + month auto-fill | **in PR (feature/plan-month), not merged** | Week/Month toggle, calendar grid with kcal per day, auto-fill range choice, past days skipped (D28). |
| Part 4 store integrations | **not built, by design** | Research notes above; needs a backend + the owner's developer accounts. |

### What the owner needs to do next (in order)
1. Run the real two-device sync test in `docs/SYNC-SETUP.md` section 6b and report any failing step (KNOWN-ISSUES #12).
2. Try the app on the phone: install, barcode scan, label photo (camera and upload), offline (KNOWN-ISSUES #21, #29, #31, #33, #36).
3. Answer the open questions at the end of [VISION.md](VISION.md) (households first: it changes the database layout). The suggested order of next features is in its section 6.
4. Decide on the open design questions in `docs/DECISIONS.md` marked *made without the owner* (D9, D10, D13-D17).
