insert into storage.buckets (id, name, public)
values ('trip-media', 'trip-media', false)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public;
