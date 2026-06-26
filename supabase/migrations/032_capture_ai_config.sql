create table if not exists public.capture_intent_rules (
  id uuid primary key default gen_random_uuid(),
  intent_key text not null unique,
  display_name text not null,
  description text,
  enabled boolean not null default true,
  confidence_threshold numeric(5,2) not null default 0.80,
  auto_execute boolean not null default false,
  requires_confirmation boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.capture_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  display_name text not null,
  prompt text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.capture_routing_config (
  id text primary key default 'default',
  enable_local_parser boolean not null default true,
  enable_local_intent_engine boolean not null default true,
  enable_llm_router boolean not null default true,
  local_confidence_threshold numeric(5,2) not null default 0.82,
  complexity_threshold numeric(5,2) not null default 0.55,
  force_all_requests_to_llm boolean not null default false,
  force_local_only boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.capture_intent_rules enable row level security;
alter table public.capture_prompt_templates enable row level security;
alter table public.capture_routing_config enable row level security;

drop policy if exists "Authenticated users can read capture intent rules"
  on public.capture_intent_rules;
create policy "Authenticated users can read capture intent rules"
  on public.capture_intent_rules
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can manage capture intent rules"
  on public.capture_intent_rules;
create policy "Authenticated users can manage capture intent rules"
  on public.capture_intent_rules
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read capture prompt templates"
  on public.capture_prompt_templates;
create policy "Authenticated users can read capture prompt templates"
  on public.capture_prompt_templates
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can manage capture prompt templates"
  on public.capture_prompt_templates;
create policy "Authenticated users can manage capture prompt templates"
  on public.capture_prompt_templates
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can read capture routing config"
  on public.capture_routing_config;
create policy "Authenticated users can read capture routing config"
  on public.capture_routing_config
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can manage capture routing config"
  on public.capture_routing_config;
create policy "Authenticated users can manage capture routing config"
  on public.capture_routing_config
  for all
  to authenticated
  using (true)
  with check (true);

insert into public.capture_intent_rules (
  intent_key,
  display_name,
  description,
  enabled,
  confidence_threshold,
  auto_execute,
  requires_confirmation,
  sort_order
) values
  ('memory', 'Memory', 'Default fallback for travel notes, photos, and moments.', true, 0.70, true, false, 10),
  ('planner_update', 'Planner', 'Create or modify travel plans.', true, 0.82, false, true, 20),
  ('expense', 'Expense', 'Create travel expenses from text, receipt, or invoice captures.', true, 0.82, false, true, 30),
  ('navigation', 'Navigation', 'Open map, place search, or route-oriented actions.', true, 0.80, true, false, 40),
  ('assistant', 'AI Assistant', 'Answer travel questions and remain in Capture chat.', true, 0.78, false, false, 50)
on conflict (intent_key) do nothing;

insert into public.capture_prompt_templates (
  template_key,
  display_name,
  prompt
) values
  (
    'intent_detection',
    'Capture Intent Detection Prompt',
    'Classify the user capture into one primary intent: memory, planner_update, expense, navigation, assistant. Also produce an actionGraph that may contain multiple related actions from one capture, such as hotel stay plus linked accommodation expense. Return strict JSON with intent, confidence from 0 to 1, entities, actionGraph, missingInformation, clarificationQuestions, reason, and proposedAction. Put only execution-blocking fields in missingInformation; put optional fields in actionGraph node optionalMissing. Pick memory if uncertain.'
  ),
  (
    'planner',
    'Planner Prompt',
    'Extract planner create/update information: action, title, date, time, location, target item, and whether confirmation is required.'
  ),
  (
    'expense',
    'Expense Prompt',
    'Extract amount, currency, merchant, timestamp, category, payer, and split members. Ask for missing payer, split members, or category.'
  ),
  (
    'memory',
    'Memory Prompt',
    'Create a concise travel memory with timestamp, day, GPS if available, photos, and people if available.'
  ),
  (
    'navigation',
    'Navigation Prompt',
    'Extract map action, place query, route request, destination, and current context.'
  ),
  (
    'assistant',
    'AI Assistant Prompt',
    'Answer or prepare the travel assistant task without database writes.'
  ),
  (
    'clarification',
    'Clarification Prompt',
    'When intent is understood but required information is missing, ask one concise conversational question at a time. Prefer selectable options when possible. Avoid opening full forms unless the user asks for More Details or the object is structurally complex.'
  )
on conflict (template_key) do nothing;

insert into public.capture_routing_config (
  id,
  enable_local_parser,
  enable_local_intent_engine,
  enable_llm_router,
  local_confidence_threshold,
  complexity_threshold,
  force_all_requests_to_llm,
  force_local_only
) values (
  'default',
  true,
  true,
  true,
  0.82,
  0.55,
  false,
  false
) on conflict (id) do nothing;
