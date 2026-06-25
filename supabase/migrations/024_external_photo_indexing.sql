alter table public.trips
add column if not exists photo_storage_provider text
  check (photo_storage_provider in ('google_drive', 'onedrive', 'supabase_legacy')),
add column if not exists photo_storage_status text not null default 'not_connected'
  check (photo_storage_status in ('not_connected', 'connected', 'disconnected', 'error')),
add column if not exists photo_storage_root_folder_id text;

create table if not exists public.journey_storage_connections (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  provider text not null check (provider in ('google_drive', 'onedrive')),
  account_label text,
  provider_account_id text,
  provider_root_folder_id text,
  journey_folder_id text,
  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error')),
  token_reference text,
  metadata jsonb not null default '{}'::jsonb,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id, provider)
);

alter table public.media_assets
add column if not exists storage_provider text not null default 'supabase_legacy'
  check (storage_provider in ('supabase_legacy', 'google_drive', 'onedrive')),
add column if not exists provider_file_id text,
add column if not exists provider_drive_id text,
add column if not exists provider_web_url text,
add column if not exists provider_thumbnail_url text,
add column if not exists provider_original_reference text,
add column if not exists taken_at timestamptz,
add column if not exists gps_latitude double precision,
add column if not exists gps_longitude double precision,
add column if not exists camera_model text,
add column if not exists orientation text,
add column if not exists exif_json jsonb not null default '{}'::jsonb,
add column if not exists ai_status text not null default 'pending'
  check (ai_status in ('pending', 'processing', 'indexed', 'failed', 'skipped')),
add column if not exists ai_metadata jsonb not null default '{}'::jsonb,
add column if not exists ocr_text text,
add column if not exists duplicate_score numeric,
add column if not exists blur_score numeric,
add column if not exists scene_tags text[] not null default '{}'::text[],
add column if not exists indexed_at timestamptz;

create table if not exists public.photo_faces (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  journey_member_id uuid references public.journey_members(id) on delete set null,
  bounding_box jsonb not null default '{}'::jsonb,
  embedding real[],
  confidence numeric,
  quality_score numeric,
  recognition_status text not null default 'unknown'
    check (recognition_status in ('unknown', 'recognized', 'confirmed', 'rejected')),
  recognized_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photo_faces_embedding_512
    check (embedding is null or array_length(embedding, 1) = 512)
);

create table if not exists public.journey_member_face_embeddings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  journey_member_id uuid not null references public.journey_members(id) on delete cascade,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  face_id uuid references public.photo_faces(id) on delete set null,
  embedding real[] not null,
  quality_score numeric,
  source text not null default 'photo'
    check (source in ('manual_seed', 'photo', 'confirmed_match')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint journey_member_face_embeddings_512
    check (array_length(embedding, 1) = 512)
);

create index if not exists journey_storage_connections_trip_id_idx
  on public.journey_storage_connections(trip_id);

create index if not exists media_assets_storage_provider_file_idx
  on public.media_assets(storage_provider, provider_file_id);

create index if not exists media_assets_taken_at_idx
  on public.media_assets(trip_id, taken_at);

create index if not exists media_assets_ai_status_idx
  on public.media_assets(trip_id, ai_status);

create index if not exists photo_faces_media_asset_id_idx
  on public.photo_faces(media_asset_id);

create index if not exists photo_faces_trip_id_idx
  on public.photo_faces(trip_id);

create index if not exists photo_faces_journey_member_id_idx
  on public.photo_faces(journey_member_id);

create index if not exists journey_member_face_embeddings_member_id_idx
  on public.journey_member_face_embeddings(journey_member_id);

create index if not exists journey_member_face_embeddings_trip_id_idx
  on public.journey_member_face_embeddings(trip_id);

alter table public.journey_storage_connections enable row level security;
alter table public.photo_faces enable row level security;
alter table public.journey_member_face_embeddings enable row level security;

drop trigger if exists journey_storage_connections_touch_updated_at
  on public.journey_storage_connections;
create trigger journey_storage_connections_touch_updated_at
before update on public.journey_storage_connections
for each row execute function public.touch_updated_at();

drop trigger if exists photo_faces_touch_updated_at on public.photo_faces;
create trigger photo_faces_touch_updated_at
before update on public.photo_faces
for each row execute function public.touch_updated_at();

drop policy if exists "Trip managers can read storage connections"
  on public.journey_storage_connections;
drop policy if exists "Trip managers can manage storage connections"
  on public.journey_storage_connections;

create policy "Trip managers can read storage connections"
  on public.journey_storage_connections
  for select
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id));

create policy "Trip managers can manage storage connections"
  on public.journey_storage_connections
  for all
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id))
  with check (public.is_trip_owner_or_admin(trip_id));

drop policy if exists "Trip members can read photo faces" on public.photo_faces;
drop policy if exists "Trip members can insert photo faces" on public.photo_faces;
drop policy if exists "Trip managers can update photo faces" on public.photo_faces;
drop policy if exists "Trip managers can delete photo faces" on public.photo_faces;

create policy "Trip members can read photo faces"
  on public.photo_faces
  for select
  to authenticated
  using (public.is_trip_member_or_creator(trip_id));

create policy "Trip members can insert photo faces"
  on public.photo_faces
  for insert
  to authenticated
  with check (public.is_trip_member_or_creator(trip_id));

create policy "Trip managers can update photo faces"
  on public.photo_faces
  for update
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id))
  with check (public.is_trip_owner_or_admin(trip_id));

create policy "Trip managers can delete photo faces"
  on public.photo_faces
  for delete
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id));

drop policy if exists "Trip members can read member face embeddings"
  on public.journey_member_face_embeddings;
drop policy if exists "Trip managers can manage member face embeddings"
  on public.journey_member_face_embeddings;

create policy "Trip members can read member face embeddings"
  on public.journey_member_face_embeddings
  for select
  to authenticated
  using (public.is_trip_member_or_creator(trip_id));

create policy "Trip managers can manage member face embeddings"
  on public.journey_member_face_embeddings
  for all
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id))
  with check (public.is_trip_owner_or_admin(trip_id));
