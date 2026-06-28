create table if not exists public.itinerary_item_ratings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  item_type text not null check (item_type in ('event', 'reservation')),
  item_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating numeric(2, 1) not null check (rating >= 0 and rating <= 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(item_type, item_id, user_id)
);

create index if not exists itinerary_item_ratings_trip_id_idx
  on public.itinerary_item_ratings(trip_id);

create index if not exists itinerary_item_ratings_item_idx
  on public.itinerary_item_ratings(item_type, item_id);

alter table public.itinerary_item_ratings enable row level security;

drop policy if exists "Trip members can read itinerary item ratings"
  on public.itinerary_item_ratings;
drop policy if exists "Trip members can insert their itinerary item ratings"
  on public.itinerary_item_ratings;
drop policy if exists "Trip members can update their itinerary item ratings"
  on public.itinerary_item_ratings;
drop policy if exists "Trip members can delete their itinerary item ratings"
  on public.itinerary_item_ratings;

create policy "Trip members can read itinerary item ratings"
  on public.itinerary_item_ratings
  for select
  to authenticated
  using (public.is_trip_member(trip_id) or public.is_trip_creator(trip_id));

create policy "Trip members can insert their itinerary item ratings"
  on public.itinerary_item_ratings
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (public.is_trip_member(trip_id) or public.is_trip_creator(trip_id))
  );

create policy "Trip members can update their itinerary item ratings"
  on public.itinerary_item_ratings
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and (public.is_trip_member(trip_id) or public.is_trip_creator(trip_id))
  )
  with check (
    user_id = auth.uid()
    and (public.is_trip_member(trip_id) or public.is_trip_creator(trip_id))
  );

create policy "Trip members can delete their itinerary item ratings"
  on public.itinerary_item_ratings
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and (public.is_trip_member(trip_id) or public.is_trip_creator(trip_id))
  );

notify pgrst, 'reload schema';
