create table if not exists public.journey_ledgers (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.trips(id) on delete cascade,
  base_currency text not null default 'NZD',
  display_currency text not null default 'NZD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(journey_id)
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.trips(id) on delete cascade,
  itinerary_event_id uuid references public.itinerary_events(id) on delete set null,
  itinerary_reservation_id uuid references public.itinerary_reservations(id) on delete set null,
  memory_entry_id uuid references public.memory_entries(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'other'
    check (category in (
      'flight',
      'hotel',
      'car',
      'fuel',
      'food',
      'ticket',
      'shopping',
      'transport',
      'insurance',
      'other'
    )),
  accounting_mode text not null default 'shared'
    check (accounting_mode in ('stats_only', 'shared')),
  expense_date date not null default current_date,
  start_date date,
  end_date date,
  original_amount numeric(12, 2) not null check (original_amount >= 0),
  original_currency text not null,
  base_amount numeric(12, 2) not null check (base_amount >= 0),
  base_currency text not null,
  exchange_rate numeric(18, 8) not null default 1 check (exchange_rate > 0),
  exchange_rate_date date,
  exchange_rate_source text,
  payer_member_id uuid references public.journey_members(id) on delete set null,
  address_text text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  location_source text,
  status text not null default 'complete'
    check (status in ('draft', 'complete', 'needs_review')),
  created_by_member_id uuid references public.journey_members(id) on delete set null,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ledger_entry_participants (
  id uuid primary key default gen_random_uuid(),
  ledger_entry_id uuid not null references public.ledger_entries(id) on delete cascade,
  member_id uuid not null references public.journey_members(id) on delete cascade,
  split_method text not null default 'equal'
    check (split_method in ('equal', 'custom_amount', 'custom_percentage')),
  share_amount numeric(12, 2),
  share_percentage numeric(7, 4),
  computed_share_base_amount numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(ledger_entry_id, member_id)
);

create table if not exists public.ledger_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency text not null,
  to_currency text not null,
  rate numeric(18, 8) not null check (rate > 0),
  rate_date date not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  unique(from_currency, to_currency, rate_date, source)
);

create table if not exists public.ledger_settlements (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.trips(id) on delete cascade,
  from_member_id uuid not null references public.journey_members(id) on delete cascade,
  to_member_id uuid not null references public.journey_members(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'paid')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists journey_ledgers_journey_id_idx
  on public.journey_ledgers(journey_id);

create index if not exists ledger_entries_journey_expense_date_idx
  on public.ledger_entries(journey_id, expense_date desc);

create index if not exists ledger_entries_payer_member_id_idx
  on public.ledger_entries(payer_member_id);

create index if not exists ledger_entries_memory_entry_id_idx
  on public.ledger_entries(memory_entry_id);

create index if not exists ledger_entries_itinerary_event_id_idx
  on public.ledger_entries(itinerary_event_id);

create index if not exists ledger_entries_itinerary_reservation_id_idx
  on public.ledger_entries(itinerary_reservation_id);

create index if not exists ledger_entry_participants_entry_id_idx
  on public.ledger_entry_participants(ledger_entry_id);

create index if not exists ledger_entry_participants_member_id_idx
  on public.ledger_entry_participants(member_id);

create index if not exists ledger_settlements_journey_id_idx
  on public.ledger_settlements(journey_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists journey_ledgers_touch_updated_at on public.journey_ledgers;
create trigger journey_ledgers_touch_updated_at
before update on public.journey_ledgers
for each row execute function public.touch_updated_at();

drop trigger if exists ledger_entries_touch_updated_at on public.ledger_entries;
create trigger ledger_entries_touch_updated_at
before update on public.ledger_entries
for each row execute function public.touch_updated_at();

drop trigger if exists ledger_entry_participants_touch_updated_at on public.ledger_entry_participants;
create trigger ledger_entry_participants_touch_updated_at
before update on public.ledger_entry_participants
for each row execute function public.touch_updated_at();

drop trigger if exists ledger_settlements_touch_updated_at on public.ledger_settlements;
create trigger ledger_settlements_touch_updated_at
before update on public.ledger_settlements
for each row execute function public.touch_updated_at();

alter table public.journey_ledgers enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.ledger_entry_participants enable row level security;
alter table public.ledger_exchange_rates enable row level security;
alter table public.ledger_settlements enable row level security;

drop policy if exists "Trip members can read journey ledger" on public.journey_ledgers;
drop policy if exists "Trip members can create journey ledger" on public.journey_ledgers;
drop policy if exists "Trip owners can update journey ledger" on public.journey_ledgers;

create policy "Trip members can read journey ledger"
  on public.journey_ledgers
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

create policy "Trip members can create journey ledger"
  on public.journey_ledgers
  for insert
  to authenticated
  with check (public.is_trip_member_or_creator(journey_id));

create policy "Trip owners can update journey ledger"
  on public.journey_ledgers
  for update
  to authenticated
  using (public.is_trip_owner_or_admin(journey_id))
  with check (public.is_trip_owner_or_admin(journey_id));

drop policy if exists "Trip members can read ledger entries" on public.ledger_entries;
drop policy if exists "Trip members can create ledger entries" on public.ledger_entries;
drop policy if exists "Entry creators can update ledger entries" on public.ledger_entries;
drop policy if exists "Entry creators can delete ledger entries" on public.ledger_entries;

create policy "Trip members can read ledger entries"
  on public.ledger_entries
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

create policy "Trip members can create ledger entries"
  on public.ledger_entries
  for insert
  to authenticated
  with check (
    public.is_trip_member_or_creator(journey_id)
    and created_by_user_id = auth.uid()
  );

create policy "Entry creators can update ledger entries"
  on public.ledger_entries
  for update
  to authenticated
  using (
    created_by_user_id = auth.uid()
    or public.is_trip_owner_or_admin(journey_id)
  )
  with check (public.is_trip_member_or_creator(journey_id));

create policy "Entry creators can delete ledger entries"
  on public.ledger_entries
  for delete
  to authenticated
  using (
    created_by_user_id = auth.uid()
    or public.is_trip_owner_or_admin(journey_id)
  );

drop policy if exists "Trip members can read ledger participants" on public.ledger_entry_participants;
drop policy if exists "Trip members can create ledger participants" on public.ledger_entry_participants;
drop policy if exists "Trip members can update ledger participants" on public.ledger_entry_participants;
drop policy if exists "Trip members can delete ledger participants" on public.ledger_entry_participants;

create policy "Trip members can read ledger participants"
  on public.ledger_entry_participants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.ledger_entries le
      where le.id = ledger_entry_id
        and public.is_trip_member_or_creator(le.journey_id)
    )
  );

create policy "Trip members can create ledger participants"
  on public.ledger_entry_participants
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.ledger_entries le
      where le.id = ledger_entry_id
        and public.is_trip_member_or_creator(le.journey_id)
    )
  );

