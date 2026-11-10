# Sync setup (Supabase)

This lets Macro Diary keep your diary in step between your phone and PC using a free Supabase project that **you** own. Your data stays in your own project; nobody else has access.

> **Verified only against a mocked server; the first real run is the owner's — report anything that differs.**
> The adapter (`js/services/sync/supabase-adapter.js`) and the SQL below have been tested against an in-memory imitation of Supabase, never against a real project. If a step below does not behave as described, or the SQL errors, please report it (paste the exact error message).

Time needed: about 15 minutes. No coding, no credit card.

## 1. Create the project

1. Go to https://supabase.com and sign up (GitHub or email).
2. Click **New project**. Pick any name (e.g. `macro-diary`), choose the region nearest you, and set a **database password** (save it in a password manager; the app never needs it).
3. Wait ~2 minutes until the dashboard says the project is ready.

## 2. Create the tables and functions (SQL)

1. In the left menu open **SQL Editor** → **New query**.
2. Paste **all** of the SQL below and click **Run**. It should finish with "Success. No rows returned". It is safe to run twice.

```sql
-- ===== Macro Diary sync schema =====

-- 1. A counter that goes up on every write. The app uses it as its "what changed since last time" bookmark.
create sequence if not exists public.records_seq;

-- 2. One row per synced record (a diary day, settings, custom foods, ...), per user.
create table if not exists public.records (
  user_id    uuid   not null default auth.uid()
             references auth.users on delete cascade,   -- deleting your account deletes your data
  key        text   not null,                            -- e.g. 'day:2026-01-31'
  value      jsonb  not null,                            -- the record itself
  updated_at bigint not null default 0,                  -- client timestamp (ms), used for last-writer-wins
  rev        bigint not null default 1,                  -- server revision of this key: 1, 2, 3 ...
  seq        bigint not null default nextval('public.records_seq'),  -- global change counter (the cursor)
  primary key (user_id, key)
);

-- Makes "give me everything newer than seq N" fast.
create index if not exists records_user_seq_idx on public.records (user_id, seq);

-- 3. Row-level security: each signed-in user can only SEE their own rows.
alter table public.records enable row level security;

drop policy if exists "read own records" on public.records;
create policy "read own records" on public.records
  for select to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policies on purpose: with RLS on, that means the app cannot write the table
-- directly. All writes must go through push_record() below.
revoke all on public.records from anon, authenticated;
grant select on public.records to authenticated;

-- 4. The only way to write. Compare-and-swap in a single statement:
--    p_base_rev = the revision the app last saw (0 = "I think this key does not exist yet").
--    If the server's revision differs, nothing is written and accepted=false is returned with the current rev.
--    SECURITY DEFINER is needed because users have no write permission on the table; the function therefore
--    ALWAYS uses auth.uid() itself (never a caller-supplied user id) and has an empty search_path.
create or replace function public.push_record(
  p_key text, p_value jsonb, p_updated_at bigint, p_base_rev bigint
) returns table(accepted boolean, rev bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_rev bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_base_rev = 0 then
    -- brand-new key: insert, unless it already exists (then it is a conflict)
    insert into public.records as r (user_id, key, value, updated_at, rev, seq)
    values (v_uid, p_key, p_value, p_updated_at, 1, nextval('public.records_seq'))
    on conflict (user_id, key) do nothing
    returning r.rev into v_rev;
  else
    -- existing key: update only if nobody changed it since the app last looked
    update public.records as r
       set value = p_value,
           updated_at = p_updated_at,
           rev = r.rev + 1,
           seq = nextval('public.records_seq')
     where r.user_id = v_uid and r.key = p_key and r.rev = p_base_rev
    returning r.rev into v_rev;
  end if;

  if v_rev is not null then
    return query select true, v_rev;
  else
    -- conflict: report the server's current revision (0 if the key does not exist)
    select r.rev into v_rev from public.records r where r.user_id = v_uid and r.key = p_key;
    return query select false, coalesce(v_rev, 0::bigint);
  end if;
end;
$$;

-- 5. Only signed-in users may call it (not the anonymous public).
revoke all on function public.push_record(text, jsonb, bigint, bigint) from public, anon;
grant execute on function public.push_record(text, jsonb, bigint, bigint) to authenticated;
```

If you get an error, copy the **whole** message, do not edit the SQL by hand, and report it.

## 3. Authentication settings

In the dashboard open **Authentication** (left menu).

1. **Sign In / Providers** (or *Providers*) → make sure **Email** is **enabled**.
2. **Confirm email**: for a single-user setup, **turn it off**. Reason: with it on, you must click a link in an email before you can ever sign in, and the free tier's built-in email sender is heavily rate-limited, so the confirmation mail often never arrives. Turning it off lets you create your account and sign in at once. (If you leave it on, the app will say "Account created — confirm your email, then sign in"; click the link, then sign in.)
3. Create your account **in the app** (Settings → Sync → create account) using your email and a strong password.
4. **Then disable public sign-ups** so nobody else can register against your project: **Authentication → Sign In / Providers → "Allow new users to sign up"** → turn **off** (older dashboards: *Authentication → Settings → "Enable sign ups"*). Existing accounts keep working. To add a second device you simply **sign in** with the same account; no new sign-up is needed.

