create table if not exists public.memory_shot_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  description text,
  worker text not null default 'memory_shot_worker',
  task text not null,
  status text not null default 'active'
    check (status in ('draft', 'active', 'archived')),
  default_visibility text not null default 'journey_members'
    check (default_visibility in ('private', 'journey_members', 'public_unlisted', 'public_discover')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_shots (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.trips(id) on delete cascade,
  template_id uuid references public.memory_shot_templates(id) on delete set null,
  author_user_id uuid references auth.users(id) on delete set null,
  title text,
  subtitle text,
  language text not null default 'en',
  status text not null default 'draft'
    check (status in ('draft', 'generating', 'ready', 'failed', 'archived')),
  visibility text not null default 'journey_members'
    check (visibility in ('private', 'journey_members', 'public_unlisted', 'public_discover')),
  cover_url text,
  preview_url text,
  drive_file_id text,
  error_message text,
  content jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_shot_assets (
  id uuid primary key default gen_random_uuid(),
  memory_shot_id uuid not null references public.memory_shots(id) on delete cascade,
  journey_id uuid not null references public.trips(id) on delete cascade,
  asset_type text not null
    check (asset_type in ('photo', 'message', 'expense', 'location', 'route', 'person', 'planner_item', 'memory')),
  source_id text not null,
  role text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memory_shot_snapshots (
  id uuid primary key default gen_random_uuid(),
  memory_shot_id uuid not null references public.memory_shots(id) on delete cascade,
  journey_id uuid not null references public.trips(id) on delete cascade,
  snapshot jsonb not null,
  source_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(memory_shot_id)
);

create table if not exists public.memory_shot_recommendations (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  template_id uuid references public.memory_shot_templates(id) on delete set null,
  recommendation_key text not null,
  title text not null,
  reason text,
  score numeric(6, 4) not null default 0,
  status text not null default 'active'
    check (status in ('active', 'dismissed', 'accepted', 'expired')),
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_shot_reads (
  id uuid primary key default gen_random_uuid(),
  memory_shot_id uuid not null references public.memory_shots(id) on delete cascade,
  journey_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(memory_shot_id, user_id)
);

create index if not exists memory_shot_templates_task_idx
  on public.memory_shot_templates(worker, task, status);

create index if not exists memory_shots_journey_status_idx
  on public.memory_shots(journey_id, status, created_at desc);

create index if not exists memory_shots_journey_visibility_idx
  on public.memory_shots(journey_id, visibility, created_at desc);

create index if not exists memory_shots_author_idx
  on public.memory_shots(author_user_id, created_at desc);

create index if not exists memory_shot_assets_shot_idx
  on public.memory_shot_assets(memory_shot_id, sort_order);

create index if not exists memory_shot_assets_source_idx
  on public.memory_shot_assets(asset_type, source_id);

create index if not exists memory_shot_snapshots_journey_idx
  on public.memory_shot_snapshots(journey_id, created_at desc);

create index if not exists memory_shot_recommendations_journey_status_idx
  on public.memory_shot_recommendations(journey_id, status, score desc, created_at desc);

create index if not exists memory_shot_reads_user_idx
  on public.memory_shot_reads(user_id, journey_id, read_at desc);

drop trigger if exists memory_shot_templates_touch_updated_at
  on public.memory_shot_templates;
create trigger memory_shot_templates_touch_updated_at
before update on public.memory_shot_templates
for each row execute function public.touch_updated_at();

drop trigger if exists memory_shots_touch_updated_at
  on public.memory_shots;
create trigger memory_shots_touch_updated_at
before update on public.memory_shots
for each row execute function public.touch_updated_at();

drop trigger if exists memory_shot_recommendations_touch_updated_at
  on public.memory_shot_recommendations;
create trigger memory_shot_recommendations_touch_updated_at
before update on public.memory_shot_recommendations
for each row execute function public.touch_updated_at();

alter table public.memory_shot_templates enable row level security;
alter table public.memory_shots enable row level security;
alter table public.memory_shot_assets enable row level security;
alter table public.memory_shot_snapshots enable row level security;
alter table public.memory_shot_recommendations enable row level security;
alter table public.memory_shot_reads enable row level security;

drop policy if exists "Authenticated users can read active memory shot templates"
  on public.memory_shot_templates;
create policy "Authenticated users can read active memory shot templates"
  on public.memory_shot_templates
  for select
  to authenticated
  using (status = 'active' or public.is_system_admin(auth.uid()));

drop policy if exists "System admins can manage memory shot templates"
  on public.memory_shot_templates;
create policy "System admins can manage memory shot templates"
  on public.memory_shot_templates
  for all
  to authenticated
  using (public.is_system_admin(auth.uid()))
  with check (public.is_system_admin(auth.uid()));

drop policy if exists "Journey members can read memory shots"
  on public.memory_shots;
create policy "Journey members can read memory shots"
  on public.memory_shots
  for select
  to authenticated
  using (
    (visibility = 'private' and author_user_id = auth.uid())
    or (visibility <> 'private' and public.is_trip_member_or_creator(journey_id))
    or public.is_trip_owner_or_admin(journey_id)
  );

drop policy if exists "Journey members can create memory shots"
  on public.memory_shots;
create policy "Journey members can create memory shots"
  on public.memory_shots
  for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_trip_member_or_creator(journey_id)
  );

drop policy if exists "Authors and owners can update memory shots"
  on public.memory_shots;
create policy "Authors and owners can update memory shots"
  on public.memory_shots
  for update
  to authenticated
  using (
    author_user_id = auth.uid()
    or public.is_trip_owner_or_admin(journey_id)
  )
  with check (
    author_user_id = auth.uid()
    or public.is_trip_owner_or_admin(journey_id)
  );

drop policy if exists "Authors and owners can delete memory shots"
  on public.memory_shots;
create policy "Authors and owners can delete memory shots"
  on public.memory_shots
  for delete
  to authenticated
  using (
    author_user_id = auth.uid()
    or public.is_trip_owner_or_admin(journey_id)
  );

drop policy if exists "Journey members can read memory shot assets"
  on public.memory_shot_assets;
create policy "Journey members can read memory shot assets"
  on public.memory_shot_assets
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

drop policy if exists "Authors and owners can manage memory shot assets"
  on public.memory_shot_assets;
create policy "Authors and owners can manage memory shot assets"
  on public.memory_shot_assets
  for all
  to authenticated
  using (
    exists (
      select 1 from public.memory_shots shot
      where shot.id = memory_shot_assets.memory_shot_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  )
  with check (
    public.is_trip_member_or_creator(journey_id)
    and exists (
      select 1 from public.memory_shots shot
      where shot.id = memory_shot_assets.memory_shot_id
        and shot.journey_id = memory_shot_assets.journey_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  );

drop policy if exists "Journey members can read memory shot snapshots"
  on public.memory_shot_snapshots;
create policy "Journey members can read memory shot snapshots"
  on public.memory_shot_snapshots
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

drop policy if exists "Authors and owners can manage memory shot snapshots"
  on public.memory_shot_snapshots;
create policy "Authors and owners can manage memory shot snapshots"
  on public.memory_shot_snapshots
  for all
  to authenticated
  using (
    exists (
      select 1 from public.memory_shots shot
      where shot.id = memory_shot_snapshots.memory_shot_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  )
  with check (
    public.is_trip_member_or_creator(journey_id)
    and exists (
      select 1 from public.memory_shots shot
      where shot.id = memory_shot_snapshots.memory_shot_id
        and shot.journey_id = memory_shot_snapshots.journey_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  );

drop policy if exists "Journey members can read memory shot recommendations"
  on public.memory_shot_recommendations;
create policy "Journey members can read memory shot recommendations"
  on public.memory_shot_recommendations
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

drop policy if exists "Journey members can create memory shot recommendations"
  on public.memory_shot_recommendations;
create policy "Journey members can create memory shot recommendations"
  on public.memory_shot_recommendations
  for insert
  to authenticated
  with check (
    public.is_trip_member_or_creator(journey_id)
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists "Recommendation owners can update memory shot recommendations"
  on public.memory_shot_recommendations;
create policy "Recommendation owners can update memory shot recommendations"
  on public.memory_shot_recommendations
  for update
  to authenticated
  using (
    public.is_trip_owner_or_admin(journey_id)
    or user_id = auth.uid()
  )
  with check (
    public.is_trip_owner_or_admin(journey_id)
    or user_id = auth.uid()
  );

drop policy if exists "Journey members can read memory shot reads"
  on public.memory_shot_reads;
create policy "Journey members can read memory shot reads"
  on public.memory_shot_reads
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

drop policy if exists "Users can mark own memory shot reads"
  on public.memory_shot_reads;
create policy "Users can mark own memory shot reads"
  on public.memory_shot_reads
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_trip_member_or_creator(journey_id)
  );

drop policy if exists "Users can update own memory shot reads"
  on public.memory_shot_reads;
create policy "Users can update own memory shot reads"
  on public.memory_shot_reads
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_trip_member_or_creator(journey_id));

insert into public.memory_shot_templates (
  key,
  title,
  description,
  worker,
  task,
  default_visibility,
  metadata
) values
  (
    'daily_best_moments',
    'Daily Best Moments',
    'A Memory Shot generated from the strongest moments of one Journey day.',
    'memory_shot_worker',
    'daily_best_moments',
    'journey_members',
    '{"seed": true, "prompt_key": "memory_shot_daily_best_moments"}'::jsonb
  ),
  (
    'today_spending',
    'Today Spending',
    'A privacy-aware spending summary Memory Shot for one Journey day.',
    'memory_shot_worker',
    'today_spending',
    'journey_members',
    '{"seed": true, "prompt_key": "memory_shot_today_spending"}'::jsonb
  ),
  (
    'people_together',
    'People Together',
    'A Memory Shot generated from people and shared moments in a Journey.',
    'memory_shot_worker',
    'people_together',
    'journey_members',
    '{"seed": true, "prompt_key": "memory_shot_people_together"}'::jsonb
  )
on conflict (key) do update
set
  title = excluded.title,
  description = excluded.description,
  worker = excluded.worker,
  task = excluded.task,
  default_visibility = excluded.default_visibility,
  metadata = public.memory_shot_templates.metadata || excluded.metadata;
