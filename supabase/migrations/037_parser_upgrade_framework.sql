create table if not exists public.parser_rules (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid references public.trips(id) on delete cascade,
  scope text not null default 'journey' check (scope in ('journey', 'global')),
  source text not null,
  intent text,
  pattern_type text not null default 'keyword' check (pattern_type in ('keyword', 'regex', 'semantic_template', 'llm_generated')),
  pattern text not null,
  slot_mapping jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  confidence numeric(5,2) not null default 0.80,
  status text not null default 'pending' check (status in ('pending', 'enabled', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  success_count integer not null default 0,
  failure_count integer not null default 0
);

create table if not exists public.parser_examples (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid references public.trips(id) on delete cascade,
  source text not null,
  original_text text not null,
  normalized_text text not null,
  corrected_parse_result jsonb not null,
  language text,
  embedding jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  usage_count integer not null default 0
);

create table if not exists public.parser_aliases (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid references public.trips(id) on delete cascade,
  alias_text text not null,
  canonical_type text not null check (canonical_type in ('person', 'place', 'currency', 'payment_method', 'split_method', 'plan_type')),
  canonical_id text,
  canonical_value text not null,
  scope text not null default 'journey' check (scope in ('journey', 'global')),
  status text not null default 'enabled' check (status in ('pending', 'enabled', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.parser_corrections (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid references public.trips(id) on delete cascade,
  source text not null,
  original_text text not null,
  wrong_parse_result jsonb,
  corrected_parse_result jsonb,
  error_types text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.parser_parse_logs (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid references public.trips(id) on delete cascade,
  source text not null,
  original_text text not null,
  parse_result jsonb,
  parse_method text not null check (parse_method in ('rule', 'example', 'alias', 'llm', 'correction', 'local')),
  matched_rule_id uuid,
  confidence numeric(5,2),
  user_accepted boolean,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists parser_examples_lookup_idx
  on public.parser_examples (source, journey_id, normalized_text);
create index if not exists parser_rules_lookup_idx
  on public.parser_rules (source, journey_id, status, priority);
create index if not exists parser_aliases_lookup_idx
  on public.parser_aliases (canonical_type, journey_id, status, alias_text);
create index if not exists parser_parse_logs_journey_idx
  on public.parser_parse_logs (journey_id, source, created_at desc);

alter table public.parser_rules enable row level security;
alter table public.parser_examples enable row level security;
alter table public.parser_aliases enable row level security;
alter table public.parser_corrections enable row level security;
alter table public.parser_parse_logs enable row level security;

drop policy if exists "Parser rules are readable by authenticated users" on public.parser_rules;
create policy "Parser rules are readable by authenticated users"
  on public.parser_rules for select to authenticated using (true);

drop policy if exists "Parser rules are manageable by authenticated users" on public.parser_rules;
create policy "Parser rules are manageable by authenticated users"
  on public.parser_rules for all to authenticated
  using (true)
  with check (true);

drop policy if exists "Parser examples are readable by authenticated users" on public.parser_examples;
create policy "Parser examples are readable by authenticated users"
  on public.parser_examples for select to authenticated using (true);

drop policy if exists "Parser examples are manageable by authenticated users" on public.parser_examples;
create policy "Parser examples are manageable by authenticated users"
  on public.parser_examples for all to authenticated
  using (true)
  with check (true);

drop policy if exists "Parser aliases are readable by authenticated users" on public.parser_aliases;
create policy "Parser aliases are readable by authenticated users"
  on public.parser_aliases for select to authenticated using (true);

drop policy if exists "Parser aliases are manageable by authenticated users" on public.parser_aliases;
create policy "Parser aliases are manageable by authenticated users"
  on public.parser_aliases for all to authenticated
  using (true)
  with check (true);

drop policy if exists "Parser corrections are manageable by authenticated users" on public.parser_corrections;
create policy "Parser corrections are manageable by authenticated users"
  on public.parser_corrections for all to authenticated
  using (true)
  with check (true);

drop policy if exists "Parser logs are manageable by authenticated users" on public.parser_parse_logs;
create policy "Parser logs are manageable by authenticated users"
  on public.parser_parse_logs for all to authenticated
  using (true)
  with check (true);
