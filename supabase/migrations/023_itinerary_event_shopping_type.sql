alter table public.itinerary_events
drop constraint if exists itinerary_events_event_type_check;

alter table public.itinerary_events
add constraint itinerary_events_event_type_check
check (
  event_type in (
    'flight',
    'hotel',
    'car',
    'activity',
    'shopping',
    'meal',
    'transport',
    'note',
    'other'
  )
);
