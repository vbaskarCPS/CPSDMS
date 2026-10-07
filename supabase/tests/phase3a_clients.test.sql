-- local stand-ins for prod-only spatial tables
create extension if not exists postgis;
create table if not exists public.route_street_lines (id bigserial primary key, route_code text, street_norm text, street_base text,
  line geography, zone geometry);

\set ON_ERROR_STOP 0
insert into auth.users (id, encrypted_password) values ('00000000-0000-0000-0000-0000000000a1', null), ('00000000-0000-0000-0000-0000000000a2', null);
insert into app_users (id, username, full_name, is_super_admin) values
 ('00000000-0000-0000-0000-0000000000a1','basvi','Vijay Baskaran', true), ('00000000-0000-0000-0000-0000000000a2','merch','Cheryl Merrick', false);
insert into user_permissions values ('00000000-0000-0000-0000-0000000000a2','workerbook');
-- two routes on Baronwood Dr (east/west halves), one on Alstep Way
insert into route_maps (area_name, route_number, route_code, route_color, segments, status) values
 ('WEST OAK TRAILS #1', 6, 'WO06', '#f00', '[]', 'approved'), ('WEST OAK TRAILS #1', 8, 'WO08', '#f00', '[]', 'approved'), ('WEST OAK TRAILS #1', 9, 'WO09', '#f00', '[]', 'approved');
insert into area_prefixes (area_name, prefix, region) values ('WEST OAK TRAILS #1', 'WO', 'East');
insert into route_street_lines (route_code, street_norm, line, zone) values
 ('WO08', 'baronwood dr', ST_GeogFromText('LINESTRING(-79.770 43.430, -79.765 43.430)'), ST_GeomFromText('POLYGON((-79.770 43.4297, -79.765 43.4297, -79.765 43.4303, -79.770 43.4303, -79.770 43.4297))', 4326)),
 ('WO09', 'baronwood dr', ST_GeogFromText('LINESTRING(-79.765 43.430, -79.760 43.430)'), ST_GeomFromText('POLYGON((-79.765 43.4297, -79.760 43.4297, -79.760 43.4303, -79.765 43.4303, -79.765 43.4297))', 4326)),
 ('WO06', 'alstep way', ST_GeogFromText('LINESTRING(-79.772 43.437, -79.770 43.437)'), null);
insert into nar_addresses (civic_no, street_name, street_type, csd_name, lat, lng) values (2280, 'Baronwood', 'DR', 'Oakville', 43.4300, -79.7620);
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source) values ('WO08', '2201|baronwood dr', 2201, 'Baronwood Drive', 'baronwood dr', 43.43, -79.768, 'nar');
-- the map already has one old client on WO08 (2201 Baronwood) and one on WO06
insert into map_pcl_cache (route_code, area_name, region, prefix, clients, client_count) values
 ('WO08', 'WEST OAK TRAILS #1', 'East', 'WO', '[{"firstName":"Old","lastName":"Owner","houseNum":"2201","streetName":"Baronwood Drive","phone":"","history":[{"year":2021,"price":"$150.00","serviceType":"SS","contractor":"Max"}]}]', 1),
 ('WO06', 'WEST OAK TRAILS #1', 'East', 'WO', '[{"firstName":"Keep","lastName":"Me","houseNum":"2403","streetName":"Alstep way","phone":"","history":[]}]', 1);

set role authenticated;
\echo '== 1 non-SA user is refused'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false);
select app_client_match('[{"i":0,"house_no":"1","street":"Baronwood Dr"}]');
select 'cheryl sees clients', count(*) from clients;

