create table if not exists public.memory_shot_artifacts (
  id uuid primary key default gen_random_uuid(),
  memory_shot_id uuid not null references public.memory_shots(id) on delete cascade,
  artifact_type text not null
    check (artifact_type in ('poster', 'motion_story')),
  variant text not null
    check (variant in ('single_poster', 'long_poster', 'grid_9', 'scroll_story')),
  status text not null default 'pending'
    check (status in ('pending', 'rendering', 'ready', 'failed', 'archived')),
  title text,
  preview_url text,
  thumbnail_url text,
  public_url text,
  storage jsonb not null default '{}'::jsonb,
  manifest jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  render_error text,
  render_warning text,
  rendered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_shot_artifacts_variant_type_check check (
    (artifact_type = 'poster' and variant in ('single_poster', 'long_poster', 'grid_9'))
    or (artifact_type = 'motion_story' and variant in ('scroll_story'))
  )
);

create table if not exists public.memory_shot_artifact_assets (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.memory_shot_artifacts(id) on delete cascade,
  asset_type text not null
    check (asset_type in ('photo', 'message', 'expense', 'location', 'route', 'person', 'planner_item', 'memory')),
  asset_id text not null,
  role text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists memory_shot_artifacts_shot_idx
  on public.memory_shot_artifacts(memory_shot_id, status, created_at desc);

create index if not exists memory_shot_artifacts_type_variant_idx
  on public.memory_shot_artifacts(artifact_type, variant, status, created_at desc);

create index if not exists memory_shot_artifact_assets_artifact_idx
  on public.memory_shot_artifact_assets(artifact_id, sort_order);

create index if not exists memory_shot_artifact_assets_source_idx
  on public.memory_shot_artifact_assets(asset_type, asset_id);

drop trigger if exists memory_shot_artifacts_touch_updated_at
  on public.memory_shot_artifacts;
create trigger memory_shot_artifacts_touch_updated_at
before update on public.memory_shot_artifacts
for each row execute function public.touch_updated_at();

alter table public.memory_shot_artifacts enable row level security;
alter table public.memory_shot_artifact_assets enable row level security;

drop policy if exists "Journey members can read memory shot artifacts"
  on public.memory_shot_artifacts;
create policy "Journey members can read memory shot artifacts"
  on public.memory_shot_artifacts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memory_shots shot
      where shot.id = memory_shot_artifacts.memory_shot_id
        and (
          (shot.visibility = 'private' and shot.author_user_id = auth.uid())
          or (shot.visibility <> 'private' and public.is_trip_member_or_creator(shot.journey_id))
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  );

drop policy if exists "Authors and owners can create memory shot artifacts"
  on public.memory_shot_artifacts;
drop policy if exists "Journey members can create memory shot artifacts"
  on public.memory_shot_artifacts;
create policy "Journey members can create memory shot artifacts"
  on public.memory_shot_artifacts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.memory_shots shot
      where shot.id = memory_shot_artifacts.memory_shot_id
        and public.is_trip_member_or_creator(shot.journey_id)
    )
  );

drop policy if exists "Authors and owners can update memory shot artifacts"
  on public.memory_shot_artifacts;
drop policy if exists "Journey members can update memory shot artifacts"
  on public.memory_shot_artifacts;
create policy "Journey members can update memory shot artifacts"
  on public.memory_shot_artifacts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.memory_shots shot
      where shot.id = memory_shot_artifacts.memory_shot_id
        and public.is_trip_member_or_creator(shot.journey_id)
    )
  )
  with check (
    exists (
      select 1
      from public.memory_shots shot
      where shot.id = memory_shot_artifacts.memory_shot_id
        and public.is_trip_member_or_creator(shot.journey_id)
    )
  );

drop policy if exists "Authors and owners can delete memory shot artifacts"
  on public.memory_shot_artifacts;
create policy "Authors and owners can delete memory shot artifacts"
  on public.memory_shot_artifacts
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.memory_shots shot
      where shot.id = memory_shot_artifacts.memory_shot_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  );

drop policy if exists "Journey members can read memory shot artifact assets"
  on public.memory_shot_artifact_assets;
create policy "Journey members can read memory shot artifact assets"
  on public.memory_shot_artifact_assets
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memory_shot_artifacts artifact
      join public.memory_shots shot on shot.id = artifact.memory_shot_id
      where artifact.id = memory_shot_artifact_assets.artifact_id
        and (
          (shot.visibility = 'private' and shot.author_user_id = auth.uid())
          or (shot.visibility <> 'private' and public.is_trip_member_or_creator(shot.journey_id))
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  );

drop policy if exists "Authors and owners can manage memory shot artifact assets"
  on public.memory_shot_artifact_assets;
drop policy if exists "Journey members can manage memory shot artifact assets"
  on public.memory_shot_artifact_assets;
create policy "Journey members can manage memory shot artifact assets"
  on public.memory_shot_artifact_assets
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.memory_shot_artifacts artifact
      join public.memory_shots shot on shot.id = artifact.memory_shot_id
      where artifact.id = memory_shot_artifact_assets.artifact_id
        and public.is_trip_member_or_creator(shot.journey_id)
    )
  )
  with check (
    exists (
      select 1
      from public.memory_shot_artifacts artifact
      join public.memory_shots shot on shot.id = artifact.memory_shot_id
      where artifact.id = memory_shot_artifact_assets.artifact_id
        and public.is_trip_member_or_creator(shot.journey_id)
    )
  );
