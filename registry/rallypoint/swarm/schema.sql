-- Rallypoint Swarm — shared memory schema (schema version 1).
--
-- Apply once to YOUR OWN Supabase project: paste into the SQL editor, or run
--   psql "$DATABASE_URL" -f .rallypoint/swarm/schema.sql
-- It is idempotent: re-running it upgrades in place and keeps your data.
--
-- Then set the agents' write secret (at least 16 characters) with
--   npx rallypoint swarm connect
-- which prompts for it, sets it with the service-role key and writes the
-- gitignored env files. Or, in the SQL editor:
--   select public.swarm_set_secret('a-long-random-secret');
-- and give that same value to agents as RALLYPOINT_SWARM_SECRET.
--
-- Model
--   * GitHub owns the work (issues, claims, pull requests, reviews, merges).
--     This database owns the memory: sessions, progress, retros, messages,
--     referee results, shipped versions, buried ideas, concepts.
--   * Everyone allowed to read reads through RLS (public, or signed-in when
--     visibility is "private"). Nobody writes through tables: there are no
--     insert/update/delete policies.
--   * Agents write only through the SECURITY DEFINER functions below, each of
--     which first checks the swarm secret against a bcrypt hash.
--   * Nothing here calls Rallypoint. There is no Rallypoint server.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.swarm_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Single-row secret store. Never readable by anon/authenticated.
create table if not exists public.swarm_secret (
  id int primary key default 1 check (id = 1),
  hash text not null,
  updated_at timestamptz not null default now()
);

