drop policy if exists "Trip members can read storage connections"
  on public.journey_storage_connections;

create policy "Trip members can read storage connections"
  on public.journey_storage_connections
  for select
  to authenticated
  using (public.is_trip_member_or_creator(trip_id));
