-- This season's done jobs go on the customer records when a day closes (and again when a closed
-- day's payouts are saved), one job per sale, without doubling up; a new address gets a customer;
-- the crew's phone/email/name is added; H01 (testing) is left out; PCL entries carry the date.
-- In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type, services)
values ('c0000000-0000-0000-0000-0000000000d1', 'crm-test', 'test-only', 'CRM test', 'wb', 'mb', 'road_trip', '{sealing}');
insert into seasons (center_id, service, year, starts_on, ends_on) values ('c0000000-0000-0000-0000-0000000000d1', 'sealing', 2026, '2026-10-01', '2026-10-31');
insert into days (center_id, day, state) values ('c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 'live');

-- a past client (2025) at 10 Elm Rd on ZZ01
insert into clients (address_key, house_no, street_name, street_norm, city, route_code, match_how, people, phones, history)
values (client_address_key('10', norm_street('Elm Rd'), null, 'Burlington'), '10', 'Elm Rd', norm_street('Elm Rd'), 'Burlington', 'ZZ01', 'given',
        '[{"first":"Ann","last":"Lee"}]', '{}', '[{"year":2025,"service":"SS","price":"199","line":"sealing"}]');

-- the day's carts: one real, one H01 (testing)
insert into payout_carts (id, center_id, day, sort, label, members) values
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 1, 'Sam',
   '[{"cn":"I1013","hire_id":"h-1","first_name":"Sam","last_name":"Abara"},{"cn":"I2004","hire_id":"h-2","first_name":"Lee","last_name":"Tran"}]'),
  ('a1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 2, 'Test',
   '[{"cn":"H01","first_name":"Test","last_name":"User"}]');
insert into payout_sales (cart_id, center_id, day, sort, route_code, address, client_name, price, payment_type, payments, type, service, notes, meta) values
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 1, 'ZZ01', '10 Elm Rd', 'Ann Lee', 209.05, 'E-Transfer', null, 'Sale', 'SS', 'New Sale', '{}'),
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 2, 'ZZ01', '22 Oak St', 'Bo Ng', 203.40, 'Cash', null, 'Sale', 'SSP', 'New Sale', '{}'),
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 3, 'ZZ01', '22 Oak St', 'Bo Ng', 339.00, 'Billed', null, 'Sale', 'Ramp', 'Asphalt', '{}'),
  ('a1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 4, 'ZZ01', '4-30 Pine Cres', 'Cy Fox', 150, 'Cash', '{"Cash": 100, "Cheque": 50}', 'Sale', 'SS', 'New Sale', '{}'),
  ('a1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 1, 'ZZ01', '99 Test Ave', 'Tess T', 1, 'Cash', null, 'Sale', 'SS', 'test', '{}');
-- the day's saved copy: the crew took a phone for Ann and for Bo (card numbers never kept)
insert into archive.session_rows (day, center_id, source_table, row_data) values
  ('2026-10-06', 'c0000000-0000-0000-0000-0000000000d1', 'transactions',
   '{"price":"209.05","customer_snapshot":{"address":"10 Elm Rd","routeCode":"ZZ01","firstName":"Ann","lastName":"Lee"},"customer_phone":"(905) 555-0101","customer_email":"ANN@EXAMPLE.COM","etransfer_email":"ann@example.com"}'),
  ('2026-10-06', 'c0000000-0000-0000-0000-0000000000d1', 'transactions',
   '{"price":"203.40","customer_snapshot":{"address":"22 Oak St","routeCode":"ZZ01","firstName":"Bo","lastName":"Ng"},"customer_phone":"905-555-0102"}');

select 'live day: nothing yet' k, count(*) from clients where history::text like '%"src": "day"%' and route_code = 'ZZ01';

-- close the day; the sync runs as the close commits (forced now with set constraints)
update days set state = 'closed' where center_id = 'c0000000-0000-0000-0000-0000000000d1' and day = '2026-10-06';
set constraints all immediate;
set constraints all deferred;

select 'customers' k, house_no, street_name, unit, route_code, match_how, people, phones, emails
  from clients where route_code = 'ZZ01' order by street_name, house_no;
select 'jobs' k, c.house_no, h->>'year' yr, h->>'service' svc, h->>'product' product, h->>'source' source, h->>'price' price,
       h->>'payment' payment, h->>'payment_detail' detail, h->>'paid' paid, h->>'contractor' crew, jsonb_array_length(h->'crew') crew_n, h->>'date' date
  from clients c, jsonb_array_elements(c.history) h where c.route_code = 'ZZ01' and h->>'src' = 'day' order by 2, svc;
select 'H01 left out' k, count(*) from clients where street_name ilike 'Test%';
select 'past job kept' k, count(*) from clients c, jsonb_array_elements(c.history) h where c.house_no = '10' and c.route_code = 'ZZ01' and h->>'year' = '2025';

-- payouts edited after closing: the save deletes and re-inserts the carts, once per cart
delete from payout_carts where center_id = 'c0000000-0000-0000-0000-0000000000d1' and day = '2026-10-06';
insert into payout_carts (id, center_id, day, sort, label, members) values
  ('a1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 1, 'Sam',
   '[{"cn":"I1013","hire_id":"h-1","first_name":"Sam","last_name":"Abara"}]');
insert into payout_sales (cart_id, center_id, day, sort, route_code, address, client_name, price, payment_type, type, service, notes, meta) values
  ('a1000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000d1', '2026-10-06', 1, 'ZZ01', '10 Elm Rd', 'Ann Lee', 219.00, 'E-Transfer', 'Sale', 'SS', 'New Sale', '{}');
select 'queued once' k, count(*) from crm_sync_queue where center_id = 'c0000000-0000-0000-0000-0000000000d1';
set constraints all immediate;
set constraints all deferred;
select 'after re-save' k, c.house_no, c.street_name, h->>'price' price, h->>'contractor' crew
  from clients c, jsonb_array_elements(c.history) h where c.route_code = 'ZZ01' and h->>'src' = 'day' order by 2;
select 'queue empty' k, count(*) from crm_sync_queue;

-- the map's PCL list carries this season's job with its date
select 'pcl entry' k, e->>'houseNum' h, e->'history'->0->>'year' yr, e->'history'->0->>'date' date, e->'history'->0->>'price' price, e->'history'->1->>'year' prev
  from map_pcl_cache m, jsonb_array_elements(m.clients) e where m.route_code = 'ZZ01' order by 2;

-- the address splitter
select 'split' k, * from crm_split_address('4-123 Main St') union all select 'split', * from crm_split_address('123 Main St Unit 7')
union all select 'split', * from crm_split_address('12a  Elm Road') union all select 'split', * from crm_split_address('Lakeshore Rd');

-- the manual resync: Workerbook users of that center only
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f1');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000f1', 'crmno', 'No Perm');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000f1', 'route_manager');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f1', true);
do $$ begin perform app_crm_resync_day('c0000000-0000-0000-0000-0000000000d1', '2026-10-06'); raise notice 'FAIL no-perm resync';
  exception when others then raise notice 'ok no-perm resync: %', sqlerrm; end $$;
do $$ begin perform app_crm_sync_day('c0000000-0000-0000-0000-0000000000d1', '2026-10-06'); raise notice 'FAIL internal callable';
  exception when others then raise notice 'ok internal hidden: %', sqlerrm; end $$;
do $$ begin perform count(*) from crm_sync_queue; raise notice 'FAIL queue readable';
  exception when others then raise notice 'ok queue hidden: %', sqlerrm; end $$;
reset role;
rollback;
