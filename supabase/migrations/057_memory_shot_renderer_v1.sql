alter table public.memory_shots
  add column if not exists render_status text not null default 'not_started'
    check (render_status in ('not_started', 'rendering', 'ready', 'failed')),
  add column if not exists render_error text,
  add column if not exists rendered_at timestamptz,
  add column if not exists original_drive_file_id text,
  add column if not exists original_drive_url text,
  add column if not exists thumbnail_url text;

create index if not exists memory_shots_render_status_idx
  on public.memory_shots(journey_id, render_status, updated_at desc);

insert into storage.buckets (id, name, public)
values ('memory-shot-renders', 'memory-shot-renders', false)
on conflict (id) do update
set public = excluded.public;

create or replace function public.can_access_memory_shot_preview(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  path_parts text[] := storage.foldername(object_name);
  target_journey_id uuid;
begin
  if array_length(path_parts, 1) < 2 then
    return false;
  end if;

  if path_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;

  target_journey_id := path_parts[1]::uuid;

  return public.is_trip_member_or_creator(target_journey_id);
end;
$$;

drop policy if exists "Journey members can upload memory shot previews"
  on storage.objects;
drop policy if exists "Journey members can update memory shot previews"
  on storage.objects;
drop policy if exists "Journey members can read memory shot previews"
  on storage.objects;

create policy "Journey members can upload memory shot previews"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'memory-shot-renders'
    and public.can_access_memory_shot_preview(name)
  );

create policy "Journey members can update memory shot previews"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'memory-shot-renders'
    and public.can_access_memory_shot_preview(name)
  )
  with check (
    bucket_id = 'memory-shot-renders'
    and public.can_access_memory_shot_preview(name)
  );

create policy "Journey members can read memory shot previews"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'memory-shot-renders'
    and public.can_access_memory_shot_preview(name)
  );
