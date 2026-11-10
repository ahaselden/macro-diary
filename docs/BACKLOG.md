# Feature backlog (priority order)

The queue of work, highest priority first. **When a feature is finished (PR merged), the next unchecked item is picked up.** Each item is its own pull request and follows the [ship-feature skill](../.claude/skills/ship-feature/SKILL.md): plan, spec and failing tests by the test-designer, implement to green, PR, pr-reviewer. Background and reasoning: [VISION.md](VISION.md); stage history: [ROADMAP.md](ROADMAP.md); open problems: [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

*Drafted on 2026-11-10 from VISION section 6 and the known issues. The order is a proposal; the owner can reorder it by editing this file.*

## How to use this list
1. Take the first item whose box is not ticked and whose **Blocked by** is empty or done.
2. If an item is blocked (needs a decision or an account from the owner), skip it, say so in the PR or chat, and take the next one. Do not start work that needs an answer nobody has given.
3. When the PR merges, tick the box, add the PR number and today's date, and update the status in VISION section 2 and ROADMAP in the same change.
4. New ideas go at the bottom of "Later / unscheduled" until the owner places them.

## Queue

- [x] **1. Favourite recipes** (VISION 4.3, capability 9). Star on recipes, Favourites filter, `favorite` flag synced with the recipe. *In PR #10, awaiting merge.*
- [ ] **2. Auto-fill a week from existing recipes** (VISION 4.2, capability 8). Pure `domain/autoplan.js`: proposes a plan from recipes, favourites, the daily calorie goal and the slots to fill; the user accepts, tweaks or rerolls; never overwrites planned meals without asking; deterministic with a seed; handles recipes with incomplete nutrition explicitly. No backend. **Blocked by:** owner answer to VISION question 5 (which rules matter first). Default if unanswered: calorie goal per day, then no repeats within N days, then prefer favourites.
- [ ] **3. Month view and auto-fill for a month** (capability 7/8). The planner is week-based today; extend the view and run the same auto-fill over more days. **Blocked by:** item 2.
- [ ] **4. Recipe import from a website** (VISION 4.1, capability 6). Pure `domain/recipe-import.js` (schema.org JSON-LD and pasted text), plus the one small backend function that fetches the page (http/https only, no private addresses, size and time limits). Imported recipes open in the editor for review; keep the source URL. **Blocked by:** owner decisions on the backend (VISION question 3) and recipe copyright (question 6).
- [ ] **5. Store integration, one store first** (VISION 4.5, capability 11). `services/stores/` adapter, pure `domain/store-match.js`, the user confirms every match, never buys automatically. **Blocked by:** owner's choice of store (question 2), a check of what that store's API allows, the backend from item 4, and the owner's developer account.
- [ ] **6. Households: share plans, recipes and lists** (VISION 4.6, capability 12). Large design change that affects the database layout. **Blocked by:** owner decision (question 1); design before any code. Ideally decided before many people use sync.

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
