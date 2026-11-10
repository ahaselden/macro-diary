-- Macro Diary sync schema. Applied automatically by the Supabase GitHub integration when this file reaches `main`.
-- Keep identical to the SQL block in docs/SYNC-SETUP.md (tests/supabase-migration.test.js checks that).
-- Migrations are forward-only: never edit this file after it has been applied; add a new, later-dated file instead.

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
