-- Close day: blockers (unpaid cart with sales, unmarked roster), then archive + clear the old
-- session, no-shows onto NS, day closed with a summary. Everything in a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id)
values ('c0000000-0000-0000-0000-0000000000c1', 'close-test', 'test-only', 'Close test', 'wb', 'mb'),
       ('c0000000-0000-0000-0000-0000000000c2', 'other-test', 'test-only', 'Other center', 'wb', 'mb');
insert into people (id, first_name, last_name) values
  ('d0000000-0000-0000-0000-0000000000a1', 'Ann', 'Showed'), ('d0000000-0000-0000-0000-0000000000a2', 'Bob', 'Noshow'),
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
-- the old app's session at this center, plus one row at another center that must survive
insert into daily_sessions (date, command_center_id, is_active, season_type) values ('2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', true, 'sealing');
insert into users (user_id, role, name, password, metadata, command_center_id) values
  ('T2001', 'Worker', 'Ann Showed', 'Ann', '{}', 'c0000000-0000-0000-0000-0000000000c1'),
  ('T2004', 'Worker', 'Dee Idle', 'Dee', '{}', 'c0000000-0000-0000-0000-0000000000c1'),
  ('rm_testmgr', 'RouteManager', 'Test Mgr', 'x', '{}', 'c0000000-0000-0000-0000-0000000000c1'),
  ('T9999', 'Worker', 'Other Center', 'Oth', '{}', 'c0000000-0000-0000-0000-0000000000c2');
insert into logsheet_sessions (id, worker_id, date, command_center_id, status, stats) values
  ('ls1', 'T2001', '2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', 'OPEN', '{"stepCount":3,"prodGross":300,"upsellGross":50,"upsellCount":1}'),
  ('ls2', 'T2004', '2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', 'OPEN', '{"stepCount":0}');
insert into transactions (id, worker_id, command_center_id, session_id, price, cc_full_number, cc_cvc) values
  ('tx1', 'T2001', 'c0000000-0000-0000-0000-0000000000c1', 'ls1', 300, '4111111111111111', '123');
insert into transactions (id, worker_id, command_center_id, session_id, price) values ('tx9', 'T9999', 'c0000000-0000-0000-0000-0000000000c2', 'lsX', 10);

insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c9'), ('a0000000-0000-0000-0000-0000000000ca');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000c9', 'closa', 'Close Admin'), ('a0000000-0000-0000-0000-0000000000ca', 'nopex', 'No Perm');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'workerbook'), ('a0000000-0000-0000-0000-0000000000ca', 'route_manager');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000c9', 'c0000000-0000-0000-0000-0000000000c1'), ('a0000000-0000-0000-0000-0000000000ca', 'c0000000-0000-0000-0000-0000000000c1');

set local role authenticated;
-- 1. a manager without Workerbook can't
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ca', true);
do $$ begin perform app_close_day_check('c0000000-0000-0000-0000-0000000000c1', '2026-10-07'); raise notice 'FAIL no-perm allowed';
  exception when others then raise notice 'ok no-perm: %', sqlerrm; end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
-- 2. blockers: ls1 has a sale and isn't paid (ls2 has none, so it doesn't block); Cy isn't marked
select 'check1' k, c->>'can_close' can_close, jsonb_array_length(c->'unpaid') unpaid, c->'unpaid'->0->>'names' names,
       jsonb_array_length(c->'unmarked') unmarked, jsonb_array_length(c->'no_shows') ns, c->>'steps' steps, c->>'gross' gross
  from (select app_close_day_check('c0000000-0000-0000-0000-0000000000c1', '2026-10-07') c) x;
do $$ begin perform app_close_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-07'); raise notice 'FAIL closed with blockers';
  exception when others then raise notice 'ok blocked: %', sqlerrm; end $$;
reset role;
-- clear the blockers (as the app would: payout marks PAID, manager marks Cy)
update logsheet_sessions set status = 'PAID' where id = 'ls1';
update day_roster set attendance = 'showed' where hire_id = 'e0000000-0000-0000-0000-0000000000a3';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
select 'check2' k, app_close_day_check('c0000000-0000-0000-0000-0000000000c1', '2026-10-07')->>'can_close' can_close;
select 'close' k, app_close_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-07') summary;
do $$ begin perform app_close_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-07'); raise notice 'FAIL closed twice';
  exception when others then raise notice 'ok twice: %', sqlerrm; end $$;
reset role;

select 'day' k, state, closed_by is not null by_set, summary->>'no_shows' ns from days where id = 'f0000000-0000-0000-0000-0000000000d1';
select 'bob' k, status, status_since, ns_count from hires where id = 'e0000000-0000-0000-0000-0000000000a2';
select 'bob NS entry' k, count(*) from status_entries where hire_id = 'e0000000-0000-0000-0000-0000000000a2' and status = 'NS' and since = '2026-10-07';
select 'left at center' k,
  (select count(*) from daily_sessions where command_center_id = 'c0000000-0000-0000-0000-0000000000c1') sessions,
  (select count(*) from logsheet_sessions where command_center_id = 'c0000000-0000-0000-0000-0000000000c1') sheets,
  (select count(*) from transactions where command_center_id = 'c0000000-0000-0000-0000-0000000000c1') tx,
  (select count(*) from users where command_center_id = 'c0000000-0000-0000-0000-0000000000c1') users;
select 'other center kept' k, (select count(*) from transactions where id = 'tx9') tx, (select count(*) from users where user_id = 'T9999') users;
select 'archived' k, source_table, count(*) from archive.session_rows where center_id = 'c0000000-0000-0000-0000-0000000000c1' group by 2 order by 2;
select 'no secrets in archive' k,
  count(*) filter (where row_data ? 'password') pw, count(*) filter (where row_data ? 'cc_full_number' or row_data ? 'cc_cvc') card
  from archive.session_rows where center_id = 'c0000000-0000-0000-0000-0000000000c1';
rollback;
