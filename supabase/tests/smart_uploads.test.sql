-- Uploading a Logsheets-style list: a job the app already wrote isn't added twice (the upload only
-- fills in what's missing), other jobs are added, and people keep their own phones.
-- In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
select 'same job' k, crm_same_job('{"year":2026,"line":"sealing","service":"SS","price":"219.00","date":"2026-10-03"}', '{"year":2026,"line":"sealing","service":"ss","price":"$219"}') a,
       crm_same_job('{"year":2026,"line":"sealing","service":"SS","price":"219.00"}', '{"year":2026,"line":"sealing","service":"Ramp","price":"219"}') diff_service,
       crm_same_job('{"year":2026,"line":"sealing","price":"219.00","date":"2026-10-03"}', '{"year":2026,"line":"sealing","price":"219","date":"2026-10-04"}') diff_day,
       crm_same_job('{"year":2025,"price":"219"}', '{"year":2026,"price":"219"}') diff_year,
       crm_same_job('{"year":2026,"price":""}', '{"year":2026,"price":""}') no_price;

insert into clients (address_key, house_no, street_name, street_norm, route_code, match_how, people, phones, history)
values (client_address_key('10', norm_street('Elm Rd'), null, null), '10', 'Elm Rd', norm_street('Elm Rd'), 'ZZ02', 'sale',
        '[{"first":"Ann","last":"Lee","phone":"9055550101"}]', '{9055550101}',
        '[{"year":2026,"line":"sealing","service":"SS","price":"219.00","payment":"Cash","paid":"paid","date":"2026-10-03","src":"day","source":"Door sale","contractor":"Sam Abara"},
          {"year":2025,"line":"sealing","service":"SS","price":"199"}]');

insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f2');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000f2', 'upldr', 'Uploader');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000f2', 'sa_territory');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f2', true);
select app_client_import_begin('Logsheets.xlsx', 'file', null, 'fp', 'Logsheets', '{}', '{"columns":{}}'::jsonb, null) imp \gset
select 'upload' k, app_client_import_add(:'imp', '[
  {"house_no":"10","street_name":"Elm Rd","route_code":"ZZ02",
   "people":[{"first":"Ann","last":"Lee","phone":"9055550101"},{"first":"Rob","last":"Lee","phone":"9055550199"}],
   "phones":["9055550101","9055550199"],"emails":["ann@example.com"],
   "history":[{"year":2026,"line":"sealing","service":"SS","price":"219","contractor":"Sam Abara, Lee Tran","payment":"Cash","source":"Door sale"},
              {"year":2026,"line":"sealing","service":"Ramp","price":"339","contractor":"Sam Abara","payment":"Billed","source":"Upsell","product":"RAMP"}]}]'::jsonb);
select 'after' k, h->>'year' yr, h->>'service' svc, h->>'price' price, h->>'contractor' contractor, h->>'date' date, h->>'src' src, h->>'product' product
  from clients c, jsonb_array_elements(c.history) h where c.route_code = 'ZZ02' order by 2 desc, 3 desc;
select 'people' k, people, phones, emails from clients where route_code = 'ZZ02';
rollback;
