create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  background_job_id uuid references public.background_jobs(id) on delete set null,
  journey_id uuid references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  worker text not null,
  task text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'waiting_for_user', 'completed', 'failed', 'cancelled')),
  priority integer not null default 100,
  prompt_key text,
  prompt_version text,
  provider text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_estimate numeric(12, 6) not null default 0,
  currency text not null default 'USD',
  current_step text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  retry_count integer not null default 0,
  max_retries integer not null default 2,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_job_attempts (
  id uuid primary key default gen_random_uuid(),
  ai_job_id uuid references public.ai_jobs(id) on delete cascade,
  attempt_number integer not null default 1,
  provider text,
  model text,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_estimate numeric(12, 6) not null default 0,
  currency text not null default 'USD',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_cost_events (
  id uuid primary key default gen_random_uuid(),
  ai_job_id uuid references public.ai_jobs(id) on delete set null,
  ai_job_attempt_id uuid references public.ai_job_attempts(id) on delete set null,
  journey_id uuid references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  worker text not null,
  task text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_estimate numeric(12, 6) not null default 0,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_jobs_background_job_idx
  on public.ai_jobs(background_job_id);

create index if not exists ai_jobs_journey_status_idx
  on public.ai_jobs(journey_id, status, created_at desc);

create index if not exists ai_jobs_user_status_idx
  on public.ai_jobs(user_id, status, available_at, created_at);

create index if not exists ai_jobs_worker_task_idx
  on public.ai_jobs(worker, task, status, available_at);

create index if not exists ai_job_attempts_job_idx
  on public.ai_job_attempts(ai_job_id, attempt_number);

create index if not exists ai_cost_events_journey_created_idx
  on public.ai_cost_events(journey_id, created_at desc);

create index if not exists ai_cost_events_provider_model_idx
  on public.ai_cost_events(provider, model, created_at desc);

drop trigger if exists ai_jobs_touch_updated_at
  on public.ai_jobs;
create trigger ai_jobs_touch_updated_at
before update on public.ai_jobs
for each row execute function public.touch_updated_at();

alter table public.ai_jobs enable row level security;
alter table public.ai_job_attempts enable row level security;
alter table public.ai_cost_events enable row level security;

drop policy if exists "Trip members can read ai jobs"
  on public.ai_jobs;
create policy "Trip members can read ai jobs"
  on public.ai_jobs
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_trip_member_or_creator(journey_id)
  );

drop policy if exists "Trip members can create ai jobs"
  on public.ai_jobs;
create policy "Trip members can create ai jobs"
  on public.ai_jobs
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      journey_id is null
      or public.is_trip_member_or_creator(journey_id)
    )
  );

drop policy if exists "Job owners can update ai jobs"
  on public.ai_jobs;
create policy "Job owners can update ai jobs"
  on public.ai_jobs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Trip members can read ai job attempts"
  on public.ai_job_attempts;
create policy "Trip members can read ai job attempts"
  on public.ai_job_attempts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.ai_jobs
      where ai_jobs.id = ai_job_attempts.ai_job_id
        and (
          ai_jobs.user_id = auth.uid()
          or public.is_trip_member_or_creator(ai_jobs.journey_id)
        )
    )
  );

drop policy if exists "Trip members can read ai cost events"
  on public.ai_cost_events;
create policy "Trip members can read ai cost events"
  on public.ai_cost_events
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_trip_member_or_creator(journey_id)
  );
