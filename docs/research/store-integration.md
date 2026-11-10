# Store integration: research and plan

**Status: DRAFT for the owner to review. Research only; no code, no implementation approved.** Written 2026-11-10 for backlog item 5 ([BACKLOG.md](../BACKLOG.md)), expanding [VISION.md](../VISION.md) section 4.5 (capability 11: "pick a store and add the shopping list to its cart"). Implementation becomes a backlog item only after the owner approves a direction below.

Terms and API details change. Everything marked **read on 2026-11-10** was read on the vendor's own documentation that day; anything else is labelled as unverified. Re-check before building.

## 1. Summary and recommendation

| Option | Does it give "list in the user's cart"? | Access | Verdict |
|---|---|---|---|
| **Kroger family** (Kroger, Ralphs, Fred Meyer, Harris Teeter and others; list of banners not verified) | Yes: *adds items* to the signed-in customer's real cart | Self-service app registration (read); no fee found | **Best first target.** Official, per-user cart. Strict usage rules. |
| **Instacart Developer Platform** | Indirectly: creates a link; the user picks a store on Instacart, items go in their cart | API key issued on application; the company page says it is **not accepting new applications** (read) | Best coverage (many US/Canada retailers) but **blocked until Instacart opens applications**. |
| **Walmart** | No cart API found; the public Affiliate API is product data and search only (read) | Affiliate program | Not feasible for carts. Possible only as search links. |
| Target, Albertsons, H-E-B, Costco | No official public cart or search API found (web search only, thin; **unverified**) | n/a | Nothing usable found; search links only unless that changes. |
| **No integration (already built)** | No: copy/share the list, per-item store-search links | None | Always stays as the fallback. |

**Recommendation:** (1) keep the existing share/search-link fallback as the baseline; (2) build **Kroger-family only** first, as a small, honest feature: search products, the user confirms each match, then "Add to my Kroger cart"; (3) **watch Instacart** and add it later (it covers far more stores and needs less per-store code) if and when it accepts new developers; (4) do not promise Walmart, Target, Albertsons, H-E-B or Costco unless a primary-source check finds a supported cart route.

The biggest open question is whether the owner's users are Kroger shoppers at all (section 8).

## 2. Kroger public APIs (read on 2026-11-10, developer.kroger.com)

- **What exists.** Public APIs: Products (catalog search), Locations (find stores), Identity (customer profile id), Cart. Partner APIs (richer "Carts" API) are **not self-service**: they need a partnership request and a contract.
- **Cart (public) = add only.** "Add to cart" (PUT) adds items to an authenticated customer's cart, and may increase the quantity of an item. There is no documented remove, view or checkout in the public Cart API. The user finishes in Kroger's own app or site, which matches principle 4 in VISION.
- **Environments.** Production `https://api.kroger.com/v1/` and a certification (test) environment `https://api-ce.kroger.com/v1/`. You choose the environment when registering; credentials are locked to it (register twice for both).
- **Access.** Create an account, register an application, receive a client ID and **client secret** (developer.kroger.com/documentation/public/getting-started/quick-start). No fee found. Whether production use needs a review step was **not stated** on the pages read; to check.
- **Rate limits.** Public APIs have daily limits applied equally to all clients, per endpoint; the Cart limit is **5,000 calls a day, shared by every user of the app** (stated on the Cart API overview, developer.kroger.com/documentation/api-products/public/cart/overview). Products has its own limit (not read). A shared daily cap matters: one busy evening of many users could exhaust it.
- **Two kinds of token.**
  - *Product search* uses the client-credentials grant, which needs the **client secret** (Basic auth on the token call). The secret must never be in the browser (VISION principle 6), so this part needs the backend.
  - *Adding to a customer's cart* needs the customer's own consent: OAuth2 **Authorization Code**, and Kroger says browser and native apps should use it **with PKCE**. The customer signs in on Kroger's site and approves; the app gets a code on its registered redirect URL and exchanges it for an access token (the docs' example shows `expires_in` 1800 seconds, i.e. 30 minutes) and a refresh token (developer.kroger.com/documentation/public/security/customer). The docs' example token call still sends the client secret with Basic auth; whether a pure browser app can do the exchange without the secret is **not clear from the pages read**. Safest plan: do the token exchange on the backend.
  - The scope names for cart were not on the pages read (a third-party source says `cart.basic:write`; **unverified**).
