-- Close day on a road-trip center: unmarked people don't block, nobody goes to the NS list;
-- an unpaid cart with sales still blocks. In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type)
values ('c0000000-0000-0000-0000-0000000000c1', 'rt-test', 'test-only', 'RT test', 'wb', 'mb', 'road_trip');
insert into people (id, first_name, last_name) values
  ('d0000000-0000-0000-0000-0000000000a1', 'Ann', 'Worked'), ('d0000000-0000-0000-0000-0000000000a2', 'Bob', 'Marked'),
  ('d0000000-0000-0000-0000-0000000000a3', 'Cy', 'Unmarked');
insert into hires (id, person_id, center_id, year, cn, ns_count) values
  ('e0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1', 2026, 'T2001', 0),
  ('e0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000c1', 2026, 'T2002', 1),
  ('e0000000-0000-0000-0000-0000000000a3', 'd0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-0000000000c1', 2026, 'T2003', 0);
insert into days (id, center_id, day, state) values ('f0000000-0000-0000-0000-0000000000d1', 'c0000000-0000-0000-0000-0000000000c1', '2026-10-07', 'live');
insert into day_roster (day_id, hire_id, attendance) values
  ('f0000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-0000000000a1', 'showed'),
  ('f0000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-0000000000a2', 'no_show'),
  ('f0000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-0000000000a3', null);
insert into daily_sessions (date, command_center_id, is_active, season_type) values ('2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', true, 'sealing');
insert into users (user_id, role, name, password, metadata, command_center_id) values
  ('T2001', 'Worker', 'Ann Worked', 'Ann', '{}', 'c0000000-0000-0000-0000-0000000000c1');
insert into logsheet_sessions (id, worker_id, date, command_center_id, status, stats) values
  ('ls1', 'T2001', '2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', 'OPEN', '{"stepCount":3,"prodGross":300}');
insert into transactions (id, worker_id, command_center_id, session_id, price) values ('tx1', 'T2001', 'c0000000-0000-0000-0000-0000000000c1', 'ls1', 300);
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c9');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000c9', 'closa', 'Close Admin');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'workerbook');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000c9', 'c0000000-0000-0000-0000-0000000000c1');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
-- unpaid cart blocks; Cy unmarked does not count
select 'check1' k, c->>'road_trip' rt, c->>'can_close' can_close, jsonb_array_length(c->'unpaid') unpaid,
       jsonb_array_length(c->'unmarked') unmarked, jsonb_array_length(c->'no_shows') ns
  from (select app_close_day_check('c0000000-0000-0000-0000-0000000000c1', '2026-10-07') c) x;
do $$ begin perform app_close_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-07'); raise notice 'FAIL closed with unpaid cart';
  exception when others then raise notice 'ok blocked: %', sqlerrm; end $$;
reset role;
update logsheet_sessions set status = 'PAID' where id = 'ls1';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
select 'check2' k, app_close_day_check('c0000000-0000-0000-0000-0000000000c1', '2026-10-07')->>'can_close' can_close;
select 'close' k, app_close_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-07') summary;
reset role;
select 'day' k, state, summary->>'no_shows' ns from days where id = 'f0000000-0000-0000-0000-0000000000d1';
select 'bob (marked no-show) untouched' k, status, ns_count from hires where id = 'e0000000-0000-0000-0000-0000000000a2';
select 'old session cleared' k, (select count(*) from daily_sessions where command_center_id = 'c0000000-0000-0000-0000-0000000000c1') sessions;
rollback;
