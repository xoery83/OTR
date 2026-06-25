create table if not exists public.itinerary_reservation_participants (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.itinerary_reservations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  participation_status text default 'planned' check (
    participation_status in ('planned', 'confirmed', 'optional', 'not_going')
  ),
  created_at timestamptz default now(),
  unique(reservation_id, user_id)
);

create index if not exists itinerary_reservation_participants_reservation_id_idx
  on public.itinerary_reservation_participants(reservation_id);

create index if not exists itinerary_reservation_participants_user_id_idx
  on public.itinerary_reservation_participants(user_id);

alter table public.itinerary_reservation_participants enable row level security;

create or replace function public.can_manage_itinerary_reservation_participants(
  target_reservation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.itinerary_reservations ir
    where ir.id = target_reservation_id
      and (
        ir.created_by = auth.uid()
        or public.is_trip_owner_or_admin(ir.trip_id)
      )
  );
$$;

drop policy if exists "Trip members can read itinerary reservation participants"
  on public.itinerary_reservation_participants;
drop policy if exists "Reservation managers can insert participants"
  on public.itinerary_reservation_participants;
drop policy if exists "Reservation managers can update participants"
  on public.itinerary_reservation_participants;
drop policy if exists "Reservation managers can delete participants"
  on public.itinerary_reservation_participants;

create policy "Trip members can read itinerary reservation participants"
  on public.itinerary_reservation_participants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.itinerary_reservations ir
      where ir.id = reservation_id
        and public.is_trip_member(ir.trip_id)
    )
  );

create policy "Reservation managers can insert participants"
  on public.itinerary_reservation_participants
  for insert
  to authenticated
  with check (
    public.can_manage_itinerary_reservation_participants(reservation_id)
  );

create policy "Reservation managers can update participants"
  on public.itinerary_reservation_participants
  for update
  to authenticated
  using (public.can_manage_itinerary_reservation_participants(reservation_id))
  with check (public.can_manage_itinerary_reservation_participants(reservation_id));

create policy "Reservation managers can delete participants"
  on public.itinerary_reservation_participants
  for delete
  to authenticated
  using (public.can_manage_itinerary_reservation_participants(reservation_id));
