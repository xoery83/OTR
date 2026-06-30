alter table public.media_assets
add column if not exists thumbnail_url text,
add column if not exists preview_url text,
add column if not exists thumbnail_generated_at timestamptz,
add column if not exists preview_generated_at timestamptz;

create index if not exists media_assets_thumbnail_url_idx
  on public.media_assets(thumbnail_url)
  where thumbnail_url is not null;

create index if not exists media_assets_preview_url_idx
  on public.media_assets(preview_url)
  where preview_url is not null;
