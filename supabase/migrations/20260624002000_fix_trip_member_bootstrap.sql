create or replace function public.add_trip_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.trip_members (trip_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (trip_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_trip_created_add_creator on public.trips;

create trigger on_trip_created_add_creator
after insert on public.trips
for each row
execute function public.add_trip_creator_as_member();

drop policy if exists "Trip creators can add trip members" on public.trip_members;

create policy "Trip creators can add trip members"
  on public.trip_members
  for insert
  to authenticated
  with check (
    public.is_trip_creator(trip_id)
  );
