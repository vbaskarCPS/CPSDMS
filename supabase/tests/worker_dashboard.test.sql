-- Worker dashboard (RUN_23): sign in any time against this year's contractor list (not Quit/Fired),
-- passes, the worker's payslips and account, editing a Generated payslip, fixing a day on one,
-- and paid = locked. Rolled back.
\set ON_ERROR_STOP 1
begin;
-- a Workerbook manager at the center (the payslip side); the worker side needs no account
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000d9');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000d9', 'payer2', 'Pay Er');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000d9', 'workerbook');

insert into command_centers (id, display_name, username, password, masterbookings_sheet_id, workerbook_sheet_id, region, services)
values ('11111111-1111-1111-1111-111111111111', 'Sealing RTs', 'wd-test', 'test-only', 'wb', 'mb', 'East', '{sealing}');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000d9', '11111111-1111-1111-1111-111111111111');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000d9', true);
insert into people (id, first_name, last_name) values
  ('22222222-0000-0000-0000-000000000001', 'Ann', 'Lee'), ('22222222-0000-0000-0000-000000000002', 'Bo', 'Ng'),
  ('22222222-0000-0000-0000-000000000003', 'Cy', 'Po');
insert into hires (id, person_id, center_id, year, cn, status) values
  ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', worker_this_year(), 'I1001', 'active'),
  ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', worker_this_year(), 'I1002', 'Q'),
  ('33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', worker_this_year() - 1, 'I1003', 'active');

