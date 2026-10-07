-- Days close one at a time: an open day is handed off (its carts saved, the old app's tables cleared)
-- so a newer day can start; it stays live and is closed later from its saved carts, once every cart
-- with sales is finalized. In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type)
values ('c0000000-0000-0000-0000-0000000000c1', 'od-test', 'test-only', 'Open days test', 'wb', 'mb', 'road_trip');
insert into people (id, first_name, last_name) values ('d0000000-0000-0000-0000-0000000000a1', 'Ann', 'Lee');
insert into hires (id, person_id, center_id, year, cn) values ('e0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1', 2026, 'I2004');
insert into days (id, center_id, day, state) values
  ('f0000000-0000-0000-0000-0000000000d6', 'c0000000-0000-0000-0000-0000000000c1', '2026-10-06', 'live'),
  ('f0000000-0000-0000-0000-0000000000d7', 'c0000000-0000-0000-0000-0000000000c1', '2026-10-07', 'planned');
insert into day_roster (day_id, hire_id) values ('f0000000-0000-0000-0000-0000000000d6', 'e0000000-0000-0000-0000-0000000000a1');
insert into daily_sessions (date, command_center_id, is_active, season_type) values ('2026-10-06', 'c0000000-0000-0000-0000-0000000000c1', true, 'sealing');
insert into users (user_id, role, name, password, metadata, command_center_id) values ('I2004', 'Worker', 'Ann Lee', 'x', '{}', 'c0000000-0000-0000-0000-0000000000c1');
insert into logsheet_sessions (id, worker_id, date, command_center_id, status, stats) values
  ('ls1', 'I2004', '2026-10-06', 'c0000000-0000-0000-0000-0000000000c1', 'OPEN', '{"stepCount":2,"prodGross":376}');
insert into transactions (id, worker_id, command_center_id, session_id, price) values ('tx1', 'I2004', 'c0000000-0000-0000-0000-0000000000c1', 'ls1', 226);
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c9'), ('a0000000-0000-0000-0000-0000000000ca');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000c9', 'opena', 'Open Admin'), ('a0000000-0000-0000-0000-0000000000ca', 'openb', 'No Perm');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'workerbook'), ('a0000000-0000-0000-0000-0000000000ca', 'route_manager');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000c9', 'c0000000-0000-0000-0000-0000000000c1'), ('a0000000-0000-0000-0000-0000000000ca', 'c0000000-0000-0000-0000-0000000000c1');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ca', true);
do $$ begin perform app_handoff_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-06'); raise notice 'FAIL no-perm handed off';
  exception when others then raise notice 'ok no-perm: %', sqlerrm; end $$;
do $$ begin perform app_archive_clear_session('c0000000-0000-0000-0000-0000000000c1', '2026-10-06'); raise notice 'FAIL internal function callable';
  exception when others then raise notice 'ok internal: %', sqlerrm; end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
-- sales in the old app but no carts saved: refused
do $$ begin perform app_handoff_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-06'); raise notice 'FAIL handed off without carts';
  exception when others then raise notice 'ok no carts: %', sqlerrm; end $$;
do $$ begin perform app_handoff_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-07'); raise notice 'FAIL planned day handed off';
  exception when others then raise notice 'ok planned: %', sqlerrm; end $$;
-- save the carts (not finalized: it wasn't paid out yet), then hand off
select 'save' k, app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-06',
  '[{"label": "Cart 1", "finalized": false, "members": [{"cn": "I2004", "equiv_split": 100, "upsell_split": 100}],
     "sales": [{"route_code": "GA07", "price": 226, "payment_type": "Cash", "type": "Sale"}, {"price": 150, "type": "Upgrade"}]},
    {"label": "Cart 2", "members": [], "sales": []}]', '[]') n;
select 'finalized stored' k, label, finalized from payout_carts order by sort;
select 'handoff' k, app_handoff_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-06') archived;
reset role;
select 'after handoff' k, d.state, d.handed_off_at is not null handed_off,
       (select count(*) from daily_sessions where command_center_id = d.center_id) sessions,
       (select count(*) from logsheet_sessions where command_center_id = d.center_id) logsheets,
       (select count(*) from transactions where command_center_id = d.center_id) txs,
       (select count(*) from users where command_center_id = d.center_id) users,
       (select count(*) from archive.session_rows where center_id = d.center_id and day = d.day) archived,
       (select count(*) from archive.session_rows where center_id = d.center_id and row_data ? 'password') passwords
  from days d where d.id = 'f0000000-0000-0000-0000-0000000000d6';
-- the newer day takes the old app's tables
update days set state = 'live' where id = 'f0000000-0000-0000-0000-0000000000d7';
insert into daily_sessions (date, command_center_id, is_active, season_type) values ('2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', true, 'sealing');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
do $$ begin perform app_handoff_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-06'); raise notice 'FAIL handed off twice';
  exception when others then raise notice 'ok twice: %', sqlerrm; end $$;
-- the handed-off day's numbers come from its carts; the unfinalized cart blocks closing (the empty one doesn't)
select 'check' k, c->>'has_session' has_session, c->>'handed_off' handed_off, c->>'carts' carts, c->>'paid' paid, c->>'steps' steps,
       c->>'gross' gross, c->>'upsells' upsells, c->'unfinalized' unfinalized, c->>'can_close' can_close
  from (select app_close_day_check('c0000000-0000-0000-0000-0000000000c1', '2026-10-06') c) x;
do $$ begin perform app_close_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-06'); raise notice 'FAIL closed with unfinalized cart';
  exception when others then raise notice 'ok blocked: %', sqlerrm; end $$;
-- finish it in the payout editor (finalized), then close: the newer day's old-app session is untouched
select 'finalize' k, app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-06',
  '[{"label": "Cart 1", "finalized": true, "members": [{"cn": "I2004", "equiv_split": 100, "upsell_split": 100}],
     "sales": [{"route_code": "GA07", "price": 226, "payment_type": "Cash", "type": "Sale"}, {"price": 150, "type": "Upgrade"}]}]',
  '[{"cn": "I2004", "first_name": "Ann", "last_name": "Lee", "equiv": 13, "total_payout": 68, "stats": {"assignedEQ": 13}}]') n;
select 'close' k, app_close_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-06') summary;
reset role;
select 'closed' k, state, summary->>'handed_off' handed_off, summary->>'had_session' had_session from days where id = 'f0000000-0000-0000-0000-0000000000d6';
select 'newer day kept' k, count(*) sessions from daily_sessions where command_center_id = 'c0000000-0000-0000-0000-0000000000c1' and date = '2026-10-07';
select 'lines' k, count(*) from payout_lines where center_id = 'c0000000-0000-0000-0000-0000000000c1';
rollback;
