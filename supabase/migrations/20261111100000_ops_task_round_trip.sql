-- Preserve the full task workflow state when the ops ledger is hydrated and saved.
alter table public.ops_tasks
  add column if not exists status text,
  add column if not exists repeat_days integer,
  add column if not exists next_opened boolean not null default false;

-- Backfill legacy rows from the flags used before explicit task statuses existed.
update public.ops_tasks
set status = case
  when done then 'done'
  when needs_clarification then 'waiting'
  else 'open'
end
where status is null;
