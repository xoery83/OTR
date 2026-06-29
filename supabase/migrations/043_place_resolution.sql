create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null,
  display_name text,
  formatted_address text,
  city text,
  region text,
  country text,
  lat double precision,
  lng double precision,
  provider text,
  provider_place_id text,
  confidence numeric,
  source text,
  raw_query text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_verified_at timestamptz
);

create index if not exists places_normalized_name_idx
  on public.places(normalized_name);

create index if not exists places_provider_place_id_idx
  on public.places(provider, provider_place_id);

create index if not exists places_lat_lng_idx
  on public.places(lat, lng);

create unique index if not exists places_normalized_country_provider_idx
  on public.places(
    normalized_name,
    coalesce(country, ''),
    coalesce(provider, ''),
    coalesce(provider_place_id, '')
  );

drop trigger if exists places_touch_updated_at on public.places;
create trigger places_touch_updated_at
before update on public.places
for each row execute function public.touch_updated_at();

alter table public.places enable row level security;

drop policy if exists "Authenticated users can read places cache" on public.places;
drop policy if exists "Authenticated users can insert places cache" on public.places;
drop policy if exists "Authenticated users can update places cache" on public.places;

create policy "Authenticated users can read places cache"
  on public.places
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert places cache"
  on public.places
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update places cache"
  on public.places
  for update
  to authenticated
  using (true)
  with check (true);

do $$
begin
  if not exists (select 1 from pg_type where typname = 'location_resolution_status') then
    create type public.location_resolution_status as enum (
      'none',
      'pending',
      'resolving',
      'resolved',
      'ambiguous',
      'failed',
      'manual'
    );
  end if;
end
$$;

alter table public.itinerary_events
add column if not exists location_text text,
add column if not exists location_lat double precision,
add column if not exists location_lng double precision,
add column if not exists location_status public.location_resolution_status not null default 'none',
add column if not exists location_confidence numeric,
add column if not exists place_id uuid references public.places(id) on delete set null,
add column if not exists provider text,
add column if not exists provider_place_id text,
add column if not exists geocoded_at timestamptz,
add column if not exists geocode_error text,
add column if not exists geocode_attempts integer not null default 0,
add column if not exists manual_location boolean not null default false;

alter table public.itinerary_reservations
add column if not exists location_text text,
add column if not exists location_lat double precision,
add column if not exists location_lng double precision,
add column if not exists location_status public.location_resolution_status not null default 'none',
add column if not exists location_confidence numeric,
add column if not exists place_id uuid references public.places(id) on delete set null,
add column if not exists provider text,
add column if not exists provider_place_id text,
add column if not exists geocoded_at timestamptz,
add column if not exists geocode_error text,
add column if not exists geocode_attempts integer not null default 0,
add column if not exists manual_location boolean not null default false;

alter table public.memory_entries
add column if not exists location_text text,
add column if not exists location_lat double precision,
add column if not exists location_lng double precision,
add column if not exists location_status public.location_resolution_status not null default 'none',
add column if not exists location_confidence numeric,
add column if not exists place_id uuid references public.places(id) on delete set null,
add column if not exists provider text,
add column if not exists provider_place_id text,
add column if not exists geocoded_at timestamptz,
add column if not exists geocode_error text,
add column if not exists geocode_attempts integer not null default 0,
add column if not exists manual_location boolean not null default false;

alter table public.media_assets
add column if not exists location_text text,
add column if not exists location_lat double precision,
add column if not exists location_lng double precision,
add column if not exists location_status public.location_resolution_status not null default 'none',
add column if not exists location_confidence numeric,
add column if not exists place_id uuid references public.places(id) on delete set null,
add column if not exists provider text,
add column if not exists provider_place_id text,
add column if not exists geocoded_at timestamptz,
add column if not exists geocode_error text,
add column if not exists geocode_attempts integer not null default 0,
add column if not exists manual_location boolean not null default false;

alter table public.ledger_entries
add column if not exists location_text text,
add column if not exists location_lat double precision,
add column if not exists location_lng double precision,
add column if not exists location_status public.location_resolution_status not null default 'none',
add column if not exists location_confidence numeric,
add column if not exists place_id uuid references public.places(id) on delete set null,
add column if not exists provider text,
add column if not exists provider_place_id text,
add column if not exists geocoded_at timestamptz,
add column if not exists geocode_error text,
add column if not exists geocode_attempts integer not null default 0,
add column if not exists manual_location boolean not null default false;

alter table public.journey_map_objects
add column if not exists location_text text,
add column if not exists location_status public.location_resolution_status not null default 'none',
add column if not exists location_confidence numeric,
add column if not exists place_id uuid references public.places(id) on delete set null,
add column if not exists provider text,
add column if not exists provider_place_id text,
add column if not exists geocoded_at timestamptz,
add column if not exists geocode_error text,
add column if not exists geocode_attempts integer not null default 0,
add column if not exists manual_location boolean not null default false;

update public.itinerary_events
set
  location_text = nullif(trim(location_name), ''),
  location_status = case
    when nullif(trim(location_name), '') is null then 'none'::public.location_resolution_status
    when location_lat is not null and location_lng is not null then 'resolved'::public.location_resolution_status
    else 'pending'::public.location_resolution_status
  end
where location_text is null;

update public.itinerary_reservations
set
  location_text = nullif(trim(location_name), ''),
  location_status = case
    when nullif(trim(location_name), '') is null then 'none'::public.location_resolution_status
    when location_lat is not null and location_lng is not null then 'resolved'::public.location_resolution_status
    else 'pending'::public.location_resolution_status
  end
where location_text is null;

update public.memory_entries
set
  location_text = nullif(trim(location_name), ''),
  location_status = case
    when nullif(trim(location_name), '') is null then 'none'::public.location_resolution_status
    when location_lat is not null and location_lng is not null then 'resolved'::public.location_resolution_status
    else 'pending'::public.location_resolution_status
  end
where location_text is null;

update public.ledger_entries
set
  location_text = nullif(trim(address_text), ''),
  location_lat = latitude::double precision,
  location_lng = longitude::double precision,
  location_status = case
    when nullif(trim(address_text), '') is null then 'none'::public.location_resolution_status
    when latitude is not null and longitude is not null then 'resolved'::public.location_resolution_status
    else 'pending'::public.location_resolution_status
  end
where location_text is null;

update public.media_assets
set
  location_lat = gps_latitude,
  location_lng = gps_longitude,
  location_status = case
    when gps_latitude is not null and gps_longitude is not null then 'resolved'::public.location_resolution_status
    when nullif(trim(location_text), '') is not null then 'pending'::public.location_resolution_status
    else 'none'::public.location_resolution_status
  end
where location_status = 'none';

create index if not exists itinerary_events_location_repair_idx
  on public.itinerary_events(trip_id, location_status, geocoded_at)
  where location_text is not null;

create index if not exists itinerary_reservations_location_repair_idx
  on public.itinerary_reservations(trip_id, location_status, geocoded_at)
  where location_text is not null;

create index if not exists memory_entries_location_repair_idx
  on public.memory_entries(trip_id, location_status, geocoded_at)
  where location_text is not null;

create index if not exists ledger_entries_location_repair_idx
  on public.ledger_entries(journey_id, location_status, geocoded_at)
  where location_text is not null;

create index if not exists journey_map_objects_source_unique_idx
  on public.journey_map_objects(journey_id, source_type, source_id)
  where source_type is not null and source_id is not null;
