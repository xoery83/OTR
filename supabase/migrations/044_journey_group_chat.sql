create table if not exists public.journey_chat_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  journey_member_id uuid references public.journey_members(id) on delete set null,
  message_type text not null
    check (message_type in ('text', 'image', 'voice', 'system')),
  text_content text,
  media_asset_id uuid references public.media_assets(id) on delete set null,
  memory_entry_id uuid references public.memory_entries(id) on delete set null,
  media_url text,
  voice_duration_ms int,
  transcript_text text,
  transcript_status text
    check (transcript_status in ('pending', 'processing', 'completed', 'failed')),
  source_type text not null default 'chat'
    check (source_type in ('chat', 'timeline_memory', 'system')),
  source_id uuid,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists journey_chat_messages_source_unique_idx
  on public.journey_chat_messages(trip_id, source_type, source_id);

create index if not exists journey_chat_messages_trip_created_idx
  on public.journey_chat_messages(trip_id, created_at desc);

create index if not exists journey_chat_messages_memory_entry_idx
  on public.journey_chat_messages(memory_entry_id);

create table if not exists public.journey_chat_read_states (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default to_timestamp(0),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create or replace function public.touch_journey_chat_message_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_journey_chat_message_updated_at
  on public.journey_chat_messages;

create trigger touch_journey_chat_message_updated_at
before update on public.journey_chat_messages
for each row
execute function public.touch_journey_chat_message_updated_at();

alter table public.journey_chat_messages enable row level security;
alter table public.journey_chat_read_states enable row level security;

drop policy if exists "Trip members can read chat messages"
  on public.journey_chat_messages;
drop policy if exists "Trip members can insert chat messages"
  on public.journey_chat_messages;
drop policy if exists "Users can revoke their chat messages"
  on public.journey_chat_messages;

create policy "Trip members can read chat messages"
  on public.journey_chat_messages
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "Trip members can insert chat messages"
  on public.journey_chat_messages
  for insert
  to authenticated
  with check (
    public.is_trip_member(trip_id)
    and (
      user_id is null
      or user_id = auth.uid()
      or (
        source_type = 'timeline_memory'
        and exists (
          select 1
          from public.memory_entries memory
          where memory.id = source_id
            and memory.trip_id = trip_id
            and memory.user_id = journey_chat_messages.user_id
        )
      )
    )
  );

create policy "Users can revoke their chat messages"
  on public.journey_chat_messages
  for update
  to authenticated
  using (
    public.is_trip_member(trip_id)
    and user_id = auth.uid()
  )
  with check (
    public.is_trip_member(trip_id)
    and user_id = auth.uid()
  );

drop policy if exists "Users can read their chat read state"
  on public.journey_chat_read_states;
drop policy if exists "Users can write their chat read state"
  on public.journey_chat_read_states;

create policy "Users can read their chat read state"
  on public.journey_chat_read_states
  for select
  to authenticated
  using (
    public.is_trip_member(trip_id)
    and user_id = auth.uid()
  );

create policy "Users can write their chat read state"
  on public.journey_chat_read_states
  for all
  to authenticated
  using (
    public.is_trip_member(trip_id)
    and user_id = auth.uid()
  )
  with check (
    public.is_trip_member(trip_id)
    and user_id = auth.uid()
  );
