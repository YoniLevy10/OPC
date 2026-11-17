-- CRITICAL: close rls_disabled_in_public for OpticalCenter (pfsxuylbnpbcgjehuaqo).
--
-- App data paths for these tables use createSystemClient / service role after
-- requireActor (or cron/webhook secrets). Enabling RLS with no authenticated
-- policies locks anon/authenticated PostgREST access without changing HQ
-- middleware (memberships already load via system client — auth-middleware-safety).

-- ---------------------------------------------------------------------------
-- 1) Idempotent: enable RLS on every public base table that still lacks it
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
      and c.relname not like 'pg_%'
  loop
    execute format(
      'alter table public.%I enable row level security',
      r.table_name
    );
    raise notice 'enabled RLS on public.%', r.table_name;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2) Explicit targets known missing from prior migrations
-- ---------------------------------------------------------------------------

alter table if exists public.store_code_aliases enable row level security;
alter table if exists public.service_visits enable row level security;
alter table if exists public.service_visit_tickets enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Service-role policies (document intent; service_role also bypasses RLS)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.store_code_aliases') is not null then
    begin
      create policy service_role_bypass_store_code_aliases
        on public.store_code_aliases
        for all to service_role
        using (true) with check (true);
    exception
      when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.service_visits') is not null then
    begin
      create policy service_role_bypass_service_visits
        on public.service_visits
        for all to service_role
        using (true) with check (true);
    exception
      when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.service_visit_tickets') is not null then
    begin
      create policy service_role_bypass_service_visit_tickets
        on public.service_visit_tickets
        for all to service_role
        using (true) with check (true);
    exception
      when duplicate_object then null;
    end;
  end if;
end
$$;

-- No authenticated/anon policies on purpose: least privilege.
-- HQ/API continues via requireActor + createSystemClient (service role).
