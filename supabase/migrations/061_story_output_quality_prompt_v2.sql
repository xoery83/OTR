update public.prompt_template_versions version
set status = 'archived'
from public.prompt_templates template
where version.template_id = template.id
  and template.key = 'memory_shot_daily_best_moments'
  and version.language = 'en'
  and version.environment = 'production'
  and version.version <> 'v2'
  and version.status = 'active';

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
  'v2',
  'active',
  'Create a Journey Story poster script from the provided Journey day data.

Use only the provided data. The output is for a shareable travel story poster, not a debug summary.

Return only valid JSON:
{
  "title": "emotional title, 4-9 words",
  "subtitle": "one line with date/place/feeling",
  "story_beats": ["2-4 natural story sentences, no checklist bullets"],
  "ending": "optional short closing line or quote",
  "selected_asset_ids": ["choose 1-3 photo asset ids when photos exist"]
}

Rules:
- Prefer a warm travel-story voice.
- If photos exist, choose at least one useful photo id for selected_asset_ids.
- Do not use the words Memory Shot.
- Do not write a checklist, log, or database-style summary.
- Do not expose ledger amounts, payment details, receipts, or sensitive spending details.
- Keep people/place/date when useful, but make it read like a story.
- If source data is thin, write a quiet but human fallback story.

Journey data: {{journey_data}}',
  '{"seed": true, "quality_upgrade": "story_output_v1"}'::jsonb
from public.prompt_templates template
where template.key = 'memory_shot_daily_best_moments'
on conflict (template_id, language, environment, version) do update
set
  prompt_body = excluded.prompt_body,
  metadata = public.prompt_template_versions.metadata || excluded.metadata,
  status = 'active';
