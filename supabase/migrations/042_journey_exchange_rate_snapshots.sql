alter table public.journey_ledgers
add column if not exists exchange_rates_snapshot_date date not null default current_date,
add column if not exists exchange_rates_snapshot_source text not null default 'default_at_creation',
add column if not exists exchange_rates_refreshed_at timestamptz,
add column if not exists exchange_rates_refreshed_by uuid references public.profiles(id) on delete set null,
add column if not exists exchange_rates_refresh_count integer not null default 0;

create table if not exists public.journey_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.trips(id) on delete cascade,
  base_currency text not null,
  quote_currency text not null,
  rate_to_base numeric(18, 8) not null check (rate_to_base > 0),
  rate_date date not null default current_date,
  source text not null default 'snapshot',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(journey_id, base_currency, quote_currency)
);

create index if not exists journey_exchange_rates_journey_idx
  on public.journey_exchange_rates(journey_id);

drop trigger if exists journey_exchange_rates_touch_updated_at on public.journey_exchange_rates;
create trigger journey_exchange_rates_touch_updated_at
before update on public.journey_exchange_rates
for each row execute function public.touch_updated_at();

alter table public.journey_exchange_rates enable row level security;

drop policy if exists "Trip members can read journey exchange rates" on public.journey_exchange_rates;
drop policy if exists "Trip members can create journey exchange rates" on public.journey_exchange_rates;
drop policy if exists "Trip owners can update journey exchange rates" on public.journey_exchange_rates;

create policy "Trip members can read journey exchange rates"
  on public.journey_exchange_rates
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

create policy "Trip members can create journey exchange rates"
  on public.journey_exchange_rates
  for insert
  to authenticated
  with check (public.is_trip_member_or_creator(journey_id));

create policy "Trip owners can update journey exchange rates"
  on public.journey_exchange_rates
  for update
  to authenticated
  using (public.is_trip_owner_or_admin(journey_id))
  with check (public.is_trip_owner_or_admin(journey_id));

alter table public.profiles
add column if not exists global_base_currency text not null default 'NZD';

notify pgrst, 'reload schema';
