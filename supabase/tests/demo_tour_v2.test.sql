-- The /demo sandbox, second pass: the whole Bridlewood map, made-up clients, hidden from centre lists, swept clean.
\set ON_ERROR_STOP 1
\i supabase/migrations/20261101100000_territory_outlines.sql
\i supabase/migrations/20261104100000_demo_tour.sql
\i :mig

insert into route_maps (area_name, route_number, route_code, route_color, segments, status)
select 'BRIDLEWOOD', g, 'BRID' || lpad(g::text, 2, '0'), '#f00', '[{"osmId":1,"name":"Elm Rd","coordinates":[[-75.86,45.29],[-75.85,45.29]]},{"osmId":2,"name":"Oak St","coordinates":[[-75.86,45.30],[-75.85,45.30]]}]', 'approved' from generate_series(1, 26) g;
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source)
select 'BRID10', g || '|elm rd', g, 'Elm Rd', 'elm rd', 45.29, -75.86 + g * 0.0001, 'osm' from generate_series(1, 120) g;
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source)
select 'BRID08', g || '|oak st', g, 'Oak St', 'oak st', 45.30, -75.86 + g * 0.0001, 'osm' from generate_series(1, 60) g;
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source)
select 'BRID21', g || '|oak st', g, 'Oak St', 'oak st', 45.30, -75.86 + g * 0.0001, 'osm' from generate_series(1, 30) g;
insert into map_pcl_cache (route_code, area_name, clients, client_count) values ('BRID10', 'BRIDLEWOOD', '[{"firstName":"Real","lastName":"Customer","houseNum":"5","streetName":"Elm Rd"}]', 40);
insert into map_pcl_by_service (route_code, service, clients, client_count) values ('BRID10', 'aeration', '[]', 12);
-- a centre-pointing row the old sweep tripped on
create table if not exists geocode_cache_t (x int);

do $$
declare r jsonb; v_code text; cc uuid; pfx text; n int; r1 text;
begin
  r := app_demo_start();
  v_code := r->>'code'; cc := (r->>'center_id')::uuid; pfx := demo_prefix(v_code); r1 := r->'routes'->>0;
  if not (select is_demo from command_centers where id = cc) then raise exception 'not marked demo'; end if;
  if (select count(*) from route_maps where area_name = 'DEMO ' || v_code) <> 26 then raise exception 'whole map'; end if;
  if (select count(*) from routes where command_center_id = cc) <> 26 then raise exception 'routes on the day'; end if;
  if r1 <> pfx || '10' or (r->'routes'->>1) <> pfx || '08' or (r->'routes'->>2) <> pfx || '21' then raise exception 'tour routes: %', r->'routes'; end if;
  if (select count(*) from routes where command_center_id = cc and cardinality(assigned_worker_ids) > 0) <> 2 then raise exception 'two routes assigned'; end if;
  if (select count(*) from route_house_builds where route_code like pfx || '%' and geocoded_at is not null and footprints_at is not null) <> 26 then raise exception 'not every route marked built'; end if;
  if (select count(*) from route_street_checks where route_code like pfx || '%') <> 52 then raise exception 'street checks: %', (select count(*) from route_street_checks where route_code like pfx || '%'); end if;
  if (select client_count from map_pcl_cache where route_code = r1) <> 40 then raise exception 'pcl density: %', (select client_count from map_pcl_cache where route_code = r1); end if;
  if (select clients::text from map_pcl_cache where route_code = r1) like '%Real%' then raise exception 'a real client leaked'; end if;
  if (select client_count from map_pcl_by_service where route_code = r1) <> 12 then raise exception 'other service'; end if;
  if (select count(*) from route_historical_properties where route_code = r1) < 2 then raise exception 'past customers'; end if;
  if (select count(*) from house_dispositions where route_code = r1) <> 8 then raise exception 'partner knocks'; end if;
  if (select count(*) from bookings where command_center_id = cc) <> 1 then raise exception 'booking'; end if;
  -- the floater doesn't see it
  insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000fa');
  insert into app_users (id, username, full_name, is_super_admin) values ('a0000000-0000-0000-0000-0000000000fa', 'tdsad', 'T Admin', true);
  insert into user_permissions values ('a0000000-0000-0000-0000-0000000000fa', 'rm_floater'), ('a0000000-0000-0000-0000-0000000000fa', 'workerbook');
  perform set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000fa', true);
  if exists (select 1 from app_floater_managers() f where f.center_id = cc) then raise exception 'floater sees the demo'; end if;
  if exists (select 1 from app_road_trip_centers() f where f.id = cc) then raise exception 'road-trip list has the demo'; end if;
  -- a row the app might write that points at the centre, then the sweep
  insert into manager_locations (manager_id, command_center_id, lat, lng) values (r->>'manager', cc, 45.3, -75.8);
  update demo_sandboxes set expires_at = now() - interval '1 minute' where code = v_code;
  n := app_demo_cleanup();
  if n <> 1 then raise exception 'sweep %', n; end if;
  if exists (select 1 from command_centers where id = cc) or exists (select 1 from route_maps where area_name = 'DEMO ' || v_code)
     or exists (select 1 from route_street_checks where route_code like pfx || '%') or exists (select 1 from map_pcl_by_service where route_code like pfx || '%')
     or exists (select 1 from route_historical_properties where command_center_id = cc) then raise exception 'not swept'; end if;
  if (select count(*) from route_houses where route_code = 'BRID10') <> 120 then raise exception 'touched the real route'; end if;
  raise notice 'demo tour v2: ok';
end $$;
rollback;
