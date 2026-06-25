create table if not exists public.trip_days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  title text,
  notes text,
  order_index int default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id, day_date)
);

create table if not exists public.itinerary_reservations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  trip_day_id uuid references public.trip_days(id) on delete set null,
  reservation_type text not null default 'other' check (
    reservation_type in ('flight', 'hotel', 'car', 'ferry', 'tour', 'restaurant', 'other')
  ),
  title text not null,
  provider text,
  location_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  confirmation_code text,
  url text,
  source_text text,
  confidence numeric,
  needs_review boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.itinerary_events
add column if not exists trip_day_id uuid references public.trip_days(id) on delete set null,
add column if not exists reservation_id uuid references public.itinerary_reservations(id) on delete set null,
add column if not exists is_estimated_time boolean not null default false,
add column if not exists date_confidence numeric,
add column if not exists time_confidence numeric,
add column if not exists participants_confidence numeric,
add column if not exists location_confidence numeric;

alter table public.memory_entries
add column if not exists trip_day_id uuid references public.trip_days(id) on delete set null;

create index if not exists trip_days_trip_id_day_date_idx
  on public.trip_days(trip_id, day_date);

create index if not exists itinerary_reservations_trip_id_starts_at_idx
  on public.itinerary_reservations(trip_id, starts_at);

create index if not exists itinerary_reservations_trip_day_id_idx
  on public.itinerary_reservations(trip_day_id);

create index if not exists itinerary_events_trip_day_id_idx
  on public.itinerary_events(trip_day_id);

create index if not exists itinerary_events_reservation_id_idx
  on public.itinerary_events(reservation_id);

create index if not exists memory_entries_trip_day_id_idx
  on public.memory_entries(trip_day_id);

alter table public.trip_days enable row level security;
alter table public.itinerary_reservations enable row level security;

drop policy if exists "Trip members can read trip days" on public.trip_days;
drop policy if exists "Trip managers can insert trip days" on public.trip_days;
drop policy if exists "Trip managers can update trip days" on public.trip_days;
drop policy if exists "Trip managers can delete trip days" on public.trip_days;

create policy "Trip members can read trip days"
  on public.trip_days
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "Trip managers can insert trip days"
  on public.trip_days
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_trip_owner_or_admin(trip_id)
  );

create policy "Trip managers can update trip days"
  on public.trip_days
  for update
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_trip_owner_or_admin(trip_id)
  )
  with check (public.is_trip_owner_or_admin(trip_id));

create policy "Trip managers can delete trip days"
  on public.trip_days
  for delete
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_trip_owner_or_admin(trip_id)
  );

drop policy if exists "Trip members can read itinerary reservations"
  on public.itinerary_reservations;
drop policy if exists "Trip managers can insert itinerary reservations"
  on public.itinerary_reservations;
drop policy if exists "Reservation creators can update itinerary reservations"
  on public.itinerary_reservations;
drop policy if exists "Reservation creators can delete itinerary reservations"
  on public.itinerary_reservations;

create policy "Trip members can read itinerary reservations"
  on public.itinerary_reservations
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "Trip managers can insert itinerary reservations"
  on public.itinerary_reservations
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_trip_owner_or_admin(trip_id)
  );

create policy "Reservation creators can update itinerary reservations"
  on public.itinerary_reservations
  for update
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_trip_owner_or_admin(trip_id)
  )
  with check (public.is_trip_owner_or_admin(trip_id));

create policy "Reservation creators can delete itinerary reservations"
  on public.itinerary_reservations
  for delete
  to authenticated
  using (
    created_by = auth.uid()
    or public.is_trip_owner_or_admin(trip_id)
  );
