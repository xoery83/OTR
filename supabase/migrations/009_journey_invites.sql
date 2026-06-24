create table if not exists public.journey_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token text not null unique,
  invited_email text,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  max_uses int default 20,
  used_count int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists journey_invites_trip_id_idx
  on public.journey_invites(trip_id);

create index if not exists journey_invites_token_idx
  on public.journey_invites(token);

alter table public.journey_invites enable row level security;

create or replace function public.is_trip_owner_or_admin(target_trip_id uuid)
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
      and tm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.trips t
    where t.id = target_trip_id
      and t.created_by = auth.uid()
  );
$$;

drop policy if exists "Trip owner admins can create journey invites" on public.journey_invites;
drop policy if exists "Trip owner admins can view journey invites" on public.journey_invites;

create policy "Trip owner admins can create journey invites"
  on public.journey_invites
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_trip_owner_or_admin(trip_id)
  );

create policy "Trip owner admins can view journey invites"
  on public.journey_invites
  for select
  to authenticated
  using (public.is_trip_owner_or_admin(trip_id));

create or replace function public.accept_journey_invite(invite_token text)
returns table(trip_id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_row public.journey_invites%rowtype;
  current_user_id uuid := auth.uid();
  inserted_count int := 0;
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
    update public.journey_invites
    set used_count = coalesce(used_count, 0) + 1
    where id = invite_row.id;

    return query select invite_row.trip_id, 'joined'::text;
    return;
  end if;

  return query select invite_row.trip_id, 'already_member'::text;
end;
$$;
