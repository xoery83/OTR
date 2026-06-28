alter table public.memory_entries
add column if not exists parent_memory_id uuid references public.memory_entries(id) on delete cascade;

create index if not exists memory_entries_parent_memory_id_idx
  on public.memory_entries(parent_memory_id);
