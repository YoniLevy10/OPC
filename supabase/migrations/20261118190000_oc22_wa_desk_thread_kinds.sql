-- OC-22: WhatsApp desk — thread kinds, bot mode, confirm reminder ladder.
-- Additive only; missing-column fallbacks remain in app code.

alter table if exists public.intake_sessions
  add column if not exists thread_kind text not null default 'store_manager',
  add column if not exists bot_mode text not null default 'auto',
  add column if not exists linked_professional_id uuid null,
  add column if not exists linked_ticket_id uuid null;

alter table if exists public.intake_sessions
  drop constraint if exists intake_sessions_thread_kind_check;
alter table if exists public.intake_sessions
  add constraint intake_sessions_thread_kind_check
  check (thread_kind in ('store_manager', 'pro_coord', 'ops_broadcast'));

alter table if exists public.intake_sessions
  drop constraint if exists intake_sessions_bot_mode_check;
alter table if exists public.intake_sessions
  add constraint intake_sessions_bot_mode_check
  check (bot_mode in ('auto', 'paused', 'never'));

create index if not exists intake_sessions_thread_kind_idx
  on public.intake_sessions (thread_kind);

alter table if exists public.tickets
  add column if not exists awaiting_store_confirm_since timestamptz null,
  add column if not exists confirm_reminder_level smallint not null default 0;

alter table if exists public.inbox_messages
  add column if not exists media_url text null,
  add column if not exists media_kind text null;

alter table if exists public.whatsapp_messages
  add column if not exists media_url text null,
  add column if not exists media_kind text null;
