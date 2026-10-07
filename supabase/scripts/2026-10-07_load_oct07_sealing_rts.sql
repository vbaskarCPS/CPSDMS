-- One-off (run once, by hand, in the Supabase SQL Editor): load the 31 workers from the
-- Workerbook Oct06 tab into the new app as Sealing RTs 2026 contractors with I numbers,
-- and book them all on Wed Oct 7, 2026 (team and Oakville/Hotel note carried from Oct06).
-- Safe to run twice: the import matches by CN # / phone and booking skips anyone already on the day.
--
-- CN #s: prefix changed to I. Three would have taken a number already used by someone else
-- (I1001 = Daniel Dondo and I02 = Kyle Harris in Payout Stats; I1103 = Sarah Moreau), so:
--   T1001 Wilson Ricardo -> I2002 · H1103 Kaiden Page-smith -> I2003 · H02 Afeez Lawal -> I2004

-- ── part 1: the phase 2a privilege fix (20261008100100_phase2a_tighten_grants.sql) ──
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

-- ── part 2: load and book ──
begin;

-- act as basvi so the permission checks pass and the audit log names who did it
select set_config('request.jwt.claim.sub', (select id::text from public.app_users where username = 'basvi'), true);

do $$
begin
  if (select count(*) from public.command_centers where display_name = 'Sealing RTs') <> 1 then
    raise exception 'Stopped: Sealing RTs center not found';
  end if;
  if not public.app_is_super_admin() then raise exception 'Stopped: basvi is not an active Super Admin'; end if;
end $$;

create temporary table wb_rows on commit drop as
  select * from jsonb_to_recordset('[{"cn": "I1453", "team": "1", "note": "Oakville", "was": "H1453"}, {"cn": "I1295", "team": "1", "note": "Oakville", "was": "C1295"}, {"cn": "I1026", "team": "2", "note": "Oakville", "was": "C1026"}, {"cn": "I1681", "team": "3", "note": "Oakville", "was": "O1681"}, {"cn": "I1004", "team": "4", "note": "Oakville", "was": "E1004"}, {"cn": "I1225", "team": "5", "note": "Oakville", "was": "EDM1225"}, {"cn": "I1065", "team": "5", "note": "Oakville", "was": "T1065"}, {"cn": "I1055", "team": "6", "note": "Oakville", "was": "H1055"}, {"cn": "I1219", "team": "6", "note": "Oakville", "was": "C1219"}, {"cn": "I2002", "team": "7", "note": "Oakville", "was": "T1001"}, {"cn": "I2000", "team": "8", "note": "Hotel", "was": "T2000"}, {"cn": "I1013", "team": "9", "note": "Oakville", "was": "T1013"}, {"cn": "I1188", "team": "10", "note": "Oakville", "was": "C1188"}, {"cn": "I1169", "team": "10", "note": "Oakville", "was": "EDM1169"}, {"cn": "I1064", "team": "11", "note": "Oakville", "was": "C1064"}, {"cn": "I1167", "team": "12", "note": "Oakville", "was": "EDM1167"}, {"cn": "I1046", "team": "13", "note": "Oakville", "was": "EDM1046"}, {"cn": "I2001", "team": null, "note": "Oakville", "was": "EDM2001"}, {"cn": "I1214", "team": null, "note": "Oakville", "was": "H1214"}, {"cn": "I1003", "team": null, "note": "Oakville", "was": "E1003"}, {"cn": "I1012", "team": null, "note": "Oakville", "was": "EDM1012"}, {"cn": "I1002", "team": null, "note": "Oakville", "was": "H1002"}, {"cn": "I1479", "team": null, "note": "Oakville", "was": "T1479"}, {"cn": "I1001", "team": null, "note": "Oakville", "was": "B1001"}, {"cn": "I2004", "team": null, "note": "Oakville", "was": "H02"}, {"cn": "I1103", "team": null, "note": "Oakville", "was": "O1103"}, {"cn": "I06", "team": null, "note": "Oakville", "was": "H06"}, {"cn": "I05", "team": null, "note": "Oakville", "was": "H05"}, {"cn": "I1190", "team": null, "note": null, "was": "H1190"}, {"cn": "I2003", "team": null, "note": null, "was": "H1103"}, {"cn": "I1639", "team": null, "note": "Oakville", "was": "O1639"}]'::jsonb) as x(cn text, team text, note text, was text);

