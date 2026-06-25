create or replace function public.accept_journey_invite(invite_token text)
returns table(accepted_trip_id uuid, invite_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.journey_invites%rowtype;
  current_user_id uuid := auth.uid();
  current_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  removed_row public.journey_removed_users%rowtype;
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

  select *
    into removed_row
  from public.journey_removed_users jru
  where jru.trip_id = invite_row.trip_id
    and jru.user_id = current_user_id
  limit 1;

  if found then
    if invite_row.invited_email is null
      or current_user_email = ''
      or lower(invite_row.invited_email) <> current_user_email
      or invite_row.created_at <= removed_row.removed_at
    then
      return query select invite_row.trip_id, 'removed'::text;
      return;
    end if;

    delete from public.journey_removed_users jru
    where jru.id = removed_row.id;
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
