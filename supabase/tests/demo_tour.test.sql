-- The /demo sandbox: built in one call, isolated by its code, swept clean afterwards.
\set ON_ERROR_STOP 1
\i supabase/migrations/20261101100000_territory_outlines.sql
\i :mig

-- the real routes the sandbox copies (fixtures)
insert into route_maps (area_name, route_number, route_code, route_color, segments, status)
select 'BRIDLEWOOD', g, 'BRID' || lpad(g::text, 2, '0'), '#f00', '[{"osmId":1,"name":"Elm Rd","coordinates":[[-75.86,45.29],[-75.85,45.29]]}]', 'approved' from unnest(array[8, 10, 21, 19]) g;
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source)
select 'BRID08', g || '|elm rd', g, 'Elm Rd', 'elm rd', 45.29, -75.86 + g * 0.0001, 'osm' from generate_series(1, 40) g;
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source)
select 'BRID10', g || '|oak st', g, 'Oak St', 'oak st', 45.30, -75.86 + g * 0.0001, 'osm' from generate_series(1, 10) g;
insert into route_house_builds (route_code, source, house_count) values ('BRID08', 'osm', 40), ('BRID10', 'osm', 10), ('BRID21', 'osm', 0), ('BRID19', 'osm', 0);

do $$
declare r jsonb; v_code text; cc uuid; pfx text; n int;
begin
  r := app_demo_start();
  v_code := r->>'code'; cc := (r->>'center_id')::uuid; pfx := demo_prefix(v_code);
  if length(v_code) <> 3 then raise exception 'code: %', r; end if;
  if (select count(*) from users where command_center_id = cc and role = 'Worker') <> 6 then raise exception 'workers'; end if;
  if (select count(*) from users where command_center_id = cc and role = 'RouteManager') <> 2 then raise exception 'managers'; end if;
  if (select count(*) from logsheet_sessions where command_center_id = cc) <> 3 then raise exception 'carts'; end if;
  if (select count(*) from routes where command_center_id = cc) <> 4 then raise exception 'routes'; end if;
  if (select count(*) from routes where command_center_id = cc and cardinality(assigned_worker_ids) = 0) <> 2 then raise exception 'two routes should wait to be assigned'; end if;
  if (select count(*) from route_houses where route_code = pfx || '01') <> 40 then raise exception 'houses copied: %', (select count(*) from route_houses where route_code = pfx || '01'); end if;
  if (select geocoded_at from route_house_builds where route_code = pfx || '01') is null then raise exception 'copied route would geocode'; end if;
  if (select count(*) from house_dispositions where route_code = pfx || '01') <> 8 then raise exception 'partner knocks'; end if;
  if (select count(*) from house_dispositions where route_code = pfx || '01' and status = 'invalid') <> 1 then raise exception 'invalid knock'; end if;
  if (select count(*) from route_historical_properties where command_center_id = cc) <> 3 then raise exception 'past customers'; end if;
  if (select client_count from map_pcl_cache where route_code = pfx || '01') <> 3 then raise exception 'pcl'; end if;
  if (select client_count from map_pcl_by_service where route_code = pfx || '01' and service = 'aeration') <> 1 then raise exception 'aeration pcl'; end if;
  if (select count(*) from bookings where command_center_id = cc and status = 'pending') <> 1 then raise exception 'booking'; end if;
  if (select (metadata->'digitalMapping'->>'areaName') from users where user_id = r->>'manager') <> 'DEMO ' || v_code then raise exception 'manager map'; end if;
  -- the sandbox is nowhere near the real routes
  if exists (select 1 from house_dispositions where route_code like 'BRID%') then raise exception 'touched the real route'; end if;

  -- Chris arrives late: on the map, on a cart of his own; asking twice is harmless
  r := app_demo_late_arrival(v_code);
  if not exists (select 1 from users where user_id = 'X' || v_code || '7' and command_center_id = cc) then raise exception 'late worker'; end if;
  if (select count(*) from logsheet_sessions where command_center_id = cc) <> 4 then raise exception 'late cart'; end if;
  r := app_demo_late_arrival(v_code);
  if (select count(*) from logsheet_sessions where command_center_id = cc) <> 4 then raise exception 'late twice'; end if;

  -- still live: the sweep leaves it; expired: everything goes
  if app_demo_cleanup() <> 0 then raise exception 'swept a live demo'; end if;
  update demo_sandboxes set expires_at = now() - interval '1 minute' where code = v_code;
  n := app_demo_cleanup();
  if n <> 1 then raise exception 'sweep count %', n; end if;
  if exists (select 1 from command_centers where id = cc) or exists (select 1 from users where command_center_id = cc)
     or exists (select 1 from route_houses where route_code like pfx || '%') or exists (select 1 from route_maps where area_name = 'DEMO ' || v_code)
     or exists (select 1 from house_dispositions where route_code like pfx || '%') or exists (select 1 from client_visits where route_code like pfx || '%')
     or exists (select 1 from map_pcl_cache where route_code like pfx || '%') or exists (select 1 from area_prefixes where area_name = 'DEMO ' || v_code)
     or exists (select 1 from demo_sandboxes where demo_sandboxes.code = v_code) then raise exception 'not swept clean'; end if;
  if (select count(*) from route_houses where route_code = 'BRID08') <> 40 then raise exception 'sweep hit the real route'; end if;
  raise notice 'demo tour sandbox: ok';
end $$;

-- the sweep is not for the app to call
do $$ begin
  if has_function_privilege('anon', 'public.app_demo_cleanup()', 'execute') then raise exception 'anon can sweep'; end if;
  if not has_function_privilege('anon', 'public.app_demo_start()', 'execute') then raise exception 'anon cannot start'; end if;
end $$;
rollback;
