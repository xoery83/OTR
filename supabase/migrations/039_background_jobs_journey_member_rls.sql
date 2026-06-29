create or replace function public.can_manage_background_jobs(
  target_journey_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_user_id is not null
    and (
      target_journey_id is null
      or exists (
        select 1
        from public.trips t
        where t.id = target_journey_id
          and t.created_by = target_user_id
      )
      or exists (
        select 1
        from public.trip_members tm
        where tm.trip_id = target_journey_id
          and tm.user_id = target_user_id
      )
      or exists (
        select 1
        from public.journey_members jm
        where jm.trip_id = target_journey_id
          and jm.user_id = target_user_id
          and jm.status = 'linked'
          and jm.role in ('owner', 'group_member')
      )
    );
$$;

drop policy if exists "Trip members can read background job batches"
  on public.background_job_batches;
drop policy if exists "Trip members can create background job batches"
  on public.background_job_batches;
drop policy if exists "Job owners can update background job batches"
  on public.background_job_batches;

create policy "Journey members can read background job batches"
  on public.background_job_batches
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_background_jobs(journey_id, auth.uid())
  );

create policy "Journey members can create background job batches"
  on public.background_job_batches
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.can_manage_background_jobs(journey_id, auth.uid())
  );

create policy "Job owners can update background job batches"
  on public.background_job_batches
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Trip members can read background jobs"
  on public.background_jobs;
drop policy if exists "Trip members can create background jobs"
  on public.background_jobs;
drop policy if exists "Job owners can update background jobs"
  on public.background_jobs;

create policy "Journey members can read background jobs"
  on public.background_jobs
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.can_manage_background_jobs(journey_id, auth.uid())
  );

create policy "Journey members can create background jobs"
  on public.background_jobs
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.can_manage_background_jobs(journey_id, auth.uid())
  );

create policy "Job owners can update background jobs"
  on public.background_jobs
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
