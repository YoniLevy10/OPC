-- Server-only delivery journal. Unique document phase + recipient across cron instances.
create table public.document_reminder_deliveries (
  delivery_key text primary key,
  document_client_id text not null,
  document_version integer not null,
  due_at timestamptz,
  stage text not null check (stage in ('six', 'two', 'month', 'overdue', 'review')),
  recipient text not null,
  status text not null check (status in ('sending', 'sent', 'failed', 'dry_run')),
  claim_token uuid not null,
  lease_until timestamptz not null,
  attempts integer not null default 1 check (attempts > 0),
  last_attempt_at timestamptz not null,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  check (status <> 'sent' or (provider_message_id is not null and sent_at is not null))
);

alter table public.document_reminder_deliveries enable row level security;
revoke all on public.document_reminder_deliveries from anon, authenticated;
grant select, insert, update on public.document_reminder_deliveries to service_role;
