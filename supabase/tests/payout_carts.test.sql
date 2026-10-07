-- Editable payouts: save carts + sales + lines together; replaced on save; locked by a generated
-- payslip (unlocked when it's voided); no card numbers in notes; read needs Workerbook. Rolled back.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id)
values ('c0000000-0000-0000-0000-0000000000c1', 'cart-test', 'test-only', 'Cart test', 'wb', 'mb');
insert into people (id, first_name, last_name) values ('d0000000-0000-0000-0000-0000000000a1', 'Ann', 'Lee');
insert into hires (id, person_id, center_id, year, cn) values ('e0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1', 2026, 'I2004');
insert into days (center_id, day, state) values ('c0000000-0000-0000-0000-0000000000c1', '2026-10-02', 'closed'), ('c0000000-0000-0000-0000-0000000000c1', '2026-10-03', 'planned');
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c9'), ('a0000000-0000-0000-0000-0000000000ca');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000c9', 'carta', 'Cart Admin'), ('a0000000-0000-0000-0000-0000000000ca', 'cartb', 'No Perm');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'workerbook'), ('a0000000-0000-0000-0000-0000000000ca', 'route_manager');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000c9', 'c0000000-0000-0000-0000-0000000000c1'), ('a0000000-0000-0000-0000-0000000000ca', 'c0000000-0000-0000-0000-0000000000c1');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
select 'save' k, app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-02',
  '[{"label": "Cart 1", "manager": "Cheryl Merrick", "members": [{"cn": "I2004", "equiv_split": 100, "upsell_split": 100, "machine_rental": 10, "deductions": 0}],
     "settings": {"taxRate": 13}, "sales": [{"route_code": "ORC09", "address": "1 Main St", "client_name": "A Client", "price": 226, "payment_type": "Credit Card", "service": "SS"},
                                          {"route_code": "ORC09", "price": 150, "payment_type": "Cash", "payments": {"Cash": 100, "E-Transfer": 50}}]}]',
  '[{"cn": "I2004", "first_name": "Ann", "last_name": "Lee", "equiv": 13, "total_payout": 68, "stats": {"assignedEQ": 13}}]') n;
select 'carts' k, count(*) from payout_carts;
select 'sales' k, count(*), sum(price), max(payments::text) from payout_sales;
-- save again with one sale: replaced
select 'save again' k, app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-02',
  '[{"label": "Cart 1", "members": [], "sales": [{"price": 200, "payment_type": "Cash"}]}]', '[]') n;
select 'after' k, (select count(*) from payout_carts) carts, (select count(*) from payout_sales) sales, (select count(*) from payout_lines) lines;
do $$ begin perform app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-02', '[{"sales": [{"price": 1, "notes": "card 4111 1111 1111 1111"}]}]', '[]'); raise notice 'FAIL card number stored';
  exception when others then raise notice 'ok card: %', sqlerrm; end $$;
do $$ begin perform app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-03', '[]', '[]'); raise notice 'FAIL planned day saved';
  exception when others then raise notice 'ok planned: %', sqlerrm; end $$;
do $$ begin insert into payout_sales (cart_id, center_id, day, price) select id, center_id, day, 1 from payout_carts limit 1; raise notice 'FAIL direct write';
  exception when others then raise notice 'ok direct write: %', sqlerrm; end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ca', true);
select 'no perm sees' k, (select count(*) from payout_carts) carts, (select count(*) from payout_sales) sales;
do $$ begin perform app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-02', '[]', '[]'); raise notice 'FAIL no-perm saved';
  exception when others then raise notice 'ok no-perm: %', sqlerrm; end $$;
reset role;
-- generated payslip locks the day; void unlocks
insert into payout_lines (center_id, day, cn) values ('c0000000-0000-0000-0000-0000000000c1', '2026-10-02', 'I2004');
insert into payslip_runs (id, center_id, start_day, end_day, season) values ('f0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000c1', '2026-10-01', '2026-10-05', 'sealing');
insert into payslips (id, run_id, center_id, cn) values ('f0000000-0000-0000-0000-0000000000f2', 'f0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000c1', 'I2004');
update payout_lines set payslip_id = 'f0000000-0000-0000-0000-0000000000f2';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
do $$ begin perform app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-02', '[]', '[]'); raise notice 'FAIL locked day saved';
  exception when others then raise notice 'ok locked: %', sqlerrm; end $$;
reset role;
update payslips set status = 'void';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
select 'after void' k, app_save_payout_day('c0000000-0000-0000-0000-0000000000c1', '2026-10-02', '[]', '[]') n;
rollback;