- **CORS.** Not addressed in the pages read; assume calls go through the backend.
- **Acceptable use (important; read for the Identity, Cart and Products sections at developer.kroger.com/documentation/public/getting-started/acceptable-use, paraphrased here: read the original before relying on it).**
  - Allowed: add an item the customer explicitly asked for; increase an item's quantity; **temporarily** cache cart data for display, and discard it when the user closes the app/site/browser.
  - Prohibited: adding items without the customer's knowledge; **tracking, sharing or storing data derived from items added to a cart**; storing or sharing the customer's Identity profile id to map data to them; **storing data derived from customer searches or frequently viewed products**; changing product names or descriptions (show them exactly as returned); comparing products or prices with other retailers; **systematically gathering API data to build a database**.
  - Consequence for design: the app must not keep a saved "ingredient -> Kroger product" memory, a price history, or a local product catalogue. Matches are chosen live each time. Even a remembered choice per ingredient is a grey area to ask Kroger about; until answered, do not store it.
- **Branding.** Kroger's primary logos may be used only for the Add to Cart use case and only if the integration is not monetised; naming and consent-screen rules apply; no public statement implying partnership or endorsement without written approval. Terms of Service apply on use.
- **Coverage.** Which banners and regions work in the Locations/Products/Cart APIs was not read. Kroger sells under several banners; the user picks a store location first (Locations API).

## 3. Instacart Developer Platform (read on 2026-11-10, docs.instacart.com)

- **What it does.** Your app POSTs a title and line items (name, quantity/unit, optional UPCs or product ids, optional brand/health filters) and gets back a **link** to an Instacart-hosted page. The user opens it, **chooses a store, adds products to their cart and checks out on Instacart**. Instacart picks a default merchant; directing users to a specific merchant is not supported. Matching is by item name (UPCs get priority).
- **Access.** API keys come from the developer dashboard (development and production keys). The company page (company.instacart.com/business/developers) says it is **"currently not accepting new applications"** with no waitlist; the getting-started overview (docs.instacart.com/developer_platform_api/get_started/overview) says production access takes roughly 30 to 40 days after applying. No fee found. The terms say affiliate commissions are possible once an integration is live.
- **Key handling.** The terms treat the key as confidential and say the app runs on the developer's server, so a backend is required (and the key can never be in the browser).
- **Restrictions in the terms (docs.instacart.com/developer_platform_api/guide/terms_and_policies/developer_terms, dated July 3, 2024; the fetch of this page was truncated, so part of this is from a summary: re-read before relying on it).** Instacart marks only to say the app is compatible; no showing priced items from several retailers on one screen; no alternative to Instacart checkout; limits at Instacart's discretion.
- **Why it is attractive.** One integration covers many US and Canadian retailers, the user keeps the choice of store, and our app does not handle carts or prices at all. Why it is not available yet: applications are closed.
- **Unverified:** Partner vs Public API details beyond one sentence on the company page; rate limits; CORS.

## 4. Walmart, Target, Albertsons, H-E-B, Costco

- **Walmart (read on 2026-11-10):** the Affiliates API documentation lists catalog, product lookup, search, reviews, stores, taxonomy, trending items: product data and referral links to earn fees. **No cart service.** Walmart's separate Marketplace/supplier APIs are for sellers, not shoppers. Search links to walmart.com remain possible as a fallback; scraping is not recommended (Walmart's terms restrict automated access, per a third-party summary, unverified).
- **Target, Albertsons, H-E-B, Costco (web search only, thin, unverified):** no official public product-search or cart API for outside developers was found; results were scrapers and paid third-party wrappers. These carry terms-of-service risk and break often. Not recommended.
- **Other aggregators (Amazon Fresh and similar):** not researched.

## 5. Proposed design (only if the owner approves Kroger first)

Fits VISION 4.5 and the layer rules (`ui -> services -> domain -> core`).

- **Domain (pure, tested):** `domain/store-match.js`.
  - Input: shopping-list items (already derived by `domain/shopping.js`) and a list of candidate products from a store.
  - Output: a ranked **suggested** match per list item with the reason ("name matches", "size 16 oz = 1 pack") and a warning flag when unsure. Includes the package-size maths: "2 cups flour" needs a 5 lb bag, so quantity becomes "1 bag", not 2 cups. Units reuse `domain/units.js`.
  - Honest numbers: unknown or unmatched items stay unmatched; nothing is guessed silently.
