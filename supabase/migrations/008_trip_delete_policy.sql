drop policy if exists "Trip creators can delete trips" on public.trips;

create policy "Trip creators can delete trips"
  on public.trips
  for delete
  to authenticated
  using (created_by = auth.uid());
