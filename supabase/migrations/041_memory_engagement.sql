create table if not exists public.memory_likes (
  id uuid primary key default gen_random_uuid(),
  memory_entry_id uuid not null references public.memory_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  like_count integer not null default 1 check (like_count between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (memory_entry_id, user_id)
);

create table if not exists public.memory_favorites (
  id uuid primary key default gen_random_uuid(),
  memory_entry_id uuid not null references public.memory_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (memory_entry_id, user_id)
);

create index if not exists memory_likes_memory_entry_id_idx on public.memory_likes(memory_entry_id);
create index if not exists memory_likes_user_id_idx on public.memory_likes(user_id);
create index if not exists memory_favorites_memory_entry_id_idx on public.memory_favorites(memory_entry_id);
create index if not exists memory_favorites_user_id_idx on public.memory_favorites(user_id);

alter table public.memory_likes enable row level security;
alter table public.memory_favorites enable row level security;

drop policy if exists "Trip members can read memory likes" on public.memory_likes;
create policy "Trip members can read memory likes"
  on public.memory_likes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memory_entries me
      where me.id = memory_likes.memory_entry_id
        and public.is_trip_member(me.trip_id)
    )
  );

drop policy if exists "Users can insert own memory likes" on public.memory_likes;
create policy "Users can insert own memory likes"
  on public.memory_likes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.memory_entries me
      where me.id = memory_likes.memory_entry_id
        and public.is_trip_member(me.trip_id)
    )
  );

drop policy if exists "Users can update own memory likes" on public.memory_likes;
create policy "Users can update own memory likes"
  on public.memory_likes
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.memory_entries me
      where me.id = memory_likes.memory_entry_id
        and public.is_trip_member(me.trip_id)
    )
  );

drop policy if exists "Users can delete own memory likes" on public.memory_likes;
create policy "Users can delete own memory likes"
  on public.memory_likes
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Trip members can read memory favorites" on public.memory_favorites;
create policy "Trip members can read memory favorites"
  on public.memory_favorites
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.memory_entries me
      where me.id = memory_favorites.memory_entry_id
        and public.is_trip_member(me.trip_id)
    )
  );

drop policy if exists "Users can insert own memory favorites" on public.memory_favorites;
create policy "Users can insert own memory favorites"
  on public.memory_favorites
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.memory_entries me
      where me.id = memory_favorites.memory_entry_id
        and public.is_trip_member(me.trip_id)
    )
  );

drop policy if exists "Users can delete own memory favorites" on public.memory_favorites;
create policy "Users can delete own memory favorites"
  on public.memory_favorites
  for delete
  to authenticated
  using (user_id = auth.uid());
