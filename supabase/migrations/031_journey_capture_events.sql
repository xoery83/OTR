create table if not exists public.journey_capture_events (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  input_type text not null
    check (input_type in ('text', 'voice', 'photo', 'video', 'attachment')),
  original_input text,
  transcription_text text,
  captured_at timestamptz not null default now(),
  timezone text,
  gps jsonb,
  metadata jsonb not null default '{}'::jsonb,
  intent text,
  confidence numeric,
  generated_actions jsonb not null default '[]'::jsonb,
  referenced_photo_ids jsonb not null default '[]'::jsonb,
  referenced_video_ids jsonb not null default '[]'::jsonb,
  referenced_expense_ids jsonb not null default '[]'::jsonb,
  referenced_planner_item_ids jsonb not null default '[]'::jsonb,
  status text not null default 'raw'
    check (status in ('raw', 'processed', 'needs_review', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journey_capture_events_journey_captured_idx
  on public.journey_capture_events(journey_id, captured_at desc);

create index if not exists journey_capture_events_status_idx
  on public.journey_capture_events(journey_id, status);

drop trigger if exists journey_capture_events_touch_updated_at
  on public.journey_capture_events;
create trigger journey_capture_events_touch_updated_at
before update on public.journey_capture_events
for each row execute function public.touch_updated_at();

alter table public.journey_capture_events enable row level security;

drop policy if exists "Trip members can read capture events"
  on public.journey_capture_events;
drop policy if exists "Trip members can insert capture events"
  on public.journey_capture_events;
drop policy if exists "Capture creators can update capture events"
  on public.journey_capture_events;

create policy "Trip members can read capture events"
  on public.journey_capture_events
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

create policy "Trip members can insert capture events"
  on public.journey_capture_events
  for insert
  to authenticated
  with check (
    public.is_trip_member_or_creator(journey_id)
    and user_id = auth.uid()
  );

create policy "Capture creators can update capture events"
  on public.journey_capture_events
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_trip_owner_or_admin(journey_id)
  )
  with check (public.is_trip_member_or_creator(journey_id));