\echo '== 2 matching (expect: 0 house WO08, 1 address_point WO09, 2 geocode WO08, 3 street WO06, 4 given WO09, 5 none)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select x->>'i' i, x->>'route_code' route, x->>'how' how, x->>'street_norm' norm from jsonb_array_elements(app_client_match('[
 {"i":0,"house_no":"2201","street":"BARONWOOD DRIVE","city":"Oakville"},
 {"i":1,"house_no":"2280","street":"Baronwood Dr","city":"oakville"},
 {"i":2,"house_no":"2210","street":"Baronwood Dr","lat":43.4301,"lng":-79.768},
 {"i":3,"house_no":"2403","street":"Alstep Way"},
 {"i":4,"house_no":"9","street":"Nowhere Rd","route":"wo09"},
 {"i":5,"house_no":"9","street":"Nowhere Rd"}]')) x;

\echo '== 3 import #1: two rows for 2201 Baronwood merge in the file; one new on Alstep'
select app_client_import_begin('calgary.xlsx','file',null,'fp1','Callbook 2026',array['FIRST','LAST'],'{"columns":{}}','notes') as imp1 \gset
select app_client_import_add(:'imp1', '[
 {"house_no":"2201","street_name":"Baronwood Dr","city":"Oakville","route_code":"WO08","match_how":"house","lat":43.43,"lng":-79.768,
  "people":[{"first":"Ann","last":"Lee"}],"phones":["9055551234"],"history":[{"year":2025,"service":"AER","price":"120","contractor":"Bo"}],"do_not_call":false},
 {"house_no":"2403","street_name":"Alstep Way","city":"Oakville","route_code":"WO06","match_how":"street",
  "people":[{"first":"Sam","last":"Wu"}],"history":[{"year":2024,"service":"SS","price":"200","contractor":"Max"}],"tags":["NO SP"]},
 {"house_no":"","street_name":"Bad"}]');
select app_client_import_finish(:'imp1', '{"rows":3}');
select house_no, street_norm, city, route_code, people, phones, tags from clients order by house_no;
select route_code, client_count, (select string_agg(e->>'firstName' || ':' || coalesce(e->>'src','old') || ':' || jsonb_array_length(e->'history'), ', ') from jsonb_array_elements(clients) e) entries
  from map_pcl_cache order by route_code;

\echo '== 4 import #2 merges into 2201 (new year, new phone, DNC) and adds a third client'
select app_client_import_begin('book2.csv','sheet','https://docs.google.com/x','fp2','Book 2',null,'{}',null) as imp2 \gset
select app_client_import_add(:'imp2', '[
 {"house_no":"2201","street_name":"Baronwood Drive","people":[{"first":"Ann","last":"Lee"},{"first":"Bob","last":"Lee"}],
  "phones":["9055559999","9055551234"],"history":[{"year":2026,"service":"AER","price":"130","contractor":"Bo"},{"year":2025,"service":"AER","price":"120","contractor":"Bo"}],"do_not_call":true},
 {"house_no":"2280","street_name":"Baronwood Dr","city":"Oakville","route_code":"WO09","match_how":"address_point","people":[{"first":"Cy","last":"Ng"}]}]');
select app_client_import_finish(:'imp2', '{}');
select house_no, people, phones, jsonb_array_length(history) hist, do_not_call from clients where house_no = '2201';

\echo '== 5 undo #1 refused (2201 changed by #2); undo #2 then #1 restores everything'
select app_client_import_undo(:'imp1');
select app_client_import_undo(:'imp2');
select house_no, people, phones, jsonb_array_length(history) hist, do_not_call from clients order by house_no;
select app_client_import_undo(:'imp1');
select 'clients left', count(*) from clients;
select route_code, client_count, (select string_agg(e->>'firstName' || ':' || coalesce(e->>'src','old'), ', ') from jsonb_array_elements(clients) e) entries
  from map_pcl_cache order by route_code;
select app_client_import_undo(:'imp1');
reset role;
\echo '== 6 grants: anon/authenticated cannot write tables directly'
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
insert into clients (address_key, house_no, street_name, street_norm) values ('x','1','a','a');
select client_refresh_map_pcl(array['WO08']);
reset role;
