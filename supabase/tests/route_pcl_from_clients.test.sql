-- Start session's PCL counts and dots come from the client database, by each map's routes; only
-- people with a map-related permission can read them, and only counts and positions come back.
\set ON_ERROR_STOP 1
begin;
insert into route_maps (area_name, route_number, route_code, route_color, segments, status) values
  ('TEST SOUTH #3', 36, 'TS36', '#ef4444', '[]', 'approved'), ('TEST SOUTH #3', 37, 'TS37', '#22c55e', '[]', 'approved'),
  ('TEST SOUTH #3', 38, 'TS38', '#06b6d4', '[]', 'pending'), ('OTHER AREA', 1, 'OA01', '#3b82f6', '[]', 'approved');
insert into clients (address_key, house_no, street_name, street_norm, city, route_code, lat, lng) values
  ('k1', '1', 'Spruce Ave', 'spruce ave', 'Burlington', 'TS36', 43.35, -79.76), ('k2', '2', 'Spruce Ave', 'spruce ave', 'Burlington', 'TS36', 43.351, -79.761),
  ('k3', '3', 'Elm St', 'elm st', 'Burlington', 'TS37', null, null), ('k4', '4', 'Oak St', 'oak st', 'Burlington', 'TS38', 43.36, -79.75),
  ('k5', '5', 'Far Rd', 'far rd', 'Burlington', 'OA01', 43.4, -79.8), ('k6', '6', 'No Route Rd', 'no route rd', 'Burlington', null, 43.4, -79.8);
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c9'), ('a0000000-0000-0000-0000-0000000000ca');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000c9', 'pclaa', 'Book Keeper'), ('a0000000-0000-0000-0000-0000000000ca', 'pclbb', 'No Perm');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c9', 'workerbook'), ('a0000000-0000-0000-0000-0000000000ca', 'bookings');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ca', true);
do $$ begin perform app_area_pcl_counts(array['TEST SOUTH #3']); raise notice 'FAIL no-perm counts';
  exception when others then raise notice 'ok no-perm counts: %', sqlerrm; end $$;
do $$ begin perform app_area_pcl_dots('TEST SOUTH #3'); raise notice 'FAIL no-perm dots';
  exception when others then raise notice 'ok no-perm dots: %', sqlerrm; end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c9', true);
select 'counts' k, * from app_area_pcl_counts(array['TEST SOUTH #3']) order by 2;
select 'counts both' k, * from app_area_pcl_counts(array['TEST SOUTH #3', 'OTHER AREA']) order by 2;
select 'dots' k, * from app_area_pcl_dots('TEST SOUTH #3') order by 3;
select 'empty' k, count(*) from app_area_pcl_counts(array[]::text[]);
reset role;
rollback;