-- Optional allow-list for private mode. Empty = any signed-in user may read.
create table if not exists public.swarm_readers (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_sessions (
  id uuid primary key default gen_random_uuid(),
  agent text not null,
  role text,
  target text,
  issue int,
  pr int,
  status text not null default 'working'
    check (status in ('working', 'ended', 'abandoned')),
  summary text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.swarm_progress (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.swarm_sessions (id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_retros (
  id bigint generated always as identity primary key,
  session_id uuid references public.swarm_sessions (id) on delete set null,
  role text,
  protocol_version text,
  went_well text,
  friction text,
  suggestion text,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_messages (
  id bigint generated always as identity primary key,
  thread_id bigint references public.swarm_messages (id) on delete cascade,
  session_id uuid references public.swarm_sessions (id) on delete set null,
  author text not null,
  kind text not null default 'note'
    check (kind in ('question', 'proposal', 'handoff', 'answer', 'note')),
  ref text,
  topic text,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_results (
  id bigint generated always as identity primary key,
  session_id uuid references public.swarm_sessions (id) on delete set null,
  target text,
  issue int,
  pr int,
  commit_sha text,
  baseline_sha text,
  mode text not null default 'score' check (mode in ('score', 'checks', 'review')),
  candidate_score double precision,
  baseline_score double precision,
  delta double precision,
  direction text check (direction in ('higher', 'lower')),
  margin double precision,
  passed boolean not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_versions (
  id bigint generated always as identity primary key,
  target text,
  version text not null,
  score double precision,
  pr int,
  commit_sha text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_buried (
  id bigint generated always as identity primary key,
  target text,
  issue int,
  pr int,
  idea text not null,
  concept text,
  reason text not null,
  lesson text,
  numbers jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_concepts (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_concept_trials (
  id bigint generated always as identity primary key,
  concept_id text not null references public.swarm_concepts (id) on delete cascade,
  target text not null,
  outcome text not null check (outcome in ('gained', 'lost', 'neutral')),
  delta double precision,
  ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.swarm_protocol_changes (
  id bigint generated always as identity primary key,
  version text not null,
  issue int,
  pr int,
  summary text not null,
  kept boolean,
  created_at timestamptz not null default now()
);

-- Upgrades from earlier drafts of schema version 1.
alter table public.swarm_results add column if not exists mode text not null default 'score';

create index if not exists swarm_sessions_status_idx on public.swarm_sessions (status, last_seen_at desc);
create index if not exists swarm_progress_session_idx on public.swarm_progress (session_id, created_at desc);
create index if not exists swarm_retros_created_idx on public.swarm_retros (created_at desc);
create index if not exists swarm_messages_created_idx on public.swarm_messages (created_at desc);
create index if not exists swarm_messages_thread_idx on public.swarm_messages (thread_id);
create index if not exists swarm_results_created_idx on public.swarm_results (created_at desc);
create index if not exists swarm_versions_target_idx on public.swarm_versions (target, created_at desc);
create index if not exists swarm_buried_created_idx on public.swarm_buried (created_at desc);
create index if not exists swarm_trials_concept_idx on public.swarm_concept_trials (concept_id, target);

insert into public.swarm_settings (key, value) values
  ('visibility', '"public"'),
  ('protocol_version', '"p1"')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Read access
-- ---------------------------------------------------------------------------

create or replace function public.swarm_schema_version()
returns int language sql immutable as $$ select 1 $$;

create or replace function public.swarm_can_read()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  visibility text;
  v_email text;
begin
  select value #>> '{}' into visibility from public.swarm_settings where key = 'visibility';
  if coalesce(visibility, 'public') = 'public' then
    return true;
  end if;
  if coalesce(auth.role(), '') <> 'authenticated' then
    return false;
  end if;
  if not exists (select 1 from public.swarm_readers) then
    return true;
  end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  return exists (select 1 from public.swarm_readers r where lower(r.email) = v_email);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'swarm_settings', 'swarm_sessions', 'swarm_progress', 'swarm_retros',
    'swarm_messages', 'swarm_results', 'swarm_versions', 'swarm_buried',
    'swarm_concepts', 'swarm_concept_trials', 'swarm_protocol_changes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists swarm_read on public.%I', t);
    execute format(
      'create policy swarm_read on public.%I for select to anon, authenticated using (public.swarm_can_read())',
      t
    );
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end;
$$;

-- The secret and the reader list are never exposed.
alter table public.swarm_secret enable row level security;
alter table public.swarm_readers enable row level security;
revoke all on public.swarm_secret from anon, authenticated;
revoke all on public.swarm_readers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create or replace view public.swarm_fleet
with (security_invoker = true) as
select
  s.id,
  s.agent,
  s.role,
  s.target,
  s.issue,
  s.pr,
  s.started_at,
  s.last_seen_at,
  p.note as latest_note,
  p.created_at as latest_note_at
from public.swarm_sessions s
left join lateral (
  select note, created_at
  from public.swarm_progress
  where session_id = s.id
  order by created_at desc
  limit 1
) p on true
where s.status = 'working'
  and s.last_seen_at > now() - interval '2 hours'
order by s.last_seen_at desc;

-- "Claim to close" is measured on worker sessions: from the session opening
-- (just before the claim) to its end (pull request submitted or released).
create or replace view public.swarm_metrics
with (security_invoker = true) as
with
  last_change as (
    select max(created_at) as at from public.swarm_protocol_changes
  ),
  counts as (
    select
      (select count(*) from public.swarm_versions) as shipped,
      (select count(*) from public.swarm_buried) as buried,
      (select count(*) from public.swarm_sessions) as sessions,
      (select count(*) from public.swarm_progress) as progress,
      (select count(*) from public.swarm_sessions
         where status = 'working' and last_seen_at > now() - interval '2 hours') as working
  )
select
  coalesce((select value #>> '{}' from public.swarm_settings where key = 'protocol_version'), 'p1')
    as protocol_version,
  c.shipped,
  c.buried,
  case when c.shipped + c.buried = 0 then null
       else round(c.shipped::numeric / (c.shipped + c.buried), 4) end as ship_rate,
  (select round((percentile_cont(0.5) within group (
       order by extract(epoch from (ended_at - started_at)) / 60.0))::numeric, 1)
     from public.swarm_sessions
     where role = 'worker' and ended_at is not null) as median_claim_to_close_minutes,
  case when c.sessions = 0 then null
       else round(c.progress::numeric / c.sessions, 2) end as progress_per_session,
  (select count(*) from public.swarm_retros r, last_change l
     where l.at is null or r.created_at > l.at) as retros_since_change,
  c.working as sessions_working
from counts c;

grant select on public.swarm_fleet, public.swarm_metrics to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writes (agents only, via the swarm secret)
-- ---------------------------------------------------------------------------

create or replace function public.swarm_set_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_secret is null or length(p_secret) < 16 then
    raise exception 'the swarm secret must be at least 16 characters';
  end if;
  insert into public.swarm_secret (id, hash, updated_at)
  values (1, extensions.crypt(p_secret, extensions.gen_salt('bf', 10)), now())
  on conflict (id) do update set hash = excluded.hash, updated_at = now();
end;
$$;

create or replace function public.swarm_assert_secret(p_secret text)
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  stored text;
begin
  select hash into stored from public.swarm_secret where id = 1;
  if stored is null then
    raise exception 'no swarm secret is set; run npx rallypoint swarm connect, or select public.swarm_set_secret(''…'') in the SQL editor'
      using errcode = '28000';
  end if;
  if p_secret is null or extensions.crypt(p_secret, stored) <> stored then
    raise exception 'invalid swarm secret' using errcode = '28P01';
  end if;
end;
$$;

create or replace function public.swarm_writable(p_table text)
returns boolean
language sql
immutable
as $$
  select p_table = any (array[
    'swarm_sessions', 'swarm_progress', 'swarm_retros', 'swarm_messages',
    'swarm_results', 'swarm_versions', 'swarm_buried', 'swarm_concepts',
    'swarm_concept_trials', 'swarm_protocol_changes'
  ])
$$;

create or replace function public.swarm_write(p_secret text, p_table text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cols text;
  bad text;
  result jsonb;
begin
  perform public.swarm_assert_secret(p_secret);
  if not public.swarm_writable(p_table) then
    raise exception 'table % is not writable', p_table using errcode = '42501';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' or p_row = '{}'::jsonb then
    raise exception 'row must be a non-empty JSON object' using errcode = '22023';
  end if;

  -- Only real, non-generated columns may be written.
  select string_agg(k, ', ') into bad
  from jsonb_object_keys(p_row) k
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_table
      and c.column_name = k and c.is_identity = 'NO'
  );
  if bad is not null then
    raise exception 'unknown or generated column(s) for %: %', p_table, bad using errcode = '42703';
  end if;

  select string_agg(format('%I', k), ', ') into cols from jsonb_object_keys(p_row) k;
  execute format(
    'insert into public.%1$I as t (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) returning to_jsonb(t.*)',
    p_table, cols
  ) into result using p_row;
  return result;
end;
$$;

create or replace function public.swarm_update(p_secret text, p_table text, p_id text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  allowed text[];
  bad text;
  sets text;
  id_type text;
  result jsonb;
begin
  perform public.swarm_assert_secret(p_secret);
  allowed := case p_table
    when 'swarm_sessions' then array['agent', 'role', 'target', 'issue', 'pr', 'status', 'summary', 'last_seen_at', 'ended_at']
    when 'swarm_protocol_changes' then array['issue', 'pr', 'summary', 'kept']
    when 'swarm_concepts' then array['name', 'description']
    else null
  end;
  if allowed is null then
    raise exception 'table % is not updatable', p_table using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'patch must be a non-empty JSON object' using errcode = '22023';
  end if;
  select string_agg(k, ', ') into bad from jsonb_object_keys(p_patch) k where not (k = any (allowed));
  if bad is not null then
    raise exception 'column(s) not updatable on %: %', p_table, bad using errcode = '42501';
  end if;

  select string_agg(format('%1$I = r.%1$I', k), ', ') into sets from jsonb_object_keys(p_patch) k;
  id_type := case p_table when 'swarm_sessions' then 'uuid' when 'swarm_concepts' then 'text' else 'bigint' end;
  execute format(
    'update public.%1$I as t set %2$s from jsonb_populate_record(null::public.%1$I, $1) r where t.id = $2::%3$s returning to_jsonb(t.*)',
    p_table, sets, id_type
  ) into result using p_patch, p_id;
  if result is null then
    raise exception 'no % row with id %', p_table, p_id using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.swarm_set_setting(p_secret text, p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.swarm_assert_secret(p_secret);
  if p_key not in ('visibility', 'protocol_version', 'goal', 'targets', 'ui') then
    raise exception 'setting % is not writable', p_key using errcode = '42501';
  end if;
  if p_key = 'visibility' and (p_value #>> '{}') not in ('public', 'private') then
    raise exception 'visibility must be "public" or "private"' using errcode = '22023';
  end if;
  insert into public.swarm_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$$;

-- Agents read through this when the swarm is private: RLS hides every table
-- from the anon key then, and agents must still see their own memory.
-- Filters are {"column": "eq.value" | "gt.value"} on real columns only.
create or replace function public.swarm_read(
  p_secret text,
  p_table text,
  p_filters jsonb default '{}'::jsonb,
  p_order text default null,
  p_limit int default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  conditions text := '';
  col text;
  cond text;
  op text;
  order_sql text := '';
  result jsonb;
begin
  perform public.swarm_assert_secret(p_secret);
  if not (public.swarm_writable(p_table) or p_table in ('swarm_settings', 'swarm_fleet', 'swarm_metrics')) then
    raise exception 'table % is not readable', p_table using errcode = '42501';
  end if;
  for col, cond in select key, value #>> '{}' from jsonb_each(coalesce(p_filters, '{}'::jsonb)) loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = p_table and c.column_name = col
    ) then
      raise exception 'unknown column % on %', col, p_table using errcode = '42703';
    end if;
    op := split_part(cond, '.', 1);
    if op not in ('eq', 'gt') then
      raise exception 'filter % must be eq.<value> or gt.<value>', col using errcode = '22023';
    end if;
    conditions := conditions || format(
      ' and %I::text %s %L',
      col,
      case op when 'eq' then '=' else '>' end,
      substr(cond, length(op) + 2)
    );
  end loop;
  if p_order is not null then
    col := split_part(p_order, '.', 1);
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = p_table and c.column_name = col
    ) then
      raise exception 'unknown order column % on %', col, p_table using errcode = '42703';
    end if;
    order_sql := format(' order by %I %s', col, case when p_order like '%.desc' then 'desc' else 'asc' end);
  end if;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I where true%s%s%s) t',
    p_table,
    conditions,
    order_sql,
    case when p_limit is not null then format(' limit %s', greatest(p_limit, 0)) else '' end
  ) into result;
  return result;
end;
$$;

create or replace function public.swarm_check(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.swarm_assert_secret(p_secret);
  return jsonb_build_object('ok', true, 'schema_version', public.swarm_schema_version());
end;
$$;

-- Function privileges: everything is revoked from PUBLIC first, then only
-- the secret-checked RPCs and read helpers are granted.
revoke all on function public.swarm_set_secret(text) from public, anon, authenticated;
-- service_role is the project's admin key; `rallypoint swarm connect` uses it
-- once to set the secret over the API instead of the SQL editor.
grant execute on function public.swarm_set_secret(text) to service_role;
revoke all on function public.swarm_assert_secret(text) from public, anon, authenticated;
revoke all on function public.swarm_write(text, text, jsonb) from public;
revoke all on function public.swarm_update(text, text, text, jsonb) from public;
revoke all on function public.swarm_set_setting(text, text, jsonb) from public;
revoke all on function public.swarm_check(text) from public;
revoke all on function public.swarm_read(text, text, jsonb, text, int) from public;
grant execute on function public.swarm_read(text, text, jsonb, text, int) to anon, authenticated;
grant execute on function public.swarm_write(text, text, jsonb) to anon, authenticated;
grant execute on function public.swarm_update(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.swarm_set_setting(text, text, jsonb) to anon, authenticated;
grant execute on function public.swarm_check(text) to anon, authenticated;
grant execute on function public.swarm_schema_version() to anon, authenticated;
grant execute on function public.swarm_can_read() to anon, authenticated;
grant execute on function public.swarm_writable(text) to anon, authenticated;