## 4. Find the Project URL and anon key

Open **Project Settings → API** (or **Data API / API Keys**, depending on dashboard version).

- **Project URL**: looks like `https://abcdxyz.supabase.co`.
- **anon / public key** (a long string starting `eyJ...`, or a "publishable" key): this key is **public by design**. It only identifies your project; what a user may do is controlled by the row-level security above.
- **NEVER paste the `service_role` (secret) key into the app, this repo, a chat, or anywhere else.** It bypasses all security. The app does not need it. If you ever pasted it somewhere, rotate it in the same settings page.

## 5. Connect the app

1. Open Macro Diary → **Settings → Sync**.
2. Paste the **Project URL** and the **anon key**, enter your email + password, press **Create account** (first time) or **Sign in**.
3. Press **Sync now**. Do the same on your other device (sign in with the same account; first sync there pulls everything down and merges it with what is already on that device).

The URL, anon key and your login session are stored only in that browser on that device.

### What "sync" does

- **Pull**: asks the server for records changed since the last time this device synced, and merges them in (newest edit wins; deletions are kept as tombstones so they propagate).
- **Push**: sends the records you changed here. If someone (another device) changed the same record in the meantime, the server refuses the write (a "conflict"); the app then pulls the newer version, merges, and retries. Nothing is silently overwritten.
- Only changes travel, not your whole history. The app works fully offline; sync happens when it can.

## 6. Check that it worked

Dashboard → **Table Editor** → `records`. You should see rows such as `day:2026-…` and `settings`, with `rev` starting at 1 and rising each time that record is changed. `seq` rises with every write.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "Signed out — please sign in again" / HTTP 401 | The login expired or was revoked. Sign in again in Settings → Sync. Also double-check the anon key was pasted completely (no spaces/line breaks) and belongs to this project. |
| "Invalid login credentials" | Wrong email/password, or you never created the account (and sign-ups are now disabled — re-enable temporarily, or create the user under Authentication → Users → Add user). |
| "Account created — confirm your email" | "Confirm email" is still on. Click the link in the email, or turn the setting off (step 3) and add the user manually. |
| "Rate limited" / HTTP 429 (also `email rate limit exceeded`) | Too many requests or sign-up emails in a short time. Wait a few minutes. Turning off "Confirm email" avoids the email limit. |
| "permission denied" / "function ... does not exist" / HTTP 404 on `rpc/push_record` | The SQL in step 2 was not run completely. Run it again (it is repeatable). |
| Network error / project not responding | **Free projects are paused after about a week of inactivity.** Open the dashboard and click **Restore project** (takes a couple of minutes). Using the app regularly with sync on keeps it active. Paused projects can be restored for a limited time; keep a regular **Backup** export from the app too. |
| Changes seem to lose to old data, or weird "future" timestamps | **Clock skew**: conflict resolution uses each device's clock. If a phone's date/time is wrong (set manually, or hours off), its edits can wrongly win or lose. Turn on automatic date & time on every device. |
| One device never receives the other's data | Make sure both are signed into the **same account** and the **same project URL**. Press Sync now on both. |

## Delete all your data

- **Only the synced copy, keep the account**: Dashboard → **SQL Editor** → run `delete from public.records;` (this clears the table for everyone — fine for a single-user project). The data on your devices is untouched and will be re-uploaded on the next sync, so sign out/disable sync first if you do not want that.
- **Account and its data**: **Authentication → Users** → open your user → **Delete user**. Rows are removed automatically (`on delete cascade`).
- **Everything**: **Project Settings → General → Delete project**.
- Local data on a device is separate: clear it from the app (or the browser's site data), after taking a Backup export if you want to keep it.

## Notes for developers

- Cursor = the largest `seq` seen, as a string. The server assigns `seq` from a sequence at write time; two concurrent transactions could in theory commit out of order, and a reader could skip the earlier one. For a single user syncing a few devices this is negligible; the engine's periodic full re-pull from a null cursor would repair it.
- Auth tokens expire (default 1 hour); the adapter refreshes them automatically and hands the new session to the app through `onSession` to persist.

## Try sync without Supabase (development only)

`npm run mock` starts a tiny in-memory stand-in for the Supabase endpoints on http://localhost:54321 (`scripts/mock-supabase.mjs`). Data is lost when it stops and any email/password is accepted, so it is only for trying the flow or developing the client. To simulate two devices on one computer, run `npm start` and open **http://localhost:8080** and **http://127.0.0.1:8080** — browsers keep separate storage for each, so each behaves like its own device. In Settings → Sync use URL `http://localhost:54321` (plain http is only accepted for localhost) and any 20+ character string as the key.

This is how the sign-in → log → sync → delete → sync flow was verified end to end in the browser during development (see the Stage 2 notes in [ROADMAP.md](ROADMAP.md)). It proves the client; it does **not** prove the SQL.
