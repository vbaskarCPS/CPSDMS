-- Payslips: save day lines, gaps from the archive, generate (no double-paying a day), a Generated
-- payslip takes a fixed day, mark paid (then locked), void frees lines.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id)
values ('c0000000-0000-0000-0000-0000000000f1', 'pay-test', 'test-only', 'Pay test', 'wb', 'mb');
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f9');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000f9', 'payer', 'Pay Er');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000f9', 'workerbook');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000f9', 'c0000000-0000-0000-0000-0000000000f1');
insert into archive.session_rows (day, center_id, source_table, row_data) values
  ('2026-10-06', 'c0000000-0000-0000-0000-0000000000f1', 'logsheet_sessions', '{"id":"a1"}'),
  ('2026-10-06', 'c0000000-0000-0000-0000-0000000000f1', 'daily_sessions', '{"season_type":"sealing"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f9', true);
select 'gaps' k, string_agg(day::text || ':' || carts, ' ') from app_payout_line_gaps('c0000000-0000-0000-0000-0000000000f1');
select 'archived' k, (a->'daily_session'->>'season_type') season, jsonb_array_length(a->'sessions') sessions
  from (select app_archived_day('c0000000-0000-0000-0000-0000000000f1', '2026-10-06') a) x;
select 'save 6th' k, app_save_payout_lines('c0000000-0000-0000-0000-0000000000f1', '2026-10-06',
  '[{"cn":"t1","first_name":"Ann","last_name":"A","steps":3,"equiv":12,"payout_rate":10,"aer_comm":120,"total_payout":130,"daily_bonus":10},
    {"cn":"T2","first_name":"Bob","last_name":"B","total_payout":80}]');
select 'save 7th' k, app_save_payout_lines('c0000000-0000-0000-0000-0000000000f1', '2026-10-07', '[{"cn":"T1","first_name":"Ann","last_name":"A","total_payout":100}]');
select 'resave 7th' k, app_save_payout_lines('c0000000-0000-0000-0000-0000000000f1', '2026-10-07', '[{"cn":"T1","first_name":"Ann","last_name":"A","total_payout":110}]');
select 'gaps after' k, count(*) from app_payout_line_gaps('c0000000-0000-0000-0000-0000000000f1');
select 'lines' k, day, cn, total_payout from payout_lines where center_id = 'c0000000-0000-0000-0000-0000000000f1' order by day, cn;

-- generate Ann's slip from both days
select 'gen' k, app_generate_payslips('c0000000-0000-0000-0000-0000000000f1', '2026-10-06', '2026-10-07', 'sealing', '{}',
  jsonb_build_array(jsonb_build_object('cn','T1','first_name','Ann','last_name','A','batch','Batch 1','settings','{"hotels":0}'::jsonb,'days','[]'::jsonb,
    'line_ids', (select jsonb_agg(id) from payout_lines where cn = 'T1' and center_id = 'c0000000-0000-0000-0000-0000000000f1'), 'earned', 240, 'final_pay', 240))) is not null ok;
do $$ begin
  perform app_generate_payslips('c0000000-0000-0000-0000-0000000000f1', '2026-10-06', '2026-10-07', 'sealing', '{}',
    jsonb_build_array(jsonb_build_object('cn','T1','line_ids', (select jsonb_agg(id) from payout_lines where cn = 'T1'), 'earned', 240, 'final_pay', 240)));
  raise notice 'FAIL double payslip';
exception when others then raise notice 'ok no double: %', sqlerrm; end $$;
-- a day on a Generated payslip can still be fixed: the payslip takes the new numbers (RUN_23)
select 'fix 7th' k, app_save_payout_lines('c0000000-0000-0000-0000-0000000000f1', '2026-10-07', '[{"cn":"T1","first_name":"Ann","last_name":"A","total_payout":120}]');
select 'slip after fix' k, earned, jsonb_array_length(days) days, updated_at is not null edited from payslips where cn = 'T1';
select 'paid' k, app_payslips_mark_paid(array(select id from payslips where cn = 'T1'));
do $$ begin perform app_save_payout_lines('c0000000-0000-0000-0000-0000000000f1', '2026-10-07', '[]'); raise notice 'FAIL rebuilt a paid-out day';
  exception when others then raise notice 'ok paid day locked: %', sqlerrm; end $$;
do $$ begin perform app_payslip_update((select id from payslips where cn = 'T1'), '{}', null, array(select id from payout_lines where cn = 'T1')); raise notice 'FAIL edited a paid payslip';
  exception when others then raise notice 'ok paid payslip locked: %', sqlerrm; end $$;
do $$ begin perform app_payslip_void((select id from payslips where cn = 'T1')); raise notice 'FAIL voided paid';
  exception when others then raise notice 'ok paid not voidable: %', sqlerrm; end $$;
reset role;
select 'slip' k, status, paid_by is not null by_set, earned, final_pay, batch from payslips where cn = 'T1';
-- void path on a second slip
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f9', true);
select 'gen bob' k, app_generate_payslips('c0000000-0000-0000-0000-0000000000f1', '2026-10-06', '2026-10-06', 'sealing', '{}',
  jsonb_build_array(jsonb_build_object('cn','T2','line_ids', (select jsonb_agg(id) from payout_lines where cn = 'T2'), 'earned', 80, 'final_pay', 80))) is not null ok;
select app_payslip_void((select id from payslips where cn = 'T2'));
reset role;
select 'bob line freed' k, payslip_id is null freed from payout_lines where cn = 'T2';
-- someone without access sees nothing
set local role anon;
do $$ begin perform 1 from payslips; raise notice 'FAIL anon read'; exception when others then raise notice 'ok anon blocked: %', sqlerrm; end $$;
reset role;
rollback;
