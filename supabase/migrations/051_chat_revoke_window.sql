create or replace function public.revoke_journey_chat_message_for_current_user(target_message_id uuid)
returns public.journey_chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  message_row public.journey_chat_messages%rowtype;
  updated_row public.journey_chat_messages%rowtype;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be logged in to revoke messages.'
      using errcode = '28000';
  end if;

  select *
    into message_row
  from public.journey_chat_messages
  where id = target_message_id
  for update;

  if not found then
    raise exception 'Message not found.'
      using errcode = 'P0002';
  end if;

  if not public.is_trip_member(message_row.trip_id) then
    raise exception 'You do not have access to this Journey.'
      using errcode = '42501';
  end if;

  if message_row.user_id is distinct from current_user_id then
    raise exception 'Only the sender can revoke this message.'
      using errcode = '42501';
  end if;

  if message_row.source_type <> 'chat' then
    raise exception 'Only messages sent from group chat can be revoked here.'
      using errcode = '42501';
  end if;

  if message_row.deleted_at is not null then
    raise exception 'Message has already been revoked.'
      using errcode = 'P0001';
  end if;

  if message_row.created_at < now() - interval '30 minutes' then
    raise exception 'Messages can only be revoked within 30 minutes.'
      using errcode = '22023';
  end if;

  update public.journey_chat_messages
    set
      deleted_at = now(),
      deleted_by = current_user_id,
      text_content = null,
      transcript_text = null
    where id = target_message_id
    returning * into updated_row;

  if message_row.memory_entry_id is not null then
    delete from public.memory_entries
    where id = message_row.memory_entry_id
      and trip_id = message_row.trip_id
      and user_id = current_user_id;
  end if;

  select *
    into updated_row
  from public.journey_chat_messages
  where id = target_message_id;

  return updated_row;
end;
$$;

grant execute on function public.revoke_journey_chat_message_for_current_user(uuid)
  to authenticated;
