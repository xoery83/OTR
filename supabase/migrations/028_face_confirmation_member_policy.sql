drop policy if exists "Trip members can confirm photo faces" on public.photo_faces;
drop policy if exists "Trip members can add member face embeddings" on public.journey_member_face_embeddings;

create policy "Trip members can confirm photo faces"
  on public.photo_faces
  for update
  to authenticated
  using (public.is_trip_member_or_creator(trip_id))
  with check (public.is_trip_member_or_creator(trip_id));

create policy "Trip members can add member face embeddings"
  on public.journey_member_face_embeddings
  for insert
  to authenticated
  with check (public.is_trip_member_or_creator(trip_id));

create index if not exists journey_member_face_embeddings_face_id_idx
  on public.journey_member_face_embeddings(face_id);