create policy "Trip members can update ledger participants"
  on public.ledger_entry_participants
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.ledger_entries le
      where le.id = ledger_entry_id
        and public.is_trip_member_or_creator(le.journey_id)
    )
  )
  with check (
    exists (
      select 1
      from public.ledger_entries le
      where le.id = ledger_entry_id
        and public.is_trip_member_or_creator(le.journey_id)
    )
  );

create policy "Trip members can delete ledger participants"
  on public.ledger_entry_participants
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.ledger_entries le
      where le.id = ledger_entry_id
        and public.is_trip_member_or_creator(le.journey_id)
    )
  );

drop policy if exists "Authenticated users can read exchange rates" on public.ledger_exchange_rates;
drop policy if exists "Authenticated users can create exchange rates" on public.ledger_exchange_rates;

create policy "Authenticated users can read exchange rates"
  on public.ledger_exchange_rates
  for select
  to authenticated
  using (true);

create policy "Authenticated users can create exchange rates"
  on public.ledger_exchange_rates
  for insert
  to authenticated
  with check (true);

drop policy if exists "Trip members can read ledger settlements" on public.ledger_settlements;
drop policy if exists "Trip members can create ledger settlements" on public.ledger_settlements;
drop policy if exists "Trip members can update ledger settlements" on public.ledger_settlements;

create policy "Trip members can read ledger settlements"
  on public.ledger_settlements
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

create policy "Trip members can create ledger settlements"
  on public.ledger_settlements
  for insert
  to authenticated
  with check (public.is_trip_member_or_creator(journey_id));

create policy "Trip members can update ledger settlements"
  on public.ledger_settlements
  for update
  to authenticated
  using (public.is_trip_member_or_creator(journey_id))
  with check (public.is_trip_member_or_creator(journey_id));
