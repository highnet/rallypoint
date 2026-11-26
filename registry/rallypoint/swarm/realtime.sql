-- Rallypoint Swarm — turn on live dashboard updates for an existing project.
--
-- schema.sql already does this; run this file only when your project applied
-- an older schema.sql and `npx rallypoint swarm doctor` says realtime is
-- missing. Paste it into the Supabase SQL editor, or run
--   psql "$DATABASE_URL" -f .rallypoint/swarm/realtime.sql
-- It is idempotent and changes no data: it adds the swarm's memory tables to
-- the supabase_realtime publication and defines the read-only helper doctor
-- uses to check that.

-- >>> realtime (kept identical in schema.sql and realtime.sql; scripts/test-swarm.mjs checks)
--
-- The dashboard subscribes to changes on these tables and re-renders the page
-- it shows, so it updates without a reload. It never reads the change payload:
-- every page re-reads through PostgREST, which stays the source of truth.
--
-- Privacy: Realtime applies the tables' RLS to postgres_changes, per
-- subscriber, with the subscriber's own token. The `swarm_read` policy above
-- therefore decides who hears a change exactly as it decides who reads the
-- row: in private mode only signed-in readers on the allow-list receive
-- events and the anon key receives none. swarm_secret, swarm_readers and
-- swarm_settings are never published.
--
-- Idempotent, and safe off Supabase: `alter publication ... add table` errors
-- when the table is already a member (or the publication is FOR ALL TABLES),
-- and plain Postgres has no supabase_realtime publication, so both are
-- checked first. Without the publication the dashboard polls once a minute.

create or replace function public.swarm_realtime_wanted()
returns text[] language sql immutable as $$
  select array[
    'swarm_sessions', 'swarm_progress', 'swarm_retros', 'swarm_messages',
    'swarm_results', 'swarm_versions', 'swarm_buried', 'swarm_concepts',
    'swarm_concept_trials', 'swarm_protocol_changes'
  ]
$$;

-- What `swarm doctor` asks: is the publication there, and which of the
-- wanted tables are not in it yet. Reveals table names only.
create or replace function public.swarm_realtime_status()
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'publication', exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
    'missing', coalesce((
      select jsonb_agg(t order by t)
      from unnest(public.swarm_realtime_wanted()) t
      where not exists (
        select 1 from pg_publication_tables p
        where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = t
      )
    ), '[]'::jsonb)
  )
$$;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'no supabase_realtime publication here: skipping (the swarm dashboard will poll instead)';
    return;
  end if;
  foreach t in array public.swarm_realtime_wanted() loop
    if not exists (
      select 1 from pg_publication_tables p
      where p.pubname = 'supabase_realtime' and p.schemaname = 'public' and p.tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

grant execute on function public.swarm_realtime_wanted() to anon, authenticated;
grant execute on function public.swarm_realtime_status() to anon, authenticated;
-- <<< realtime
