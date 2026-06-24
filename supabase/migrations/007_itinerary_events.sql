create table if not exists public.itinerary_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  description text,
  event_type text not null default 'activity' check (
    event_type in ('flight', 'hotel', 'car', 'activity', 'meal', 'transport', 'note', 'other')
  ),
  location_name text,
  planned_start timestamptz,
  planned_end timestamptz,
  booking_reference text,
  url text,
  order_index int default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.itinerary_events enable row level security;

create index if not exists itinerary_events_trip_id_planned_start_idx
  on public.itinerary_events(trip_id, planned_start);

create index if not exists itinerary_events_trip_id_order_index_idx
  on public.itinerary_events(trip_id, order_index);

alter table public.memory_entries
add column if not exists itinerary_event_id uuid references public.itinerary_events(id) on delete set null;

drop policy if exists "Trip members can read itinerary events" on public.itinerary_events;
drop policy if exists "Trip members can insert itinerary events" on public.itinerary_events;
drop policy if exists "Event creators can update itinerary events" on public.itinerary_events;
drop policy if exists "Event creators can delete itinerary events" on public.itinerary_events;

create policy "Trip members can read itinerary events"
  on public.itinerary_events
  for select
  to authenticated
  using (
    public.is_trip_member(trip_id)
    or public.is_trip_creator(trip_id)
  );

create policy "Trip members can insert itinerary events"
  on public.itinerary_events
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.is_trip_member(trip_id)
      or public.is_trip_creator(trip_id)
    )
  );

create policy "Event creators can update itinerary events"
  on public.itinerary_events
  for update
  to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

create policy "Event creators can delete itinerary events"
  on public.itinerary_events
  for delete
  to authenticated
  using (created_by = auth.uid());
