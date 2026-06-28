alter table public.profiles
add column if not exists global_aka text;

notify pgrst, 'reload schema';
