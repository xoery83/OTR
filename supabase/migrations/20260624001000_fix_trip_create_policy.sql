alter table public.trips
alter column created_by set default auth.uid();

drop policy if exists "Authenticated users can create trips" on public.trips;

create policy "Authenticated users can create trips"
  on public.trips
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and created_by = auth.uid()
  );
