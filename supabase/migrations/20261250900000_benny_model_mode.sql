-- The Benny: which model answers, as a setting that can be switched without a deploy.
--
--   main        the big model answers everything (how it has worked so far; the default when nothing is set)
--   fast_first  the small model takes plain lookups first; the server redoes the question on the big model whenever
--               that isn't safe (a change, a ranking, a number that isn't in what the database returned, …)
--
-- benny_settings holds it (key model_mode). Nobody reads or writes the table directly: the server reads the mode
-- through benny_model_mode(), and it is changed in SQL by the developer. To go back at any moment:
--   update benny_settings set value = 'main', updated_at = now() where key = 'model_mode';
-- Additive only.

create table if not exists public.benny_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.benny_settings enable row level security;
revoke all on public.benny_settings from public, anon, authenticated;

create or replace function public.benny_model_mode()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((select s.value from benny_settings s where s.key = 'model_mode' and s.value in ('main', 'fast_first')), 'main');
$$;
revoke all on function public.benny_model_mode() from public, anon;
grant execute on function public.benny_model_mode() to authenticated;
