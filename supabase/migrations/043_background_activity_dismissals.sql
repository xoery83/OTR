create table if not exists public.background_activity_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_key text not null,
  job_id uuid references public.background_jobs(id) on delete cascade,
  batch_id uuid references public.background_job_batches(id) on delete cascade,
  status text not null
    check (status in ('queued', 'uploading', 'processing', 'waiting_for_user', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (
    (job_id is not null and batch_id is null)
    or (job_id is null and batch_id is not null)
  )
);

create unique index if not exists background_activity_dismissals_user_key_unique
  on public.background_activity_dismissals(user_id, activity_key);

create index if not exists background_activity_dismissals_user_idx
  on public.background_activity_dismissals(user_id, created_at desc);

alter table public.background_activity_dismissals enable row level security;

drop policy if exists "Users can read their background activity dismissals"
  on public.background_activity_dismissals;
create policy "Users can read their background activity dismissals"
  on public.background_activity_dismissals
  for select
  using (user_id = auth.uid());

drop policy if exists "Users can create their background activity dismissals"
  on public.background_activity_dismissals;
create policy "Users can create their background activity dismissals"
  on public.background_activity_dismissals
  for insert
  with check (user_id = auth.uid());

drop policy if exists "Users can delete their background activity dismissals"
  on public.background_activity_dismissals;
create policy "Users can delete their background activity dismissals"
  on public.background_activity_dismissals
  for delete
  using (user_id = auth.uid());
