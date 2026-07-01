create or replace function public.update_own_journey_member_notes(
  target_member_id uuid,
  next_notes text
)
returns public.journey_members
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_member public.journey_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.journey_members jm
    set notes = nullif(btrim(coalesce(next_notes, '')), '')
  where jm.id = target_member_id
    and jm.user_id = auth.uid()
  returning * into updated_member;

  if not found then
    raise exception 'forbidden_or_missing_member' using errcode = '42501';
  end if;

  return updated_member;
end;
$$;

revoke all on function public.update_own_journey_member_notes(uuid, text) from public;
grant execute on function public.update_own_journey_member_notes(uuid, text) to authenticated;
