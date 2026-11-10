# Macro Diary: vision and architecture

**Status: DRAFT for the owner to review and edit.** Written on 2026-11-10 from the owner's own notes. Nothing here is a commitment. Statements marked *(my suggestion)* are mine, not the owner's; *(open question)* needs a decision. Once approved, this becomes the source for [ROADMAP.md](ROADMAP.md) and for the spec of each feature.

## 1. Purpose

Macro Diary helps people decide what to eat and keeps track of it. It does four things, in one app that works on a phone and a PC:

1. **Track** calories and macros, with food data from existing databases, and **sync** them across devices.
2. **Plan** meals for a day, a week or a month, so the question "what are we going to eat tonight?" is already answered.
3. **Cook from recipes**: bring in recipes from websites or pasted text, turn them into recipes in the app, and use them in meal plans.
4. **Shop**: turn a plan into one shopping list of ingredients and, eventually, send that list to a grocery store's cart.

The goal is that individuals and families can plan how and when they will eat their calories without redoing that thinking every evening.

## 2. Capabilities: what is wanted, what exists

| # | Capability | Today | Notes |
|---|---|---|---|
| 1 | Track calories and macros (USDA, Open Food Facts, custom foods, barcode scan) | **Built** | Label-photo entry (camera or upload) and "save a scanned barcode as your own food" are merged (PRs 2 and 5); both are unverified on real phones. |
| 2 | Share a day, export day/week/month/year | **Built** | |
| 3 | Sync across devices | **Built; real two-device test pending** | The owner's Supabase project exists and is the built-in default (PR #8, D25), so a new user only signs in; "Advanced: use my own project" and an "Add another device" setup link are merged. No device has synced through the real project yet ([SYNC-SETUP.md](SYNC-SETUP.md) 6b). Open: whether to host other people's data (households, privacy, free tier, sign-up settings). No QR code yet. |
| 4 | Recipes with nutrition per serving | **Built** | Ingredients are parsed from text and linked to real foods. |
| 5 | Import a recipe from **pasted text** | **Built** | Paste ingredient lines. |
| 6 | Import a recipe from a **website** | Not built | Needs a small backend (section 5). |
| 7 | Plan a day or week by hand, log planned meals to the diary | **Built** | No month view yet. |
| 8 | **Auto-fill a week or month** from existing recipes | **Built** (week PR #12, D27; month in PR, D28) | Section 4.2. Preview, then Accept; never overwrites planned meals. |
| 9 | **Favourite** recipes | **Built** (PR #10, D26) | Section 4.3. Used as a filter now; auto-fill will use it as a preference. |
| 10 | Shopping list from the plan (aisles, tick-off, share) | **Built** | |
| 11 | Pick a store and **add the list to its cart** | Not built | Needs a backend and developer accounts (section 4.5). |
| 12 | Families: share plans, recipes and lists between people | Not designed | *(open question)* Section 4.6. |

## 3. Principles

These are what the existing decisions already follow; I propose we write them down so new features are judged against them *(my suggestion)*.

1. **Local-first.** The app works fully offline with data in the browser. Cloud and stores are optional layers on top, never required to use the diary.
2. **The user owns the data.** Export and restore always work; sync is a pluggable adapter, not a lock-in.
3. **Free to run.** Static hosting plus a free database tier. Anything that costs money or needs an account of the owner's is optional and clearly marked.
4. **Honest numbers.** Incomplete nutrition is shown as incomplete, never counted as zero. Anything read by a machine (OCR, parsers, store matching) is a **suggestion the user confirms**, with warnings; it is never silently trusted.
5. **Small and replaceable parts.** Layers (`ui -> services -> domain -> core`), pure logic in `domain/` with tests, outside services behind small interfaces.
6. **No secret in the browser.** Anything needing a secret (store accounts, API keys that cost money) goes through the backend in section 5.
7. **Documented and reviewed.** Features start with a spec and tests written by someone other than the implementer, and end in a pull request that someone other than the author reviews ([ship-feature skill](../.claude/skills/ship-feature/SKILL.md)).

## 4. How each new idea fits the architecture

Current structure, for orientation (details in [ARCHITECTURE.md](ARCHITECTURE.md)):

```
  ui/        screens and dialogs (builds HTML, handles taps)
   |
  services/  the outside world: food databases, barcode, OCR, sync, share/files
   |
  domain/    pure logic with tests: nutrition, units, recipes, plan, shopping, merge
   |
  core/      state store, schema/migrations, dates, formatting
```

### 4.1 Import a recipe from a website or text
- **Parsing is mostly free.** Most recipe sites embed machine-readable recipe data (schema.org `Recipe` as JSON-LD): name, ingredients, steps, servings, times. A pure `domain/recipe-import.js` would turn that data, or plain pasted text, into our recipe shape, reusing the existing ingredient parser. Sites without that data fall back to text paste.
- **Fetching is the hard part.** Browsers cannot read other sites' pages (CORS), so a backend function must fetch the URL (section 5). It needs safeguards: only http/https, no private addresses, size and time limits.
- **Copyright note.** The app should keep the source URL and treat imported recipes as the user's private copy, not republish them. *(my suggestion)*
- Imported recipes always open in the recipe editor so the user can review ingredients and link foods before saving.

### 4.2 Auto-fill a week or month from existing recipes
- A pure `domain/autoplan.js`: inputs are the recipes, favourites, the calorie goal per day, which meal slots to fill, and rules such as "do not repeat a recipe within N days" and "prefer favourites". Output is a **proposed plan the user can accept, tweak or reroll**; it never overwrites meals already planned without asking.
- Rule-based first (deterministic with a seed, so it is testable and explainable: "chose this because it fits 600 kcal and was not used this week"). No AI is needed for version 1.
- It must handle incomplete recipes (unknown nutrition) explicitly, for example by preferring complete ones and flagging the rest.
- Extending to a month is the same function over more days.

### 4.3 Favourite recipes
- A `favorite` flag on the recipe, so it syncs with the recipe. Needs a schema bump (v5) with a migration and a test, per the project rule. Used as a filter in the recipes list and as a preference in auto-fill.

### 4.4 Cross-platform
- Today: an installable web app (PWA) for phone and PC, with the barcode, camera and offline features that browsers allow.
- Native apps are not planned; the web app plus the optional backend should cover the goals. *(open question, section 8)*

### 4.5 Grocery store integration
- **Shape.** An adapter interface like the sync adapters: `searchProducts(storeId, item)` and `addToCart(storeId, items)`, living in `services/stores/`, with a pure `domain/store-match.js` that maps shopping-list items to products (including package sizes: "2 cups flour" becomes one bag).
- **The user confirms every match** before anything is added; nothing is ever bought automatically. The user completes checkout in the store's own app or site.
- **Fallback that needs no integration:** per-item store-search links and copy/share of the list (already built).
- **Honest uncertainty.** Whether each store allows this is not yet checked. My understanding, to be verified before any work: Kroger offers a public developer API with product search and cart; Walmart's and H-E-B's public APIs may not allow carts for ordinary apps. Which stores are possible decides the scope. *(open question)*
- Needs the backend (secrets and CORS) and the owner's developer accounts.

### 4.6 Families and households *(open question)*
- "People and families" suggests several people sharing a plan, recipes and shopping list while keeping separate diaries. Today each sync account owns its data. Sharing needs a household concept, invites and different access rules, and a decision about which data is shared (probably recipes, plan and shopping) and which stays personal (diary, goals).
- This is the largest design change in this document; it should be decided before sync goes live, because it changes the database layout.

## 5. The one backend

Several features need a server for the same reasons: secrets, and fetching pages. I propose **one small serverless function** *(my suggestion)*, for example a Cloudflare Worker or a Supabase Edge Function, with only these jobs:

1. fetch a recipe page for import (4.1);
2. talk to grocery stores on the user's behalf (4.5);
3. optionally, read label photos with a vision model if the free in-browser reader proves too weak.

Everything else stays static and client-side, and the app keeps working if the backend is not set up (the features that need it just stay off).

## 6. Suggested order *(my suggestion; each step is its own pull request)*

1. Go live with sync (owner sets up Supabase), after deciding on households (4.6).
2. Favourites (small; unlocks 3). **Done (PR #10 merged).**
3. Auto-fill week/month (pure logic, no backend, fully testable). **Week done (PR #12); month in PR.**
4. Recipe import from websites (first use of the backend).
5. Store integration, starting with the one store that allows it.

## 7. Proposed non-goals *(edit freely)*

- Medical or dietary advice. The app reports numbers and the user's own goals; it does not tell people what they should eat.
- Social features, ads, or selling data.
- Buying automatically. The user always confirms and checks out.

## 8. Open questions for the owner

1. **Households:** do you want families to share plans, recipes and lists in the first release of sync, or later? (My recommendation: decide now, build later.)
2. **Stores:** which stores matter most? I will check what each actually allows before promising any.
3. **Backend:** are you comfortable with one small serverless function and, if needed, a free account for it?
4. **Native apps:** is installing the web app on the phone enough?
5. **Auto-fill rules:** what should it respect first: calorie goal per day, no repeats, prep time, ingredients already in the pantry, or something else?
6. **Recipe copyright:** is "private copy with a source link" acceptable for imported recipes?
