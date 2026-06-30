drop index if exists public.background_jobs_active_content_translation_idx;

alter table public.content_translations
alter column source_id type text
using source_id::text;

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

notify pgrst, 'reload schema';
