create table if not exists public.journey_removed_users (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  removed_by_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  removed_at timestamptz not null default now(),
  unique(trip_id, user_id)
);

create index if not exists journey_removed_users_trip_id_idx
  on public.journey_removed_users(trip_id);

create index if not exists journey_removed_users_user_id_idx
  on public.journey_removed_users(user_id);

alter table public.journey_removed_users enable row level security;

drop policy if exists "Owners can read removed journey users" on public.journey_removed_users;
drop policy if exists "Owners can manage removed journey users" on public.journey_removed_users;

create policy "Owners can read removed journey users"
  on public.journey_removed_users
  for select
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id));

create policy "Owners can manage removed journey users"
  on public.journey_removed_users
  for all
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id))
  with check (public.is_trip_owner_or_admin(trip_id));

drop policy if exists "Trip owner admins can update journey invites" on public.journey_invites;

create policy "Trip owner admins can update journey invites"
  on public.journey_invites
  for update
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id))
  with check (public.is_trip_owner_or_admin(trip_id));

create or replace function public.remove_journey_member(
  target_member_id uuid,
  revoke_matching_invites boolean default true
)
returns table(removed_trip_id uuid, remove_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  member_row public.journey_members%rowtype;
  remaining_owner_count int;
begin
  select *
    into member_row
  from public.journey_members jm
  where jm.id = target_member_id
  for update;

  if not found then
    return query select null::uuid, 'invalid'::text;
    return;
  end if;

  if not public.is_trip_owner_or_admin(member_row.trip_id) then
    return query select member_row.trip_id, 'forbidden'::text;
    return;
  end if;

  if member_row.role = 'owner' then
    select count(*)
      into remaining_owner_count
    from public.journey_members jm
    where jm.trip_id = member_row.trip_id
      and jm.role = 'owner'
      and jm.id <> member_row.id;

    if remaining_owner_count = 0 then
      return query select member_row.trip_id, 'last_owner'::text;
      return;
    end if;
  end if;

  if member_row.user_id is not null then
    delete from public.trip_members tm
    where tm.trip_id = member_row.trip_id
      and tm.user_id = member_row.user_id;

    insert into public.journey_removed_users (
      trip_id,
      user_id,
      removed_by_user_id,
      reason
    )
    values (
      member_row.trip_id,
      member_row.user_id,
      auth.uid(),
      'removed_from_people'
    )
    on conflict (trip_id, user_id) do update
      set removed_by_user_id = excluded.removed_by_user_id,
          removed_at = now(),
          reason = excluded.reason;
  end if;

  if revoke_matching_invites and member_row.invite_email is not null then
    update public.journey_invites ji
    set is_active = false
    where ji.trip_id = member_row.trip_id
      and lower(ji.invited_email) = lower(member_row.invite_email);
  end if;

  delete from public.journey_members jm
  where jm.id = member_row.id;

  return query select member_row.trip_id, 'removed'::text;
end;
$$;

grant execute on function public.remove_journey_member(uuid, boolean) to authenticated;

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

  if exists (
    select 1
    from public.journey_removed_users jru
    where jru.trip_id = invite_row.trip_id
      and jru.user_id = current_user_id
  ) then
    return query select invite_row.trip_id, 'removed'::text;
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
      'group_member',
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
