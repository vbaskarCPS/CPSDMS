-- Account settings: worker PIN sign-in, lockout, worker contact edits, PIN reset, manager contact.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id) values ('c0000000-0000-0000-0000-000000000001', 'acct-test', 'test-only', 'Acct test', 'wb', 'mb');
insert into people (id, first_name, last_name, cell_phone) values ('d0000000-0000-0000-0000-000000000001', 'Lindsay', 'Welsh', '905-555-0101');
insert into hires (id, person_id, center_id, year, cn) values ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 2026, 'T1001');
insert into users (user_id, role, name, password, metadata, command_center_id) values
  ('T1001', 'Worker', 'Lindsay Welsh', 'Lindsay', '{"phone":"905-555-0101"}', 'c0000000-0000-0000-0000-000000000001'),
  ('rm_testmanager', 'RouteManager', 'Test Manager', 'x', '{"phone":"1"}', 'c0000000-0000-0000-0000-000000000001');

create temporary table r (k text, v text);
grant all on r to anon, authenticated;
set local role anon;
-- first name works until a PIN is set
insert into r select 'login_first', (legacy_login_worker('t1001', 'lindsay') ->> 'user_id');
insert into r select 'login_wrong', coalesce(legacy_login_worker('T1001', 'nope') ->> 'user_id', 'null');
insert into r select 'acct_wrong', app_worker_account('T1001', 'c0000000-0000-0000-0000-000000000001', 'nope') ->> 'reason';
insert into r select 'acct_ok', app_worker_account('T1001', 'c0000000-0000-0000-0000-000000000001', 'Lindsay') ->> 'has_pin';
insert into r select 'save_badphone', app_worker_save_account('T1001', 'c0000000-0000-0000-0000-000000000001', 'Lindsay', '555', null, null) ->> 'reason';
insert into r select 'save_ok', app_worker_save_account('T1001', 'c0000000-0000-0000-0000-000000000001', 'Lindsay', '416-555-0199', '', 'Lin@Example.com') ->> 'ok';
insert into r select 'pin_bad', app_worker_set_pin('T1001', 'c0000000-0000-0000-0000-000000000001', 'Lindsay', '12a4') ->> 'reason';
insert into r select 'pin_ok', app_worker_set_pin('T1001', 'c0000000-0000-0000-0000-000000000001', 'Lindsay', '4821') ->> 'ok';
-- now the PIN, not the first name
insert into r select 'login_first_after', coalesce(legacy_login_worker('T1001', 'Lindsay') ->> 'user_id', 'null');
insert into r select 'login_pin', legacy_login_worker('T1001', '4821') ->> 'user_id';
insert into r select 'login_pin_nopassword', (legacy_login_worker('T1001', '4821') ? 'password')::text;
-- five wrong PINs lock it, even the right one
insert into r select 'wrong' || g, coalesce(legacy_login_worker('T1001', '0000') ->> 'user_id', 'null') from generate_series(1, 5) g;
insert into r select 'locked_right_pin', coalesce(legacy_login_worker('T1001', '4821') ->> 'user_id', 'null');
insert into r select 'acct_locked', app_worker_account('T1001', 'c0000000-0000-0000-0000-000000000001', '4821') ->> 'reason';
reset role;

select k, v from r order by k;

-- stored values
select 'people' k, cell_phone, alt_phone, email from people where id = 'd0000000-0000-0000-0000-000000000001';
select 'legacy phone' k, metadata->>'phone' from users where user_id = 'T1001';
select 'pin hash readable as text?' k, pin_hash like '$2%' bcrypt, pin_failed, pin_locked_until > now() locked from hires where id = 'e0000000-0000-0000-0000-000000000001';

-- anon can't call the internals or staff reset
set local role anon;
do $$ begin
  begin perform app_reset_worker_pin('e0000000-0000-0000-0000-000000000001'); raise notice 'FAIL anon reset allowed';
  exception when insufficient_privilege then raise notice 'ok anon reset blocked'; end;
  begin perform app_worker_hire_for('T1001', 'c0000000-0000-0000-0000-000000000001'); raise notice 'FAIL anon helper allowed';
  exception when insufficient_privilege then raise notice 'ok anon helper blocked'; end;
end $$;
reset role;

-- staff reset (workerbook perm) puts first name back; manager updates own contact
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000b1');
insert into app_users (id, username, full_name, is_super_admin, rm_center_id) values ('a0000000-0000-0000-0000-0000000000b1', 'mante', 'Test Manager', false, 'c0000000-0000-0000-0000-000000000001');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000b1', 'workerbook');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000b1', true);
select app_reset_worker_pin('e0000000-0000-0000-0000-000000000001');
select 'after reset, first name' k, legacy_login_worker('T1001', 'Lindsay') ->> 'user_id' v;
select app_update_my_contact(' 905 555 0123 ', 'Me@Example.com');
do $$ begin
  begin perform app_update_my_contact('12', null); raise notice 'FAIL bad phone accepted';
  exception when others then raise notice 'ok bad phone: %', sqlerrm; end;
end $$;
reset role;
select 'manager' k, phone, email from app_users where id = 'a0000000-0000-0000-0000-0000000000b1';
select 'manager legacy phone' k, metadata->>'phone' from users where user_id = 'rm_testmanager';
rollback;
