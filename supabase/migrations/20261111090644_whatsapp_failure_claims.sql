-- Atomically lease due WhatsApp failures so overlapping cron invocations don't
-- send the same row concurrently. Claims expire after five minutes on worker crash.
alter table public.whatsapp_send_failures
  add column if not exists claimed_at timestamptz;

create or replace function public.claim_whatsapp_send_failures(
  p_limit integer default 40
)
returns setof public.whatsapp_send_failures
language sql
security invoker
set search_path = ''
as $$
  with candidates as (
    select id
    from public.whatsapp_send_failures
    where status = 'pending'
      and next_retry_at <= now()
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by next_retry_at asc
    for update skip locked
    limit greatest(0, least(p_limit, 200))
  )
  update public.whatsapp_send_failures as failures
  set claimed_at = now(), updated_at = now()
  from candidates
  where failures.id = candidates.id
  returning failures.*;
$$;

revoke all on function public.claim_whatsapp_send_failures(integer) from public;
grant execute on function public.claim_whatsapp_send_failures(integer) to service_role;
