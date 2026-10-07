-- Access-rule tests for 20261008100000_phase2a_contractors_days.sql.
-- Run on a scratch copy of the database (never production): it inserts fixtures.
-- Expected results are in each \\echo line.
\set ON_ERROR_STOP 0
\pset footer off
-- fixtures (as owner)
insert into command_centers (id, username, password, display_name, region, workerbook_sheet_id, masterbookings_sheet_id, cn_prefix)
values ('aaaaaaaa-0000-0000-0000-000000000001','ontrt','x','Ontario road trip','East','','','E'),
       ('bbbbbbbb-0000-0000-0000-000000000002','calg','x','Calgary','West','','','C');
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2'),('00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-0000000000a4');
insert into app_users (id, username, full_name, is_super_admin) values
 ('00000000-0000-0000-0000-0000000000a1','basvi','Vijay Baskaran', true),
 ('00000000-0000-0000-0000-0000000000a2','merch','Cheryl Merrick', false),
 ('00000000-0000-0000-0000-0000000000a3','calgx','Calgary Mgr', false),
 ('00000000-0000-0000-0000-0000000000a4','rmonl','Route Only', false);
insert into user_permissions values ('00000000-0000-0000-0000-0000000000a2','workerbook'),('00000000-0000-0000-0000-0000000000a2','route_manager'),
  ('00000000-0000-0000-0000-0000000000a3','workerbook'),('00000000-0000-0000-0000-0000000000a4','route_manager');
insert into user_centers values ('00000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a3','bbbbbbbb-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-0000000000a4','aaaaaaaa-0000-0000-0000-000000000001');

\echo '== 1 import as Cheryl (expect read 4, new_people 2, new_hires 2, skipped 2)'
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select app_import_contractors('aaaaaaaa-0000-0000-0000-000000000001', 2026, '[
 {"cn":"E1001","first":"Devon","last":"Clarke","cell":"(905) 555-0101","days":31,"ns":1,"alm":0.25,"slv":0.5,"returning":true,"hats":{"SE":3,"AER":5},"shuttle":"1","sin":"123456789"},
 {"cn":"e 1002","first":"Priya","last":"Nair","cell":"905-555-0124","status":"wl"},
 {"cn":"E1003","first":"Dup","last":"Phone","cell":"9055550101"},
 {"cn":"??","first":"Bad","last":"Row"}]'::jsonb) as result;
\echo '== 1b re-run is idempotent (expect new_people 0, new_hires 0, updated 2)'
select app_import_contractors('aaaaaaaa-0000-0000-0000-000000000001', 2026, '[
 {"cn":"E1001","first":"Devon","last":"Clarke","cell":"9055550101","days":35},{"cn":"E1002","first":"Priya","last":"Nair","cell":"9055550124","status":"WL"}]'::jsonb)->>'new_hires' as new_hires_on_rerun;
select first_name, lifetime_days, hats, first_year from people order by first_name;
select cn, status, ns_count, alumni_rate, status_since = current_date as since_today from hires order by cn;
\echo '== 2 Calgary manager cannot import into Ontario (expect Not allowed)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false);
select app_import_contractors('aaaaaaaa-0000-0000-0000-000000000001', 2026, '[]'::jsonb);
\echo '== 2b Calgary manager CAN read contractors (bookable anywhere) (expect 2)'
select count(*) from hires;
\echo '== 2c Calgary manager cannot change an Ontario hire (expect 0 rows updated)'
update hires set shuttle='9' where cn='E1001';
select shuttle from hires where cn='E1001';
\echo '== 3 route-manager-only sees no contractors (expect 0)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a4',false);
select count(*) from people;
\echo '== 4 booking as Cheryl (expect 1 booked; WL booking error)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select app_book('aaaaaaaa-0000-0000-0000-000000000001','2026-10-08', array(select id from hires where cn='E1001'));
select app_book('aaaaaaaa-0000-0000-0000-000000000001','2026-10-08', array(select id from hires where cn='E1002'));
select app_book('aaaaaaaa-0000-0000-0000-000000000001','2026-10-08', array(select id from hires where cn='E1001')) as rebook_adds;
update day_roster set confirmed_at=now(), confirmed_via='staff', attendance='showed';
select r.attendance, r.confirmed_via, r.shuttle from day_roster r;
\echo '== 4b route manager at Ontario can read the roster (expect 1); Calgary manager cannot (expect 0)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a4',false); select count(*) from day_roster;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false); select count(*) from day_roster;
select app_book('aaaaaaaa-0000-0000-0000-000000000001','2026-10-09', array(select id from hires where cn='E1001'));
\echo '== 5 closed day is locked for Cheryl, open for Super Admin'
reset role; update days set state='closed'; set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
update day_roster set notes='late';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
update day_roster set notes='fixed by SA'; select notes from day_roster;
\echo '== 6 PIN hash unreadable (expect permission denied)'
select pin_hash from hires;
\echo '== 7 next CN (expect E1003)'
select app_next_cn('aaaaaaaa-0000-0000-0000-000000000001', 2026);
\echo '== 8 status change is logged (expect WL then active for E1002)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
update hires set status='active' where cn='E1002';
select string_agg(status, ' → ' order by id) from status_entries where hire_id=(select id from hires where cn='E1002');
\echo '== 9 anon sees nothing (expect permission denied)'
reset role; set role anon; select count(*) from people;
reset role;
\echo '== 10 audit rows written (expect >0)'
select count(*) > 0 from audit_log where entity in ('hires','people','day_roster','contractor_import');
