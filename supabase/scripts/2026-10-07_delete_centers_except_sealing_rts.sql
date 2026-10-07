-- One-off (run once, by hand): permanently delete every command center except "Sealing RTs",
-- with every row that belongs to them. Requested by Vijay on 2026-10-07 after being told it
-- removes Ottawa, Hamilton, Calgary, Toronto, Coquitlam and Edmonton and their history
-- (about 1,506 contractors, 3,904 shuttle rows, 1,591 training records). Cannot be undone.
--
-- All or nothing: if anything fails, nothing is deleted. It refuses to run unless it finds
-- exactly one "Sealing RTs" to keep and exactly six other centers.
begin;

create temporary table doomed on commit drop as
  select id, id::text as tid, display_name from public.command_centers
   where not (display_name = 'Sealing RTs' and username = 'bcimport');

do $$
declare n_keep int; n_doomed int;
begin
  select count(*) into n_keep from public.command_centers where display_name = 'Sealing RTs' and username = 'bcimport';
  select count(*) into n_doomed from doomed;
  if n_keep <> 1 or n_doomed <> 6 then
    raise exception 'Stopped: expected 1 center to keep and 6 to delete, found % and %', n_keep, n_doomed;
  end if;
end $$;

-- Tables that point at a center without a cascading link (text ids, or links that block the delete).
delete from public.contractors                where command_center_id in (select tid from doomed);
delete from public.training_progress          where command_center_id in (select tid from doomed);
delete from public.training_attempts          where command_center_id in (select tid from doomed);
delete from public.workerbook_confirmations   where command_center_id in (select tid from doomed);
delete from public.workerbook_na_counts       where command_center_id in (select id from doomed);
delete from public.shuttle_day_roster         where command_center_id in (select id from doomed);
delete from public.shuttle_points             where command_center_id in (select id from doomed);
delete from public.onboarding_config          where command_center_id in (select id from doomed);
delete from public.geocode_cache              where command_center_id in (select id from doomed);
delete from public.manager_locations          where command_center_id in (select id from doomed);
delete from public.route_historical_properties where command_center_id in (select id from doomed);
delete from public.pending_sales              where command_center_id in (select id from doomed);
delete from public.pcl_error_log              where command_center_id in (select id from doomed);
delete from public.house_dispositions         where command_center_id in (select tid from doomed);
delete from public.map_pins                   where command_center_id in (select tid from doomed);
delete from public.pcl_cache                  where command_center_id in (select tid from doomed);
delete from public.pcl_geocode_cache          where command_center_id in (select tid from doomed);
delete from public.route_splits               where command_center_id in (select tid from doomed);
delete from public.worker_pcl_templates       where command_center_id in (select tid from doomed);

-- The centers themselves. Everything linked with "on delete cascade" goes with them
-- (users, sessions, logsheets, transactions, bookings, routes, job fairs, email templates,
-- seasons, manager-center links); app_users.rm_center_id is cleared.
delete from public.command_centers where id in (select id from doomed);

select (select count(*) from public.command_centers) as centers_left,
       (select string_agg(display_name, ', ') from public.command_centers) as kept;

commit;
