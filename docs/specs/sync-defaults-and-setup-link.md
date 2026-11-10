# Spec: sync defaults and setup link

## Purpose
Let an end user sync by only signing in: the app can ship a built-in default Supabase project (URL + publishable key, public by design, RLS protects data), and an already-set-up device can hand its project URL + key to another device through a link. Until the owner supplies real default values (product decision, docs/VISION.md) the defaults are EMPTY and the app must behave exactly as before.

Provenance: written red-first, before implementation. The author read `config.js`, `index.js` and their tests only.

## Contract
Services layer (`js/services/sync/`), pure except where noted. Imports point downward only.

| Module | Export | Shape |
|---|---|---|
| `defaults.js` (new) | `DEFAULT_SYNC` | `{ url: '', anonKey: '' }` placeholders (strings). Owner fills in later. No secrets. |
| `config.js` | `effectiveConnection(cfg, defaults)` | returns `{ url, anonKey, source: 'custom'\|'default'\|'none' }`. `url` is the normalised origin. For `'none'`: `{url:'',anonKey:'',source:'none'}`. Pure, never throws. |
| `config.js` | per-device cfg field `useOwnProject` | boolean, optional, lives in the existing `macrodiary.sync.v1` key (no schema migration; absent = false) |
| `index.js` | `createSyncService({..., defaults = DEFAULT_SYNC})` | new optional option. `status`, `syncNow`, `schedule`, `signIn`, `signUp`, `signOut` use the effective connection. The first argument given to `adapterFactory` has the EFFECTIVE `url`/`anonKey` (plus the session). `configure({url,anonKey})` keeps its validation and additionally sets `useOwnProject: true` on success. |
| `setup-link.js` (new) | `buildSetupLink(appUrl, { url, anonKey, ...ignored })` | string; `''` if url/key unusable (non-https, short key, service_role/sb_secret_). Never throws. |
| `setup-link.js` (new) | `parseSetupLink(urlOrHash)` | `{ url, anonKey }` or `null`. Never throws. |
| `setup-link.js` (new) | `planSetupLinkApply(cfg, parsedLink, defaults)` | `{ action: 'apply'\|'confirm'\|'ignore', patch }`. Pure decision used by `main.js`; `patch` (apply/confirm) is `{ url, anonKey, useOwnProject }` for `config.set`. |

Link format: `<appUrl-without-hash>#sync-setup=<base64url(JSON {"v":1,"url":...,"key":...})>`. Fragment, not query (never sent to a server or logged). base64url without padding.

Key rules (shared by build and parse): url must pass `normalizeUrl` (https, or http only for localhost/127.0.0.1); key must be a string longer than 20 chars; refuse a JWT whose payload role is `service_role`, any key containing `service_role`, and any `sb_secret_` key; `sb_publishable_...` and anon JWTs are accepted.

## Behaviours
Defaults (`tests/sync-defaults.test.js`)
- D1 `DEFAULT_SYNC` has string `url` and `anonKey`.
- D2 `DEFAULT_SYNC` is empty OR a valid https url + key that is not service_role/sb_secret_.
- D3 `defaults.js` source contains no service_role / secret / password / token text.
- D4 empty cfg + valid defaults -> `source:'default'`, url normalised.
- D5 empty cfg + empty or invalid defaults (http, short key, null, garbage) -> `none`.
- D6 user-set url/key win over defaults -> `custom`.
- D7 `useOwnProject:true` with own values -> `custom`.
- D8 `useOwnProject:true` never falls back to the default project.
- D9 with empty defaults the result matches today's `isConfigured` semantics.
- D10 pure, no throw on hostile cfg/defaults (null, numbers, frozen, inherited props).
- D11 service with empty defaults unchanged: `unconfigured`, signIn refused ("project URL"), `syncNow` -> Not signed in.
- D12 service with valid defaults, empty cfg: status `signed-out`; signIn calls the default project with the default key.
- D13 signed-in on default: adapter built with the default url/key; custom config wins when set.
- D14 `configure` validation unchanged and sets `useOwnProject:true`.

Setup link (`tests/sync-setup-link.test.js`)
- S1 build/parse round-trip (jwt and sb_publishable_ keys).
- S2 fragment not query; payload exactly `{v:1,url,key}`, base64url charset; S2b existing hash replaced.
- S3 build never carries password/session/token/email even if passed.
- S4 parse returns only `{url, anonKey}`, ignoring all other fields.
- S5 parse accepts full URL, `#sync-setup=...`, `sync-setup=...`.
- S6 url normalised to origin.
- S7 non-https refused; http only for localhost/127.0.0.1.
- S8 wrong/missing version refused.
- S9 missing/short/non-string key refused (21 chars is the minimum).
- S10 service_role jwt, `service_role` text and `sb_secret_` refused by parse and build.
- S11 build returns `''` on unusable input.
- S12 parse returns null on garbage (non-base64, bad JSON, JSON non-objects, unicode/lone surrogates, 100 KB and 5 MB input) without throwing.
- S13 `__proto__`/`constructor` keys in payload do not pollute or leak.
- S14 a hostile url (html in path) is refused or reduced to a clean origin.
- S15 plan: null link -> ignore.
- S16 plan: not signed in, link differs from default -> apply `{url, anonKey, useOwnProject:true}`.
- S17 plan: link equals default project -> apply `{url:'', anonKey:'', useOwnProject:false}` (clears stale custom values, else they would still win).
- S18 plan: signed in (refresh_token) to a different project (default or custom) -> `confirm`, never `apply`.
- S19 plan: signed in and link is the project already in use -> `ignore`.
- S20 plan: patch contains only url/anonKey/useOwnProject; no throw on hostile cfg/defaults.

