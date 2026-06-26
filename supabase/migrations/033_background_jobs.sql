create table if not exists public.background_job_batches (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  batch_type text not null,
  title text not null,
  total_items integer not null default 0,
  completed_items integer not null default 0,
  failed_items integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued', 'uploading', 'processing', 'waiting_for_user', 'completed', 'failed', 'cancelled')),
  current_step text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.background_job_batches(id) on delete set null,
  journey_id uuid references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  job_type text not null,
  title text not null,
  status text not null default 'queued'
    check (status in ('queued', 'uploading', 'processing', 'waiting_for_user', 'completed', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  current_step text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists background_job_batches_journey_idx
  on public.background_job_batches(journey_id, created_at desc);

create index if not exists background_job_batches_user_status_idx
  on public.background_job_batches(user_id, status, created_at desc);

create index if not exists background_jobs_journey_status_idx
  on public.background_jobs(journey_id, status, created_at desc);

create index if not exists background_jobs_user_status_idx
  on public.background_jobs(user_id, status, available_at, created_at);

create index if not exists background_jobs_batch_idx
  on public.background_jobs(batch_id);

create unique index if not exists background_jobs_active_media_job_idx
  on public.background_jobs(job_type, ((payload->>'mediaAssetId')))
  where status in ('queued', 'uploading', 'processing', 'waiting_for_user')
    and payload ? 'mediaAssetId';

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists background_job_batches_touch_updated_at
  on public.background_job_batches;
create trigger background_job_batches_touch_updated_at
before update on public.background_job_batches
for each row execute function public.touch_updated_at();

drop trigger if exists background_jobs_touch_updated_at
  on public.background_jobs;
create trigger background_jobs_touch_updated_at
before update on public.background_jobs
for each row execute function public.touch_updated_at();

alter table public.background_job_batches enable row level security;
alter table public.background_jobs enable row level security;

drop policy if exists "Trip members can read background job batches"
  on public.background_job_batches;
create policy "Trip members can read background job batches"
  on public.background_job_batches
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.trip_members
      where trip_members.trip_id = background_job_batches.journey_id
        and trip_members.user_id = auth.uid()
    )
  );

drop policy if exists "Trip members can create background job batches"
  on public.background_job_batches;
create policy "Trip members can create background job batches"
  on public.background_job_batches
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      journey_id is null
      or exists (
        select 1 from public.trip_members
        where trip_members.trip_id = background_job_batches.journey_id
          and trip_members.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Job owners can update background job batches"
  on public.background_job_batches;
create policy "Job owners can update background job batches"
  on public.background_job_batches
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Trip members can read background jobs"
  on public.background_jobs;
create policy "Trip members can read background jobs"
  on public.background_jobs
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.trip_members
      where trip_members.trip_id = background_jobs.journey_id
        and trip_members.user_id = auth.uid()
    )
  );

drop policy if exists "Trip members can create background jobs"
  on public.background_jobs;
create policy "Trip members can create background jobs"
  on public.background_jobs
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      journey_id is null
      or exists (
        select 1 from public.trip_members
        where trip_members.trip_id = background_jobs.journey_id
          and trip_members.user_id = auth.uid()
      )
    )
  );

drop policy if exists "Job owners can update background jobs"
  on public.background_jobs;
create policy "Job owners can update background jobs"
  on public.background_jobs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