do $$
declare r jsonb; tok text; slip uuid; run uuid; l1 uuid; l2 uuid; l3 uuid; c uuid := '11111111-1111-1111-1111-111111111111'; y int := worker_this_year();
begin
  -- ── signing in ──
  assert app_worker_sign_in('i1001', 'ann')->>'ok' = 'true', 'first name, any case';
  assert app_worker_sign_in('I1002', 'Bo')->>'reason' = 'left', 'quit can''t sign in';
  assert app_worker_sign_in('I1003', 'Cy')->>'reason' = 'not_found', 'last year''s hire can''t sign in';
  r := app_worker_sign_in('I1001', 'nope');
  assert r->>'reason' = 'wrong' and not (r->>'has_pin')::boolean, 'wrong, no PIN: ' || r::text;
  for i in 1..6 loop perform app_worker_sign_in('I1001', 'nope'); end loop;
  assert app_worker_sign_in('I1001', 'Ann')->>'ok' = 'true', 'wrong first names don''t lock (today''s sign-in still works)';
  -- the first name today's session was loaded with also works until there's a PIN
  insert into users (user_id, name, role, password, command_center_id) values ('I1001', 'Annie Lee', 'Worker', 'Annie', '11111111-1111-1111-1111-111111111111');
  assert app_worker_sign_in('I1001', 'annie')->>'ok' = 'true', 'session first name';
  r := app_worker_sign_in('I1001', 'Ann');
  tok := r->>'token';
  assert length(tok) = 64 and r->'worker'->>'center_name' = 'Sealing RTs' and r->'worker'->>'first_name' = 'Ann', 'pass: ' || r::text;
  assert not exists (select 1 from worker_passes where token_hash = tok), 'raw token never stored';
  assert app_worker_me(tok)->>'ok' = 'true' and app_worker_me(tok)->'today' = 'null'::jsonb, 'me, no session';
  assert app_worker_me('garbage')->>'reason' = 'signed_out', 'bad pass';

  -- ── PIN through the pass ──
  assert app_worker_pass_set_pin(tok, 'wrong', '1234')->>'reason' = 'wrong', 'pin needs the current secret';
  assert app_worker_pass_set_pin(tok, 'Ann', '12')->>'reason' = 'bad_pin', 'pin length';
  assert app_worker_pass_set_pin(tok, 'Ann', '4321')->>'ok' = 'true', 'pin set';
  assert app_worker_sign_in('I1001', 'Ann')->>'reason' = 'wrong', 'first name stops once a PIN exists';
  assert app_worker_sign_in('I1001', '4321')->>'ok' = 'true', 'pin works';
  -- the pass used to make the PIN still works; another phone's pass (taken with the first name) doesn't
  assert app_worker_me(tok)->>'ok' = 'true', 'own pass kept';
  r := app_worker_sign_in('I1001', '4321');
  assert app_worker_me(r->>'token')->>'ok' = 'true';
  -- five wrong PINs lock it, even the right PIN, for 15 minutes
  for i in 1..5 loop perform app_worker_sign_in('I1001', '0000'); end loop;
  assert app_worker_sign_in('I1001', '4321')->>'reason' = 'locked', 'locked after 5 PINs';
  update hires set pin_locked_until = null, pin_failed = 0 where cn = 'I1001';
  -- a manager clearing the PIN signs every phone out
  perform app_reset_worker_pin('33333333-0000-0000-0000-000000000001');
  assert app_worker_me(tok)->>'reason' = 'signed_out' and app_worker_me(r->>'token')->>'reason' = 'signed_out', 'reset ends passes';
  perform app_worker_sign_in('I1001', 'Ann');
  tok := app_worker_sign_in('I1001', 'Ann')->>'token';
  perform app_worker_pass_set_pin(tok, 'Ann', '4321');
  delete from users where user_id = 'I1001';
  assert app_worker_pass_save_account(tok, '905-555-0101', '', 'ann@x.ca')->>'ok' = 'true';
  assert app_worker_pass_account(tok)->>'email' = 'ann@x.ca' and (app_worker_pass_account(tok)->>'has_pin')::boolean, 'account';

  -- ── a payslip from three day lines ──
  insert into payout_lines (id, center_id, day, cn, hire_id, first_name, last_name, manager, steps, equiv, total_payout, daily_bonus) values
    (gen_random_uuid(), c, make_date(y, 10, 1), 'I1001', '33333333-0000-0000-0000-000000000001', 'Ann', 'Lee', 'Sam', 4, 1.5, 180.25, 0),
    (gen_random_uuid(), c, make_date(y, 10, 2), 'I1001', '33333333-0000-0000-0000-000000000001', 'Ann', 'Lee', 'Sam', 3, 1.0, 95.10, 10),
    (gen_random_uuid(), c, make_date(y, 10, 3), 'I1001', '33333333-0000-0000-0000-000000000001', 'Ann', 'Lee', 'Sam', 5, 2.0, 210.00, 0);
  select id into l1 from payout_lines where day = make_date(y, 10, 1);
  select id into l2 from payout_lines where day = make_date(y, 10, 2);
  select id into l3 from payout_lines where day = make_date(y, 10, 3);
  run := app_generate_payslips(c, make_date(y, 10, 1), make_date(y, 10, 7), 'sealing', '{"hotels":false,"advances":true,"travelPkg":false}',
    jsonb_build_array(jsonb_build_object('cn', 'I1001', 'first_name', 'Ann', 'last_name', 'Lee', 'batch', 'Batch 1',
      'settings', '{"is120Program":false,"hotels":20,"advances":50,"travelPkg":0,"crackfillPct":10,"extraDeductions":[],"additions":[]}',
      'days', '[]', 'line_ids', jsonb_build_array(l1, l2), 'earned', 275.35, 'final_pay', 227.82)));
  select id into slip from payslips where run_id = run;

  -- each day's line, with what its pay was worked out from; nobody else's pass can read it
  update payout_lines set stats = '{"prodCash": 300, "prodPayable": 265.49, "basePayoutRate": 17}' where id = l1;
  r := app_worker_payslip_lines(tok, slip);
  assert jsonb_array_length(r->'lines') = 2 and (r->'lines'->0->'stats'->>'prodCash')::numeric = 300, 'day lines: ' || r::text;
  insert into people (id, first_name) values ('22222222-0000-0000-0000-000000000009', 'Di');
  insert into hires (person_id, center_id, year, cn, status) values ('22222222-0000-0000-0000-000000000009', c, y, 'I1009', 'active');
  assert app_worker_payslip_lines(app_worker_sign_in('I1009', 'Di')->>'token', slip)->>'reason' = 'not_found', 'another worker can''t read it';

  -- the worker sees it
  r := app_worker_payslips(tok);
  assert jsonb_array_length(r->'payslips') = 1 and r->'payslips'->0->>'status' = 'generated', 'worker sees generated: ' || r::text;
  assert jsonb_array_length(app_worker_payslips(app_worker_sign_in('I1001', '4321')->>'token')->'payslips') = 1;

  -- ── edit: add day 3, $120 program off, an addition ──
  r := app_payslip_update(slip, '{"is120Program":false,"hotels":20,"advances":50,"travelPkg":0,"crackfillPct":10,"extraDeductions":[{"id":"1","label":"Vest","amount":15}],"additions":[{"id":"2","label":"Bonus","amount":25}]}', 'Batch 2', array[l1, l2, l3]);
  -- earned 485.35; hotels 20; advances hidden; crackfill 48.54 (485.35*10% = 48.535 → 48.54); vest 15; bonus 25 → 485.35-20-48.54-15+25 = 426.81
  assert (r->>'earned')::numeric = 485.35 and (r->>'final_pay')::numeric = 426.81 and (r->>'days')::int = 3, 'edit totals: ' || r::text;
  assert (select days->2->>'date' from payslips where id = slip) = 'Oct03', 'day label';
  assert (select batch from payslips where id = slip) = 'Batch 2' and (select updated_at from payslips where id = slip) is not null;
  assert (select payslip_id from payout_lines where id = l3) = slip, 'day 3 now on it';
  -- someone else's or out-of-range days are refused
  begin perform app_payslip_update(slip, null, null, array[gen_random_uuid()]); raise exception 'FAIL foreign line';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;

  -- ── fixing day 2 in Payouts while the payslip is Generated ──
  perform app_save_payout_lines(c, make_date(y, 10, 2), '[{"cn":"i1001","first_name":"Ann","last_name":"Lee","manager":"Sam","steps":3,"equiv":1,"total_payout":105.10,"daily_bonus":20}]');
  assert (select earned from payslips where id = slip) = 495.35, 'payslip picked up the fixed day: ' || (select earned from payslips where id = slip);
  assert (select count(*) from payout_lines where payslip_id = slip) = 3, 'fixed day back on the payslip';

  -- $120 program floor: 3 days * 120 = 360 < 495.35 → no bump; check a low earner later

  -- ── paid = locked ──
  perform app_payslips_mark_paid(array[slip]);
  begin perform app_payslip_update(slip, null, null, array[l1]); raise exception 'FAIL edit paid';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform app_save_payout_lines(c, make_date(y, 10, 1), '[]'); raise exception 'FAIL save paid day';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin update payslips set final_pay = 1 where id = slip; raise exception 'FAIL direct update paid';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin delete from payout_lines where id = l1; raise exception 'FAIL delete paid line';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform app_payslip_void(slip); raise exception 'FAIL void paid';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  assert app_worker_payslips(tok)->'payslips'->0->>'status' = 'paid', 'worker sees paid';

  -- a paid payslip can't take more days, and a deleted contractor only clears the link
  begin insert into payout_lines (center_id, day, cn, payslip_id) values (c, make_date(y, 10, 4), 'I1001', slip); raise exception 'FAIL insert onto paid';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  update payout_lines set hire_id = null where payslip_id = slip;
  update payslips set hire_id = null where id = slip;
  update payslips set hire_id = '33333333-0000-0000-0000-000000000001' where id = slip;

  -- ── marked Quit: the pass stops at once, and stays ended if put back ──
  update hires set status = 'Q' where cn = 'I1001';
  assert app_worker_me(tok)->>'reason' = 'signed_out' and app_worker_payslips(tok)->>'reason' = 'signed_out', 'quit kills the pass';
  update hires set status = 'active' where cn = 'I1001';
  assert app_worker_me(tok)->>'reason' = 'signed_out', 'still ended after being put back';
  tok := app_worker_sign_in('I1001', '4321')->>'token';

  -- ── a worker with two carts on a day: re-linking, and the mixed case ──
  insert into payout_lines (id, center_id, day, cn, hire_id, total_payout) values
    (gen_random_uuid(), c, make_date(y, 10, 9), 'I1001', '33333333-0000-0000-0000-000000000001', 60),
    (gen_random_uuid(), c, make_date(y, 10, 9), 'I1001', '33333333-0000-0000-0000-000000000001', 40);
  run := app_generate_payslips(c, make_date(y, 10, 8), make_date(y, 10, 14), 'aeration', '{}',
    jsonb_build_array(jsonb_build_object('cn', 'I1001', 'settings', '{}', 'days', '[]',
      'line_ids', (select jsonb_agg(id) from payout_lines where day = make_date(y, 10, 9)), 'earned', 100, 'final_pay', 100)));
  select id into slip from payslips where run_id = run;
  perform app_save_payout_lines(c, make_date(y, 10, 9), '[{"cn":"I1001","total_payout":60},{"cn":"I1001","total_payout":45}]');
  assert (select earned from payslips where id = slip) = 105 and (select count(*) from payout_lines where payslip_id = slip) = 2, 'both carts back on';
  perform app_payslip_update(slip, null, null, array[(select id from payout_lines where payslip_id = slip and total_payout = 60)]);
  begin perform app_save_payout_lines(c, make_date(y, 10, 9), '[{"cn":"I1001","total_payout":60},{"cn":"I1001","total_payout":45}]'); raise exception 'FAIL mixed day saved';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok mixed refused: %', left(sqlerrm, 90); end;
  -- the worker taken off their only day: that payslip is voided, not left at $0 or less
  perform app_payslip_update(slip, null, null, (select array_agg(id) from payout_lines where day = make_date(y, 10, 9)));
  perform app_save_payout_lines(c, make_date(y, 10, 9), '[]');
  assert (select status from payslips where id = slip) = 'void', 'no days left → void';
  assert (select earned from payslips where id = slip) = 105;
  perform app_worker_sign_out(tok);
  assert app_worker_me(tok)->>'reason' = 'signed_out', 'signed out';

  -- ── a void payslip is hidden from the worker ──
  raise notice 'ALL OK';
end $$;
-- the worker functions are open to signed-out phones; the tables behind them aren't
set local role anon;
do $$ begin perform app_worker_me('x'); raise notice 'ok anon can call the worker functions'; end $$;
do $$ begin perform 1 from worker_passes; raise notice 'FAIL anon read passes'; exception when others then raise notice 'ok passes hidden'; end $$;
do $$ begin perform app_payslip_update(gen_random_uuid(), null, null, null); raise notice 'FAIL anon edited a payslip'; exception when others then raise notice 'ok anon can''t edit payslips'; end $$;
reset role;
rollback;
