create table if not exists public.image_index_records (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  journey_id uuid not null references public.trips(id) on delete cascade,
  day_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'indexed_local', 'needs_llm', 'indexed_llm', 'failed')),
  caption text,
  scene text,
  objects jsonb not null default '[]'::jsonb,
  people jsonb not null default '[]'::jsonb,
  ocr_text text,
  embedding real[],
  quality_score numeric,
  duplicate_hash text,
  image_hash text,
  blur_score numeric,
  brightness_score numeric,
  dominant_colors jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  needs_llm_review boolean not null default false,
  llm_review_reason text,
  model_used text,
  model_version text,
  cost_estimate numeric,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(media_asset_id)
);

create index if not exists image_index_records_journey_id_idx
  on public.image_index_records(journey_id);

create index if not exists image_index_records_status_idx
  on public.image_index_records(journey_id, status);

create index if not exists image_index_records_duplicate_hash_idx
  on public.image_index_records(duplicate_hash);

alter table public.image_index_records enable row level security;

drop trigger if exists image_index_records_touch_updated_at
  on public.image_index_records;
create trigger image_index_records_touch_updated_at
before update on public.image_index_records
for each row execute function public.touch_updated_at();

drop policy if exists "Trip members can read image index records"
  on public.image_index_records;
drop policy if exists "Trip members can insert image index records"
  on public.image_index_records;
drop policy if exists "Trip members can update image index records"
  on public.image_index_records;

create policy "Trip members can read image index records"
  on public.image_index_records
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

create policy "Trip members can insert image index records"
  on public.image_index_records
  for insert
  to authenticated
  with check (public.is_trip_member_or_creator(journey_id));

create policy "Trip members can update image index records"
  on public.image_index_records
  for update
  to authenticated
  using (public.is_trip_member_or_creator(journey_id))
  with check (public.is_trip_member_or_creator(journey_id));
