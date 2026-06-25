alter table public.photo_faces
add column if not exists model_name text,
add column if not exists embedding_version text;

alter table public.journey_member_face_embeddings
add column if not exists model_name text,
add column if not exists embedding_version text;

create index if not exists photo_faces_model_version_idx
  on public.photo_faces(trip_id, embedding_version);

create index if not exists journey_member_face_embeddings_model_version_idx
  on public.journey_member_face_embeddings(trip_id, embedding_version);
