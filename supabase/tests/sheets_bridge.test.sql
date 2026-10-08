-- The Google Sheets bridge: the saved copy keeps each sale's card only as the sheet shows it
-- (last 4), the day's sheet info and sends are Workerbook-only, a send is recorded, and only
-- Super Admin › Users sets a center's sheet from its link. In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type)
values ('c0000000-0000-0000-0000-0000000000c1', 'sb-test', 'test-only', 'Sheets test', 'wb', '', 'road_trip'),
       ('c0000000-0000-0000-0000-0000000000c2', 'sb-other', 'test-only', 'Other center', 'wb', 'mb-other', 'road_trip');
insert into days (id, center_id, day, state) values ('f0000000-0000-0000-0000-0000000000d6', 'c0000000-0000-0000-0000-0000000000c1', '2026-10-06', 'live');
insert into daily_sessions (date, command_center_id, is_active, season_type) values ('2026-10-06', 'c0000000-0000-0000-0000-0000000000c1', true, 'sealing');
insert into users (user_id, role, name, password, metadata, command_center_id) values ('I2004', 'Worker', 'Ann Lee', 'x', '{}', 'c0000000-0000-0000-0000-0000000000c1');
insert into logsheet_sessions (id, worker_id, date, command_center_id, status, stats) values
  ('ls1', 'I2004', '2026-10-06', 'c0000000-0000-0000-0000-0000000000c1', 'PAID', '{}');
insert into transactions (id, worker_id, command_center_id, session_id, price, payment_method, cc_full_number, cc_expiry, cc_cvc) values
  ('raw', 'I2004', 'c0000000-0000-0000-0000-0000000000c1', 'ls1', 226, 'Credit Card', '4111 1111 1111 1234', '12/29', '123'),
  ('bam', 'I2004', 'c0000000-0000-0000-0000-0000000000c1', 'ls1', 203, 'Credit Card', 'BAMBORA-998877', 'AUTH42', '4321'),
  ('msk', 'I2004', 'c0000000-0000-0000-0000-0000000000c1', 'ls1', 150, 'Credit Card', 'CARD-••••5678', null, null),
  ('etf', 'I2004', 'c0000000-0000-0000-0000-0000000000c1', 'ls1', 169, 'E-Transfer', null, null, null);
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c9'), ('a0000000-0000-0000-0000-0000000000ca'), ('a0000000-0000-0000-0000-0000000000cb');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000c9', 'sheta', 'Sheet Admin'),
  ('a0000000-0000-0000-0000-0000000000ca', 'shetb', 'No Perm'), ('a0000000-0000-0000-0000-0000000000cb', 'shetc', 'Book Keeper');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'workerbook'), ('a0000000-0000-0000-0000-0000000000c9', 'sa_users'),
  ('a0000000-0000-0000-0000-0000000000ca', 'route_manager'), ('a0000000-0000-0000-0000-0000000000cb', 'workerbook');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000c9', 'c0000000-0000-0000-0000-0000000000c1'),
  ('a0000000-0000-0000-0000-0000000000ca', 'c0000000-0000-0000-0000-0000000000c1'), ('a0000000-0000-0000-0000-0000000000cb', 'c0000000-0000-0000-0000-0000000000c1');

-- the saved copy: no card fields, only the masked last 4
select 'archived' k, app_archive_clear_session('c0000000-0000-0000-0000-0000000000c1', '2026-10-06') > 0 ok;
select 'card' k, row_data->>'id' id, row_data->>'card_masked' card_masked,
       row_data ? 'cc_full_number' has_number, row_data ? 'cc_expiry' has_expiry, row_data ? 'cc_cvc' has_cvc
  from archive.session_rows where source_table = 'transactions' and center_id = 'c0000000-0000-0000-0000-0000000000c1' order by 2;
select 'no long digit runs' k, count(*) from archive.session_rows
 where center_id = 'c0000000-0000-0000-0000-0000000000c1' and row_data::text ~ '\d{5,}' and source_table = 'transactions'
   and row_data::text ~ '1111|998877';

set local role authenticated;
-- no Workerbook permission: nothing
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ca', true);
do $$ begin perform app_day_sheet_info('c0000000-0000-0000-0000-0000000000c1', '2026-10-06'); raise notice 'FAIL no-perm info';
  exception when others then raise notice 'ok no-perm info: %', sqlerrm; end $$;
do $$ begin perform app_record_day_sheet_send('c0000000-0000-0000-0000-0000000000c1', '2026-10-06', 1, 1); raise notice 'FAIL no-perm send';
  exception when others then raise notice 'ok no-perm send: %', sqlerrm; end $$;
do $$ begin perform count(*) from day_sheet_sends; raise notice 'FAIL sends readable';
  exception when others then raise notice 'ok sends hidden: %', sqlerrm; end $$;
-- Workerbook at this center, but not the other one
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000cb', true);
do $$ begin perform app_day_sheet_info('c0000000-0000-0000-0000-0000000000c2', '2026-10-06'); raise notice 'FAIL other center';
  exception when others then raise notice 'ok other center: %', sqlerrm; end $$;
select 'info before sheet' k, app_day_sheet_info('c0000000-0000-0000-0000-0000000000c1', '2026-10-06') info;
do $$ begin perform app_record_day_sheet_send('c0000000-0000-0000-0000-0000000000c1', '2026-10-06', 3, 3); raise notice 'FAIL sent with no sheet';
  exception when others then raise notice 'ok no sheet: %', sqlerrm; end $$;
do $$ begin perform app_set_center_sheet('c0000000-0000-0000-0000-0000000000c1', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/edit'); raise notice 'FAIL workerbook set sheet';
  exception when others then raise notice 'ok only admins set the sheet: %', sqlerrm; end $$;
-- Super Admin › Users sets it from a link
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
do $$ begin perform app_set_center_sheet('c0000000-0000-0000-0000-0000000000c1', 'not a link'); raise notice 'FAIL bad link';
  exception when others then raise notice 'ok bad link: %', sqlerrm; end $$;
select 'set sheet' k, app_set_center_sheet('c0000000-0000-0000-0000-0000000000c1', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab/edit#gid=0') sheet;
select 'send' k, app_record_day_sheet_send('c0000000-0000-0000-0000-0000000000c1', '2026-10-06', 3, 3);
select 'send again' k, app_record_day_sheet_send('c0000000-0000-0000-0000-0000000000c1', '2026-10-06', 3, -2);
select 'info after' k, i->>'sheet_id' sheet, i->>'saved' saved, jsonb_array_length(i->'sends') sends,
       i->'sends'->0->>'by' latest_by, i->'sends'->0->>'accounts' latest_accounts, i->'sends'->1->>'logsheets' first_logsheets
  from (select app_day_sheet_info('c0000000-0000-0000-0000-0000000000c1', '2026-10-06') i) x;
select 'other day' k, app_day_sheet_info('c0000000-0000-0000-0000-0000000000c1', '2026-10-05')->>'saved' saved;
reset role;
select 'audit' k, count(*) from audit_log where entity = 'command_centers' and entity_id = 'c0000000-0000-0000-0000-0000000000c1';
rollback;
