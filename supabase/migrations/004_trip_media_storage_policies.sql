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
  if array_length(path_parts, 1) < 3 then
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
  if array_length(path_parts, 1) < 3 then
    return false;
  end if;

  return path_parts[2] = auth.uid()::text
    and path_parts[3] = 'compressed'
    and public.can_access_trip_media(object_name);
end;
$$;

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
