alter table public.itinerary_events
add column if not exists source_text text,
add column if not exists confidence numeric,
add column if not exists needs_review boolean not null default false;

create table if not exists public.itinerary_event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.itinerary_events(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  participation_status text default 'planned' check (
    participation_status in ('planned', 'confirmed', 'optional', 'not_going')
  ),
  created_at timestamptz default now(),
  unique(event_id, user_id)
);

create index if not exists itinerary_event_participants_event_id_idx
  on public.itinerary_event_participants(event_id);

create index if not exists itinerary_event_participants_user_id_idx
  on public.itinerary_event_participants(user_id);

alter table public.itinerary_event_participants enable row level security;

create or replace function public.can_manage_itinerary_event_participants(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.itinerary_events ie
    where ie.id = target_event_id
      and (
        ie.created_by = auth.uid()
        or public.is_trip_owner_or_admin(ie.trip_id)
      )
  );
$$;

drop policy if exists "Trip members can read itinerary event participants"
  on public.itinerary_event_participants;
drop policy if exists "Itinerary managers can insert participants"
  on public.itinerary_event_participants;
drop policy if exists "Itinerary managers can update participants"
  on public.itinerary_event_participants;
drop policy if exists "Itinerary managers can delete participants"
  on public.itinerary_event_participants;

create policy "Trip members can read itinerary event participants"
  on public.itinerary_event_participants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.itinerary_events ie
      where ie.id = event_id
        and public.is_trip_member(ie.trip_id)
    )
  );

create policy "Itinerary managers can insert participants"
  on public.itinerary_event_participants
  for insert
  to authenticated
  with check (public.can_manage_itinerary_event_participants(event_id));

create policy "Itinerary managers can update participants"
  on public.itinerary_event_participants
  for update
  to authenticated
  using (public.can_manage_itinerary_event_participants(event_id))
  with check (public.can_manage_itinerary_event_participants(event_id));

create policy "Itinerary managers can delete participants"
  on public.itinerary_event_participants
  for delete
  to authenticated
  using (public.can_manage_itinerary_event_participants(event_id));
