-- Roll call answers applied at start: book next day, WDR, Quit; only for people who showed.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id) values ('c0000000-0000-0000-0000-0000000000a7', 'rc-test', 'test-only', 'RC test', 'wb', 'mb');
insert into people (id, first_name) values ('d0000000-0000-0000-0000-0000000000c1', 'A'), ('d0000000-0000-0000-0000-0000000000c2', 'B'), ('d0000000-0000-0000-0000-0000000000c3', 'C'), ('d0000000-0000-0000-0000-0000000000c4', 'D');
insert into hires (id, person_id, center_id, year, cn) values
 ('e0000000-0000-0000-0000-0000000000c1', 'd0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-0000000000a7', 2026, 'R2001'),
 ('e0000000-0000-0000-0000-0000000000c2', 'd0000000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-0000000000a7', 2026, 'R2002'),
 ('e0000000-0000-0000-0000-0000000000c3', 'd0000000-0000-0000-0000-0000000000c3', 'c0000000-0000-0000-0000-0000000000a7', 2026, 'R2003'),
 ('e0000000-0000-0000-0000-0000000000c4', 'd0000000-0000-0000-0000-0000000000c4', 'c0000000-0000-0000-0000-0000000000a7', 2026, 'R2004');
insert into days (id, center_id, day, state) values ('f0000000-0000-0000-0000-0000000000a7', 'c0000000-0000-0000-0000-0000000000a7', '2026-10-07', 'planned');
insert into day_roster (day_id, hire_id, attendance, next_day, next_action) values
 ('f0000000-0000-0000-0000-0000000000a7', 'e0000000-0000-0000-0000-0000000000c1', 'showed', '2026-10-09', null),
 ('f0000000-0000-0000-0000-0000000000a7', 'e0000000-0000-0000-0000-0000000000c2', 'showed', null, 'WDR'),
 ('f0000000-0000-0000-0000-0000000000a7', 'e0000000-0000-0000-0000-0000000000c3', 'showed', null, 'Q'),
 ('f0000000-0000-0000-0000-0000000000a7', 'e0000000-0000-0000-0000-0000000000c4', 'no_show', '2026-10-08', 'book');
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000a7');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000a7', 'rolla', 'Roll A');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000a7', 'workerbook');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000a7', 'c0000000-0000-0000-0000-0000000000a7');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a7', true);
select 'apply' k, app_apply_next_days('f0000000-0000-0000-0000-0000000000a7');
select 'apply again (idempotent)' k, app_apply_next_days('f0000000-0000-0000-0000-0000000000a7');
reset role;
select 'statuses' k, string_agg(cn || ':' || status || ':' || coalesce(status_since::text, ''), ' ' order by cn) from hires where center_id = 'c0000000-0000-0000-0000-0000000000a7';
select 'bookings' k, string_agg(h.cn || '@' || d.day, ' ' order by h.cn) from day_roster r join days d on d.id = r.day_id join hires h on h.id = r.hire_id
 where d.center_id = 'c0000000-0000-0000-0000-0000000000a7' and d.day > '2026-10-07';
rollback;
