alter table public.memory_entries
alter column user_id set default auth.uid();

drop policy if exists "Trip members can insert memory entries" on public.memory_entries;

create policy "Trip members can insert memory entries"
  on public.memory_entries
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and user_id = auth.uid()
    and public.is_trip_member(trip_id)
  );

drop policy if exists "Users can add themselves to trips they created" on public.trip_members;

create policy "Users can add themselves to trips they created"
  on public.trip_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'owner'
    and public.is_trip_creator(trip_id)
  );
