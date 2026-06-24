create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  memory_entry_id uuid references public.memory_entries(id) on delete cascade,
  asset_type text not null check (asset_type in ('image', 'video', 'audio')),
  storage_bucket text not null default 'trip-media',
  original_file_path text,
  compressed_file_path text,
  thumbnail_file_path text,
  original_file_size bigint,
  compressed_file_size bigint,
  mime_type text,
  width int,
  height int,
  storage_tier text not null default 'standard' check (storage_tier in ('standard', 'pro_original')),
  is_original_preserved boolean not null default false,
  retention_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists media_assets_trip_id_idx
  on public.media_assets(trip_id);

create index if not exists media_assets_memory_entry_id_idx
  on public.media_assets(memory_entry_id);

create index if not exists media_assets_user_id_idx
  on public.media_assets(user_id);

alter table public.media_assets enable row level security;

drop policy if exists "Trip members can read media assets" on public.media_assets;
drop policy if exists "Trip members can insert media assets" on public.media_assets;
drop policy if exists "Users can update their own media assets" on public.media_assets;
drop policy if exists "Users can delete their own media assets" on public.media_assets;

create policy "Trip members can read media assets"
  on public.media_assets
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "Trip members can insert media assets"
  on public.media_assets
  for insert
  to authenticated
  with check (
    public.is_trip_member(trip_id)
    and user_id = auth.uid()
  );

create policy "Users can update their own media assets"
  on public.media_assets
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_trip_member(trip_id)
  );

create policy "Users can delete their own media assets"
  on public.media_assets
  for delete
  to authenticated
  using (user_id = auth.uid());
