-- The customer CRM: every knock is kept as a visit (one per house per day); the customer page shows
-- the record, its visits (with the crew's name) and the texts sent; the territory map shows each
-- customer's category for this season, plus houses that said no and aren't customers. Only people
-- with a CRM permission, and only for their centers' maps. In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
\i supabase/migrations/20261021100000_crm_customers.sql

insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type, services)
values ('c0000000-0000-0000-0000-0000000000e1', 'crm-cust', 'test-only', 'CRM cust', 'wb', 'mb', 'road_trip', '{sealing}'),
       ('c0000000-0000-0000-0000-0000000000e2', 'crm-other', 'test-only', 'CRM other', 'wb', 'mb', 'road_trip', '{sealing}');
insert into route_maps (area_name, route_number, route_code, route_color, segments, status) values
  ('CRM TOWN', 1, 'CT01', '#ef4444', '[]', 'approved'), ('CRM TOWN', 2, 'CT02', '#22c55e', '[]', 'approved'),
  ('CRM FAR', 1, 'CF01', '#3b82f6', '[]', 'approved');
insert into map_area_centers (area_name, center_id) values ('CRM TOWN', 'c0000000-0000-0000-0000-0000000000e1'),
                                                        ('CRM FAR', 'c0000000-0000-0000-0000-0000000000e2');

-- this season's year, for the history
select extract(year from now() at time zone 'America/Toronto')::int as yr \gset

insert into clients (id, address_key, house_no, street_name, street_norm, city, route_code, lat, lng, people, phones, history) values
  -- back again: a job this year and before, paid
  ('d0000000-0000-0000-0000-000000000001', 'ck1', '10', 'Elm Rd', 'elm rd', 'Burlington', 'CT01', 43.35, -79.76, '[{"first":"Ann","last":"Lee"}]', '{9055550101}',
   jsonb_build_array(jsonb_build_object('year', :yr, 'service', 'SS', 'price', '209.05', 'paid', 'paid', 'date', '2026-10-06', 'src', 'day'),
                     jsonb_build_object('year', :yr - 1, 'service', 'SS', 'price', '199'))),
  -- new this year
  ('d0000000-0000-0000-0000-000000000002', 'ck2', '22', 'Oak St', 'oak st', 'Burlington', 'CT01', 43.351, -79.761, '[{"first":"Bo","last":"Ng"}]', '{}',
   jsonb_build_array(jsonb_build_object('year', :yr, 'service', 'SSP', 'price', '203.40', 'paid', 'paid'))),
  -- owed this year (billed)
  ('d0000000-0000-0000-0000-000000000003', 'ck3', '4', 'Pine Cres', 'pine cres', 'Burlington', 'CT02', 43.352, -79.762, '[]', '{}',
   jsonb_build_array(jsonb_build_object('year', :yr, 'service', 'Ramp', 'price', '339.00', 'paid', 'owed'))),
  -- past customer who said no this year
  ('d0000000-0000-0000-0000-000000000004', 'ck4', '7 A', 'Birch Ave', 'birch ave', 'Burlington', 'CT02', 43.353, -79.763, '[{"first":"Cy","last":"Fox"}]', '{}',
   jsonb_build_array(jsonb_build_object('year', :yr - 2, 'service', 'SS', 'price', '180'))),
  -- past customer, not knocked
  ('d0000000-0000-0000-0000-000000000005', 'ck5', '9', 'Birch Ave', 'birch ave', 'Burlington', 'CT02', 43.354, -79.764, '[]', '{}',
   jsonb_build_array(jsonb_build_object('year', :yr - 1, 'service', 'SS', 'price', '180'))),
  -- no position: not on the map
  ('d0000000-0000-0000-0000-000000000006', 'ck6', '11', 'Birch Ave', 'birch ave', 'Burlington', 'CT02', null, null, '[]', '{}', '[]'),
  -- the other center's map
  ('d0000000-0000-0000-0000-000000000007', 'ck7', '1', 'Far Rd', 'far rd', 'Burlington', 'CF01', 43.4, -79.8, '[]', '{}', '[]');

-- houses on the routes (for the non-customer "no")
insert into route_houses (route_code, house_key, civic_no, civic_suffix, street_name, street_norm, lat, lng) values
  ('CT02', '7a|birch ave', 7, 'A', 'Birch Ave', 'birch ave', 43.353, -79.763),
  ('CT02', '15|birch ave', 15, null, 'Birch Ave', 'birch ave', 43.355, -79.765),
  ('CT02', '17|birch ave', 17, null, 'Birch Ave', 'birch ave', 43.356, -79.766);

-- a crew member
insert into people (id, first_name, last_name) values ('e0000000-0000-0000-0000-000000000001', 'Sam', 'Abara');
insert into hires (person_id, center_id, year, cn) values ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000e1', :yr, 'Z1013');

-- ── visits: the trigger keeps one per house per day ──
insert into house_dispositions (route_code, house_key, status, note, worker_id, command_center_id, first_name)
values ('CT02', '7a|birch ave', 'not_home', null, 'Z1013', 'c0000000-0000-0000-0000-0000000000e1', null);
-- (make that knock three days ago)
update client_visits set day = day - 3, at = at - interval '3 days' where house_key = '7a|birch ave';
-- today the same house says no (one row in house_dispositions, two visits); the phone's clock is ignored
update house_dispositions set status = 'no', note = 'Did it himself', first_name = 'Cy', updated_at = now() - interval '5 days'
 where route_code = 'CT02' and house_key = '7a|birch ave';
