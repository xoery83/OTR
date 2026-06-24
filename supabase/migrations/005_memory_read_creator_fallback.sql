drop policy if exists "Trip members can read memory entries" on public.memory_entries;
drop policy if exists "Trip members can insert memory entries" on public.memory_entries;
drop policy if exists "Users can update their own memory entries" on public.memory_entries;

create policy "Trip members can read memory entries"
  on public.memory_entries
  for select
  to authenticated
  using (
    public.is_trip_member(trip_id)
    or public.is_trip_creator(trip_id)
  );

create policy "Trip members can insert memory entries"
  on public.memory_entries
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and user_id = auth.uid()
    and (
      public.is_trip_member(trip_id)
      or public.is_trip_creator(trip_id)
    )
  );

create policy "Users can update their own memory entries"
  on public.memory_entries
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      public.is_trip_member(trip_id)
      or public.is_trip_creator(trip_id)
    )
  );

drop policy if exists "Trip members can read media assets" on public.media_assets;
drop policy if exists "Trip members can insert media assets" on public.media_assets;
drop policy if exists "Users can update their own media assets" on public.media_assets;

create policy "Trip members can read media assets"
  on public.media_assets
  for select
  to authenticated
  using (
    public.is_trip_member(trip_id)
    or public.is_trip_creator(trip_id)
  );

create policy "Trip members can insert media assets"
  on public.media_assets
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      public.is_trip_member(trip_id)
      or public.is_trip_creator(trip_id)
    )
  );

create policy "Users can update their own media assets"
  on public.media_assets
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      public.is_trip_member(trip_id)
      or public.is_trip_creator(trip_id)
    )
  );

create or replace function public.can_access_trip_media(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  path_parts text[] := storage.foldername(object_name);
  target_trip_id uuid;
begin
  if array_length(path_parts, 1) < 3 then
    return false;
  end if;

  if path_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  target_trip_id := path_parts[1]::uuid;

  return public.is_trip_member(target_trip_id)
    or public.is_trip_creator(target_trip_id);
end;
$$;
