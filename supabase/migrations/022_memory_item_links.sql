alter table public.memory_entries
add column if not exists itinerary_event_id uuid references public.itinerary_events(id) on delete set null,
add column if not exists itinerary_reservation_id uuid references public.itinerary_reservations(id) on delete set null;

create index if not exists memory_entries_itinerary_event_id_idx
  on public.memory_entries(itinerary_event_id);

create index if not exists memory_entries_itinerary_reservation_id_idx
  on public.memory_entries(itinerary_reservation_id);
