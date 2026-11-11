# Barcode lookup sources beyond Open Food Facts (research, no code)

*Backlog item 10, Part B. Written 2026-11-11. Research only: nothing here is built, no account was created, and nothing was added to the app. Findings come from web searches and one small live test; third-party pages (blogs, forums, directories) may be out of date, so **re-read each provider's own terms before relying on a number**.*

## 1. The problem
A scan or a photo gives a barcode. The app asks Open Food Facts (OFF) first. OFF is crowd-sourced, so some products are missing or have only calories per 100 g (two of the owner's test barcodes, 705105703862 and 736211050977, gave odd or poor records). Today, when OFF has nothing, the user gets "Not found. Create a custom food" (add-food.js). The question is which second source, if any, is worth adding, at what cost, and with what owner decisions.

## 2. What the app does today (facts from the code)
- `searchAll` (services/foods.js) asks OFF for a barcode and **skips USDA for barcodes** (`useUSDA && !isBarcode(q)`), so USDA is never tried for a scanned code.
- A saved custom food with the same barcode is found first (add-food.js), so the user's own correction always wins.
- The USDA key is the user's own (Settings); the shared `DEMO_KEY` is tiny. The sync backend is the only place a secret may live (VISION principle 6; KNOWN-ISSUES 43 must be fixed before a function relays calls for others).

## 3. The sources compared

| Source | Barcode lookup | Cost and limits | Needs | Terms to respect | Confidence in these facts |
|---|---|---|---|---|---|
| **Open Food Facts** (today) | Direct lookup by code | Free, open data (ODbL), polite use | Nothing | Attribution and share-alike for the data | High (already integrated) |
| **USDA FoodData Central, Branded foods** | Branded records carry `gtinUpc`; the search box accepts the digits | Free; own key in Settings, already integrated; DEMO_KEY showed a limit of **10 requests** in its window in my test | Nothing new (the user's own key) | US government data, public domain; no attribution required | **Tested live** (section 4) |
| **Edamam Food Database** | Lists UPC lookup (the page claims 615,000+ UPCs) | A basic/free plan exists, but I could not confirm its call quota; paid tiers were quoted at roughly $14 and $69 a month by a third-party directory | An Edamam developer account; an app id and **secret key** (backend only) | Every plan requires attribution ("powered by" with the logo linking to developer.edamam.com); caching rights are per plan; their terms restrict building a copy of the data | Medium (official page for UPC and attribution; quotas unverified) |
| **FatSecret Platform** | `food.find_id_for_barcode` (v2) is **Premier-only** | "Premier Free" for start-ups, non-profits and students (verification and an application); otherwise paid | A FatSecret account approved for Premier Free; OAuth credentials (backend only) | Attribution required; barcode must be a 13-digit padded GTIN; US dataset on the free premier tier | Medium (official editions page and docs; the padding detail is from a forum) |
| **Nutritionix** | UPC lookup is documented in third-party mirrors | Freemium; I found **no official numbers** | An account | **Terms unclear**; could not confirm | Low |
| Others seen (DietlyAPI, Oanor) | Barcode lookup | Unknown | Accounts | Mostly OFF data repackaged, plus AI-estimated entries in one case | Low; **not recommended** (no separate data, or estimates presented as data) |
| Not researched | UPCitemdb, Go-UPC, Spoonacular, Barcode Lookup | n/a | n/a | n/a | These are mostly product-name databases with little or no nutrition data; skipped on purpose |

## 4. The USDA test (the one live check)
Done 2026-11-11 with the shared `DEMO_KEY`, three requests in total:
1. A search for the two owner test barcodes (`705105703862`, `021000013197` from a documentation example) restricted to `Branded` returned **0 hits**. So coverage is partial, as the backlog noted.
2. To prove the mechanism I took a real record: a name search for "cheddar cheese" gave a Branded food whose `gtinUpc` is `828653282457`. Searching that same digit string returned **exactly 1 hit with that `gtinUpc`**.

So searching the digits finds a branded record when one exists. `gtinUpc` values in the examples are 12 digits (UPC-A); an EAN-13 that starts with 0 is the same product as its 12-digit form (the app already treats those as equal in `sameBarcode`). Not tried: UPC-E, whether a leading-zero variant is needed, and how many real products the owner scans would be found (that needs the owner's own USDA key and real scans).

## 4b. What a lookup shares
Each lookup sends the barcode digits to that provider, from the user's browser (USDA, OFF) or from our backend (providers that need a secret). Scanning a barcode says what a person eats, so any provider added must be named in Settings and the privacy text, and the user must be able to leave it off (as the existing USDA and OFF switches do).

## 5. Options

**A. Do nothing beyond OFF.** Zero cost, zero risk; the user keeps creating a custom food for missing products (and that custom food is then found by its barcode).

**B. USDA branded fallback (recommended first step).** When OFF has no usable product for a scanned or photographed barcode, ask USDA with the digits and accept only a result whose `gtinUpc` is the same product (`sameBarcode`), then show it exactly like any result, with its source badge "USDA". No new account, no secret, no new third party, public-domain data, and the code path already exists for names. Costs: one extra request per miss; the shared demo key will rate-limit quickly, so it only makes sense with the user's own key (the app would say so, as for suggested matches). Coverage is partial and US-only (tested above).

**C. Edamam as a further fallback.** Possibly the widest UPC coverage of the free-to-try options, but it needs an Edamam account and a secret key kept in the backend, visible attribution in the app, and a check of its caching terms. Only worth it if B leaves too many misses on real scans.

**D. FatSecret Premier Free.** Needs approval as a start-up, non-profit or student, a backend, attribution, and only the US dataset. The eligibility is uncertain for a personal project.

**E. Nutritionix.** Skip until its terms and pricing can be read from the official site.

## 6. Recommendation
1. Build **B** (small, no owner account needed): a USDA lookup by GTIN after an OFF miss, with the user's own key, label the source, and say plainly when the key is missing or rate-limited. It would be its own spec-first PR, tested with fake search results (as the existing `foods` tests) and with a source-text UI check.
2. **Then measure.** Have the owner scan the products they actually buy for a few weeks and note the misses. Only if too many remain, decide on C (or D).
3. Skip E and the unresearched services.

## 7. Decisions needed from the owner
1. **Go ahead with B?** It needs no account. (Recommended.)
2. **Do you want a paid or approved account at all** (Edamam developer account, or FatSecret Premier Free application)? Not needed for B; only if B is not enough.
3. If C or D later: **where the secret lives** (the sync backend; KNOWN-ISSUES 43 must be fixed first), and **who is responsible** for the provider terms (the owner's name will be on the account).

## 8. What would be built for B (outline, for the later spec)
- A pure `domain` helper that picks the USDA result whose `gtinUpc` matches the scanned code (`sameBarcode`), tolerant of missing fields and hostile input.
- `searchAll`: for a barcode, when OFF returns no usable product and USDA is enabled, try USDA with the digits (and the 12-digit form of a leading-zero EAN-13).
- The result list and the "Not found" message say which sources were tried.
- No schema change, no new file in the service worker list beyond any new module.

## 9. Not verified
Edamam's free quota, Nutritionix's terms and pricing, FatSecret's current approval rules, UPC-E behaviour in USDA, and how many of the owner's real products USDA contains.

## Sources
- USDA FoodData Central: [API guide](https://fdc.nal.usda.gov/api-guide.html), [help](https://fdc.nal.usda.gov/help)
- Edamam: [Food Database API](https://developer.edamam.com/food-database-api), [FAQ](https://developer.edamam.com/faq)
- FatSecret: [editions](https://platform.fatsecret.com/api-editions), [find_id_for_barcode](https://platform.fatsecret.com/docs/v2/food.find_id_for_barcode), [forum thread on barcode lookup](https://groups.google.com/g/fatsecret-platform-api/c/pe7opNUXA40)
- Nutritionix: third-party mirrors only (no official page read)
