# Feature backlog (priority order)

The queue of work, highest priority first. **When a feature is finished (PR merged), the next unchecked item is picked up.** Each implementation item is its own pull request and follows the [ship-feature skill](../.claude/skills/ship-feature/SKILL.md): plan, spec and failing tests by the test-designer, implement to green, PR, pr-reviewer. Background and reasoning: [VISION.md](VISION.md); stage history: [ROADMAP.md](ROADMAP.md); open problems: [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

*Drafted on 2026-11-10 from VISION section 6 and the known issues. The order is a proposal; the owner can reorder it by editing this file.*

## How to use this list
0. **Nothing starts by itself.** Work begins only when the owner asks (for example "do the next backlog item"); an item counts as finished when the owner has merged its PR, because agents never merge. `CLAUDE.md` points every session here.
1. Take the first item whose box is not ticked and whose **Blocked by** is empty or done.
2. If an item is blocked (needs a decision or an account from the owner), skip it, say so in the PR or chat, and take the next one. Do not start work that needs an answer nobody has given.
3. When the PR merges, tick the box, add the PR number and today's date, and update the status in VISION section 2 and ROADMAP in the same change.
4. Items marked **plan and research only** produce a document for the owner to review (a docs-only PR); they never include code, and the owner's approval of the document is what creates the implementation item.
5. New ideas go at the bottom of "Later / unscheduled" until the owner places them.

## Queue

- [x] **1. Favourite recipes** (VISION 4.3, capability 9). Star on recipes, Favourites filter, `favorite` flag synced with the recipe. *Merged as PR #10.*
- [ ] **2. Auto-fill a week from existing recipes** (VISION 4.2, capability 8). Pure `domain/autoplan.js`: proposes a plan from recipes, favourites, the daily calorie goal and the slots to fill; the user accepts, tweaks or rerolls; never overwrites planned meals without asking; deterministic with a seed; handles recipes with incomplete nutrition explicitly. No backend. **Blocked by:** owner answer to VISION question 5 (which rules matter first). Default if unanswered: calorie goal per day, then no repeats within N days, then prefer favourites.
- [ ] **3. Month view and auto-fill for a month** (capability 7/8). The planner is week-based today; extend the view and run the same auto-fill over more days. **Blocked by:** item 2.
- [ ] **4. Recipe import from a website** (VISION 4.1, capability 6). Pure `domain/recipe-import.js` (schema.org JSON-LD and pasted text), plus the one small backend function that fetches the page (http/https only, no private addresses, size and time limits). Imported recipes open in the editor for review; keep the source URL. **Blocked by:** owner decisions on the backend (VISION question 3) and recipe copyright (question 6).
- [ ] **5. Store integration: plan and research only, no implementation** (VISION 4.5, capability 11). Deliverable is a document (`docs/research/store-integration.md`), not code: which stores allow cart access for an ordinary app (verified from each store's current developer terms, not memory), what accounts, keys and costs each needs, how it would use the backend from item 4, the adapter shape (`services/stores/`, pure `domain/store-match.js`, package-size matching), the user-confirms-every-match rule, the fallback that needs no integration, risks, and a recommended first store with a proposed implementation breakdown. Implementation becomes a new backlog item only after the owner approves the plan. **Blocked by:** nothing for the research itself; the owner's store preferences (VISION question 2) improve it.
- [ ] **6. Households: plan and research only, no implementation** (VISION 4.6, capability 12). Deliverable is a design document (`docs/research/households.md`), not code: what is shared (probably recipes, plan, shopping list) versus personal (diary, goals), invite and membership model, access rules and row-level security changes, effect on the sync records and database layout, migration of existing single-user data, privacy and abuse concerns, options with trade-offs, and a recommendation. It should say what must be decided before many people use sync. Implementation becomes a new backlog item only after the owner approves the design. **Blocked by:** nothing for the research itself.

## Small follow-ups (take between features, or when the owner asks)
- [ ] Keep keyboard focus on the star after toggling it (found in the PR #10 review).
- [ ] QR code for the "Add another device" sync link (needs an encoder; the project has no dependencies, see D25).
- [ ] Fix the `configure()` 20-character key off-by-one (KNOWN-ISSUES 38).
- [ ] UPC-E codes expanded to UPC-A (KNOWN-ISSUES 34).

## Needs the owner (not code)
- [ ] Go live with sync: real two-device test with the owner's Supabase project ([SYNC-SETUP.md](SYNC-SETUP.md)). This is being tested separately; do not change sync behaviour meanwhile.
- [ ] Try barcode, label photo, setup link and favourites on a real phone (KNOWN-ISSUES 33, 36, 37, 39).
- [ ] Answer the open questions in VISION section 8.

## Later / unscheduled
- Native apps (not planned; VISION question 4).
- Favourites for foods or plan items; sorting favourites first (out of scope of item 1).
