-- RUN_29 — Master Bookings: each person's filter settings (heat map, knocks, customers, bookings,
-- the panel open or closed), remembered across devices. One row per person; a person reads and
-- writes only their own row.
create table if not exists public.mb_user_filters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  filters jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.mb_user_filters enable row level security;
revoke all on public.mb_user_filters from anon, authenticated;
grant select, insert, update on public.mb_user_filters to authenticated;

drop policy if exists mb_user_filters_own_read on public.mb_user_filters;
create policy mb_user_filters_own_read on public.mb_user_filters for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists mb_user_filters_own_insert on public.mb_user_filters;
create policy mb_user_filters_own_insert on public.mb_user_filters for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists mb_user_filters_own_update on public.mb_user_filters;
create policy mb_user_filters_own_update on public.mb_user_filters for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
