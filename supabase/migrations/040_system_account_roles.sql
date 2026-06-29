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

create or replace function public.protect_profile_account_role()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile_email text;
begin
  select lower(u.email)
    into profile_email
  from auth.users u
  where u.id = new.id;

  if tg_op = 'INSERT' then
    if profile_email = 'xoery83@gmail.com' then
      new.account_role := 'admin';
    elsif new.account_role is null then
      new.account_role := 'free_user';
    elsif new.account_role <> 'free_user' and not public.is_system_admin(auth.uid()) then
      new.account_role := 'free_user';
    end if;
    return new;
  end if;

  if new.account_role is distinct from old.account_role
    and auth.uid() is not null
    and not public.is_system_admin(auth.uid()) then
    raise exception 'Only system admins can change account roles.';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_account_role_trigger on public.profiles;

create trigger protect_profile_account_role_trigger
before insert or update on public.profiles
for each row
execute function public.protect_profile_account_role();

update public.profiles p
set account_role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = 'xoery83@gmail.com';

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

drop policy if exists "Parser rules are manageable by authenticated users" on public.parser_rules;
create policy "Parser rules are manageable by authenticated users"
  on public.parser_rules for all to authenticated
  using (scope <> 'global' or public.is_system_admin())
  with check (scope <> 'global' or public.is_system_admin());

drop policy if exists "Parser examples are manageable by authenticated users" on public.parser_examples;
create policy "Parser examples are manageable by authenticated users"
  on public.parser_examples for all to authenticated
  using (journey_id is not null or public.is_system_admin())
  with check (journey_id is not null or public.is_system_admin());

drop policy if exists "Parser aliases are manageable by authenticated users" on public.parser_aliases;
create policy "Parser aliases are manageable by authenticated users"
  on public.parser_aliases for all to authenticated
  using (scope <> 'global' or public.is_system_admin())
  with check (scope <> 'global' or public.is_system_admin());

notify pgrst, 'reload schema';
