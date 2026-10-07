-- Bringing the maps' past clients into Clients: one record per address (entries on two routes merge),
-- history and people kept, existing clients untouched, unusable entries skipped, runs once, undoable;
-- the city › route map › route tree. In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
delete from client_import_changes; delete from client_imports; delete from clients; delete from map_pcl_cache;
insert into area_prefixes (area_name, prefix, region, route_start, route_count) values ('GLEN ABBEY #1', 'GA', 'West', 1, 8) on conflict (area_name) do update set region = 'West';
insert into route_maps (area_name, route_number, route_code, status, route_color) values ('GLEN ABBEY #1', 1, 'GA01', 'approved', '#f00'), ('GLEN ABBEY #1', 2, 'GA02', 'approved', '#0f0');
insert into map_pcl_cache (route_code, area_name, region, prefix, clients, client_count) values
 ('GA01', 'GLEN ABBEY #1', 'East', 'GA', '[
   {"houseNum": "12", "streetName": "Main Street", "city": "Oakville", "firstName": "Ann", "lastName": "Lee", "phone": "(905) 555-0101", "lat": 43.4, "lng": -79.7,
    "history": [{"year": 2021, "price": "$200.00", "contractor": "Max H", "serviceType": "SS"}]},
   {"houseNum": "14", "streetName": "Main St", "city": "Oakville", "firstName": "Bo", "lastName": "Kay", "phone": "", "history": []},
   {"houseNum": "", "streetName": "Nowhere", "city": "Oakville", "history": []},
   {"houseNum": "99", "streetName": "Imported Rd", "city": "Oakville", "src": "crm", "cid": "x"}
 ]', 4),
 ('GA02', 'GLEN ABBEY #1', 'East', 'GA', '[
   {"houseNum": "12", "streetName": "MAIN ST", "city": "Oakville", "firstName": "Ann", "lastName": "Lee", "phone": "9055550101",
    "history": [{"year": 2023, "price": "$219.00", "contractor": "Jo P", "serviceType": "SS,SSP"}, {"year": 2021, "price": "$200.00", "contractor": "Max H", "serviceType": "SS"}]},
   {"houseNum": "7", "streetName": "Elm Ave", "city": "burlington ", "firstName": "Cy", "lastName": "Day", "history": []},
   {"houseNum": "8", "streetName": "Elm Ave", "city": "Oakville", "firstName": "Di", "lastName": "Ng", "history": []}
 ]', 3);
-- an address that's already a client stays as it is
insert into clients (address_key, house_no, street_name, street_norm, city, people, history)
values (client_address_key('8', norm_street('Elm Ave'), null, 'Oakville'), '8', 'Elm Ave', norm_street('Elm Ave'), 'Oakville', '[{"first": "Existing", "last": "Person"}]', '[]');
\ir ../migrations/20261013100000_clients_from_map.sql
select 'import' k, source, status, counts from client_imports;
select 'clients' k, house_no, street_name, city, route_code, match_how, people, phones, services, history from clients order by street_norm, house_no;
-- runs once: running the whole script again changes nothing
\ir ../migrations/20261013100000_clients_from_map.sql
select 'after 2nd run' k, (select count(*) from client_imports) imports, (select count(*) from clients) clients;
-- the tree, as someone with the Clients permission
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c9'), ('a0000000-0000-0000-0000-0000000000ca');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000c9', 'treee', 'Tree Viewer'), ('a0000000-0000-0000-0000-0000000000ca', 'nopee', 'No Perm');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'dialer'), ('a0000000-0000-0000-0000-0000000000ca', 'workerbook');
update clients set route_code = null where house_no = '8';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
select 'tree' k, * from app_client_tree(null) order by city, area_name nulls last, route_code;
select 'tree sealing' k, count(*) rows, sum(clients) clients from app_client_tree('sealing');
select 'tree aeration' k, count(*) rows from app_client_tree('aeration');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ca', true);
select 'no perm tree' k, count(*) from app_client_tree(null);
reset role;
-- undo works like any import
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'sa_territory');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
select 'undo' k, app_client_import_undo((select id from client_imports where source = 'map'));
reset role;
select 'after undo' k, (select count(*) from clients) clients, (select status from client_imports where source = 'map') status,
  (select sum(client_count) from map_pcl_cache) map_entries;
rollback;
