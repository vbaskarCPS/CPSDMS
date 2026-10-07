-- One-off (run once, by hand, after migration 20261007300000_session_archive.sql):
-- close the Oct 6, 2026 session at "Sealing RTs" so Oct 7 can start, keeping a copy.
--
-- 1. Copies the day into archive.session_rows: the session, 14 logsheets, 38 routes,
--    25 sales, the route split, 27 past-customer rows, and the 21 session users.
--    Never copied: user passwords and the card number / expiry / CVC fields on sales.
-- 2. Clears the day exactly like the old app's own reset (adminResetDailySession), which
--    the old app needs before the next day can start: it holds one day at a time, and
--    otherwise Oct 6 workers, managers and sales would show up inside Oct 7.
--    Kept in place, as the old app's reset keeps them: door-knock results
--    (house_dispositions) and map pins, which carry over between days by design.
--
-- All or nothing: it stops (and changes nothing) unless the counts match.
begin;

create temporary table oct6 on commit drop as
  select ds.command_center_id as cc
    from public.daily_sessions ds
    join public.command_centers c on c.id = ds.command_center_id
   where ds.date = '2026-10-06' and c.display_name = 'Sealing RTs';

do $$
declare n_sess int; n_all_sess int; n_sheets int; n_tx int; n_tx_other int; n_users int;
begin
  select count(*) into n_sess from oct6;
  select count(*) into n_all_sess from public.daily_sessions where command_center_id in (select cc from oct6);
  select count(*) into n_sheets from public.logsheet_sessions where date = '2026-10-06' and command_center_id in (select cc from oct6);
  select count(*) into n_tx from public.transactions where command_center_id in (select cc from oct6);
  select count(*) into n_tx_other from public.transactions where command_center_id in (select cc from oct6)
     and (session_id is null or session_id not in (select id from public.logsheet_sessions where date = '2026-10-06'));
  select count(*) into n_users from public.users where role in ('Worker', 'RouteManager') and command_center_id in (select cc from oct6);
  if n_sess <> 1 or n_all_sess <> 1 or n_sheets <> 14 or n_tx <> 25 or n_tx_other <> 0 or n_users <> 21 then
    raise exception 'Stopped: expected 1 session (only one at the center), 14 logsheets, 25 sales all from Oct 6, 21 users; found %, %, %, %, % not from Oct 6, %',
      n_sess, n_all_sess, n_sheets, n_tx, n_tx_other, n_users;
  end if;
end $$;

-- 1. Keep a copy
insert into archive.session_rows (day, center_id, source_table, row_data)
select '2026-10-06', o.cc, x.t, x.r from oct6 o, lateral (
  select 'daily_sessions' t, to_jsonb(d) r from public.daily_sessions d where d.date = '2026-10-06' and d.command_center_id = o.cc
  union all select 'logsheet_sessions', to_jsonb(l) from public.logsheet_sessions l where l.date = '2026-10-06' and l.command_center_id = o.cc
  union all select 'routes', to_jsonb(r) from public.routes r where r.session_date = '2026-10-06' and r.command_center_id = o.cc
  union all select 'bookings', to_jsonb(b) from public.bookings b where b.session_date = '2026-10-06' and b.command_center_id = o.cc
  union all select 'transactions', to_jsonb(t) - 'cc_full_number' - 'cc_expiry' - 'cc_cvc' from public.transactions t where t.command_center_id = o.cc
  union all select 'route_splits', to_jsonb(s) from public.route_splits s where s.command_center_id = o.cc::text
  union all select 'route_historical_properties', to_jsonb(h) from public.route_historical_properties h where h.command_center_id = o.cc
  union all select 'pending_sales', to_jsonb(p) from public.pending_sales p where p.command_center_id::text = o.cc::text
  union all select 'users', to_jsonb(u) - 'password' from public.users u where u.role in ('Worker', 'RouteManager') and u.command_center_id = o.cc
) x;

-- 2. Clear the day (same steps as the old app's reset)
delete from public.geocode_cache               where command_center_id in (select cc from oct6);
delete from public.route_historical_properties where command_center_id in (select cc from oct6);
delete from public.pending_sales               where command_center_id::text in (select cc::text from oct6);
delete from public.route_splits                where command_center_id in (select cc::text from oct6);
delete from public.transactions                where command_center_id in (select cc from oct6);
delete from public.logsheet_sessions           where date = '2026-10-06' and command_center_id in (select cc from oct6);
delete from public.routes                      where session_date = '2026-10-06' and command_center_id in (select cc from oct6);
delete from public.bookings                    where session_date = '2026-10-06' and command_center_id in (select cc from oct6);
delete from public.daily_sessions              where date = '2026-10-06' and command_center_id in (select cc from oct6);
delete from public.users                       where role in ('Worker', 'RouteManager') and command_center_id in (select cc from oct6);

select (select json_object_agg(source_table, n) from (select source_table, count(*) n from archive.session_rows
          where day = '2026-10-06' group by 1) a)                                          as copied,
       (select count(*) from public.daily_sessions where date = '2026-10-06')              as sessions_left,
       (select count(*) from public.transactions)                                          as sales_left,
       (select count(*) from public.house_dispositions)                                    as door_knocks_kept;

commit;
