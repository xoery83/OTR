create table if not exists public.journey_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  avatar_url text,
  role text not null default 'group_member'
    check (role in ('owner', 'group_member', 'guest')),
  status text not null default 'unlinked'
    check (status in ('linked', 'unlinked', 'invite_pending')),
  notes text,
  invite_email text,
  invite_code text unique,
  invited_by_user_id uuid references public.profiles(id) on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id, user_id)
);

create index if not exists journey_members_trip_id_idx
  on public.journey_members(trip_id);

create index if not exists journey_members_user_id_idx
  on public.journey_members(user_id);

create index if not exists journey_members_invite_code_idx
  on public.journey_members(invite_code);

alter table public.journey_members enable row level security;

create or replace function public.is_trip_member_or_creator(target_trip_id uuid)
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
  )
  or exists (
    select 1
    from public.trips t
    where t.id = target_trip_id
      and t.created_by = auth.uid()
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists journey_members_touch_updated_at on public.journey_members;
create trigger journey_members_touch_updated_at
before update on public.journey_members
for each row execute function public.touch_updated_at();

drop policy if exists "Trip members can read journey members" on public.journey_members;
drop policy if exists "Owners can create journey members" on public.journey_members;
drop policy if exists "Owners can update journey members" on public.journey_members;
drop policy if exists "Owners can delete journey members" on public.journey_members;

create policy "Trip members can read journey members"
  on public.journey_members
  for select
  to authenticated
  using (public.is_trip_member_or_creator(trip_id));

create policy "Owners can create journey members"
  on public.journey_members
  for insert
  to authenticated
  with check (public.is_trip_owner_or_admin(trip_id));

create policy "Owners can update journey members"
  on public.journey_members
  for update
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id))
  with check (public.is_trip_owner_or_admin(trip_id));

create policy "Owners can delete journey members"
  on public.journey_members
  for delete
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id));

create or replace function public.add_trip_creator_as_journey_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  creator_name text;
  creator_avatar text;
