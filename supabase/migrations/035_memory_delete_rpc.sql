create or replace function public.delete_memory_entry_for_current_user(target_memory_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  memory_row public.memory_entries%rowtype;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be logged in to delete a memory.'
      using errcode = '28000';
  end if;

  select *
    into memory_row
  from public.memory_entries
  where id = target_memory_id;

  if not found then
    raise exception 'Memory not found.'
      using errcode = 'P0002';
  end if;

  if memory_row.user_id is distinct from current_user_id then
    raise exception 'Only the creator can delete this memory.'
      using errcode = '42501';
  end if;

  delete from public.memory_entries
  where id = target_memory_id;

  return target_memory_id;
end;
$$;

grant execute on function public.delete_memory_entry_for_current_user(uuid) to authenticated;
