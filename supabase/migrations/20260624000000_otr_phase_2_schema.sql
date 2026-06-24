create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination text,
  start_date date,
  end_date date,
  cover_image_url text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  role text default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz default now(),
  unique(trip_id, user_id)
);

create table if not exists public.memory_entries (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in ('text', 'photo', 'voice', 'location')),
  content text,
  media_url text,
  captured_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  report_date date not null,
  title text,
  summary text,
  highlights jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  unique(trip_id, report_date)
);

create index if not exists trip_members_user_id_idx
  on public.trip_members(user_id);

create index if not exists trip_members_trip_id_idx
  on public.trip_members(trip_id);

create index if not exists memory_entries_trip_id_captured_at_idx
  on public.memory_entries(trip_id, captured_at desc);

create index if not exists daily_reports_trip_id_report_date_idx
  on public.daily_reports(trip_id, report_date);

create or replace function public.is_trip_member(target_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members tm
    where tm.trip_id = target_trip_id
      and tm.user_id = auth.uid()
  );
$$;

create or replace function public.add_trip_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trip_members (trip_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (trip_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_trip_created_add_creator on public.trips;

create trigger on_trip_created_add_creator
after insert on public.trips
for each row
execute function public.add_trip_creator_as_member();

create or replace function public.is_trip_creator(target_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = target_trip_id
      and t.created_by = auth.uid()
  );
$$;

create or replace function public.can_access_trip_media(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  path_parts text[] := storage.foldername(object_name);
  target_trip_id uuid;
begin
  if array_length(path_parts, 1) < 2 then
    return false;
  end if;

  if path_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  target_trip_id := path_parts[1]::uuid;

  return public.is_trip_member(target_trip_id);
end;
$$;

create or replace function public.can_upload_trip_media(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  path_parts text[] := storage.foldername(object_name);
begin
  if array_length(path_parts, 1) < 2 then
    return false;
  end if;

  return path_parts[2] = auth.uid()::text
    and public.can_access_trip_media(object_name);
end;
$$;

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.memory_entries enable row level security;
alter table public.daily_reports enable row level security;

drop policy if exists "Profiles are readable by authenticated users" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Profiles are readable by authenticated users"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "Trip members can read trips" on public.trips;
drop policy if exists "Authenticated users can create trips" on public.trips;

create policy "Trip members can read trips"
  on public.trips
  for select
  to authenticated
  using (
    public.is_trip_member(id)
    or created_by = auth.uid()
  );

create policy "Authenticated users can create trips"
  on public.trips
  for insert
  to authenticated
  with check (created_by = auth.uid());

drop policy if exists "Trip members can read trip members" on public.trip_members;
drop policy if exists "Trip creators can add trip members" on public.trip_members;

create policy "Trip members can read trip members"
  on public.trip_members
  for select
  to authenticated
  using (
    public.is_trip_member(trip_id)
    or public.is_trip_creator(trip_id)
  );

create policy "Trip creators can add trip members"
  on public.trip_members
  for insert
  to authenticated
  with check (public.is_trip_creator(trip_id));

drop policy if exists "Trip members can read memory entries" on public.memory_entries;
drop policy if exists "Trip members can insert memory entries" on public.memory_entries;
drop policy if exists "Users can update their own memory entries" on public.memory_entries;
drop policy if exists "Users can delete their own memory entries" on public.memory_entries;

create policy "Trip members can read memory entries"
  on public.memory_entries
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "Trip members can insert memory entries"
  on public.memory_entries
  for insert
  to authenticated
  with check (
    public.is_trip_member(trip_id)
    and user_id = auth.uid()
  );

create policy "Users can update their own memory entries"
  on public.memory_entries
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_trip_member(trip_id)
  );

create policy "Users can delete their own memory entries"
  on public.memory_entries
  for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Trip members can read daily reports" on public.daily_reports;
drop policy if exists "Trip members can insert daily reports" on public.daily_reports;
drop policy if exists "Trip members can update daily reports" on public.daily_reports;

create policy "Trip members can read daily reports"
  on public.daily_reports
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "Trip members can insert daily reports"
  on public.daily_reports
  for insert
  to authenticated
  with check (public.is_trip_member(trip_id));

create policy "Trip members can update daily reports"
  on public.daily_reports
  for update
  to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

insert into storage.buckets (id, name, public)
values ('trip-media', 'trip-media', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Trip members can upload trip media" on storage.objects;
drop policy if exists "Trip members can read trip media" on storage.objects;

create policy "Trip members can upload trip media"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'trip-media'
    and public.can_upload_trip_media(name)
  );

create policy "Trip members can read trip media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'trip-media'
    and public.can_access_trip_media(name)
  );
