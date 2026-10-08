-- PCL texts go to the right person: name and phone from the same person, "there" when unsure,
-- imports keep each person's phone, and the old map lists give people their phones back.
-- In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
-- the contact chooser
select 'one person' k, * from client_contact('[{"first":"Ann","last":"Lee"}]', '{9055550101}');
select 'own phone wins' k, * from client_contact('[{"first":"Evelyn","last":"Robbins"},{"first":"Gorry","last":"Hansen","phone":"9055553660"}]', '{9055553660,9055558080}');
select 'unknown pairing' k, * from client_contact('[{"first":"Evelyn","last":"Robbins"},{"first":"Gorry","last":"Hansen"}]', '{9055553660,9055558080}');
select 'two people no phone' k, * from client_contact('[{"first":"A","last":"B"},{"first":"C","last":"D"}]', '{}');
select 'nobody' k, * from client_contact('[]', '{9055550101}');

-- an import keeps phone order and pairs people with their phones
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000e1');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000e1', 'pclts', 'PCL Test');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000e1', 'sa_territory');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000e1', true);
select app_client_import_begin('t.xlsx', 'file', null, 'fp', 'r', '{}', '{"columns":{}}'::jsonb, null) imp \gset
select 'add' k, app_client_import_add(:'imp', '[
  {"house_no":"588","street_name":"Wilene Drive","city":"Burlington","route_code":"ZZ46","services":["sealing"],
   "people":[{"first":"Evelyn","last":"Robbins","phone":"9055558080"},{"first":"Gorry","last":"Hansen","phone":"9055553660"}],
   "phones":["9055558080","9055553660"],"history":[{"year":2024,"service":"SS","price":"199","line":"sealing"}]}]'::jsonb);
select 'phones in order' k, phones, people->0->>'phone' first_phone from clients where house_no = '588' and route_code = 'ZZ46';
-- a later file brings the same name without a phone, then with one
select 'merge' k, app_client_import_add(:'imp', '[
  {"house_no":"588","street_name":"Wilene Drive","city":"Burlington","people":[{"first":"Evelyn","last":"Robbins"}],"phones":[]},
  {"house_no":"12","street_name":"Elm Rd","city":"Burlington","route_code":"ZZ46","people":[{"first":"Bo","last":"Ng"},{"first":"Cy","last":"Ng"}],"phones":["9055550002"],"history":[{"year":2023,"service":"SS","price":"","line":"sealing"}]},
  {"house_no":"12","street_name":"Elm Rd","city":"Burlington","people":[{"first":"Cy","last":"Ng","phone":"9055550003"}],"phones":["9055550003"]}]'::jsonb);
select 'after merge' k, house_no, people, phones from clients where route_code = 'ZZ46' order by house_no;
update clients set services = '{sealing}' where route_code = 'ZZ46';
select 'entries' k, e->>'houseNum' h, e->>'firstName' f, e->>'phone' ph, e->>'nameUnsure' unsure
  from jsonb_array_elements(client_pcl_entries('ZZ46', 'sealing')) e order by 1, 2;
reset role;

rollback;
