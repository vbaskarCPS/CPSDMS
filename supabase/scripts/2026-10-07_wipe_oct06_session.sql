-- One-off (run once, by hand): permanently delete the Oct 6, 2026 session at "Sealing RTs"
-- and everything recorded in it. Requested by Vijay on 2026-10-07 after exporting the day,
-- having been told it holds 25 sales ($4,438.30), 14 logsheets (13 PAID), 38 routes,
-- 1,185 door-knock results, 4 map pins, 1 route split, 27 historical-property rows and
-- 53 geocode-cache rows. Cannot be undone. Contractors, users and the new-app workerbook
-- are not touched.
--
-- All or nothing: it stops (and deletes nothing) unless it finds exactly one Oct 6 session
-- at Sealing RTs, and exactly the counts above.
begin;

create temporary table oct6 on commit drop as
  select ds.command_center_id as cc, ds.command_center_id::text as cct
    from public.daily_sessions ds
    join public.command_centers c on c.id = ds.command_center_id
   where ds.date = '2026-10-06' and c.display_name = 'Sealing RTs';

create temporary table oct6_sheets on commit drop as
  select l.id from public.logsheet_sessions l, oct6
   where l.date = '2026-10-06' and l.command_center_id = oct6.cc;

do $$
declare n_sess int; n_sheets int; n_tx int; n_tx_day int; n_hd int;
begin
  select count(*) into n_sess from oct6;
  select count(*) into n_sheets from oct6_sheets;
  select count(*) into n_tx from public.transactions where session_id in (select id from oct6_sheets);
  select count(*) into n_tx_day from public.transactions t, oct6
   where t.command_center_id = oct6.cc and (t."timestamp" at time zone 'America/Toronto')::date = '2026-10-06';
  select count(*) into n_hd from public.house_dispositions where session_id in (select id from oct6_sheets);
  if n_sess <> 1 or n_sheets <> 14 or n_tx <> 25 or n_tx_day <> 25 or n_hd <> 1185 then
    raise exception 'Stopped: expected 1 session, 14 logsheets, 25 sales, 1185 door knocks; found %, %, % (% dated Oct 6), %',
      n_sess, n_sheets, n_tx, n_tx_day, n_hd;
  end if;
end $$;

-- Rows tied to the day's logsheets
delete from public.transactions        where session_id in (select id from oct6_sheets);
delete from public.house_dispositions  where session_id in (select id from oct6_sheets);

-- Rows tied to the date (no cascading link to the session)
delete from public.map_pins                    where session_date = '2026-10-06' and command_center_id in (select cct from oct6);
delete from public.route_splits                where session_date = '2026-10-06' and command_center_id in (select cct from oct6);
delete from public.route_historical_properties where session_date = '2026-10-06' and command_center_id in (select cc from oct6);
delete from public.geocode_cache               where session_date = '2026-10-06' and command_center_id in (select cc from oct6);
delete from public.pending_sales               where session_date = '2026-10-06' and command_center_id::text in (select cct from oct6);

-- The session itself; routes, logsheets and bookings go with it ("on delete cascade").
delete from public.daily_sessions where date = '2026-10-06' and command_center_id in (select cc from oct6);

select (select count(*) from public.daily_sessions where date = '2026-10-06')       as sessions_left,
       (select count(*) from public.logsheet_sessions where date = '2026-10-06')    as logsheets_left,
       (select count(*) from public.routes where session_date = '2026-10-06')       as routes_left,
       (select count(*) from public.transactions)                                   as sales_left,
       (select count(*) from public.house_dispositions where session_id like '%_1791289519727') as door_knocks_left;

commit;
