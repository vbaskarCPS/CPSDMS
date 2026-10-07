-- Access-rule tests for 20261008200000_phase2b_territory_sessions.sql (run on a scratch copy, never production).
\set ON_ERROR_STOP 0
insert into command_centers (id, username, password, display_name, region, workerbook_sheet_id, masterbookings_sheet_id, cn_prefix)
values ('aaaaaaaa-0000-0000-0000-000000000001','bcimport','x','Sealing RTs','East','','','I'),
       ('bbbbbbbb-0000-0000-0000-000000000002','calg','x','Calgary','West','','','C');
insert into auth.users (id, encrypted_password) values ('00000000-0000-0000-0000-0000000000a1', extensions.crypt('BasviPass1', extensions.gen_salt('bf'))),
 ('00000000-0000-0000-0000-0000000000a2', extensions.crypt('CherylPass1', extensions.gen_salt('bf'))),
 ('00000000-0000-0000-0000-0000000000a3', null),('00000000-0000-0000-0000-0000000000a4', null);
insert into app_users (id, username, full_name, is_super_admin, rm_center_id) values
 ('00000000-0000-0000-0000-0000000000a1','basvi','Vijay Baskaran', true, null),
 ('00000000-0000-0000-0000-0000000000a2','merch','Cheryl Merrick', false, 'aaaaaaaa-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-0000000000a3','calgx','Calgary Mgr', false, null),
 ('00000000-0000-0000-0000-0000000000a4','rmonl','Route Only', false, null);
insert into user_permissions values ('00000000-0000-0000-0000-0000000000a2','workerbook'),('00000000-0000-0000-0000-0000000000a2','route_manager'),
  ('00000000-0000-0000-0000-0000000000a3','workerbook'),('00000000-0000-0000-0000-0000000000a4','route_manager');
insert into user_centers values ('00000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a3','bbbbbbbb-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-0000000000a4','aaaaaaaa-0000-0000-0000-000000000001');
insert into users (user_id, role, name, username, password, command_center_id) values ('rm_cherylmerrick','RouteManager','Cheryl Merrick','merch',null,'aaaaaaaa-0000-0000-0000-000000000001'),
  ('rm_old','RouteManager','Old Manager','oldmg','legacypw','aaaaaaaa-0000-0000-0000-000000000001');

set role authenticated;
\echo '== 1 territory: Cheryl (no SA territory) cannot assign; SA can; Cheryl reads her center, Calgary cannot'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
insert into map_area_centers (area_name, center_id) values ('GLEN ABBEY #1','aaaaaaaa-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
insert into map_area_centers (area_name, center_id) values ('GLEN ABBEY #1','aaaaaaaa-0000-0000-0000-000000000001'), ('WEST OAKS TRAILS #2','aaaaaaaa-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false); select 'cheryl sees', count(*) from map_area_centers;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false); select 'calgary sees', count(*) from map_area_centers;

\echo '== 2 start session'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select (app_import_contractors('aaaaaaaa-0000-0000-0000-000000000001', 2026,
  '[{"cn":"I1004","first":"Jahswill","last":"Nuetey","cell":"7806000522"},{"cn":"I1225","first":"Chris","last":"Hinch","cell":"7802028951"},{"cn":"I1065","first":"Kyle","last":"Pitt","cell":"4376056085"}]'::jsonb))->>'new_hires' as imported;
select app_book('aaaaaaaa-0000-0000-0000-000000000001','2026-10-07', array(select id from hires));
\echo '-- missing showed tick (expect error)'
select app_start_session((select id from days), '{"service":"sealing"}', '[{"code":"GA01","area":"GLEN ABBEY #1","manager_id":"00000000-0000-0000-0000-0000000000a2"}]',
  jsonb_build_array(jsonb_build_object('name','1','kind','cart','manager_id','00000000-0000-0000-0000-0000000000a2','hire_ids', (select jsonb_agg(id) from hires where cn in ('I1004','I1225'))) ),
  array(select id from hires where cn='I1004'));
\echo '-- route-manager-only cannot start (expect Not allowed)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a4',false);
select app_start_session((select id from days), '{}', '[{"code":"GA01"}]', '[{"name":"1","hire_ids":[]}]', '{}');
\echo '-- success (expect a uuid), then day live, roster filled'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select app_start_session((select id from days), '{"service":"sealing","liveCard":true}', '[{"code":"GA01","area":"GLEN ABBEY #1","manager_id":"00000000-0000-0000-0000-0000000000a2"}]',
  jsonb_build_array(jsonb_build_object('name','1','kind','cart','manager_id','00000000-0000-0000-0000-0000000000a2','hire_ids', (select jsonb_agg(id) from hires where cn in ('I1004','I1225'))),
                    jsonb_build_object('name','RC1','kind','ramp','manager_id','00000000-0000-0000-0000-0000000000a2','hire_ids', (select jsonb_agg(id) from hires where cn='I1065'))),
  array(select id from hires)) is not null as started;
select d.state, h.cn, r.attendance, r.team, r.manager_id is not null as has_mgr from day_roster r join days d on d.id=r.day_id join hires h on h.id=r.hire_id order by h.cn;
\echo '-- second start (expect already started)'
select app_start_session((select id from days), '{}', '[{"code":"GA01"}]', '[{"name":"1","hire_ids":[]}]', '{}');
\echo '-- Cheryl reads the session (1), Calgary manager cannot (0)'
select count(*) from sessions;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a3',false); select count(*) from sessions;

\echo '== 3 old RM login with /app password'
reset role; set role anon;
select 'app pw', legacy_login_rm('MERCH','CherylPass1')->>'name';
select 'wrong pw', legacy_login_rm('merch','nope') is null;
select 'empty pw', legacy_login_rm('merch','') is null;
select 'legacy pw still works', legacy_login_rm('oldmg','LEGACYPW')->>'name';
select 'no pw column leak', legacy_login_rm('MERCH','CherylPass1') ? 'password';
\echo '== 4 anon cannot read sessions or territory'
select count(*) from sessions;
select count(*) from map_area_centers;
reset role;
