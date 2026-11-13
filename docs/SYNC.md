# How sync works (and why)

Goal: log on your phone, open the PC, see the same diary — without a server we have to babysit, and without ever blocking the app on the network. The app stays **offline-first**: the device's own copy (`localStorage`) is always the one the UI reads and writes. Sync is a background reconciliation with a small cloud database.

> Setup instructions for the owner are in [SYNC-SETUP.md](SYNC-SETUP.md). This page explains the design so it can be reviewed or changed.

## The three pieces

```
 ui/sync-view.js ── Settings → Sync card (sign in, "Sync now", status)
        │
 services/sync/index.js ── glue: config + session + engine + debounced auto-sync
        │
        ├── services/sync/engine.js          pull → merge → push loop (backend-agnostic)
        │       ├── domain/sync-records.js   state ⇄ records, hashing
        │       └── domain/merge.js          last-writer-wins merge (D9)
        └── an ADAPTER (the only backend-specific code)
                ├── services/sync/supabase-adapter.js   REST to Supabase (no SDK)
                └── services/sync/memory-adapter.js     in-memory server, used by tests
```
The engine never knows which backend it talks to, so switching to Firebase, a Cloudflare Worker, or a file in a cloud drive means writing one new adapter (~100 lines) — nothing else changes.

## Records, not snapshots

The unit that travels is a **record**: `{ key, value, updatedAt }`.

| key | contents |
|-----|----------|
| `day:2026-03-04` | all entries logged that day |
| `settings` | goals, weight unit, database toggles (+ their timestamp) |
| `custom`, `measures` | your saved (custom) foods, each with a stable `id`; saved measures like "1 cup = 125 g", keyed by the saved food's id (D53) |
| `tombstones` | ids of deleted things, with deletion times |

**Saved foods match by `id` (D53).** Two devices agree on which saved food is which by its `id`, so a rename on one device updates the same food on the other instead of leaving the old name behind. The newest edit of a food wins as a whole record, and a tombstone for a food id hides a food last edited before it. A food from a device still on the old app has no `id`: merge derives one from its name, brand, source and barcode (the same id the migration gives it), so it meets the same food. That device also keeps writing measures under the food's name; merge folds those into the id bucket. Copies of a saved food (diary entries, recipe and plan foods) carry its id as `foodId`; one that arrives from an old-app device has none.

Why records: only what changed is uploaded and downloaded, so a five-year history does not re-send on every change; and a conflict only affects one day, not your whole diary. Why *not* one record per entry: more rows and requests for no benefit at this size.

## One sync, step by step

1. **Pull** records changed on the server since this device's *cursor* (a server counter it remembers).
2. **Merge** them into the local state with `mergeStates` (last-writer-wins per entry, tombstones for deletions; see [D9](DECISIONS.md#d9-last-writer-wins-per-record-with-tombstones-for-merging-restore-now-sync-later--made-without-the-owner)). The UI is refreshed only if something actually changed.
3. **Find what's dirty**: each local record is hashed and compared with the hash recorded at the last successful sync. Records that differ are uploaded.
4. **Push** each dirty record with the server revision this device last saw (`baseRev`). The server accepts it only if that is still the current revision (compare-and-swap). If another device pushed in between, it is a **conflict**: the engine goes back to step 1 (the merge now includes the other device's change) and tries again, up to four rounds.
5. **Save** the new cursor, revisions and hashes. If anything failed (offline, server error), nothing is marked as synced and the cursor does not advance, so the next attempt redoes the work — nothing is lost.

A sync where nothing changed anywhere uploads nothing.

## Why it converges

`mergeStates` is commutative, associative and idempotent (property-tested over random states and by a randomized three-device simulation in `tests/sync-engine.test.js`). In plain terms: no matter which device syncs when, or how many times, they all end up with the same result. Deleting something on one device removes it everywhere because the deletion is a tombstone that outranks any older edit; editing it *after* the deletion on another device brings it back, which is the safest outcome for a food diary.

## What does not sync

`theme` and the *recent foods* list stay on each device ([D10](DECISIONS.md)). The USDA key (`apiKey`) stays on the device **unless** the owner turns on "Sync my USDA key to my other devices" in Settings; then it travels, in plain text, inside the `settings` record ([D42](DECISIONS.md)). Devices on an older app version do not know the switch: update all devices before relying on it. The sync **session token** is also kept apart from your data (`macrodiary.sync.v1`), so it is never in a backup file or merged into anything.

## Security model

- The page only ever talks to **your** Supabase project, and only over https (`normalizeUrl` refuses anything else except `localhost` for development).
- The key the page uses (`anon`) is public by design. What protects your data is **row-level security** in the database: every row has a `user_id` and the policy only lets you read your own; writes only go through one SQL function. Never paste the `service_role` key anywhere.
- Everything that comes back from the server is treated as untrusted: records are validated and run through the same rules as a restored backup file before they touch your state, and anything rendered is escaped.
- Passwords are never stored by the app; only the session tokens Supabase returns are.

## Setup: built-in default project and setup link
A device uses its own project if the user set one, else the built-in default in `js/services/sync/defaults.js` (the owner's project), else nothing. A signed-in device can show a link (`#sync-setup=…`, URL + key only) that pre-fills Settings → Sync on another device. See D25.

## Known limits (honest list)

- **Not verified against a real server yet.** The adapter and SQL were tested against a mock written from Supabase's documented behaviour. The first real run will be the owner's.
- **Device clocks are trusted** for "which edit is newer". A device with a badly wrong clock can lose or win edits unfairly. Fine for one person; a hybrid logical clock would fix it if ever needed.
- **Tombstones grow forever** until pruned (`pruneTombstones` exists but is not scheduled). Tiny in practice.
- **No live push** (no websockets): a device picks up changes when it syncs (on load, after changes, or "Sync now"), not instantly.
- **Free tier**: Supabase pauses projects after a week of inactivity; waking it is one click.
