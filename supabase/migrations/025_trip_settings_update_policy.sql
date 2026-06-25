drop policy if exists "Trip owners and admins can update trip settings"
  on public.trips;

create policy "Trip owners and admins can update trip settings"
  on public.trips
  for update
  to authenticated
  using (public.is_trip_owner_or_admin(id))
  with check (public.is_trip_owner_or_admin(id));