-- changed again the same day: still one visit today, the note kept
update house_dispositions set status = 'invalid', note = '' where route_code = 'CT02' and house_key = '7a|birch ave';
select 'visits at 7a' k, (now() at time zone 'America/Toronto')::date - day days_ago, status, note, first_name, worker_id
  from client_visits where house_key = '7a|birch ave' order by day;

-- a non-customer said no today; another was knocked and taken back
insert into house_dispositions (route_code, house_key, status, worker_id, command_center_id) values
  ('CT02', '15|birch ave', 'no', 'Q9999', 'c0000000-0000-0000-0000-0000000000e1'),
  ('CT02', '17|birch ave', 'no', 'Q9999', 'c0000000-0000-0000-0000-0000000000e1');
delete from house_dispositions where route_code = 'CT02' and house_key = '17|birch ave';
select 'taken back' k, count(*) from client_visits where house_key = '17|birch ave';

-- texts sent to Ann
insert into email_logs (recipient_email, email_type, status, sent_at) values ('CT01|10 Elm Rd', 'pcl_outreach_text', 'sent', now() - interval '2 days'),
                                                                            ('CT01|22 Oak St', 'pcl_outreach_text', 'sent', now());

-- the one-time copy of earlier knocks (re-running the migration adds nothing twice)
insert into house_dispositions (route_code, house_key, status, worker_id, created_at, updated_at) values ('CT01', '99|old rd', 'go_back', 'Z1013', now() - interval '10 days', now() - interval '10 days');
delete from client_visits where house_key = '99|old rd';
insert into client_visits (route_code, house_key, day, status, note, first_name, worker_id, center_id, at)
select route_code, house_key, (coalesce(updated_at, created_at) at time zone 'America/Toronto')::date, status,
       nullif(trim(coalesce(note, '')), ''), nullif(trim(coalesce(first_name, '')), ''), worker_id, command_center_id, coalesce(updated_at, created_at)
  from house_dispositions hd where route_code is not null and house_key is not null and status is not null
   and not exists (select 1 from client_visits v where v.route_code = hd.route_code and v.house_key = hd.house_key)
on conflict do nothing;
select 'backfill' k, (now() at time zone 'America/Toronto')::date - day days_ago, status from client_visits where house_key = '99|old rd';
select 'no doubles' k, count(*) from client_visits where house_key = '7a|birch ave';

-- house keys
select 'house key' k, crm_house_key('7 A', 'birch ave'), crm_house_key(null, 'x');

-- ── people ──
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f1'), ('a0000000-0000-0000-0000-0000000000f2'), ('a0000000-0000-0000-0000-0000000000f3');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000f1', 'crmaa', 'Book Keeper'),
  ('a0000000-0000-0000-0000-0000000000f2', 'crmbb', 'No Perm'), ('a0000000-0000-0000-0000-0000000000f3', 'crmcc', 'Other Center');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000f1', 'bookings'), ('a0000000-0000-0000-0000-0000000000f3', 'workerbook');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000e1'),
                                                  ('a0000000-0000-0000-0000-0000000000f2', 'c0000000-0000-0000-0000-0000000000e1'),
                                                  ('a0000000-0000-0000-0000-0000000000f3', 'c0000000-0000-0000-0000-0000000000e2');

set local role authenticated;
-- no permission
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f2', true);
do $$ begin perform app_my_areas(); raise notice 'FAIL no-perm areas'; exception when others then raise notice 'ok no-perm areas: %', sqlerrm; end $$;
do $$ begin perform app_customer('d0000000-0000-0000-0000-000000000001'); raise notice 'FAIL no-perm customer'; exception when others then raise notice 'ok no-perm customer: %', sqlerrm; end $$;
do $$ begin perform 1 from client_visits; raise notice 'FAIL visits readable'; exception when others then raise notice 'ok visits table closed: %', sqlerrm; end $$;

-- the other center: sees only its map
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f3', true);
select 'other areas' k, jsonb_path_query_array(app_my_areas(), '$[*].area');
do $$ begin perform app_area_customers('CRM TOWN'); raise notice 'FAIL other center map'; exception when others then raise notice 'ok other center map: %', sqlerrm; end $$;
do $$ begin perform app_customer('d0000000-0000-0000-0000-000000000001'); raise notice 'FAIL other center customer'; exception when others then raise notice 'ok other center customer: %', sqlerrm; end $$;

-- the book keeper
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f1', true);
select 'my areas' k, app_my_areas();
select 'totals' k, (app_area_customers('CRM TOWN'))->'totals', (app_area_customers('CRM TOWN'))->'routes' routes, (app_area_customers('CRM TOWN'))->'said_no' said_no;
select 'point' k, p->>4 cat, p->>5 address, p->>6 name, p->>7 paid, p->>0 is null no_id
  from jsonb_array_elements((app_area_customers('CRM TOWN'))->'points') p order by p->>5;
select 'customer 4' k, x->'client'->>'house_no', x->>'area', x ? 'search_text' leaked,
       jsonb_path_query_array(x->'visits', '$[*].status') statuses, x->'visits'->0->>'worker' worker, x->'visits'->1->>'note' note
  from app_customer('d0000000-0000-0000-0000-000000000004') x;
select 'customer 1 texts' k, jsonb_array_length(x->'texts'), jsonb_array_length(x->'visits') from app_customer('d0000000-0000-0000-0000-000000000001') x;
do $$ begin perform app_customer('d0000000-0000-0000-0000-0000000000ff'); raise notice 'FAIL missing'; exception when others then raise notice 'ok missing: %', sqlerrm; end $$;
reset role;
rollback;
