create or replace function public.can_share_journey_live_location(
  target_journey_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.journey_members jm
    where jm.trip_id = target_journey_id
      and jm.user_id = target_user_id
      and jm.status = 'linked'
      and jm.role in ('owner', 'group_member')
  );
$$;

drop policy if exists "Journey members can read active live locations"
  on public.journey_live_locations;
drop policy if exists "Users can create own live location"
  on public.journey_live_locations;
drop policy if exists "Users can update own live location"
  on public.journey_live_locations;
drop policy if exists "Users can delete own live location"
  on public.journey_live_locations;

create policy "Active journey members can read active live locations"
  on public.journey_live_locations
  for select
  to authenticated
  using (
    public.can_share_journey_live_location(journey_id, auth.uid())
    and (
      is_live_enabled = true
      or user_id = auth.uid()
    )
  );

create policy "Active journey members can create own live location"
  on public.journey_live_locations
  for insert
  to authenticated
  with check (
    public.can_share_journey_live_location(journey_id, auth.uid())
    and user_id = auth.uid()
  );

create policy "Active journey members can update own live location"
  on public.journey_live_locations
  for update
  to authenticated
  using (
    public.can_share_journey_live_location(journey_id, auth.uid())
    and user_id = auth.uid()
  )
  with check (
    public.can_share_journey_live_location(journey_id, auth.uid())
    and user_id = auth.uid()
  );

create policy "Users can delete own live location"
  on public.journey_live_locations
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_trip_member_or_creator(journey_id)
  );
