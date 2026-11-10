// The database schema exists in two places a human reads: docs/SYNC-SETUP.md (manual setup) and the migration the Supabase
// GitHub integration applies on merge to main. They must never drift, and the security-critical lines must never disappear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');
const files = readdirSync(new URL('supabase/migrations/', root)).filter(f => f.endsWith('.sql'));
const docSql = read('docs/SYNC-SETUP.md').match(/```sql\n([\s\S]*?)\n```/)[1].trim();

test('there is exactly one sync migration with a valid timestamped name', () => {
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{14}_[a-z0-9_]+\.sql$/);
});
test('the migration contains the SQL from docs/SYNC-SETUP.md unchanged', () => {
  assert.ok(read('supabase/migrations/' + files[0]).includes(docSql), 'migration and docs/SYNC-SETUP.md differ: update both');
});
test('security-critical statements are present: RLS on, no direct writes, definer function pinned and restricted', () => {
  const sql = read('supabase/migrations/' + files[0]).toLowerCase();
  for (const must of ['alter table public.records enable row level security', 'revoke all on public.records from anon, authenticated',
    'grant select on public.records to authenticated', "set search_path = ''", 'security definer', 'auth.uid()',
    'revoke all on function public.push_record(text, jsonb, bigint, bigint) from public, anon',
    'grant execute on function public.push_record(text, jsonb, bigint, bigint) to authenticated'])
    assert.ok(sql.includes(must), 'missing: ' + must);
});
test('the migration never grants write access to the table, never touches service_role, and is re-runnable', () => {
  const sql = read('supabase/migrations/' + files[0]).toLowerCase();
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete|all)\b[^;]*on\s+public\.records/);
  assert.doesNotMatch(sql, /service_role/);
  assert.doesNotMatch(sql, /drop\s+(table|schema|function|sequence)\b/);
  assert.match(sql, /create table if not exists/); assert.match(sql, /create or replace function/);
});
