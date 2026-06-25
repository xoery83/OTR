# Journey External Photo Storage & AI Indexing V2

Journey is not a cloud drive. Original photos should live in the user's own
storage provider, while Journey stores references and searchable intelligence.

## Phase Boundary

This phase adds the foundation only:

- Provider-agnostic storage schema.
- AI indexing metadata fields on `media_assets`.
- Face detection and face library tables.
- A TypeScript `StorageProvider` interface.

It does not yet implement:

- Google Drive OAuth.
- OneDrive OAuth.
- Original photo upload to external providers.
- Local face/OCR/EXIF processing jobs.
- Gallery or relationship graph UI.

The current compressed Supabase image upload remains supported as
`supabase_legacy`.

## Storage Model

Journey-level storage settings live on `trips`:

- `photo_storage_provider`
- `photo_storage_status`
- `photo_storage_root_folder_id`

Provider connection metadata lives in `journey_storage_connections`. It stores
provider identifiers and a `token_reference`, not raw provider tokens.

`media_assets` can now reference external original files via:

- `storage_provider`
- `provider_file_id`
- `provider_drive_id`
- `provider_web_url`
- `provider_thumbnail_url`
- `provider_original_reference`

## AI Index

`media_assets` now has lightweight indexing fields:

- EXIF/GPS/camera fields.
- OCR text.
- Duplicate and blur scores.
- Scene tags.
- AI status and metadata.

`photo_faces` stores detected faces per image. It keeps bounding boxes and
embeddings, but not cropped face images.

`journey_member_face_embeddings` stores the gradually improving face library for
each journey member.

## Next Implementation Steps

1. Add a Journey settings UI to select Google Drive or OneDrive.
2. Implement OAuth and secure token storage outside client-visible tables.
3. Implement provider adapters for `StorageProvider`.
4. Move photo upload to a backend streaming route.
5. Add local indexing jobs for EXIF, thumbnails, OCR, blur, and faces.
6. Store original photos externally and store only metadata in Journey.
7. Build People/Gallery/Map features on top of indexed metadata.
