create or replace function public.get_trip_members_for_current_user(target_trip_id uuid)
returns table(
  member_id uuid,
  member_trip_id uuid,
  member_user_id uuid,
  member_role text,
  member_created_at timestamptz,
  display_name text,
  avatar_url text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if not public.is_trip_member(target_trip_id) then
    return;
  end if;

  return query
    select
      tm.id,
      tm.trip_id,
      tm.user_id,
      coalesce(tm.role, 'member'),
      tm.created_at,
      p.display_name,
      p.avatar_url
    from public.trip_members tm
    left join public.profiles p on p.id = tm.user_id
    where tm.trip_id = target_trip_id
    order by tm.created_at asc;
end;
$$;

grant execute on function public.get_trip_members_for_current_user(uuid) to authenticated;
