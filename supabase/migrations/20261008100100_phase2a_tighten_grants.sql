-- Phase 2a follow-up: exact privileges on the new tables.
--
-- Supabase gives anon and authenticated ALL privileges on every new table by
-- default. The 2a migration removed them from anon only, so the table-level
-- grants to authenticated still exposed hires.pin_hash (empty so far) and let
-- signed-in users write any column. Reset to exactly what the app needs; the
-- row-level security policies are unchanged.

revoke all on public.people, public.hires, public.status_entries, public.days, public.day_roster from anon, authenticated;

grant select, insert, update on public.people to authenticated;
grant select (id, person_id, center_id, year, cn, shuttle, status, status_since, ns_count, alumni_rate, silver_rate,
              legacy_contractor_id, pin_set_at, created_at, updated_at) on public.hires to authenticated;
grant insert (person_id, center_id, year, cn, shuttle, status, status_since, ns_count, alumni_rate, silver_rate, legacy_contractor_id)
  on public.hires to authenticated;
grant update (shuttle, status, status_since, ns_count, alumni_rate, silver_rate) on public.hires to authenticated;
grant select on public.status_entries to authenticated;
grant select, insert, update on public.days to authenticated;
grant select, insert, update, delete on public.day_roster to authenticated;

-- Trigger functions are never called directly.
revoke execute on function public.day_roster_guard() from public, anon, authenticated;
revoke execute on function public.hires_status_entry() from public, anon, authenticated;
revoke execute on function public.hires_status_log() from public, anon, authenticated;

-- Pin search_path on the phase 1 trigger functions the security advisor flagged.
alter function public.touch_updated_at() set search_path = public;
alter function public.rate_cards_version() set search_path = public;
alter function public.seasons_no_overlap() set search_path = public;
