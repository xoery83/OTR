alter table public.memory_entries
add column if not exists location_name text;

create index if not exists memory_entries_trip_id_captured_at_asc_idx
  on public.memory_entries(trip_id, captured_at asc);