- **Services:** `services/stores/` with a small adapter interface `searchProducts(storeId, term)`, `addToCart(storeId, items)`, `status()`; `kroger-adapter.js` implements it through the backend; a memory adapter for tests, as with sync.
- **Backend (shared with recipe import, backlog item 4):** one small serverless function that holds the Kroger client secret and (a) fetches product search results, (b) completes the OAuth code exchange and refreshes tokens, (c) forwards "add to cart". It is a pass-through: it stores **no** customer cart or search data (Kroger's rules above), and that includes **not logging or caching request or response bodies, search terms or cart payloads** (host logs are a quiet way to store them). Token placement is **undecided and needs a decision before building**: the short-lived access token could sit in the browser's session storage (exposed to any script injected into the page, so the app's escaping rules matter) or be held only for the length of one request; the long-lived **refresh token** is the sensitive one and should not be kept in the page at all (options: an encrypted cookie set by the backend, or not using refresh tokens and asking the customer to sign in again). The secret and the production credentials are the owner's; nothing secret goes in the repo.
- **UI:** a "Send to Kroger" step on the Shop tab: choose a store (Locations search), see suggested matches per item with a picker to change or skip, then a **review screen listing exactly what will be added**, an explicit "Add to my Kroger cart" button, a clear result ("12 added, 3 skipped"), and a link to open Kroger to check out. Nothing is added without that button. The user signs in on Kroger's own page, never in our app.
- **Failure behaviour:** if the backend or the daily cap is unavailable, the button explains it and the existing share/search-link fallback still works. The app keeps working offline and without the backend.
- **No schema change expected** for the first version if nothing is stored. A "selected store" preference may be a per-device setting.

## 6. Risks and constraints

1. **Kroger usage rules** forbid storing data derived from searches or cart items and building a product database. The design above avoids it; ask Kroger support before any "remember my product choice" feature.
2. **Shared daily cap** (Cart 5,000 a day for the whole app) is a hard ceiling on how many users can add lists per day; fine for one household, a problem if the app grows. Partner status would lift it but needs a contract.
3. **Account ownership.** The developer account and client secret belong to the owner; the owner would be the named developer on Kroger's consent screen and is responsible for the app's compliance.
4. **Branding limits** (no partnership claims; logo use rules).
5. **Instacart is closed to new applications today**; its terms also need a server and limit how prices are shown.
6. **Brittleness.** Vendor APIs change terms without notice; adapters must fail clearly.
7. **Privacy.** Customer tokens are sensitive. They must not be logged, synced to the Supabase project or committed. The sync system must never carry them, and the backend must not log search terms, cart payloads or tokens.
8. **Backend cost and safety.** A public function that forwards add-to-cart must only act on the signed-in user's own token and rate-limit itself.
9. **Unverified on real devices:** the OAuth redirect round trip inside an installed phone app (PWA) is a known fragile area (leaving the app to sign in may reload it) and must be tested on real phones.

## 7. Proposed implementation breakdown (NOT approved; for the owner to accept, change or drop)

Each would be its own backlog item and pull request, in order, after the owner approves:

1. **A. Backend skeleton** (shared with item 4): the function, secrets handling, health check, request limits. Needs the owner's account on the chosen host.
2. **B. `domain/store-match.js`**: pure matching and package-size logic with the test-designer's tests. No network.
3. **C. Kroger read-only**: store picker and product search behind the adapter; show suggested matches in the Shop tab, no cart yet.
4. **D. Kroger add to cart**: OAuth with PKCE, the review screen, the add call, error handling.
5. **E. Instacart adapter** (only if applications reopen): "Open in Instacart" using one link; far simpler than D.

## 8. Decisions needed from the owner

1. **Is Kroger-first right?** Do you or your intended users shop at Kroger, Ralphs, Fred Meyer, Harris Teeter or similar? If not, the best near-term "integration" is the fallback that already exists, and Instacart later.
2. **Backend:** are you comfortable owning one small serverless function and a free account for it (VISION question 3)? Every real option needs it.
3. **Developer account:** are you willing to register as the Kroger developer and accept its terms for the app? Your name or organisation would be shown to customers on Kroger's consent screen, and you would be the party responsible for the app's compliance. Whether an individual may register or a company is needed was not checked.
4. **Instacart:** do you want to apply as soon as applications reopen (and is the owner or a company the applicant)?
5. **Scope:** is "add to cart, then finish in the store's app" enough, or do you expect prices and totals shown in our app? (Kroger's rules forbid comparing prices with other retailers, and Instacart's terms forbid showing priced items from several retailers on one screen, so cross-store totals are off the table under both.)

## 9. Sources read on 2026-11-10
- Kroger developer portal, public documentation: API Basics, Quick Start, Cart API overview, Customer Authentication, Acceptable Use, Branding Guidelines, Partner APIs (developer.kroger.com/documentation/...).
- Instacart Developer Platform docs: overview, API keys, create shopping list page, create recipe page, FAQ, developer terms, and the company developer page (docs.instacart.com/developer_platform_api, company.instacart.com/business/developers).
- Walmart I/O Affiliates API introduction (walmart.io/docs/affiliates/v1/introduction).
- Web searches for Target, Albertsons, H-E-B and Costco returned only third-party results (unverified).
