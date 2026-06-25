create table if not exists public.journey_map_objects (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.trips(id) on delete cascade,
  type text not null check (
    type in (
      'live_location',
      'memory',
      'booking',
      'plan_item',
      'hotel',
      'restaurant',
      'parking',
      'fuel',
      'toilet',
      'airport',
      'trailhead',
      'poi',
      'route_point',
      'emergency'
    )
  ),
  source_type text,
  source_id uuid,
  title text not null,
  description text,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  timestamp timestamptz,
  owner_user_id uuid references public.profiles(id) on delete set null,
  visibility text not null default 'journey'
    check (visibility in ('private', 'journey', 'public')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.journey_live_locations (
  journey_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  recorded_at timestamptz,
  is_live_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (journey_id, user_id)
);

create index if not exists journey_map_objects_journey_type_idx
  on public.journey_map_objects(journey_id, type);

create index if not exists journey_map_objects_source_idx
  on public.journey_map_objects(source_type, source_id);

create index if not exists journey_live_locations_journey_updated_idx
  on public.journey_live_locations(journey_id, updated_at desc);

alter table public.journey_map_objects enable row level security;
alter table public.journey_live_locations enable row level security;

drop trigger if exists journey_map_objects_touch_updated_at
  on public.journey_map_objects;
create trigger journey_map_objects_touch_updated_at
before update on public.journey_map_objects
for each row execute function public.touch_updated_at();

drop trigger if exists journey_live_locations_touch_updated_at
  on public.journey_live_locations;
create trigger journey_live_locations_touch_updated_at
before update on public.journey_live_locations
for each row execute function public.touch_updated_at();

drop policy if exists "Journey members can read map objects"
  on public.journey_map_objects;
drop policy if exists "Journey members can create map objects"
  on public.journey_map_objects;
drop policy if exists "Owners can update own map objects"
  on public.journey_map_objects;
drop policy if exists "Owners can delete own map objects"
  on public.journey_map_objects;

create policy "Journey members can read map objects"
  on public.journey_map_objects
  for select
  to authenticated
  using (
    visibility = 'public'
    or public.is_trip_member_or_creator(journey_id)
  );

create policy "Journey members can create map objects"
  on public.journey_map_objects
  for insert
  to authenticated
  with check (
    public.is_trip_member_or_creator(journey_id)
    and owner_user_id = auth.uid()
  );

create policy "Owners can update own map objects"
  on public.journey_map_objects
  for update
  to authenticated
  using (
    public.is_trip_member_or_creator(journey_id)
    and owner_user_id = auth.uid()
  )
  with check (
    public.is_trip_member_or_creator(journey_id)
    and owner_user_id = auth.uid()
  );

create policy "Owners can delete own map objects"
  on public.journey_map_objects
  for delete
  to authenticated
  using (
    public.is_trip_member_or_creator(journey_id)
    and owner_user_id = auth.uid()
  );

drop policy if exists "Journey members can read active live locations"
  on public.journey_live_locations;
drop policy if exists "Users can create own live location"
  on public.journey_live_locations;
drop policy if exists "Users can update own live location"
  on public.journey_live_locations;
drop policy if exists "Users can delete own live location"
  on public.journey_live_locations;

create policy "Journey members can read active live locations"
  on public.journey_live_locations
  for select
  to authenticated
  using (
    public.is_trip_member_or_creator(journey_id)
    and (
      is_live_enabled = true
      or user_id = auth.uid()
    )
  );

create policy "Users can create own live location"
  on public.journey_live_locations
  for insert
  to authenticated
  with check (
    public.is_trip_member_or_creator(journey_id)
    and user_id = auth.uid()
  );

create policy "Users can update own live location"
  on public.journey_live_locations
  for update
  to authenticated
  using (
    public.is_trip_member_or_creator(journey_id)
    and user_id = auth.uid()
  )
  with check (
    public.is_trip_member_or_creator(journey_id)
    and user_id = auth.uid()
  );

create policy "Users can delete own live location"
  on public.journey_live_locations
  for delete
  to authenticated
  using (
    public.is_trip_member_or_creator(journey_id)
    and user_id = auth.uid()
  );
