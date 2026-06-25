alter table public.itinerary_events
add column if not exists status text not null default 'planned'
  check (status in ('planned', 'cancelled', 'completed', 'skipped'));

alter table public.itinerary_reservations
add column if not exists status text not null default 'planned'
  check (status in ('planned', 'cancelled', 'completed', 'skipped'));

drop policy if exists "Event creators can update itinerary events" on public.itinerary_events;
drop policy if exists "Event creators can delete itinerary events" on public.itinerary_events;
drop policy if exists "Trip members can update itinerary events" on public.itinerary_events;
drop policy if exists "Trip members can delete itinerary events" on public.itinerary_events;

create policy "Trip members can update itinerary events"
  on public.itinerary_events
  for update
  to authenticated
  using (
    public.is_trip_member(trip_id)
    or public.is_trip_creator(trip_id)
  )
  with check (
    public.is_trip_member(trip_id)
    or public.is_trip_creator(trip_id)
  );

create policy "Trip members can delete itinerary events"
  on public.itinerary_events
  for delete
  to authenticated
  using (
    public.is_trip_member(trip_id)
    or public.is_trip_creator(trip_id)
  );

drop policy if exists "Reservation creators can update itinerary reservations"
  on public.itinerary_reservations;
drop policy if exists "Reservation creators can delete itinerary reservations"
  on public.itinerary_reservations;
drop policy if exists "Trip members can update itinerary reservations"
  on public.itinerary_reservations;
drop policy if exists "Trip members can delete itinerary reservations"
  on public.itinerary_reservations;

create policy "Trip members can update itinerary reservations"
  on public.itinerary_reservations
  for update
  to authenticated
  using (public.is_trip_member_or_creator(trip_id))
  with check (public.is_trip_member_or_creator(trip_id));

create policy "Trip members can delete itinerary reservations"
  on public.itinerary_reservations
  for delete
  to authenticated
  using (public.is_trip_member_or_creator(trip_id));
