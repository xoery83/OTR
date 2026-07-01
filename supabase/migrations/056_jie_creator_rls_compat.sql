drop policy if exists "Trip members can read ai jobs"
  on public.ai_jobs;
create policy "Trip members can read ai jobs"
  on public.ai_jobs
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_trip_member_or_creator(journey_id)
  );

drop policy if exists "Trip members can create ai jobs"
  on public.ai_jobs;
create policy "Trip members can create ai jobs"
  on public.ai_jobs
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      journey_id is null
      or public.is_trip_member_or_creator(journey_id)
    )
  );

drop policy if exists "Trip members can read ai job attempts"
  on public.ai_job_attempts;
create policy "Trip members can read ai job attempts"
  on public.ai_job_attempts
  for select
  to authenticated
  using (
    exists (
      select 1 from public.ai_jobs
      where ai_jobs.id = ai_job_attempts.ai_job_id
        and (
          ai_jobs.user_id = auth.uid()
          or public.is_trip_member_or_creator(ai_jobs.journey_id)
        )
    )
  );

drop policy if exists "Trip members can read ai cost events"
  on public.ai_cost_events;
create policy "Trip members can read ai cost events"
  on public.ai_cost_events
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_trip_member_or_creator(journey_id)
  );

drop policy if exists "Journey members can read memory shots"
  on public.memory_shots;
create policy "Journey members can read memory shots"
  on public.memory_shots
  for select
  to authenticated
  using (
    (visibility = 'private' and author_user_id = auth.uid())
    or (
      visibility <> 'private'
      and public.is_trip_member_or_creator(journey_id)
    )
    or public.is_trip_owner_or_admin(journey_id)
  );

drop policy if exists "Journey members can create memory shots"
  on public.memory_shots;
create policy "Journey members can create memory shots"
  on public.memory_shots
  for insert
  to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_trip_member_or_creator(journey_id)
  );

drop policy if exists "Journey members can read memory shot assets"
  on public.memory_shot_assets;
create policy "Journey members can read memory shot assets"
  on public.memory_shot_assets
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

drop policy if exists "Authors and owners can manage memory shot assets"
  on public.memory_shot_assets;
create policy "Authors and owners can manage memory shot assets"
  on public.memory_shot_assets
  for all
  to authenticated
  using (
    exists (
      select 1 from public.memory_shots shot
      where shot.id = memory_shot_assets.memory_shot_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  )
  with check (
    public.is_trip_member_or_creator(journey_id)
    and exists (
      select 1 from public.memory_shots shot
      where shot.id = memory_shot_assets.memory_shot_id
        and shot.journey_id = memory_shot_assets.journey_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  );

drop policy if exists "Journey members can read memory shot snapshots"
  on public.memory_shot_snapshots;
create policy "Journey members can read memory shot snapshots"
  on public.memory_shot_snapshots
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

drop policy if exists "Authors and owners can manage memory shot snapshots"
  on public.memory_shot_snapshots;
create policy "Authors and owners can manage memory shot snapshots"
  on public.memory_shot_snapshots
  for all
  to authenticated
  using (
    exists (
      select 1 from public.memory_shots shot
      where shot.id = memory_shot_snapshots.memory_shot_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  )
  with check (
    public.is_trip_member_or_creator(journey_id)
    and exists (
      select 1 from public.memory_shots shot
      where shot.id = memory_shot_snapshots.memory_shot_id
        and shot.journey_id = memory_shot_snapshots.journey_id
        and (
          shot.author_user_id = auth.uid()
          or public.is_trip_owner_or_admin(shot.journey_id)
        )
    )
  );

drop policy if exists "Journey members can read memory shot recommendations"
  on public.memory_shot_recommendations;
create policy "Journey members can read memory shot recommendations"
  on public.memory_shot_recommendations
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

drop policy if exists "Journey members can create memory shot recommendations"
  on public.memory_shot_recommendations;
create policy "Journey members can create memory shot recommendations"
  on public.memory_shot_recommendations
  for insert
  to authenticated
  with check (
    public.is_trip_member_or_creator(journey_id)
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists "Journey members can read memory shot reads"
  on public.memory_shot_reads;
create policy "Journey members can read memory shot reads"
  on public.memory_shot_reads
  for select
  to authenticated
  using (public.is_trip_member_or_creator(journey_id));

drop policy if exists "Users can mark own memory shot reads"
  on public.memory_shot_reads;
create policy "Users can mark own memory shot reads"
  on public.memory_shot_reads
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_trip_member_or_creator(journey_id)
  );

drop policy if exists "Users can update own memory shot reads"
  on public.memory_shot_reads;
create policy "Users can update own memory shot reads"
  on public.memory_shot_reads
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_trip_member_or_creator(journey_id)
  );

