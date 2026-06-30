create table if not exists public.media_asset_variants (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references public.media_assets(id) on delete cascade,
  variant_type text not null check (variant_type in ('thumbnail', 'preview')),
  storage_provider text not null default 'hetzner_disk'
    check (storage_provider in ('hetzner_disk')),
  relative_path text not null,
  mime_type text not null default 'image/webp',
  width int,
  height int,
  file_size bigint not null default 0,
  generated_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (media_asset_id, variant_type)
);

create index if not exists media_asset_variants_asset_idx
  on public.media_asset_variants(media_asset_id);

create index if not exists media_asset_variants_cleanup_idx
  on public.media_asset_variants(variant_type, last_accessed_at);

alter table public.media_asset_variants enable row level security;

drop trigger if exists media_asset_variants_touch_updated_at
  on public.media_asset_variants;
create trigger media_asset_variants_touch_updated_at
before update on public.media_asset_variants
for each row execute function public.touch_updated_at();
