-- Link locked engagements to the professionals book when known.

alter table public.engagements
  add column if not exists professional_id uuid references public.professionals(id) on delete set null;

create index if not exists engagements_professional_id_idx
  on public.engagements (professional_id)
  where professional_id is not null;
