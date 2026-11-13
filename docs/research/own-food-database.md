# Our own food database, so USDA is not needed (research, no code)

*Backlog item 15. Written 2026-11-13. Research only: nothing here is built, no account was created, nothing was added to the app. Facts come from web searches (listed at the end) and from the code; third-party pages may be out of date, so **re-read each source's own terms and file sizes before relying on a number**. Anything marked "estimate" is my arithmetic, not a measurement.*

## 1. The problem
Today the app asks two live services for foods: Open Food Facts (OFF, no key) and USDA FoodData Central (needs the user's own key; the shared demo key allows about 10 requests, see [barcode-sources.md](barcode-sources.md)). That means a key to set up on every device (item 14), rate limits, no search without a network, and a lookup that sends what you eat to a third party. The owner asked whether we can keep a database of our own instead.

## 2. What the data is and what it costs to hold
| Dataset | What | Size (as published) | Licence | Confidence |
|---|---|---|---|---|
| USDA Foundation Foods | A few hundred well-measured generic foods | about 0.5 MB (JSON) to 3.4 MB (CSV) zipped | USDA data; the pages I found call it public domain, **I did not find an official USDA licence statement** | Medium |
| USDA SR Legacy (2018, no longer updated) | About 7,800 generic foods, the classic table | small (the figures in my search results were garbled) | as above | Medium |
| USDA Branded Foods | Packaged US products with barcode (`gtinUpc`), name, brand, label nutrients | The *full download of all USDA data* is **458 MB zipped / 3.1 GB unzipped**; Branded is most of it | as above | Medium |
| Open Food Facts | Crowd-sourced world products, many with barcodes | food CSV about **0.9 GB gzipped / 9 GB unzipped**; also JSONL, Parquet and a MongoDB dump, updated nightly | Database under **ODbL** (attribution; share-alike if you publish a derived database), contents under the Database Contents Licence; **images are CC BY-SA** | High for the licence names, Medium for sizes |

**What the app needs from each food** is small: name, brand, barcode, serving size and label, and calories, protein, carbs and fat per 100 g (later the extra label nutrients, item 16). Kept to those fields a record is roughly 150 to 250 bytes of text. *Estimate:* generic foods (Foundation plus SR Legacy) about 1 to 2 MB; USDA Branded trimmed very roughly 80 to 150 MB; an OFF subset for one country in the same range or larger. A real trimmed export is needed to confirm.

## 3. What we hold today and what would change
- `searchAll` (services/foods.js) queries OFF and USDA live; results are mapped to one food shape (`mapOFF`, `mapUSDA`); barcode fallbacks exist (item 11, D39).
- The app is a static site on GitHub Pages with no build step and **no dependencies**; third-party files may be copied into `js/vendor/` unchanged (D21). The sync backend is the *user's own* Supabase project entered in Settings, so there is no single server of ours that all users share.
- A food the user logs is copied into the diary entry, so a food database changing later would not break old entries.

## 4. Options

**A. Keep live lookups (today).** Nothing to build; keeps the key, rate-limit and privacy costs above. Item 14 would at least remove typing the key on every device.

**B. Ship a small generic-food file with the app (Foundation plus SR Legacy).** A trimmed JSON file under `data/` (about 1 to 2 MB, *estimate*), precached by the service worker and searched in the browser. Works offline, needs no key and no network, nothing to run. Covers generic foods (oats, chicken breast, banana) but **not branded products or barcodes**. Public-domain source (to be confirmed on USDA's site). The refresh is a dev-only script in `tools/` run by the owner now and then (SR Legacy never changes; Foundation changes a couple of times a year). The cheapest real step, and it removes the most common need for a USDA key.

**C. Static, sharded branded data on GitHub Pages (no server).** Split trimmed Branded data into many small files by barcode prefix (a scan fetches one small file) and by name prefix (a search fetches one or a few). The service worker caches what was used. No backend, no key, no limits of ours apart from GitHub Pages' own (about 1 GB site size and a soft bandwidth cap, **to be verified**). Costs: a build script, a very large number of files, weaker free-text search than a database (word order, typos), and a heavy repository. Branded data would be roughly 10 percent or more of the Pages size limit (*estimate*).

**D. Put the data in a Postgres table and search it with a function.** Free Supabase gives **500 MB of database and 1 GB of file storage** (third-party 2026 guides; confirm on Supabase's pricing page). About 100 to 150 MB of branded data plus indexes fits, but it shares the 500 MB with the owner's sync data. Good search (full text and trigram, a barcode index) and a tiny app change (one RPC call). But each user has their *own* Supabase project, so either every user loads the data into their own project (heavy for a non-technical user) or the owner's project serves everyone (the owner pays and carries abuse and limits: the "one backend for everyone" question VISION left open). Not recommended before the many-user questions are settled.

**E. Open Food Facts dump.** Same shapes as C or D but far larger and global. The ODbL means that publishing a derived database (even as shard files on Pages) must itself be shared under ODbL with attribution, and quality is uneven (the owner's two test barcodes showed that). Better as a *per-country, barcode-lookup-only* addition after B or C proves useful. Images are CC BY-SA and are not needed.

**F. Build our own data (users contribute).** Out of scope: needs moderation, accounts and a server.

## 5. Privacy and licensing notes
- A local or static database removes the "what I eat is sent to USDA or OFF" leak for the foods it covers.
- USDA: confirm the official licence statement before shipping (my sources were third-party).
- OFF: any published derived OFF database brings the ODbL share-alike and attribution duties; keep the credit visible in Settings.
- Freshness: data in the app is a snapshot. Show its date in Settings and keep a refresh script.

## 6. Recommendation
1. **Do B first** (a bundled generic-food file: offline, no key, no server, public domain). It also gives the app the offline search it lacks. It would be its own spec-first PR; the refresh script lives in `tools/` and is never shipped.
2. **Then measure**: how often the owner still needs a branded product B does not have, and how often the live USDA or OFF lookup fails or hits the limit (items 11 and 14 give that data).
3. **Only if misses stay high**, choose between C (static shards, no server) and D (database) for branded products. My lean is C, because it needs no account and no shared backend, but only after a real trimmed export shows the true size.
4. Skip E and F for now.

## 7. Decisions needed from the owner
1. **Go ahead with B** (bundled generic foods)? It would become a new backlog item.
2. Is **about 2 MB more to download and cache** acceptable on phones? (Estimate.)
3. Later: do you want branded products and barcodes held by us at all, given the repository and hosting limits in C and the shared-backend question in D?

## 8. What B would contain (outline for a later spec)
- A pure `domain/local-foods.js` (search and ranking over an in-memory list, tolerant of missing fields), a small loader in `services/`, a dev-only `tools/build-foods.mjs` that turns USDA's CSV or JSON into the trimmed file, and `searchAll` using the local list first and the live services after it. No saved-shape change. New files go in the service worker's list; a source label ("Built-in") and the data date appear in the UI.

## 9. Not verified
Official USDA licence wording; the real size of trimmed files (every size above for trimmed data is an estimate); GitHub Pages' current size and bandwidth limits; Supabase's current free-plan numbers (from third-party guides); how many of the owner's real foods are generic versus branded.

## Sources
- USDA FoodData Central: [download datasets](https://fdc.nal.usda.gov/download-datasets), [Branded Food Products documentation](https://fdc.nal.usda.gov/GBFPD_Documentation)
- Open Food Facts: [data and exports](https://world.openfoodfacts.org/data), [Parquet on Hugging Face](https://huggingface.co/datasets/openfoodfacts/product-database)
- Supabase free-plan limits: third-party 2026 guides, e.g. [Jetadmin](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/); confirm on Supabase's own pricing page
