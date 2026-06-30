alter table public.media_assets
add column if not exists original_drive_file_id text,
add column if not exists original_drive_web_url text,
add column if not exists thumbnail_drive_file_id text,
add column if not exists thumbnail_drive_web_url text,
add column if not exists thumbnail_width int,
add column if not exists thumbnail_height int,
add column if not exists thumbnail_size bigint,
add column if not exists processing_status text not null default 'pending'
  check (processing_status in ('pending', 'processing', 'ready', 'failed', 'legacy')),
add column if not exists legacy_supabase_path text,
add column if not exists legacy_thumbnail_path text;

create index if not exists media_assets_drive_original_idx
  on public.media_assets(original_drive_file_id)
  where original_drive_file_id is not null;

create index if not exists media_assets_drive_thumbnail_idx
  on public.media_assets(thumbnail_drive_file_id)
  where thumbnail_drive_file_id is not null;

create index if not exists media_assets_processing_status_idx
  on public.media_assets(trip_id, processing_status);
