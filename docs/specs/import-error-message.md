# Spec: honest message when the import service cannot be reached

Follow-up to `docs/specs/recipe-import.md` (section 4) and DECISIONS D29. When the `fetch-recipe` function is not deployed on the user's Supabase project, the browser's CORS preflight gets a 404, the browser blocks the request and `fetch()` rejects with a `TypeError` ("Failed to fetch"); the app cannot tell this from being offline, yet currently says "Network error: check your internet connection", which is misleading. This change is a **wording change only**: no network behaviour changes (same request, same timeout, same status mapping).

## Contract
Unchanged: `fetchRecipePage(conn, pageUrl, fetchImpl = fetch) -> Promise<{html, finalUrl}>` in `js/services/recipe-fetch.js` (services layer). Failures are rejected `Error`s, message <= 300 chars. The UI already renders `e.message` through `esc()`; the UI is not tested here.

## Behaviours
E1. When `fetchImpl` rejects with a non-abort error (`TypeError('Failed to fetch')`, a plain `Error`, a thrown string, `null`, `undefined`, an object), the rejected message says the import service could not be reached / the connection may be down (matches `/could not (be )?reach|couldn't reach|unable to reach|connection/i`).
E2. The same message also says the service may not be set up on the project yet (matches `/not (been )?set up|not deployed|isn't set up|is not set up/i`).
E3. The same message tells the user the paste route still works (contains the word "paste", case-insensitive).
E4. The message hedges: it does not state as fact that the user is offline (no `you are offline`, `you're offline`, `you are not connected`, `no internet`, `check your internet`), and contains a hedge word (`may`, `might`, `could`, `possibly`, `or`).
E5. Length <= 300 chars; never contains the anon key or any part of the page URL (path, query); no raw error text from the thrown value is echoed (e.g. a thrown `Error('secret-path ...')`, a string containing the key).
E6. The message is identical in kind for every non-abort throw type (all of E1..E4 hold for each).
E7. Timeout/abort errors (`AbortError`, `TimeoutError` DOMExceptions) keep the "took too long" message (matches `/time|slow|too long|took/i`) and do NOT claim the service is not set up.
E8. Server answers are unchanged: 404 without the `{ok:false}` shape still says "not set up" (existing S7); a 404 WITH `{ok:false,error}` still shows the page-level error and not "not set up".
E9. Network behaviour unchanged: exactly one `fetchImpl` call is made on a rejection (no retry).

## Existing tests
`tests/recipe-fetch.test.js` S6 (`/network|connection|internet|offline|reach/i` for the network case) and S7 must pass unchanged; the new text satisfies S6 through "connection"/"reach". No change to them is needed.

## Cannot be tested automatically (manual checklist)
- Open Import in an installation whose Supabase project does not have `fetch-recipe` deployed, paste a URL, and see the new text (reach/connection + may not be set up + paste still works).
- Turn the network off in devtools and see the same hedged text (it is deliberately the same; the app cannot distinguish the two).
- Deploy the function and confirm import works and this message no longer appears.

## Open questions
- Exact wording is not fixed; tests assert required ideas by regex only.
- Whether to distinguish `navigator.onLine === false` (UI could say "offline" as fact) is out of scope: services must not rely on globals here and the plan says wording only.

## Verification log (implementer, desktop built-in browser)
- With `fetch` made to reject with `TypeError("Failed to fetch")` (what a browser reports when the function is missing and the preflight fails), the Import dialog showed: "Could not reach the import service. Your connection may be down, or the service is not set up on your project yet. You can paste the recipe instead." and the Import button re-enabled. Not checked: the real browser behaviour against an undeployed function (it was seen on the live site before the function was deployed, which is what this wording is for), a phone.
- SW cache bumped to v28. No other behaviour changed.
