alter table public.intake_sessions
  add column if not exists customer_name text;

comment on column public.intake_sessions.customer_name is
  'Optional customer label maintained by operations for WhatsApp inbox sessions.';