select public.app_import_contractors(
  (select id from public.command_centers where display_name = 'Sealing RTs'), 2026,
  '[{"cn": "I1453", "first": "Mugove", "last": "Chipfurutse", "cell": "226 387 8803", "shuttle": "Hamilton", "days": 71, "ns": 0, "returning": false}, {"cn": "I1295", "first": "Vidal", "last": "Peyechew", "cell": "3433696979", "shuttle": "B-Team", "days": 62, "ns": 0, "returning": false}, {"cn": "I1026", "first": "Volodymr", "last": "Vorona", "cell": "587-968-4752", "days": 21, "ns": 0, "returning": false}, {"cn": "I1681", "first": "Bryce", "last": "Bourgeois", "cell": "753 382 4687", "email": "bryce.bourgeois7lds@gmail.com", "days": 18, "ns": 0, "returning": false}, {"cn": "I1004", "first": "Jahswill", "last": "Nuetey", "cell": "780 600 0522", "shuttle": "Edmonton", "days": 332, "ns": 0, "returning": true, "hats": {"AER": 9, "SE": 100}}, {"cn": "I1225", "first": "Chris", "last": "Hinch", "cell": "780 202 8951", "shuttle": "Edmonton", "days": 88, "ns": 0, "returning": false, "hats": {"AER": 2}}, {"cn": "I1065", "first": "Kyle", "last": "Pitt", "cell": "437-605-6085", "email": "kylepitt47@gmail.com", "shuttle": "Toronto", "days": 28, "ns": 0, "returning": true}, {"cn": "I1055", "first": "Samir", "last": "Mohamed", "cell": "289 689 6259", "shuttle": "Hamilton", "days": 41, "ns": 0, "returning": false}, {"cn": "I1219", "first": "Chris", "last": "Martine", "cell": "403 481 4067", "email": "chrismartine77@gmail.com", "shuttle": "Calgary", "days": 71, "ns": 0, "returning": false}, {"cn": "I2002", "first": "Wilson", "last": "Ricardo", "cell": "437 345 9422", "email": "dumax2011@gmail.com", "shuttle": "Toronto", "days": 38, "ns": 0, "returning": true}, {"cn": "I2000", "first": "Justice", "last": "Noel", "cell": "289 659 8305", "shuttle": "Toronto", "days": 32, "ns": 0, "returning": true}, {"cn": "I1013", "first": "Michael", "last": "Asiegbunam", "cell": "416 997 4566", "email": "asiegbunamm@gmail.com", "shuttle": "Toronto", "days": 43, "ns": 0, "returning": true}, {"cn": "I1188", "first": "Favour", "last": "Anugawo", "cell": "403 836 3267", "shuttle": "Calgary", "days": 107, "ns": 0, "returning": false}, {"cn": "I1169", "first": "Steven", "last": "Doherty", "cell": "780 915 6170", "shuttle": "Edmonton", "days": 38, "ns": 0, "returning": false}, {"cn": "I1064", "first": "Asher", "last": "Ralph Farrell", "cell": "403 996 4345", "days": 23, "ns": 0, "returning": false}, {"cn": "I1167", "first": "David", "last": "Nsapu", "cell": "780 616 8158", "shuttle": "Edmonton", "days": 97, "ns": 0, "returning": false}, {"cn": "I1046", "first": "Stephen", "last": "Anderson", "cell": "825-785-8381", "shuttle": "Edmonton", "days": 109, "ns": 0, "returning": false}, {"cn": "I2001", "first": "Damon", "last": "Brown", "cell": "306-805-0243", "shuttle": "Edmonton", "days": 39, "ns": 0, "returning": false}, {"cn": "I1214", "first": "Hassan", "last": "Abdulwahab", "cell": "905 973 7466", "shuttle": "Hamilton", "days": 18, "ns": 0, "returning": false}, {"cn": "I1003", "first": "Andile", "last": "Gobodo", "cell": "825 785 8439", "shuttle": "Edmonton", "days": 256, "ns": 0, "returning": true, "hats": {"AER": 1}}, {"cn": "I1012", "first": "Kenan", "last": "Francis-Bull", "cell": "587-930-6114", "shuttle": "Edmonton", "days": 354, "ns": 0, "returning": true, "hats": {"AER": 0, "SE": 2}}, {"cn": "I1002", "first": "Nathan", "last": "Clark", "cell": "416 662 0194", "shuttle": "Hamilton", "days": 48, "ns": 0, "returning": false}, {"cn": "I1479", "first": "Kevontae", "last": "Ragguette", "cell": "647 574 7569", "email": "kevontaeragguette976@gmail.com", "shuttle": "Toronto", "days": 241, "ns": 0, "returning": true}, {"cn": "I1001", "first": "Daniel", "last": "Dondo", "cell": "236-688-3015", "email": "danieldondo7@gmail.com", "shuttle": "Calgary", "days": 401, "ns": 0, "returning": true, "hats": {"RJ": 1}}, {"cn": "I2004", "first": "Afeez", "last": "Lawal", "cell": "365 855 1813", "shuttle": "Hamilton", "days": 207, "ns": 0, "returning": true}, {"cn": "I1103", "first": "Sarah", "last": "Moreau", "cell": "613 639 5434", "email": "sarahmoreau283@gmail.com", "days": 67, "ns": 0, "returning": false}, {"cn": "I06", "first": "Chuk", "last": "Aneyanou", "shuttle": "Hamilton", "days": 44, "ns": 0, "returning": false}, {"cn": "I05", "first": "Oladapo", "last": "Abdulafeez", "cell": "365 336 0270", "shuttle": "Hamilton", "days": 214, "ns": 0, "returning": true}, {"cn": "I1190", "first": "Aaron", "last": "Laguisma", "cell": "289 788 0144", "email": "aaron19931203@gmail.com", "shuttle": "6", "days": 34, "ns": 1, "returning": false}, {"cn": "I2003", "first": "Kaiden", "last": "Page-smith", "cell": "365 883 5713", "email": "kpagesmi3966@hwdsb.on.ca", "shuttle": "6", "days": 5, "ns": 1, "returning": false}, {"cn": "I1639", "first": "Yves", "last": "Buyangandu", "cell": "613 857 1268", "email": "buyanganduyves@yahoo.com", "days": 23, "ns": 0, "returning": false}]'::jsonb) as import_result;

select public.app_book(
  (select id from public.command_centers where display_name = 'Sealing RTs'), date '2026-10-07',
  array(select h.id from public.hires h join wb_rows w on w.cn = h.cn where h.year = 2026)) as newly_booked;

update public.day_roster r set team = coalesce(r.team, w.team), notes = coalesce(r.notes, w.note)
  from public.hires h, wb_rows w, public.days d
 where r.hire_id = h.id and h.cn = w.cn and h.year = 2026
   and r.day_id = d.id and d.day = date '2026-10-07'
   and d.center_id = (select id from public.command_centers where display_name = 'Sealing RTs');

select (select count(*) from public.hires h join wb_rows w on w.cn = h.cn and h.year = 2026) as contractors_loaded,
       (select count(*) from public.day_roster r join public.days d on d.id = r.day_id
         where d.day = date '2026-10-07' and d.center_id = (select id from public.command_centers where display_name = 'Sealing RTs')) as booked_oct7;

commit;
