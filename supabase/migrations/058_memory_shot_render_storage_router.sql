alter table public.memory_shots
  add column if not exists original_storage_provider text,
  add column if not exists original_storage_path text,
  add column if not exists preview_storage_provider text,
  add column if not exists preview_storage_path text,
  add column if not exists thumbnail_storage_provider text,
  add column if not exists thumbnail_storage_path text,
  add column if not exists render_warning text;

create index if not exists memory_shots_preview_storage_provider_idx
  on public.memory_shots(preview_storage_provider, updated_at desc);
