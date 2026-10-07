-- Floater Route Manager: the permission can be granted; the live managers list (center, routes, areas,
-- workers, carts, steps, gross) is for floaters only. In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id) values
  ('c0000000-0000-0000-0000-0000000000c1', 'fl-a', 'test-only', 'Alpha CC', 'wb', 'mb'), ('c0000000-0000-0000-0000-0000000000c2', 'fl-b', 'test-only', 'Beta CC', 'wb', 'mb');
insert into daily_sessions (date, command_center_id, is_active, season_type) values
  ('2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', true, 'sealing'), ('2026-10-07', 'c0000000-0000-0000-0000-0000000000c2', true, 'aeration');
insert into users (user_id, role, name, password, metadata, command_center_id) values
  ('rm_annlee', 'RouteManager', 'Ann Lee', 'x', '{"phone": "416-555-0101", "digitalMappings": [{"areaName": "Glen Abbey"}, {"areaName": "Bronte"}]}', 'c0000000-0000-0000-0000-0000000000c1'),
  ('rm_bobkay', 'RouteManager', 'Bob Kay', 'x', '{}', 'c0000000-0000-0000-0000-0000000000c1'),
  ('rm_cyday', 'RouteManager', 'Cy Day', 'x', '{}', 'c0000000-0000-0000-0000-0000000000c2'),
  ('I1001', 'Worker', 'W One', 'x', '{"assignedManagerId": "rm_annlee", "teamId": "1"}', 'c0000000-0000-0000-0000-0000000000c1'),
  ('I1002', 'Worker', 'W Two', 'x', '{"assignedManagerId": "rm_annlee", "teamId": "1"}', 'c0000000-0000-0000-0000-0000000000c1'),
  ('I1003', 'Worker', 'W Three', 'x', '{"assignedManagerId": "rm_annlee", "teamId": "2"}', 'c0000000-0000-0000-0000-0000000000c1'),
  ('A2001', 'Worker', 'W Four', 'x', '{"assignedManagerId": "rm_cyday"}', 'c0000000-0000-0000-0000-0000000000c2');
insert into routes (route_code, session_date, command_center_id, manager_id) values
  ('GA02', '2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', 'rm_annlee'), ('GA01', '2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', 'rm_annlee'),
  ('BR05', '2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', 'rm_bobkay');
insert into logsheet_sessions (id, worker_id, date, command_center_id, stats, team_worker_ids) values
  ('l1', 'I1001', '2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', '{"stepCount": 4, "prodGross": 600, "upsellGross": 50}', '{I1001,I1002}'),
  ('l2', 'I1003', '2026-10-07', 'c0000000-0000-0000-0000-0000000000c1', '{"stepCount": 1, "prodGross": 150}', '{}');
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c9'), ('a0000000-0000-0000-0000-0000000000ca');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000c9', 'exect', 'Exec Floater'), ('a0000000-0000-0000-0000-0000000000ca', 'plain', 'Plain RM');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'rm_floater'), ('a0000000-0000-0000-0000-0000000000c9', 'route_manager'),
  ('a0000000-0000-0000-0000-0000000000ca', 'route_manager');
do $$ begin insert into user_permissions values ('a0000000-0000-0000-0000-0000000000ca', 'not_a_perm'); raise notice 'FAIL unknown permission stored';
  exception when others then raise notice 'ok unknown permission: %', sqlerrm; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
select center_name, season_type, manager_id, manager_name, phone, routes, areas, workers, carts, steps, gross from app_floater_managers();
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ca', true);
do $$ begin perform app_floater_managers(); raise notice 'FAIL plain RM listed managers';
  exception when others then raise notice 'ok plain RM: %', sqlerrm; end $$;
reset role;
rollback;
