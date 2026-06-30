alter table public.i18n_locale_bundles
add column if not exists source_locale text not null default 'en',
add column if not exists generated_by text not null default 'llm',
add column if not exists provider text,
add column if not exists model text,
add column if not exists prompt_version text,
add column if not exists missing_keys_count integer not null default 0,
add column if not exists token_estimate integer,
add column if not exists cost_estimate_usd numeric,
add column if not exists error_message text,
add column if not exists published_at timestamptz;

update public.i18n_locale_bundles
set published_at = coalesce(published_at, updated_at)
where status = 'reviewed'
  and published_at is null;

create index if not exists i18n_locale_bundles_published_lookup_idx
  on public.i18n_locale_bundles(language_code, namespace, base_version, status)
  where status = 'reviewed';

notify pgrst, 'reload schema';