UI wiring (statically checked where possible, otherwise manual; U1-U8 in `sync-defaults.test.js`)
- U1 `sync-view.js` contains "Advanced: use my own project" and "Add another device".
- U2 wording says the link carries URL and key only, no password/sign-in.
- U3 every url/key/link interpolation in `sync-view.js` is wrapped in `esc(`.
- U4 `main.js` parses `location.hash`, and strips with `history.replaceState`.
- U5 `main.js` uses `planSetupLinkApply`.
- U6 `setup-link.js` has no query/storage/network/DOM use. U7 it imports only config/defaults/core/domain.
- U8 `sw.js` lists both new files and `CACHE` is at least v20.
- M1+ manual behaviours below (not automatable).

## Edge cases and hostile input
Covered: empty/short/huge inputs, NaN-like and wrong types, prototype keys, HTML in url, unicode, service_role keys, http urls, secrets passed to build. Imported/synced data cannot reach these functions: the sync config is per device and is not part of backups.

## How weak the automated tests are
U1-U8 are regex checks over source text. They show strings and calls are present, not that handlers run, that the form is skipped, that `replaceState` runs after parsing, or that the toast appears. U3 only inspects `${...}` expressions containing link/url/key-like words, and can miss other variable names. U3 probably already passes before implementation (existing view already escapes): it proves nothing until the new markup exists. U6/U7 are negative checks. `planSetupLinkApply` tests cover the decision, not that `main.js` obeys it. No fake DOM was written.

## Manual checklist
- [ ] Empty defaults (as shipped): Settings -> Sync looks and works exactly as before (URL/key form, sign up/in, sync).
- [ ] With a valid default (temporarily edit `defaults.js` locally): Settings -> Sync shows sign-in directly, plus a small "Advanced: use my own project" link; clicking it reveals the URL/key form.
- [ ] Save own project via Advanced: it is used from then on, even if the default exists; sign-in works against it.
- [ ] Signed in: "Add another device" shows the link, Copy works, Share (where supported) works; wording says URL and key only, never password or session. Link contains `#sync-setup=` and no `?`.
- [ ] Open the link on a second device/browser: toast confirms, address bar hash is removed, sign-in form shown, project set (own project flag set when it differs from default).
- [ ] Open a garbage `#sync-setup=abc` link: nothing happens, no toast, hash removed.
- [ ] Open a link for project B while signed in to project A: nothing changes until the user confirms; Cancel leaves A signed in.
- [ ] Open a link containing a service_role key or http url (craft by hand): ignored.
- [ ] Hash is removed from the address bar and browser history entry (back button does not re-apply).
- [ ] After the update the phone picks up the new `CACHE` (reload twice).

## Shipping checklist
- `sw.js` SHELL gains `js/services/sync/defaults.js` and `js/services/sync/setup-link.js`; bump `CACHE` (`tests/sw.test.js` already enforces the list; U8 enforces the bump).
- Update docs/SYNC.md, docs/DECISIONS.md (why fragment, why defaults are public-safe), docs/ROADMAP.md.

## Out of scope / follow-ups
- QR code of the setup link: not in this feature (no dependency allowed, no encoder exists). Follow-up.
- Social/magic-link sign-in, public sign-ups, custom SMTP, SQL/migration changes.

## Open questions
- `effectiveConnection` for `useOwnProject:true` with empty/invalid own values: returns `custom` with empty fields or `none`? Only "not default" is asserted (D8).
- Signed in, same url but different key in the link: apply or ignore? Not tested.
- When a link is applied for a different project while there is stale `meta`/session: should it be cleared? Not tested (apply only happens when signed out; stale `meta` may remain).
- Maximum accepted link length: tests only require 100 KB and 5 MB garbage to return null, not a specific limit.
- Exact UI wording of "Add another device" help text: U2 asserts only a loose pattern; adjust the regex if the wording is reasonable but different.
- `planSetupLinkApply` and the `defaults` option of `createSyncService` are this spec's own additions to the brief.

## Implementation notes (added by the implementer, not the test-designer)
- Manual checks run in the built-in browser on localhost: setup link applied + hash stripped; garbage link ignored + stripped; signed-in view shows "Add another device" with a link containing no secrets; with a temporary fake default in `defaults.js`: sign-in-only view, "Advanced: use my own project" reveals the form, "Use the built-in server instead" returns. Not run: the confirm prompt for a different project while signed in, Copy/Share on a phone, real sign-in against Supabase.
- Deviation: when the device is on the built-in default, "Add another device" shows a short "just sign in on the other device" note instead of a link (the link would be identical to the default).
- Open questions are answered as: own-project with empty values gives `none`; link applied also clears the device's `session` and `meta`.
