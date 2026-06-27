create index if not exists journey_members_invite_email_idx
  on public.journey_members(lower(invite_email))
  where invite_email is not null;

create or replace function public.claim_email_invited_journeys()
returns table(
  claimed_trip_id uuid,
  claimed_member_id uuid,
  claim_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  profile_name text;
  profile_avatar text;
  candidate public.journey_members%rowtype;
  trip_member_role text;
  inserted_count int := 0;
begin
  if current_user_id is null or current_user_email = '' then
    return query select null::uuid, null::uuid, 'invalid'::text;
    return;
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (
    current_user_id,
    coalesce(
      nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
      nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
      current_user_email,
      'Traveler'
    ),
    nullif(
      coalesce(
        auth.jwt() -> 'user_metadata' ->> 'avatar_url',
        auth.jwt() -> 'user_metadata' ->> 'picture'
      ),
      ''
    )
  )
  on conflict (id) do nothing;

  select display_name, avatar_url
    into profile_name, profile_avatar
  from public.profiles
  where id = current_user_id;

  for candidate in
    select jm.*
    from public.journey_members jm
    where lower(coalesce(jm.invite_email, '')) = current_user_email
      and jm.status in ('unlinked', 'invite_pending')
      and (jm.user_id is null or jm.user_id = current_user_id)
      and not exists (
        select 1
        from public.journey_members linked
        where linked.trip_id = jm.trip_id
          and linked.user_id = current_user_id
          and linked.id <> jm.id
      )
      and not exists (
        select 1
        from public.journey_removed_users removed
        where removed.trip_id = jm.trip_id
          and removed.user_id = current_user_id
          and removed.removed_at >= jm.created_at
      )
    order by jm.created_at asc
  loop
    update public.journey_members
    set user_id = current_user_id,
        display_name = coalesce(nullif(display_name, ''), profile_name, 'Traveler'),
        avatar_url = coalesce(avatar_url, profile_avatar),
        status = 'linked',
        linked_at = coalesce(linked_at, now())
    where id = candidate.id;

    trip_member_role := case
      when candidate.role = 'owner' then 'owner'
      else 'member'
    end;

    insert into public.trip_members (trip_id, user_id, role)
    values (candidate.trip_id, current_user_id, trip_member_role)
    on conflict (trip_id, user_id) do nothing;

    get diagnostics inserted_count = row_count;

    return query select
      candidate.trip_id,
      candidate.id,
      case when inserted_count > 0 then 'claimed' else 'already_member' end;
  end loop;
end;
$$;

grant execute on function public.claim_email_invited_journeys() to authenticated;
