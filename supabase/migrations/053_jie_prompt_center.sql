create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  worker text not null,
  task text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.prompt_templates(id) on delete cascade,
  language text not null default 'en',
  environment text not null default 'production',
  version text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  prompt_body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, language, environment, version)
);

create unique index if not exists prompt_template_versions_one_active_idx
  on public.prompt_template_versions(template_id, language, environment)
  where status = 'active';

create index if not exists prompt_templates_worker_task_idx
  on public.prompt_templates(worker, task);

create index if not exists prompt_template_versions_template_status_idx
  on public.prompt_template_versions(template_id, status, language, environment);

drop trigger if exists prompt_templates_touch_updated_at
  on public.prompt_templates;
create trigger prompt_templates_touch_updated_at
before update on public.prompt_templates
for each row execute function public.touch_updated_at();

drop trigger if exists prompt_template_versions_touch_updated_at
  on public.prompt_template_versions;
create trigger prompt_template_versions_touch_updated_at
before update on public.prompt_template_versions
for each row execute function public.touch_updated_at();

alter table public.prompt_templates enable row level security;
alter table public.prompt_template_versions enable row level security;

drop policy if exists "Authenticated users can read prompt templates"
  on public.prompt_templates;
create policy "Authenticated users can read prompt templates"
  on public.prompt_templates
  for select
  to authenticated
  using (true);

drop policy if exists "System admins can manage prompt templates"
  on public.prompt_templates;
create policy "System admins can manage prompt templates"
  on public.prompt_templates
  for all
  to authenticated
  using (public.is_system_admin(auth.uid()))
  with check (public.is_system_admin(auth.uid()));

drop policy if exists "Authenticated users can read prompt template versions"
  on public.prompt_template_versions;
create policy "Authenticated users can read prompt template versions"
  on public.prompt_template_versions
  for select
  to authenticated
  using (true);

drop policy if exists "System admins can manage prompt template versions"
  on public.prompt_template_versions;
create policy "System admins can manage prompt template versions"
  on public.prompt_template_versions
  for all
  to authenticated
  using (public.is_system_admin(auth.uid()))
  with check (public.is_system_admin(auth.uid()));

insert into public.prompt_templates (key, worker, task, description, metadata)
values
  (
    'memory_shot_daily_best_moments',
    'memory_shot_worker',
    'daily_best_moments',
    'Generate a Memory Shot from the strongest moments of one Journey day.',
    '{"seed": true}'::jsonb
  ),
  (
    'memory_shot_today_spending',
    'memory_shot_worker',
    'today_spending',
    'Generate a privacy-aware spending summary Memory Shot for one Journey day.',
    '{"seed": true}'::jsonb
  ),
  (
    'memory_shot_people_together',
    'memory_shot_worker',
    'people_together',
    'Generate a Memory Shot around people appearing together in a Journey.',
    '{"seed": true}'::jsonb
  ),
  (
    'journey_daily_summary',
    'summary_worker',
    'daily_summary',
    'Summarize one Journey day from source events, planner items, memories, media, people, places, and ledger signals.',
    '{"seed": true}'::jsonb
  ),
  (
    'discover_safety_check',
    'discover_safety_worker',
    'public_memory_shot_safety',
    'Check whether a Memory Shot is safe and privacy-appropriate for Discover.',
    '{"seed": true}'::jsonb
  )
on conflict (key) do update
set
  worker = excluded.worker,
  task = excluded.task,
  description = excluded.description,
  metadata = public.prompt_templates.metadata || excluded.metadata;

insert into public.prompt_template_versions (
  template_id,
  language,
  environment,
  version,
  status,
  prompt_body,
  metadata
)
select
  template.id,
  'en',
  'production',
  'v1',
  'active',
  seed.prompt_body,
  '{"seed": true}'::jsonb
from (
  values
    (
      'memory_shot_daily_best_moments',
      'Create a concise Memory Shot draft from the provided Journey day data. Highlight the best real moments, avoid inventing facts, and return structured JSON for title, subtitle, sections, photo_notes, privacy_notes, and source_summary. Journey data: {{journey_data}}'
    ),
    (
      'memory_shot_today_spending',
      'Create a privacy-aware spending Memory Shot from the provided Journey ledger data. Summarize categories and group context without exposing sensitive full payment details unless explicitly requested. Return structured JSON for title, subtitle, highlights, totals, privacy_notes, and source_summary. Ledger data: {{ledger_data}}'
    ),
    (
      'memory_shot_people_together',
      'Create a Memory Shot draft about people appearing together in the provided Journey data. Do not identify unnamed people. Respect private member names and return structured JSON for title, subtitle, people_summary, moments, privacy_notes, and source_summary. People and media data: {{people_media_data}}'
    ),
    (
      'journey_daily_summary',
      'Summarize this Journey day using only the provided source data. Keep the tone warm and factual. Return structured JSON for title, summary, highlights, open_questions, and source_summary. Day data: {{day_data}}'
    ),
    (
      'discover_safety_check',
      'Review this Memory Shot for public Discover sharing. Check for faces, minors, exact addresses, flights, passports, tickets, receipts, license plates, home addresses, sensitive chat, expense details, and private names. Return structured JSON for decision, risk_level, reasons, required_redactions, and reviewer_notes. Memory Shot data: {{memory_shot_data}}'
    )
) as seed(key, prompt_body)
join public.prompt_templates template
  on template.key = seed.key
on conflict (template_id, language, environment, version) do update
set
  prompt_body = excluded.prompt_body,
  metadata = public.prompt_template_versions.metadata || excluded.metadata
where public.prompt_template_versions.status <> 'active'
  or public.prompt_template_versions.metadata ? 'seed';

