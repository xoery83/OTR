alter table public.profiles
add column if not exists account_role text not null default 'free_user'
  check (account_role in ('admin', 'free_user', 'plus', 'pro'));

create index if not exists profiles_account_role_idx
  on public.profiles(account_role);

create or replace function public.is_system_admin(target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = target_user_id
      and p.account_role = 'admin'
  );
$$;

create or replace function public.list_account_roles()
returns table (
  id uuid,
  email text,
  display_name text,
  avatar_url text,
  account_role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_system_admin(auth.uid()) then
    raise exception 'Only system admins can list account roles.';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.display_name,
    p.avatar_url,
    p.account_role,
    p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  order by
    case p.account_role
      when 'admin' then 0
      when 'pro' then 1
      when 'plus' then 2
      else 3
    end,
    p.created_at desc;
end;
$$;

create or replace function public.update_profile_account_role(
  target_profile_id uuid,
  next_account_role text
)
returns table (
  id uuid,
  email text,
  display_name text,
  avatar_url text,
  account_role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_system_admin(auth.uid()) then
    raise exception 'Only system admins can update account roles.';
  end if;

  if next_account_role not in ('admin', 'free_user', 'plus', 'pro') then
    raise exception 'Invalid account role.';
  end if;

  update public.profiles
  set account_role = next_account_role
  where profiles.id = target_profile_id;

  return query
  select
    p.id,
    u.email::text,
    p.display_name,
    p.avatar_url,
    p.account_role,
    p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = target_profile_id;
end;
$$;

create or replace function public.search_account_roles(search_query text)
returns table (
  id uuid,
  email text,
  display_name text,
  avatar_url text,
  account_role text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_query text := lower(trim(coalesce(search_query, '')));
begin
  if not public.is_system_admin(auth.uid()) then
    raise exception 'Only system admins can search account roles.';
  end if;

  if length(normalized_query) < 2 then
    return;
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.display_name,
    p.avatar_url,
    p.account_role,
    p.created_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  where lower(coalesce(u.email::text, '')) like '%' || normalized_query || '%'
     or lower(coalesce(p.display_name, '')) like '%' || normalized_query || '%'
  order by
    case
      when lower(coalesce(u.email::text, '')) = normalized_query then 0
      when lower(coalesce(u.email::text, '')) like normalized_query || '%' then 1
      when lower(coalesce(p.display_name, '')) like normalized_query || '%' then 2
      else 3
    end,
    p.created_at desc
  limit 20;
end;
$$;

update public.profiles p
set account_role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'xoery83@gmail.com';

grant execute on function public.is_system_admin(uuid) to authenticated;
grant execute on function public.list_account_roles() to authenticated;
grant execute on function public.search_account_roles(text) to authenticated;
grant execute on function public.update_profile_account_role(uuid, text) to authenticated;

notify pgrst, 'reload schema';
