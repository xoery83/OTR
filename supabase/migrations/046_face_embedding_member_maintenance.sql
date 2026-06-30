drop policy if exists "Trip members can update member face embeddings" on public.journey_member_face_embeddings;
drop policy if exists "Trip members can delete member face embeddings" on public.journey_member_face_embeddings;

create policy "Trip members can update member face embeddings"
  on public.journey_member_face_embeddings
  for update
  to authenticated
  using (public.is_trip_member_or_creator(trip_id))
  with check (public.is_trip_member_or_creator(trip_id));

create policy "Trip members can delete member face embeddings"
  on public.journey_member_face_embeddings
  for delete
  to authenticated
  using (public.is_trip_member_or_creator(trip_id));