begin
  select display_name, avatar_url
    into creator_name, creator_avatar
  from public.profiles
  where id = new.created_by;

  insert into public.journey_members (
    trip_id,
    user_id,
    display_name,
    avatar_url,
    role,
    status,
    linked_at
  )
  values (
    new.id,
    new.created_by,
    coalesce(creator_name, 'Owner'),
    creator_avatar,
    'owner',
    'linked',
    now()
  )
  on conflict (trip_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_trip_created_add_journey_creator on public.trips;
create trigger on_trip_created_add_journey_creator
after insert on public.trips
for each row execute function public.add_trip_creator_as_journey_member();

insert into public.journey_members (
  trip_id,
  user_id,
  display_name,
  avatar_url,
  role,
  status,
  linked_at,
  created_at
)
select
  tm.trip_id,
  tm.user_id,
  coalesce(p.display_name, 'Traveler'),
  p.avatar_url,
  case when tm.role = 'owner' then 'owner' else 'group_member' end,
  'linked',
  tm.created_at,
  tm.created_at
from public.trip_members tm
left join public.profiles p on p.id = tm.user_id
on conflict (trip_id, user_id) do nothing;

create or replace function public.claim_journey_member(target_member_id uuid)
returns table(claimed_member_id uuid, claimed_trip_id uuid, claim_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  member_row public.journey_members%rowtype;
  current_user_id uuid := auth.uid();
  trip_member_role text;
begin
  if current_user_id is null then
    return query select null::uuid, null::uuid, 'invalid'::text;
    return;
  end if;

  select *
    into member_row
  from public.journey_members jm
  where jm.id = target_member_id
  for update;

  if not found then
    return query select null::uuid, null::uuid, 'invalid'::text;
    return;
  end if;

  if not public.is_trip_member_or_creator(member_row.trip_id) then
    return query select member_row.id, member_row.trip_id, 'forbidden'::text;
    return;
  end if;

  if exists (
    select 1
    from public.journey_members jm
    where jm.trip_id = member_row.trip_id
      and jm.user_id = current_user_id
      and jm.id <> member_row.id
  ) then
    return query select member_row.id, member_row.trip_id, 'already_has_identity'::text;
    return;
  end if;

  if member_row.user_id is not null and member_row.user_id <> current_user_id then
    return query select member_row.id, member_row.trip_id, 'already_claimed'::text;
    return;
  end if;

  update public.journey_members
  set user_id = current_user_id,
      status = 'linked',
      linked_at = coalesce(linked_at, now())
  where id = member_row.id;

  trip_member_role := case
    when member_row.role = 'owner' then 'owner'
    else 'member'
  end;

  insert into public.trip_members (trip_id, user_id, role)
  values (member_row.trip_id, current_user_id, trip_member_role)
  on conflict (trip_id, user_id) do nothing;

  return query select member_row.id, member_row.trip_id, 'claimed'::text;
end;
$$;

grant execute on function public.claim_journey_member(uuid) to authenticated;

create or replace function public.get_journey_members_for_current_user(target_trip_id uuid)
returns table(
  member_id uuid,
  member_trip_id uuid,
  member_user_id uuid,
  member_display_name text,
  member_avatar_url text,
  member_role text,
  member_status text,
  member_notes text,
  member_invite_email text,
  member_linked_at timestamptz,
  member_created_at timestamptz,
  profile_display_name text,
  profile_avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    jm.id,
    jm.trip_id,
    jm.user_id,
    jm.display_name,
    jm.avatar_url,
    jm.role,
    jm.status,
    jm.notes,
    jm.invite_email,
    jm.linked_at,
    jm.created_at,
    p.display_name,
    p.avatar_url
  from public.journey_members jm
  left join public.profiles p on p.id = jm.user_id
  where jm.trip_id = target_trip_id
    and public.is_trip_member_or_creator(target_trip_id)
  order by
    case jm.role
      when 'owner' then 0
      when 'group_member' then 1
      else 2
    end,
    jm.created_at;
$$;

grant execute on function public.get_journey_members_for_current_user(uuid) to authenticated;

create or replace function public.accept_journey_invite(invite_token text)
returns table(accepted_trip_id uuid, invite_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.journey_invites%rowtype;
  current_user_id uuid := auth.uid();
  inserted_count int := 0;
  profile_name text;
  profile_avatar text;
begin
  if current_user_id is null then
    return query select null::uuid, 'invalid'::text;
    return;
  end if;

  select *
  into invite_row
  from public.journey_invites ji
  where ji.token = invite_token
    and ji.is_active = true
  limit 1;

  if not found then
    return query select null::uuid, 'invalid'::text;
    return;
  end if;

  if invite_row.expires_at is not null and invite_row.expires_at < now() then
    return query select invite_row.trip_id, 'expired'::text;
    return;
  end if;

  if coalesce(invite_row.used_count, 0) >= coalesce(invite_row.max_uses, 20) then
    return query select invite_row.trip_id, 'full'::text;
    return;
  end if;

  if exists (
    select 1
    from public.trip_members tm
    where tm.trip_id = invite_row.trip_id
      and tm.user_id = current_user_id
  ) then
    return query select invite_row.trip_id, 'already_member'::text;
    return;
  end if;

  insert into public.trip_members (trip_id, user_id, role)
  values (invite_row.trip_id, current_user_id, invite_row.role)
  on conflict (trip_id, user_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    select display_name, avatar_url
      into profile_name, profile_avatar
    from public.profiles
    where id = current_user_id;

    insert into public.journey_members (
      trip_id,
      user_id,
      display_name,
      avatar_url,
      role,
      status,
      invite_email,
      invited_by_user_id,
      linked_at
    )
    values (
      invite_row.trip_id,
      current_user_id,
      coalesce(profile_name, 'Traveler'),
      profile_avatar,
      case when invite_row.role = 'admin' then 'group_member' else 'group_member' end,
      'linked',
      invite_row.invited_email,
      invite_row.created_by,
      now()
    )
    on conflict (trip_id, user_id) do nothing;

    update public.journey_invites
    set used_count = coalesce(used_count, 0) + 1
    where id = invite_row.id;

    return query select invite_row.trip_id, 'joined'::text;
    return;
  end if;

  return query select invite_row.trip_id, 'already_member'::text;
end;
$$;

grant execute on function public.accept_journey_invite(text) to authenticated;
