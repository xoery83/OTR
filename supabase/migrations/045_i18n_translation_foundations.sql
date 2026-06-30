alter table public.profiles
add column if not exists account_role text not null default 'free_user'
  check (account_role in ('admin', 'free_user', 'plus', 'pro'));

alter table public.profiles
add column if not exists preferred_language text not null default 'auto';

create or replace function public.is_system_admin(target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = target_user_id
      and p.account_role = 'admin'
  );
$$;

create table if not exists public.i18n_locale_bundles (
  id uuid primary key default gen_random_uuid(),
  language_code text not null,
  namespace text not null default 'common',
  base_version text not null,
  translations_json jsonb not null default '{}'::jsonb,
  status text not null default 'machine'
    check (status in ('machine', 'reviewed')),
  engine text not null default 'libretranslate',
  created_by text not null default 'auto'
    check (created_by in ('auto', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (language_code, namespace, base_version)
);

create index if not exists i18n_locale_bundles_lookup_idx
  on public.i18n_locale_bundles(language_code, namespace, base_version);

create table if not exists public.content_translations (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  source_field text not null,
  source_lang text not null,
  target_lang text not null,
  source_hash text not null,
  translated_text text not null,
  engine text not null default 'libretranslate',
  status text not null default 'machine'
    check (status in ('machine', 'reviewed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id, source_field, target_lang, source_hash)
);

create index if not exists content_translations_source_idx
  on public.content_translations(source_type, source_id, source_field);

create index if not exists content_translations_target_idx
  on public.content_translations(target_lang, status, updated_at desc);

drop trigger if exists i18n_locale_bundles_touch_updated_at
  on public.i18n_locale_bundles;
create trigger i18n_locale_bundles_touch_updated_at
before update on public.i18n_locale_bundles
for each row execute function public.touch_updated_at();

drop trigger if exists content_translations_touch_updated_at
  on public.content_translations;
create trigger content_translations_touch_updated_at
before update on public.content_translations
for each row execute function public.touch_updated_at();

create unique index if not exists background_jobs_active_locale_bundle_idx
  on public.background_jobs(
    job_type,
    (lower(payload->>'language_code')),
    (coalesce(payload->>'namespace', 'common')),
    (coalesce(payload->>'base_version', ''))
  )
  where job_type = 'generate_locale_bundle'
    and status in ('queued', 'uploading', 'processing', 'waiting_for_user');

create unique index if not exists background_jobs_active_content_translation_idx
  on public.background_jobs(
    job_type,
    ((payload->>'source_type')),
    ((payload->>'source_id')),
    ((payload->>'source_field')),
    (lower(payload->>'target_lang')),
    ((payload->>'source_hash'))
  )
  where job_type = 'translate_user_content'
    and status in ('queued', 'uploading', 'processing', 'waiting_for_user');

alter table public.i18n_locale_bundles enable row level security;
alter table public.content_translations enable row level security;

drop policy if exists "Authenticated users can read locale bundles"
  on public.i18n_locale_bundles;
create policy "Authenticated users can read locale bundles"
  on public.i18n_locale_bundles
  for select
  to authenticated
  using (true);

drop policy if exists "Admins can manage locale bundles"
  on public.i18n_locale_bundles;
create policy "Admins can manage locale bundles"
  on public.i18n_locale_bundles
  for all
  to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

drop policy if exists "Admins can manage content translations"
  on public.content_translations;
create policy "Admins can manage content translations"
  on public.content_translations
  for all
  to authenticated
  using (public.is_system_admin())
  with check (public.is_system_admin());

notify pgrst, 'reload schema';
